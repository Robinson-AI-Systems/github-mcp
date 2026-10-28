import { describe, expect, it, beforeEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { buildZip } from '../../test/helpers/zip-builder.js';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';
import { makeWorld, parse } from '../../test/helpers/write-contract.js';

const served = { bytes: null, calls: [] };
vi.mock('../../src/github/public-url.js', async (original) => ({
  ...(await original()),
  downloadPublicAsset: async (url, options) => {
    served.calls.push({ url, options });
    return { bytes: served.bytes, size: served.bytes.length };
  }
}));
const SHA = 'a'.repeat(40);
function arrange(w) {
  w.gh.when('GET /repos/{owner}/{repo}/commits/{ref}').reply(200, { sha: SHA });
  w.gh.when('GET /repos/{owner}/{repo}/zipball/{ref}').reply(302, '', {
    location: 'https://codeload.github.com/example-org/hello/zip/' + SHA
  });
}
async function run(w, name, args, connection = w.connection) {
  return createDispatch({ env: w.ctx.env, credentials: w.credentials, gates: [],
    fetch: w.gh.fetch, now: w.ctx.now, sleep: w.ctx.sleep })({
      registry, name, args, connection, db: w.db
    });
}
describe('C-13 pinned repository ZIP as a connection-owned binary handle', () => {
  beforeEach(() => { served.calls = []; });
  it('fetches once at an exact SHA and reconstructs complete binary and Unicode files in two calls', async () => {
    served.bytes = buildZip([
      { name: 'hello-' + SHA.slice(0, 7) + '/', data: '' },
      { name: 'hello-' + SHA.slice(0, 7) + '/café.txt', data: 'Unicode ✓' },
      { name: 'hello-' + SHA.slice(0, 7) + '/binary.bin', data: Buffer.from([0, 1, 254, 255]) }
    ]);
    const w = await makeWorld({ profile: 'read_only' });
    arrange(w);
    const first = parse(await run(w, 'github_content_snapshot', { owner: 'example-org', repo: 'hello', ref: 'main' }));
    expect(first).toMatchObject({ commit_sha: SHA, type: 'archive', file_count: 2, complete: false });
    expect(first.sha256).toBe(createHash('sha256').update(served.bytes).digest('hex'));
    expect(first.handle).toMatch(/^res_/);
    expect(JSON.stringify(first)).not.toContain('codeload.github.com');
    const second = parse(await run(w, 'github_get_result', { handle: first.handle, byteOffset: 0, byteLength: 32768 }));
    expect(second).toMatchObject({ type: 'archive', sha256: first.sha256, complete: true });
    expect(Buffer.from(second.content_base64, 'base64')).toEqual(served.bytes);
    expect(served.calls).toHaveLength(1);
    expect(w.gh.calls.filter(c => c.route.includes('zipball'))).toHaveLength(1);
    expect(w.gh.invalid).toEqual([]);
  });
  it('reports exact windows, enforces tenant isolation and never leaks ZIP through metadata paging', async () => {
    served.bytes = buildZip([{ name: 'hello-a/repo.dat', data: Buffer.alloc(20000, 42) }]);
    const w = await makeWorld({ profile: 'read_only' });
    arrange(w);
    const first = parse(await run(w, 'github_content_snapshot', { repo: 'hello', ref: SHA }));
    const metadata = parse(await run(w, 'github_get_result', { handle: first.handle }));
    expect(metadata.content_base64).toBeUndefined();
    const half = parse(await run(w, 'github_get_result', { handle: first.handle, byteOffset: 0, byteLength: 128 }));
    expect(half.next_byte_offset).toBe(128);
    expect(half.complete).toBe(false);
    expect(parse(await run(w, 'github_get_result', { handle: first.handle, byteOffset: 128, byteLength: 32768 })).complete).toBe(true);
    const foreign = { ...w.connection, client_id: 'another-tenant' };
    expect((await run(w, 'github_get_result', { handle: first.handle, byteOffset: 0 }, foreign)).isError).toBe(true);
  });
  it('rejects malicious archives and provider failures before persisting anything', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    arrange(w);
    served.bytes = buildZip([{ name: '../outside', data: 'bad' }]);
    expect((await run(w, 'github_content_snapshot', { repo: 'hello', ref: SHA })).isError).toBe(true);
    served.bytes = buildZip([{ name: 'repo/secret', data: 'ghp_FAKE0123456789abcdefgh' }]);
    expect((await run(w, 'github_content_snapshot', { repo: 'hello', ref: SHA })).isError).toBe(true);
    w.gh.when('GET /repos/{owner}/{repo}/zipball/{ref}').reply(404, { message: 'Not Found' });
    expect((await run(w, 'github_content_snapshot', { repo: 'hello', ref: SHA })).isError).toBe(true);
  });
});
