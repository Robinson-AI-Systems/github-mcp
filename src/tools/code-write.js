// Files, commits and refs, change side (D-2 part 2). Every tool is a `defineGithubWrite`. A branch must always be named (nothing is
// written to a guessed default), and the branch is part of the target, so production names, protected branches, project-owned refs and
// the protected-resource list all see it. File writes are optimistic-concurrency safe: the file's current blob SHA is read, shown in the
// preview and sent; a change since the preview is refused with the new SHA.
import { graphql } from '../github/client.js';
import { defineGithubWrite } from './define-github-write.js';
import { OUTSIDE_PROJECT } from './protect-guard.js';
import { missing, octo, ownerOf, refusal, slug } from './github-write.js';
import { notifyOutsiders } from './people-guard.js';
import { productionReason } from './production-guard.js';
import { overridable } from './rule-override.js';

const OWNER = { type: 'string', maxLength: 39, description: 'GitHub account (default: the connection\'s default account)' };
const REPO = { type: 'string', minLength: 1, maxLength: 100 };
const BRANCH = { type: 'string', minLength: 1, maxLength: 250, description: 'The branch to write to (always named; there is no default)' };
const MESSAGE = { type: 'string', minLength: 1, maxLength: 2000, description: 'Commit message' };
const MAX_FILE_CHARS = 200_000;
const MAX_INVERSE_CHARS = 100_000;
const short = (sha) => String(sha ?? '').slice(0, 7);
const b64 = (text) => Buffer.from(text, 'utf8').toString('base64');
const branchTarget = (args, ctx) => ({ owner: ownerOf(args, ctx), repo: args.repo, ref: args.branch, scope: 'repo' });
const productionOf = (ctx, target) => productionReason(ctx, target);

const readFile = (ctx, target, path, ref) => missing(async () => (await (await octo(ctx, target.owner)).request('GET /repos/{owner}/{repo}/contents/{path}', { owner: target.owner, repo: target.repo, path, ref })).data);
const textOf = (file) => (file && file.encoding === 'base64' && typeof file.content === 'string' ? Buffer.from(file.content, 'base64') : null);
const decodedText = (file) => { const buffer = textOf(file); return buffer && !buffer.includes(0) ? buffer.toString('utf8') : null; };
const cleanPath = (path) => {
  const p = String(path ?? '').replace(/^\/+/, '');
  if (!p || p.endsWith('/') || p.split('/').some((part) => part === '..' || part === '.' || part === '')) throw new TypeError('The path must be a file path inside the repository, such as docs/readme.md.');
  return p;
};
const changedSince = (args, before, path) => {
  if (!args.expectedSha) return;
  const now = before?.sha ?? null;
  if (!now || !now.startsWith(String(args.expectedSha).toLowerCase())) {
    throw refusal(`The file changed since the preview: ${path} is now at version ${short(now) || '(deleted)'} but you expected ${short(args.expectedSha)}. Read it again, then redo the change.`, 409);
  }
};

const FILE_PROPS = { owner: OWNER, repo: REPO, branch: BRANCH, path: { type: 'string', minLength: 1, maxLength: 1000, description: 'File path inside the repository' }, message: MESSAGE,
  expectedSha: { type: 'string', minLength: 7, maxLength: 40, description: 'The file version shown in the preview; the change is refused if the file has changed since' }, ...OUTSIDE_PROJECT };

const contentPutFile = defineGithubWrite(overridable({
  name: 'github_content_put_file', area: 'content', audience: ['B'],
  description: 'Create or update one file with a commit on a named branch; refused if the file changed since your preview.',
  properties: { ...FILE_PROPS, content: { type: 'string', maxLength: MAX_FILE_CHARS, description: 'The new text of the file' } },
  required: ['repo', 'branch', 'path', 'message', 'content'],
  declarations: { production: 'when-target' },
  target: (args, ctx) => { cleanPath(args.path); return branchTarget(args, ctx); },
  read: (args, ctx, target) => readFile(ctx, target, cleanPath(args.path), args.branch),
  classify: ({ ctx, target }) => productionOf(ctx, target).then((production) => ({ production })),
  summarize: ({ args, before, target }) => {
    const where = `${slug(target.owner, target.repo)} on ${args.branch}`;
    return before ? `Update ${cleanPath(args.path)} in ${where} (now version ${short(before.sha)}, ${before.size} bytes; new text ${Buffer.byteLength(args.content)} bytes). Pass expectedSha: ${short(before.sha)} to make the change refuse if the file moves first`
      : `Create ${cleanPath(args.path)} in ${where} (${Buffer.byteLength(args.content)} bytes)`;
  },
  apply: async ({ args, ctx, before, target }) => {
    const path = cleanPath(args.path);
    changedSince(args, before, path);
    return (await octo(ctx, target.owner)).request('PUT /repos/{owner}/{repo}/contents/{path}', { owner: target.owner, repo: target.repo, path, message: args.message, content: b64(args.content), branch: args.branch, ...(before ? { sha: before.sha } : {}) });
  },
  readAfter: ({ args, ctx, target }) => readFile(ctx, target, cleanPath(args.path), args.branch),
  verify: ({ args, after }) => decodedText(after) === args.content,
  inverse: ({ args, before, target }) => {
    const path = cleanPath(args.path);
    if (!before) return { tool: 'github_content_delete_file', args: { owner: target.owner, repo: target.repo, branch: args.branch, path, message: `Undo: remove ${path}` } };
    const previous = decodedText(before);
    return previous !== null && previous.length <= MAX_INVERSE_CHARS ? { tool: 'github_content_put_file', args: { owner: target.owner, repo: target.repo, branch: args.branch, path, message: `Undo: restore ${path}`, content: previous } } : null;
  },
  present: ({ after }) => ({ path: after?.path, sha: after?.sha, size: after?.size })
}, { branchOf: (args) => args.branch }));

const contentDeleteFile = defineGithubWrite(overridable({
  name: 'github_content_delete_file', area: 'content', audience: ['B'],
  description: 'Delete one file with a commit on a named branch; refused if the file changed since your preview.',
  properties: FILE_PROPS,
  required: ['repo', 'branch', 'path', 'message'],
  declarations: { production: 'when-target', confirm: 'always' },
  target: (args, ctx) => { cleanPath(args.path); return branchTarget(args, ctx); },
  read: (args, ctx, target) => readFile(ctx, target, cleanPath(args.path), args.branch),
  classify: ({ ctx, target }) => productionOf(ctx, target).then((production) => ({ production })),
  summarize: ({ args, before, target }) => (before ? `Delete ${cleanPath(args.path)} from ${slug(target.owner, target.repo)} on ${args.branch} (version ${short(before.sha)}, ${before.size} bytes)` : `${cleanPath(args.path)} does not exist on ${args.branch}, so there is nothing to delete`),
  apply: async ({ args, ctx, before, target }) => {
    const path = cleanPath(args.path);
    if (!before) throw refusal(`${path} does not exist on ${args.branch}.`, 404);
    changedSince(args, before, path);
    return (await octo(ctx, target.owner)).request('DELETE /repos/{owner}/{repo}/contents/{path}', { owner: target.owner, repo: target.repo, path, message: args.message, sha: before.sha, branch: args.branch });
  },
  readAfter: async ({ args, ctx, target }) => ((await readFile(ctx, target, cleanPath(args.path), args.branch)) === null ? 'gone' : 'still there'),
  verify: ({ after }) => after === 'gone',
  inverse: ({ args, before, target }) => {
    const previous = decodedText(before);
    return previous !== null && previous.length <= MAX_INVERSE_CHARS ? { tool: 'github_content_put_file', args: { owner: target.owner, repo: target.repo, branch: args.branch, path: cleanPath(args.path), message: `Undo: restore ${cleanPath(args.path)}`, content: previous } } : null;
  },
  present: () => ({ deleted: true })
}, { branchOf: (args) => args.branch }));

// ---- several files in one commit ----
const COMMIT = 'mutation($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { oid url } } }';
const MAX_FILES = 50;
const MAX_TOTAL_CHARS = 500_000;
const FILE_ITEM = { type: 'object', properties: { path: { type: 'string', minLength: 1, maxLength: 1000 }, content: { type: 'string', maxLength: MAX_FILE_CHARS, description: 'New text of the file' },
  delete: { type: 'boolean', description: 'true to delete this path instead of writing it' } }, required: ['path'], additionalProperties: false };

function checkFiles(files) {
  const seen = new Set();
  let total = 0;
  for (const f of files) {
    const path = cleanPath(f.path);
    if (seen.has(path)) throw new TypeError(`${path} is listed twice.`);
    seen.add(path);
    if (f.delete === true ? f.content !== undefined : typeof f.content !== 'string') throw new TypeError(`${path}: give either content to write or delete: true, not both and not neither.`);
    total += (f.content ?? '').length;
  }
  if (total > MAX_TOTAL_CHARS) throw new TypeError('That is too much text for one commit through this tool (500,000 characters).');
}

const headOf = (ctx, target, branch) => missing(async () => (await (await octo(ctx, target.owner)).request('GET /repos/{owner}/{repo}/branches/{branch}', { owner: target.owner, repo: target.repo, branch })).data.commit.sha);

const contentPushFiles = defineGithubWrite(overridable({
  name: 'github_content_push_files', area: 'content', audience: ['B'],
  description: 'Commit several file changes at once on a named branch, signed by GitHub; refused if the branch moved since your preview.',
  properties: { owner: OWNER, repo: REPO, branch: BRANCH, message: MESSAGE, files: { type: 'array', items: FILE_ITEM, minItems: 1, maxItems: MAX_FILES },
    expectedHead: { type: 'string', minLength: 40, maxLength: 40, description: 'The branch head shown in the preview; the commit is refused if the branch has moved' }, ...OUTSIDE_PROJECT },
  required: ['repo', 'branch', 'message', 'files'],
  declarations: { production: 'when-target' },
  target: (args, ctx) => { checkFiles(args.files); return branchTarget(args, ctx); },
  read: (args, ctx, target) => headOf(ctx, target, args.branch),
  classify: ({ ctx, target }) => productionOf(ctx, target).then((production) => ({ production })),
  summarize: ({ args, before, target }) => {
    const writes = args.files.filter((f) => !f.delete).map((f) => f.path);
    const deletes = args.files.filter((f) => f.delete).map((f) => f.path);
    const list = [...writes.map((p) => `+${p}`), ...deletes.map((p) => `-${p}`)];
    return before ? `Commit ${args.files.length} file change(s) to ${slug(target.owner, target.repo)} on ${args.branch} (observed head ${short(before)}; pass expectedHead: ${before} to refuse if it moves): ${list.slice(0, 10).join(', ')}${list.length > 10 ? ` and ${list.length - 10} more` : ''}`
      : `${args.branch} does not exist in ${slug(target.owner, target.repo)}`;
  },
  apply: async ({ args, ctx, before, target }) => {
    if (!before) throw refusal(`The branch ${args.branch} does not exist.`, 404);
    const additions = args.files.filter((f) => !f.delete).map((f) => ({ path: cleanPath(f.path), contents: b64(f.content) }));
    const deletions = args.files.filter((f) => f.delete).map((f) => ({ path: cleanPath(f.path) }));
    if (args.expectedHead && args.expectedHead !== before) throw refusal(`The branch ${args.branch} moved since the preview: it now points at ${short(before)}, not ${short(args.expectedHead)}. Nothing was changed; preview again.`, 409);
    const octokit = await octo(ctx, target.owner);
    const [headline, ...rest] = args.message.split('\n');
    const data = await graphql(octokit, COMMIT, { input: { branch: { repositoryNameWithOwner: slug(target.owner, target.repo), branchName: args.branch },
      message: { headline: headline.slice(0, 250), ...(rest.join('\n').trim() ? { body: rest.join('\n').trim() } : {}) }, expectedHeadOid: args.expectedHead ?? before,
      fileChanges: { ...(additions.length ? { additions } : {}), ...(deletions.length ? { deletions } : {}) } } });
    return { data };
  },
  readAfter: ({ args, ctx, target }) => headOf(ctx, target, args.branch),
  verify: ({ before, after, response }) => !!after && after !== before && after === response?.data?.createCommitOnBranch?.commit?.oid,
  present: ({ response }) => ({ commit: response?.data?.createCommitOnBranch?.commit?.oid, url: response?.data?.createCommitOnBranch?.commit?.url })
}, { branchOf: (args) => args.branch }));

// ---- small edits to several files in one commit (send only what changes, not whole files) ----
const MAX_EDIT_CHARS = 20_000;
const EDIT_ITEM = { type: 'object', properties: { find: { type: 'string', minLength: 1, maxLength: MAX_EDIT_CHARS, description: 'Exact text to find (must appear once unless all is true)' },
  replace: { type: 'string', maxLength: MAX_EDIT_CHARS, description: 'Text to put in its place (empty removes it)' }, all: { type: 'boolean', description: 'Replace every occurrence' } },
required: ['find', 'replace'], additionalProperties: false };
const EDIT_FILE_ITEM = { type: 'object', properties: { path: { type: 'string', minLength: 1, maxLength: 1000 }, edits: { type: 'array', items: EDIT_ITEM, minItems: 1, maxItems: 50 } }, required: ['path', 'edits'], additionalProperties: false };

function checkEditFiles(files) {
  const seen = new Set();
  let total = 0;
  for (const f of files) {
    const path = cleanPath(f.path);
    if (seen.has(path)) throw new TypeError(`${path} is listed twice.`);
    seen.add(path);
    for (const e of f.edits) total += e.find.length + e.replace.length;
  }
  if (total > MAX_TOTAL_CHARS) throw new TypeError('Those edits are too large for one commit through this tool (500,000 characters).');
}
const snippet = (text) => JSON.stringify(text.length > 60 ? text.slice(0, 57) + '...' : text);
/** Applies one file's edits in order. Plain text matching (no patterns); the text to find must be there, and unique unless `all`. */
export function applyEdits(text, edits, path) {
  let out = text;
  const problems = [];
  for (const e of edits) {
    const parts = out.split(e.find);
    const count = parts.length - 1;
    if (count === 0) { problems.push(`${path}: the text ${snippet(e.find)} was not found`); continue; }
    if (count > 1 && e.all !== true) { problems.push(`${path}: the text ${snippet(e.find)} appears ${count} times; add more surrounding text or set all: true`); continue; }
    out = parts.join(e.replace);
  }
  return { text: out, problems };
}
const planEdits = (args, before) => {
  const changes = [], problems = [];
  for (const f of args.files) {
    const path = cleanPath(f.path);
    const have = before.files.find((x) => x.path === path);
    if (!have || have.text === null) { problems.push(have ? `${path} is not a text file this tool can edit` : `${path} could not be read`); continue; }
    const r = applyEdits(have.text, f.edits, path);
    problems.push(...r.problems);
    if (!r.problems.length && r.text === have.text) problems.push(`${path}: the edits change nothing`);
    if (!r.problems.length && r.text !== have.text) changes.push({ path, text: r.text, before: have.text.length });
  }
  return { changes, problems };
};

const contentEditFiles = defineGithubWrite(overridable({
  name: 'github_content_edit_files', area: 'content', audience: ['B'],
  description: 'Edit files by find-and-replace and commit on a named branch, signed by GitHub. Send only the changed text, not whole files.',
  properties: { owner: OWNER, repo: REPO, branch: BRANCH, message: MESSAGE, files: { type: 'array', items: EDIT_FILE_ITEM, minItems: 1, maxItems: 20 },
    expectedHead: { type: 'string', minLength: 40, maxLength: 40, description: 'The branch head shown in the preview; the commit is refused if the branch has moved' }, ...OUTSIDE_PROJECT },
  required: ['repo', 'branch', 'message', 'files'],
  declarations: { production: 'when-target' },
  target: (args, ctx) => { checkEditFiles(args.files); return branchTarget(args, ctx); },
  // Reads every file at the branch head it saw, so the edits and the commit's expected head describe the same state.
  read: async (args, ctx, target) => {
    const head = await headOf(ctx, target, args.branch);
    if (!head) return null;
    const files = [];
    for (const f of args.files) {
      const path = cleanPath(f.path);
      files.push({ path, text: decodedText(await readFile(ctx, target, path, head)) });
    }
    return { head, files };
  },
  classify: ({ ctx, target }) => productionOf(ctx, target).then((production) => ({ production })),
  summarize: ({ args, before, target }) => {
    if (!before) return `${args.branch} does not exist in ${slug(target.owner, target.repo)}`;
    const { changes, problems } = planEdits(args, before);
    if (problems.length) return `Cannot apply these edits to ${slug(target.owner, target.repo)} on ${args.branch}: ${problems.join('; ')}`;
    return `Edit ${changes.length} file(s) in ${slug(target.owner, target.repo)} on ${args.branch} (head now ${short(before.head)}; pass expectedHead: ${before.head} to refuse if it moves): ${changes.map((c) => `${c.path} (${c.before} -> ${c.text.length} characters)`).join(', ')}`;
  },
  apply: async ({ args, ctx, before, target }) => {
    if (!before) throw refusal(`The branch ${args.branch} does not exist.`, 404);
    const { changes, problems } = planEdits(args, before);
    if (problems.length) throw refusal(`Nothing was changed. ${problems.join('; ')}`, 422);
    if (args.expectedHead && args.expectedHead !== before.head) throw refusal(`The branch ${args.branch} moved since the preview: it now points at ${short(before.head)}, not ${short(args.expectedHead)}. Nothing was changed; preview again.`, 409);
    const octokit = await octo(ctx, target.owner);
    const [headline, ...rest] = args.message.split('\n');
    const data = await graphql(octokit, COMMIT, { input: { branch: { repositoryNameWithOwner: slug(target.owner, target.repo), branchName: args.branch },
      message: { headline: headline.slice(0, 250), ...(rest.join('\n').trim() ? { body: rest.join('\n').trim() } : {}) }, expectedHeadOid: args.expectedHead ?? before.head,
      fileChanges: { additions: changes.map((c) => ({ path: c.path, contents: b64(c.text) })) } } });
    return { data };
  },
  readAfter: ({ args, ctx, target }) => headOf(ctx, target, args.branch),
  verify: ({ before, after, response }) => !!after && after !== before?.head && after === response?.data?.createCommitOnBranch?.commit?.oid,
  present: ({ response }) => ({ commit: response?.data?.createCommitOnBranch?.commit?.oid, url: response?.data?.createCommitOnBranch?.commit?.url })
}, { branchOf: (args) => args.branch }));

// ---- comment on a commit ----
const commitComment = defineGithubWrite({
  name: 'github_commit_comment', area: 'commit', audience: ['B'],
  description: 'Comment on a commit, optionally on a line of one file. Notifies the people it mentions.',
  properties: { owner: OWNER, repo: REPO, sha: { type: 'string', minLength: 7, maxLength: 40 }, body: { type: 'string', minLength: 1, maxLength: 5000 },
    path: { type: 'string', maxLength: 1000, description: 'File to comment on (with line)' }, line: { type: 'integer', minimum: 1 } },
  required: ['repo', 'sha', 'body'],
  declarations: { production: 'never', notifies: true },
  target: (args, ctx) => {
    if ((args.path === undefined) !== (args.line === undefined)) throw new TypeError('To comment on a line, give both path and line.');
    return { owner: ownerOf(args, ctx), repo: args.repo, scope: 'repo' };
  },
  read: async (args, ctx, target) => (await (await octo(ctx, target.owner)).request('GET /repos/{owner}/{repo}/commits/{ref}', { owner: target.owner, repo: target.repo, ref: args.sha })).data.sha,
  classify: ({ args, ctx, target }) => notifyOutsiders(ctx, { text: args.body, repoOwner: target.owner }),
  summarize: ({ args, before, target }) => `Comment on commit ${short(before)} of ${slug(target.owner, target.repo)}${args.path ? ` (${args.path}, line ${args.line})` : ''}: "${args.body.slice(0, 80)}"`,
  apply: async ({ args, ctx, before, target }) => (await octo(ctx, target.owner)).request('POST /repos/{owner}/{repo}/commits/{commit_sha}/comments', {
    owner: target.owner, repo: target.repo, commit_sha: before, body: args.body, ...(args.path ? { path: args.path, line: args.line } : {}) }),
  readAfter: async ({ ctx, target, response }) => (await (await octo(ctx, target.owner)).request('GET /repos/{owner}/{repo}/comments/{comment_id}', { owner: target.owner, repo: target.repo, comment_id: response.data.id })).data,
  verify: ({ args, after }) => after?.body === args.body,
  present: ({ after }) => ({ id: after?.id, html_url: after?.html_url })
});

// ---- move a ref (compare-and-swap) ----
const UPDATE_REFS = 'mutation($input: UpdateRefsInput!) { updateRefs(input: $input) { clientMutationId } }';
const fullRef = (ref) => (String(ref).startsWith('refs/') ? String(ref) : `refs/${ref}`);
const nameOf = (full) => full.replace(/^refs\/(heads|tags)\//, '');

const gitUpdateRef = defineGithubWrite(overridable({
  name: 'github_git_update_ref', area: 'git', audience: ['B'],
  description: 'Move a branch or tag to another commit, only if it still points where you saw it. Force moves need force: true.',
  properties: { owner: OWNER, repo: REPO, ref: { type: 'string', minLength: 1, maxLength: 250, description: 'heads/<branch> or tags/<tag>' }, sha: { type: 'string', minLength: 40, maxLength: 40, description: 'The commit to move it to' },
    force: { type: 'boolean', description: 'Allow a move that drops commits (not a fast-forward)' },
    expectedSha: { type: 'string', minLength: 40, maxLength: 40, description: 'Where the ref pointed in your preview; refused if it moved' }, ...OUTSIDE_PROJECT },
  required: ['repo', 'ref', 'sha'],
  declarations: { production: 'when-target', confirm: 'always', profiles: ['full'] },
  target: (args, ctx) => {
    const full = fullRef(args.ref);
    if (!/^refs\/(heads|tags)\/.+/.test(full)) throw new TypeError('The ref must be a branch (heads/<name>) or a tag (tags/<name>).');
    return { owner: ownerOf(args, ctx), repo: args.repo, ref: nameOf(full), scope: 'repo', ...(full.startsWith('refs/tags/') ? { kind: 'tag' } : {}) };
  },
  read: async (args, ctx, target) => {
    const octokit = await octo(ctx, target.owner);
    const full = fullRef(args.ref);
    const repo = (await octokit.request('GET /repos/{owner}/{repo}', { owner: target.owner, repo: target.repo })).data;
    const current = (await octokit.request('GET /repos/{owner}/{repo}/git/ref/{ref}', { owner: target.owner, repo: target.repo, ref: full.replace(/^refs\//, '') })).data.object.sha;
    const compare = await missing(async () => (await octokit.request('GET /repos/{owner}/{repo}/compare/{basehead}', { owner: target.owner, repo: target.repo, basehead: `${current}...${args.sha}` })).data);
    return { nodeId: repo.node_id, current, ahead: compare?.ahead_by ?? null, dropped: compare?.behind_by ?? null, status: compare?.status ?? null };
  },
  classify: ({ ctx, target }) => productionOf(ctx, target).then((production) => ({ production })),
  summarize: ({ args, before, target }) => {
    const where = `${args.ref} in ${slug(target.owner, target.repo)}`;
    if (before.current === args.sha) return `${where} already points at ${short(args.sha)}`;
    const effect = before.dropped === null ? 'the effect on commits could not be worked out' : before.dropped > 0 ? `${before.dropped} commit(s) would be dropped from it` : `${before.ahead} new commit(s) added`;
    return `Move ${where} from ${short(before.current)} to ${short(args.sha)}: ${effect}${before.dropped > 0 && args.force !== true ? '. This is not a fast-forward, so it needs force: true' : ''}`;
  },
  apply: async ({ args, ctx, before, target }) => {
    if (args.expectedSha && args.expectedSha !== before.current) throw refusal(`The ref moved since the preview: it now points at ${short(before.current)}, not ${short(args.expectedSha)}.`, 409);
    if ((before.dropped === null || before.dropped > 0) && args.force !== true) throw refusal('That move drops commits (it is not a fast-forward). Pass force: true if you really mean it.', 422);
    const octokit = await octo(ctx, target.owner);
    await graphql(octokit, UPDATE_REFS, { input: { repositoryId: before.nodeId, refUpdates: [{ name: fullRef(args.ref), afterOid: args.sha, beforeOid: before.current, ...(args.force === true ? { force: true } : {}) }] } });
  },
  readAfter: async ({ args, ctx, target }) => (await (await octo(ctx, target.owner)).request('GET /repos/{owner}/{repo}/git/ref/{ref}', { owner: target.owner, repo: target.repo, ref: fullRef(args.ref).replace(/^refs\//, '') })).data.object.sha,
  verify: ({ args, after }) => after === args.sha,
  inverse: ({ args, before, target }) => ({ tool: 'github_git_update_ref', args: { owner: target.owner, repo: target.repo, ref: args.ref, sha: before.current, expectedSha: args.sha, force: true } }),
  present: ({ args, after }) => ({ ref: args.ref, now_at: after })
}, { branchOf: (_args, target) => (target.kind === 'tag' ? null : target.ref) }));

const all = [contentPutFile, contentDeleteFile, contentPushFiles, contentEditFiles, commitComment, gitUpdateRef];
export const tools = all.map((d) => d.tool);
export const handlers = Object.fromEntries(all.map((d) => [d.tool.name, d.handler]));
