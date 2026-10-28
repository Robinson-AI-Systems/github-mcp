// Pinned repository archive, retained in the existing tenant-scoped result store.
import { createHash, randomBytes } from 'node:crypto';
import { defineRead } from './define-read.js';
import { plain, readerFor } from './github-read.js';
import { downloadPublicAsset } from '../github/public-url.js';
import { listZip, readEntry } from '../core/zip-reader.js';
import { containsCredential } from './util.js';

const limits = { compressed: 16 * 1048576, expanded: 40 * 1048576, entries: 500 };
const definition = defineRead({
  name: 'github_content_snapshot', area: 'content', audience: ['B', 'Op'],
  description: 'Save a complete pinned repository ZIP and return a resumable byte handle.',
  properties: {
    owner: { type: 'string', maxLength: 39 },
    repo: { type: 'string', minLength: 1, maxLength: 100 },
    ref: { type: 'string', minLength: 1, maxLength: 250 }
  }, required: ['repo'],
  guidance: 'ZIP up to 16 MiB, 40 MiB expanded, 500 files. SHA-256 and byte windows through github_get_result. Retained 24 hours.',
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const p = { owner, repo: args.repo };
    const ref = args.ref ?? (await octokit.request('GET /repos/{owner}/{repo}', p)).data.default_branch;
    if (!ref) throw new TypeError('Repository ref is missing.');
    const resolved = await octokit.request('GET /repos/{owner}/{repo}/commits/{ref}', { ...p, ref });
    const sha = resolved.data?.sha;
    if (!/^[a-f0-9]{40}$/i.test(sha ?? '')) throw new TypeError('GitHub did not resolve a commit SHA.');
    const archive = await octokit.request('GET /repos/{owner}/{repo}/zipball/{ref}',
      { ...p, ref: sha, request: { redirect: 'manual' } });
    if (!archive.headers?.location) throw new TypeError('GitHub returned no pinned ZIP download.');
    const { bytes } = await downloadPublicAsset(archive.headers.location, { maxBytes: limits.compressed });
    const files = listZip(bytes, limits).filter(e => !e.directory);
    if (!files.length) throw new TypeError('The repository ZIP has no files.');
    for (const entry of files) {
      const data = readEntry(bytes, entry);
      if (containsCredential(data.toString('utf8')))
        throw new TypeError('The archive contains credential-shaped text and cannot be returned exactly.');
    }
    const connection = ctx.connection.client_id ?? ctx.connection.pass_id;
    if (!connection) throw new TypeError('A scoped connection is required.');
    const handle = 'res_' + randomBytes(16).toString('base64url');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    await ctx.db.putResult({ handle, connection: String(connection),
      summary: 'Repository ZIP ' + owner + '/' + args.repo + ' @ ' + sha,
      body: { type: 'archive', owner, repo: args.repo, ref, sha, sha256,
        content_base64: bytes.toString('base64'), total_bytes: bytes.length, file_count: files.length } });
    return { type: 'archive', owner, repo: args.repo, ref, commit_sha: sha, sha256,
      handle, total_bytes: bytes.length, file_count: files.length, encoding: 'zip',
      next_byte_offset: 0, complete: false, expires_in_seconds: 86400,
      next: 'Call github_get_result with handle and byteOffset=0, then repeat from next_byte_offset. Verify ZIP SHA-256.' };
  })
});
export const tools = [definition.tool];
export const handlers = { [definition.tool.name]: definition.handler };
