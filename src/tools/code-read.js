// Files, commits and git data, read side (D-2 part 1). Big answers are bounded here (a file's text, a tree, a patch) and then again by the
// result rules (C-1): nothing is returned whole when it is large. Reads only.
import { listAll } from '../github/client.js';
import { defineRead } from './define-read.js';
import { globToRegExp } from './production-guard.js';
import { githubDownloadPage, safeGithubDownloadRedirect } from './safe-download-link.js';
import { plain, readerFor } from './github-read.js';
import { containsCredential } from './util.js';

const OWNER = { type: 'string', maxLength: 39, description: 'GitHub account (default: the connection\'s default account)' };
const REPO = { type: 'string', minLength: 1, maxLength: 100 };
const REF = { type: 'string', minLength: 1, maxLength: 250 };
const PATCH_CAP = 1500;
const MAX_FILES = 100;
const MAX_TREE = 500;
const MAX_TEXT_BYTES = 1_000_000;
const first = (text) => String(text ?? '').split('\n')[0];
const clip = (text, n) => (typeof text === 'string' && text.length > n ? `${text.slice(0, n)}\n… [patch cut at ${n} characters]` : text);

const fileView = (f) => ({ filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions, ...(f.previous_filename ? { renamed_from: f.previous_filename } : {}),
  ...(f.patch ? { patch: clip(f.patch, PATCH_CAP) } : { patch: null }) });

/** Looks like binary data: a NUL byte, or many bytes that are not text. */
export function looksBinary(buffer) {
  const sample = buffer.subarray(0, 8000);
  if (sample.includes(0)) return true;
  let odd = 0;
  for (const byte of sample) if (byte < 7 || (byte > 13 && byte < 32 && byte !== 27)) odd += 1;
  return sample.length > 0 && odd / sample.length > 0.1;
}

export const contentGet = defineRead({
  name: 'github_content_get', area: 'content', audience: ['B', 'Op'], byteWindow: true,
  description: 'Read a file\'s text (long text is cut and kept behind a handle) or list a directory, at any branch, tag or commit.',
  properties: { owner: OWNER, repo: REPO, path: { type: 'string', maxLength: 1000, description: 'File or directory path; empty or / for the top level' }, ref: { ...REF, description: 'Branch, tag or commit (default: the default branch)' },
    startLine: { type: 'integer', minimum: 1 }, endLine: { type: 'integer', minimum: 1 },
    byteOffset: { type: 'integer', minimum: 0, description: 'Start byte (zero-based). Returns exact base64 bytes, not characters.' },
    byteLength: { type: 'integer', minimum: 1, maximum: 32768, description: 'Read at most this many bytes (up to 32768); defaults to 32768 when byteOffset is given.' } },
  required: ['repo'],
  handler: (args, ctx) => plain(async () => {
    if ((args.startLine === undefined) !== (args.endLine === undefined) ||
        (args.startLine !== undefined && (args.endLine < args.startLine || args.endLine - args.startLine >= 100)))
      throw new TypeError('Supply both startLine and endLine, covering at most 100 lines.');
    if ((args.byteOffset !== undefined || args.byteLength !== undefined) &&
        (args.startLine !== undefined || args.endLine !== undefined))
      throw new TypeError('Byte ranges cannot be combined with line ranges.');
    const { owner, octokit } = await readerFor(args, ctx);
    const path = String(args.path ?? '').replace(/^\/+|\/+$/g, '');
    const query = { owner, repo: args.repo, path, ...(args.ref ? { ref: args.ref } : {}) };
    const { data } = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', query);
    if (Array.isArray(data)) return { path, type: 'dir', count: data.length, items: data.map((e) => ({ name: e.name, path: e.path, type: e.type, size: e.size })) };
    if (data.type === 'symlink' || data.type === 'submodule') return { path: data.path, type: data.type, target: data.target ?? data.submodule_git_url ?? null, sha: data.sha };
    const base = { path: data.path, type: 'file', size: data.size, sha: data.sha, html_url: data.html_url };
    if (data.encoding !== 'base64' || typeof data.content !== 'string' || data.size > MAX_TEXT_BYTES) {
      return { ...base, content: null, note: `This file is ${data.size} bytes, too large to read through the contents API. Use github_content_get_archive_link or open the link.`, download_url: data.download_url };
    }
    const buffer = Buffer.from(data.content, 'base64');
    if (args.byteOffset !== undefined || args.byteLength !== undefined) {
      // Check the entire decoded file before splitting/encoding: checking the
      // requested window alone could leak a token split across two windows.
      if (containsCredential(buffer.toString('utf8')))
        throw new TypeError('Byte-exact retrieval is not available for a file containing credential-shaped content.');
      const at = args.byteOffset ?? 0;
      if (at > buffer.length) throw new TypeError('byteOffset exceeds the file size.');
      const chunk = buffer.subarray(at, at + (args.byteLength ?? 32768));
      return { ...base, encoding: 'base64', content_base64: chunk.toString('base64'),
        byte_offset: at, byte_length: chunk.length, total_bytes: buffer.length,
        next_byte_offset: at + chunk.length, complete: at + chunk.length === buffer.length };
    }
    if (looksBinary(buffer)) return { ...base, binary: true, content: null, note: 'This is a binary file, so its content is not shown.', download_url: data.download_url };
    const text = buffer.toString('utf8');
    if (args.startLine !== undefined) {
      const lines = text.split('\n');
      return { ...base, start_line: args.startLine, end_line: Math.min(args.endLine, lines.length),
        total_lines: lines.length, content: lines.slice(args.startLine - 1, args.endLine).join('\n') };
    }
    return { ...base, content: text };
  })
});

export const contentGetTree = defineRead({
  name: 'github_content_get_tree', area: 'content', audience: ['B'],
  description: 'List every file in a repository at a ref (recursive), optionally only paths matching a glob such as src/**/*.js.',
  properties: { owner: OWNER, repo: REPO, ref: { ...REF, description: 'Branch, tag or commit (default: the default branch)' }, glob: { type: 'string', maxLength: 200, description: 'Only paths matching this (* within a folder, ** across folders)' },
    include_dirs: { type: 'boolean', description: 'Also list folders (default files only)' }, max: { type: 'integer', minimum: 1, maximum: MAX_TREE, description: 'Default 200' } },
  required: ['repo'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const ref = args.ref ?? (await octokit.request('GET /repos/{owner}/{repo}', { owner, repo: args.repo })).data.default_branch;
    const { data } = await octokit.request('GET /repos/{owner}/{repo}/git/trees/{tree_sha}', { owner, repo: args.repo, tree_sha: ref, recursive: '1' });
    // `**/` also matches no folder at all (src/**/*.js finds src/a.js), as people expect.
    const patterns = args.glob ? [globToRegExp(args.glob), globToRegExp(args.glob.replaceAll('**/', ''))] : null;
    const wanted = patterns ? { test: (path) => patterns.some((re) => re.test(path)) } : null;
    const matches = (data.tree ?? []).filter((e) => (e.type === 'blob' || (args.include_dirs && e.type === 'tree')) && (!wanted || wanted.test(e.path)));
    const max = args.max ?? 200;
    return { ref, sha: data.sha, github_truncated: data.truncated === true, total_matching: matches.length, shown: Math.min(matches.length, max),
      ...(data.truncated ? { note: 'GitHub cut this tree because the repository is very large; list a folder with github_content_get instead.' } : {}),
      items: matches.slice(0, max).map((e) => ({ path: e.path, type: e.type === 'tree' ? 'dir' : 'file', ...(e.size !== undefined ? { size: e.size } : {}) })) };
  })
});

export const contentGetArchiveLink = defineRead({
  name: 'github_content_get_archive_link', area: 'content', audience: ['B'],
  description: 'A short-lived download link for a tarball or zipball of a ref (the link itself, not the file).',
  properties: { owner: OWNER, repo: REPO, ref: { ...REF, description: 'Branch, tag or commit (default: the default branch)' }, format: { type: 'string', enum: ['tarball', 'zipball'], description: 'Default tarball' } },
  required: ['repo'],
  guidance: 'A clean public archive link is provided when safe. Signed or unverified redirect addresses are withheld from all result modes; use the GitHub page shown instead.',
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const ref = args.ref ?? (await octokit.request('GET /repos/{owner}/{repo}', { owner, repo: args.repo })).data.default_branch;
    const route = args.format === 'zipball' ? 'GET /repos/{owner}/{repo}/zipball/{ref}' : 'GET /repos/{owner}/{repo}/tarball/{ref}';
    const response = await octokit.request(route, { owner, repo: args.repo, ref, request: { redirect: 'manual' } });
    const url = response.headers?.location;
    if (!url) throw new TypeError('GitHub did not return a download link for that ref.');
    const safe = safeGithubDownloadRedirect(url, githubDownloadPage(owner, args.repo));
    return { ref, format: args.format ?? 'tarball', ...safe, expires: safe.url ? 'within about one minute' : null };
  })
});

const FIXES = [
  [/unknown owner|owner.*not found|no such user/i, 'The name is not a GitHub user or team that can be an owner here. Check the spelling, or that the person has access to the repository.'],
  [/invalid owner|invalid.*owner/i, 'The owner is not written in a form GitHub accepts. Use @username, @org/team-name or an email address.'],
  [/invalid pattern|pattern/i, 'The file pattern is not valid. Check the wildcards and slashes.'],
  [/syntax/i, 'The line is not in the form "pattern @owner". Put the file pattern first, then one or more owners separated by spaces.']
];
const fixFor = (error) => FIXES.find(([re]) => re.test(`${error.kind ?? ''} ${error.message ?? ''}`))?.[1] ?? 'Fix this line in the CODEOWNERS file and check again.';

export const contentCheckCodeowners = defineRead({
  name: 'github_content_check_codeowners', area: 'content', audience: ['B', 'O'],
  description: 'Problems GitHub found in a CODEOWNERS file (bad lines, unknown users or teams) on a branch, in plain words.',
  properties: { owner: OWNER, repo: REPO, ref: { ...REF, description: 'Branch, tag or commit (default: the default branch)' } },
  required: ['repo'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const where = `${owner}/${args.repo}`;
    try {
      const { data } = await octokit.request('GET /repos/{owner}/{repo}/codeowners/errors', { owner, repo: args.repo, ...(args.ref ? { ref: args.ref } : {}) });
      const errors = data.errors ?? [];
      return { repo: where, ref: args.ref ?? 'the default branch', problems: errors.length, ...(errors.length ? {} : { ok: 'GitHub found no problems in the CODEOWNERS file.' }),
        items: errors.map((e) => ({ line: e.line, column: e.column, kind: e.kind, text: e.source, path: e.path, problem: e.message, suggestion: e.suggestion ?? null, fix: fixFor(e) })) };
    } catch (error) {
      if (error?.status === 404) return { repo: where, ref: args.ref ?? 'the default branch', problems: null, no_codeowners_file: true, note: 'There is no CODEOWNERS file here (or the repository could not be found), so nothing was checked. This is not the same as "no errors".' };
      throw error;
    }
  })
});

export const commitList = defineRead({
  name: 'github_commit_list', area: 'commit', audience: ['B', 'Op'],
  description: 'Commits on a branch (or touching a path), optionally by author or date range; newest first.',
  properties: { owner: OWNER, repo: REPO, ref: { ...REF, description: 'Branch, tag or commit to start from (default branch)' }, path: { type: 'string', maxLength: 1000 }, author: { type: 'string', maxLength: 100, description: 'GitHub login or email' },
    since: { type: 'string', maxLength: 40, description: 'ISO date/time' }, until: { type: 'string', maxLength: 40 }, max: { type: 'integer', minimum: 1, maximum: 200, description: 'Default 30' } },
  required: ['repo'],
  summaryType: 'commit',
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const query = { owner, repo: args.repo, per_page: Math.min(args.max ?? 30, 100), ...(args.ref ? { sha: args.ref } : {}), ...(args.path ? { path: args.path } : {}), ...(args.author ? { author: args.author } : {}),
      ...(args.since ? { since: args.since } : {}), ...(args.until ? { until: args.until } : {}) };
    const { items, capped } = await listAll(octokit, 'GET /repos/{owner}/{repo}/commits', query, { max: args.max ?? 30 });
    return { count: items.length, ...(capped ? { more_exist: true } : {}), items };
  })
});

export const commitGet = defineRead({
  name: 'github_commit_get', area: 'commit', audience: ['B', 'Op'],
  description: 'One commit: message, author, signature status and the files changed with their stats (patches cut).',
  properties: { owner: OWNER, repo: REPO, ref: { ...REF, description: 'Commit SHA, branch or tag' } },
  required: ['repo', 'ref'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const { data: c } = await octokit.request('GET /repos/{owner}/{repo}/commits/{ref}', { owner, repo: args.repo, ref: args.ref });
    const files = c.files ?? [];
    return { sha: c.sha, message: c.commit?.message, author: c.author?.login ?? c.commit?.author?.name, date: c.commit?.author?.date, committer: c.committer?.login ?? c.commit?.committer?.name,
      verified: c.commit?.verification?.verified, parents: (c.parents ?? []).map((p) => p.sha), stats: c.stats, html_url: c.html_url,
      files_changed: files.length, files: files.slice(0, MAX_FILES).map(fileView), ...(files.length > MAX_FILES ? { files_not_shown: files.length - MAX_FILES } : {}) };
  })
});

export const commitCompare = defineRead({
  name: 'github_commit_compare', area: 'commit', audience: ['B', 'Op'],
  description: 'Compare two refs: how far ahead or behind, the commits between them and the files changed (patches cut).',
  properties: { owner: OWNER, repo: REPO, base: REF, head: REF },
  required: ['repo', 'base', 'head'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const { data: c } = await octokit.request('GET /repos/{owner}/{repo}/compare/{basehead}', { owner, repo: args.repo, basehead: `${args.base}...${args.head}`, per_page: 100 });
    const files = c.files ?? [];
    return { status: c.status, ahead_by: c.ahead_by, behind_by: c.behind_by, total_commits: c.total_commits, merge_base: c.merge_base_commit?.sha, html_url: c.html_url,
      commits: (c.commits ?? []).slice(0, 30).map((x) => ({ sha: x.sha, message: first(x.commit?.message), author: x.author?.login ?? x.commit?.author?.name })),
      ...((c.commits ?? []).length > 30 ? { commits_not_shown: c.commits.length - 30 } : {}),
      files_changed: files.length, files: files.slice(0, MAX_FILES).map(fileView), ...(files.length > MAX_FILES ? { files_not_shown: files.length - MAX_FILES } : {}) };
  })
});

export const commitListPrs = defineRead({
  name: 'github_commit_list_prs', area: 'commit', audience: ['B', 'Op'],
  description: 'Pull requests that contain a commit.',
  properties: { owner: OWNER, repo: REPO, sha: { type: 'string', minLength: 4, maxLength: 40 } },
  required: ['repo', 'sha'],
  summaryType: 'pull_request',
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const { items } = await listAll(octokit, 'GET /repos/{owner}/{repo}/commits/{commit_sha}/pulls', { owner, repo: args.repo, commit_sha: args.sha }, { max: 50 });
    return items;
  })
});

const shortRef = (ref) => String(ref).replace(/^refs\//, '');

export const gitGetRef = defineRead({
  name: 'github_git_get_ref', area: 'git', audience: ['B'],
  description: 'One ref (a branch or tag pointer) and the commit it points at, e.g. heads/main or tags/v1.0.',
  properties: { owner: OWNER, repo: REPO, ref: { ...REF, description: 'heads/<branch> or tags/<tag> (refs/ is optional)' } },
  required: ['repo', 'ref'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const { data } = await octokit.request('GET /repos/{owner}/{repo}/git/ref/{ref}', { owner, repo: args.repo, ref: shortRef(args.ref) });
    return { ref: data.ref, sha: data.object?.sha, type: data.object?.type };
  })
});

export const gitGetCommit = defineRead({
  name: 'github_git_get_commit', area: 'git', audience: ['B'],
  description: 'The low-level commit object: its tree, parents and signature verification.',
  properties: { owner: OWNER, repo: REPO, sha: { type: 'string', minLength: 4, maxLength: 40 } },
  required: ['repo', 'sha'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const { data } = await octokit.request('GET /repos/{owner}/{repo}/git/commits/{commit_sha}', { owner, repo: args.repo, commit_sha: args.sha });
    return { sha: data.sha, tree: data.tree?.sha, parents: (data.parents ?? []).map((p) => p.sha), message: data.message, author: data.author, committer: data.committer,
      verified: data.verification?.verified, verification_reason: data.verification?.reason, html_url: data.html_url };
  })
});

const all = [contentGet, contentGetTree, contentGetArchiveLink, contentCheckCodeowners, commitList, commitGet, commitCompare, commitListPrs, gitGetRef, gitGetCommit];
export const tools = all.map((d) => d.tool);
export const handlers = Object.fromEntries(all.map((d) => [d.tool.name, d.handler]));
