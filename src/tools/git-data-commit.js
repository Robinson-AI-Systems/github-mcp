// PAR-3: atomic Git Data writes for binary and text files on one named branch.
// A Git commit has the observed branch head as its sole parent, unlike independent file PUTs.
// Loose blobs/trees/commits may remain if GitHub refuses the final non-forced fast-forward.
import { createHash } from 'node:crypto';
import { defineGithubWrite } from './define-github-write.js';
import { OUTSIDE_PROJECT } from './protect-guard.js';
import { missing, octo, ownerOf, refusal, slug } from './github-write.js';
import { productionReason } from './production-guard.js';

const OWNER = { type: 'string', maxLength: 39 };
const REPO = { type: 'string', minLength: 1, maxLength: 100 };
const BRANCH = { type: 'string', minLength: 1, maxLength: 250 };
const SHA = { type: 'string', pattern: '^[a-fA-F0-9]{40}$' };
const MAX_FILES = 50;
const MAX_FILE_BYTES = 1_500_000;
const MAX_TOTAL_BYTES = 2_000_000;
const MAX_ENCODED_CHARS = 2_000_000;
const short = (sha) => String(sha ?? '').slice(0, 7);
const targetOf = (a, ctx) => ({ owner: ownerOf(a, ctx), repo: a.repo, ref: a.branch, scope: 'repo' });
const branchHead = (ctx, t, branch) => missing(async () => (
  await (await octo(ctx, t.owner)).request('GET /repos/{owner}/{repo}/branches/{branch}',
    { owner: t.owner, repo: t.repo, branch })).data.commit.sha);
const gitParams = (t) => ({ owner: t.owner, repo: t.repo });

function pathOf(path) {
  if (typeof path !== 'string' || !path || path.length > 1000 || path.startsWith('/') ||
      path.endsWith('/') || /[\\\x00-\x1f\x7f]/.test(path) ||
      path.split('/').some((p) => !p || p === '.' || p === '..'))
    throw new TypeError('Every file must have a safe repository-relative path.');
  return path;
}

/** Strictly decode canonical base64; no silent repairs or lossy UTF-8 conversion. */
export function bytesOf(item) {
  if (item.delete === true) {
    if (item.content !== undefined || item.encoding !== undefined || item.mode !== undefined)
      throw new TypeError('A deletion cannot also supply content, encoding or mode.');
    return null;
  }
  if (typeof item.content !== 'string')
    throw new TypeError('Supply file content as UTF-8 text or canonical base64 bytes.');
  const encoding = item.encoding ?? 'utf-8';
  if (encoding !== 'base64' && encoding !== 'utf-8')
    throw new TypeError('File encoding must be utf-8 or base64.');
  if (item.content.length > MAX_ENCODED_CHARS) throw new TypeError('Encoded content is too large.');
  if (encoding === 'base64' && !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.content))
    throw new TypeError('Binary content must use canonical padded base64 without whitespace.');
  const bytes = Buffer.from(item.content, encoding === 'base64' ? 'base64' : 'utf8');
  if (encoding === 'base64' && bytes.toString('base64') !== item.content)
    throw new TypeError('Binary content has noncanonical or invalid base64 padding.');
  if (bytes.length > MAX_FILE_BYTES) throw new TypeError('A file exceeds the 1.5 MB upload limit.');
  if (item.mode !== undefined && item.mode !== '100644' && item.mode !== '100755')
    throw new TypeError('Only regular file and executable modes are supported (100644 or 100755).');
  return bytes;
}

export function checkGitFiles(files) {
  if (!Array.isArray(files) || files.length < 1 || files.length > MAX_FILES)
    throw new TypeError('Provide 1-50 file operations; oversized batches are refused, never truncated.');
  const paths = new Set();
  let total = 0;
  let additions = 0;
  for (const item of files) {
    const path = pathOf(item.path);
    if (paths.has(path)) throw new TypeError('Duplicate file path: ' + path);
    paths.add(path);
    const bytes = bytesOf(item);
    if (bytes !== null) { additions += 1; total += bytes.length; }
  }
  if (total > MAX_TOTAL_BYTES) throw new TypeError('Combined files exceed the 2 MB limit.');
  return { total, additions, deletions: files.length - additions };
}

const FILE = { type: 'object', additionalProperties: false, properties: {
  path: { type: 'string', minLength: 1, maxLength: 1000 },
  content: { type: 'string', maxLength: MAX_ENCODED_CHARS, description: 'Non-secret file content, plain text or canonical base64 for binary bytes' },
  encoding: { type: 'string', enum: ['utf-8', 'base64'], description: 'base64 preserves binary bytes (e.g. a PDF); utf-8 is the default' },
  mode: { type: 'string', enum: ['100644', '100755'], description: 'Regular file mode; default 100644; choose 100755 only for executables' },
  delete: { type: 'boolean', description: 'Delete this path instead of providing content' }
}, required: ['path'] };

export const gitDataCommit = defineGithubWrite({
  name: 'github_content_commit_git_data', area: 'content', audience: ['B'],
  description: 'Commit binary PDFs or text and deletions via real Git blobs, tree and exact-parent commit, with a non-force branch update.',
  properties: { owner: OWNER, repo: REPO, branch: BRANCH,
    message: { type: 'string', minLength: 1, maxLength: 2000 },
    expectedHead: { type: 'string', pattern: '^([a-fA-F0-9]{40})?$', description: 'Exact observed destination head, or empty for an absent branch.' },
    createFrom: { ...SHA, description: 'For an absent branch only: exact source commit to parent the new commit. Existing branches keep their own head.' },
    expectedFileCount: { type: 'integer', minimum: 1, maximum: MAX_FILES, description: 'Independent intended count; mismatch refuses before any provider request.' },
    files: { type: 'array', minItems: 1, maxItems: MAX_FILES, items: FILE },
    ...OUTSIDE_PROJECT },
  required: ['repo', 'branch', 'message', 'files'],
  declarations: { production: 'when-target' },
  target: (args, ctx) => {
    checkGitFiles(args.files);
    if (args.expectedFileCount !== undefined && args.expectedFileCount !== args.files.length)
      throw new TypeError('expectedFileCount does not match the submitted files; nothing was sent.');
    return targetOf(args, ctx);
  },
  read: async (args, ctx, t) => {
    const head = await branchHead(ctx, t, args.branch);
    if (!head && !args.createFrom) throw Object.assign(new TypeError('The target branch does not exist. Supply createFrom with an exact source commit, or create the branch first. Nothing was sent.'), {safeMessage:true});
    return { head, parent: head ?? args.createFrom.toLowerCase(), create: !head };
  },
  classify: ({ ctx, target }) => productionReason(ctx, target).then((production) => ({ production })),
  summarize: ({ args, before, target }) => {
    const info = checkGitFiles(args.files);
    return before?.parent ? 'Commit ' + info.additions + ' file(s) and ' + info.deletions +
      ' deletion(s) (' + info.total + ' bytes) to ' + slug(target.owner, target.repo) +
      ':' + args.branch + ', parent ' + short(before.parent) + '; observed destination ' + (before.head ?? 'absent') +
      '. Binary content stays on GitHub and is not returned.'
      : 'The branch ' + args.branch + ' does not exist.';
  },
  apply: async ({ args, before, ctx, target }) => {
    if (args.expectedHead !== undefined && args.expectedHead.toLowerCase() !== (before.head ?? '').toLowerCase())
      throw refusal('The destination branch moved since your preview; inspect its exact head before another intent.', 409);
    const gh = await octo(ctx, target.owner);
    const p = gitParams(target);
    const base = (await gh.request('GET /repos/{owner}/{repo}/git/commits/{commit_sha}',
      { ...p, commit_sha: before.parent })).data;
    if (base?.sha !== before.parent || !/^[a-f0-9]{40}$/i.test(base?.tree?.sha ?? ''))
      throw refusal('The parent commit tree could not be verified; nothing was committed.');
    const treeEntries = [];
    for (const item of args.files) {
      const path = pathOf(item.path);
      const bytes = bytesOf(item);
      if (bytes === null) {
        treeEntries.push({ path, mode: '100644', type: 'blob', sha: null });
      } else {
        const blob = (await gh.request('POST /repos/{owner}/{repo}/git/blobs',
          { ...p, content: bytes.toString('base64'), encoding: 'base64' })).data;
        const expectedBlob = createHash('sha1').update(Buffer.concat([Buffer.from('blob ' + bytes.length + '\0'), bytes])).digest('hex');
        if (blob?.sha !== expectedBlob)
          throw refusal('GitHub did not acknowledge the uploaded blob.');
        treeEntries.push({ path, mode: item.mode ?? '100644', type: 'blob', sha: blob.sha });
      }
    }
    const tree = (await gh.request('POST /repos/{owner}/{repo}/git/trees',
      { ...p, base_tree: base.tree.sha, tree: treeEntries })).data;
    if (!/^[a-f0-9]{40}$/i.test(tree?.sha ?? ''))
      throw refusal('GitHub did not acknowledge the proposed tree.');
    if (tree.sha === base.tree.sha)
      throw refusal('The proposed changes have no effect on the branch tree.');
    const commit = (await gh.request('POST /repos/{owner}/{repo}/git/commits',
      { ...p, message: args.message, tree: tree.sha, parents: [before.parent] })).data;
    if (!/^[a-f0-9]{40}$/i.test(commit?.sha ?? ''))
      throw refusal('GitHub did not acknowledge the parented Git commit.');
    // force=false disallows a race-lost sibling commit from overwriting new branch history.
    if (before.create) await gh.request('POST /repos/{owner}/{repo}/git/refs',
      { ...p, ref: 'refs/heads/' + args.branch, sha: commit.sha });
    else await gh.request('PATCH /repos/{owner}/{repo}/git/refs/{ref}',
      { ...p, ref: 'heads/' + args.branch, sha: commit.sha, force: false });
    return { data: { sha: commit.sha, tree: tree.sha, parent: before.parent,
      files: args.files.length, manifest: treeEntries } };
  },
  readAfter: async ({ args, ctx, target, response }) => {
    const head = await branchHead(ctx, target, args.branch);
    const gh = await octo(ctx, target.owner), p = gitParams(target);
    const commit = (await gh.request('GET /repos/{owner}/{repo}/git/commits/{commit_sha}', { ...p, commit_sha: response.data.sha })).data;
    const tree = (await gh.request('GET /repos/{owner}/{repo}/git/trees/{tree_sha}', { ...p, tree_sha: response.data.tree, recursive: '1' })).data;
    const entries = new Map((tree.tree ?? []).map(entry => [entry.path, entry]));
    const complete = tree.truncated === false && tree.sha === response.data.tree;
    const confirmedFiles = complete && head === response.data.sha && commit.sha === response.data.sha && commit.parents?.length === 1 && commit.parents[0].sha === response.data.parent && commit.tree?.sha === response.data.tree ? response.data.manifest.filter(item => item.sha === null
      ? !entries.has(item.path) : entries.get(item.path)?.sha === item.sha && entries.get(item.path)?.mode === item.mode && entries.get(item.path)?.type === 'blob').length : 0;
    return { head, commit: commit.sha, parent: commit.parents?.length === 1 ? commit.parents[0].sha : null,
      tree: commit.tree?.sha, complete, confirmedFiles };
  },
  verify: ({ before, after, response }) => after.head === response.data.sha && after.commit === response.data.sha &&
    after.parent === before.parent && after.tree === response.data.tree && after.complete && after.confirmedFiles === response.data.files,
  present: ({ after, response }) => ({ branch_head: after?.head ?? null, commit: response?.data?.sha,
    parent: response?.data?.parent, tree: response?.data?.tree, files: response?.data?.files,
    submitted_files: response?.data?.files, confirmed_files: after?.confirmedFiles ?? 0,
    manifest_complete: after?.complete === true })
});

export const tools = [gitDataCommit.tool];
export const handlers = { [gitDataCommit.tool.name]: gitDataCommit.handler };
