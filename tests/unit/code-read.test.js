import { describe, expect, it } from 'vitest';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';
import { makeWorld, parse } from '../../test/helpers/write-contract.js';

const R = { repo: 'hello' };
const b64 = (text) => Buffer.from(text).toString('base64');
const fileBody = (extra = {}) => ({ type: 'file', name: 'a.md', path: 'docs/a.md', size: 5, sha: 'abc', encoding: 'base64', content: b64('hello'), html_url: 'u', download_url: 'd', ...extra });

async function run(world, name, args) {
  const dispatch = createDispatch({ credentials: world.credentials, gates: [], fetch: world.gh.fetch, now: world.ctx.now, sleep: async () => {} });
  const result = await dispatch({ registry, name, args, connection: world.connection, db: world.db });
  return { result, body: result.isError ? null : (result.structuredContent ?? parse(result)) };
}
const world = () => makeWorld({ profile: 'read_only' });

describe('content reads (D-2)', () => {
  it('reads a text file at a ref', async () => {
    const w = await world();
    w.gh.when('GET /repos/{owner}/{repo}/contents/{path}').reply(200, fileBody());
    const { body } = await run(w, 'github_content_get', { ...R, path: 'docs/a.md', ref: 'dev' });
    expect(body).toMatchObject({ type: 'file', path: 'docs/a.md', content: 'hello' });
    expect(w.gh.calls[0].query).toMatchObject({ ref: 'dev' });
    expect(w.gh.invalid).toEqual([]);
  });
  it('encodes a path with spaces and # so GitHub receives it whole', async () => {
    const w = await world();
    w.gh.when('GET /repos/{owner}/{repo}/contents/{path}').reply(200, fileBody({ path: 'my dir/#notes.md' }));
    await run(w, 'github_content_get', { ...R, path: 'my dir/#notes.md' });
    expect(decodeURIComponent(w.gh.calls[0].path)).toBe('/repos/example-org/hello/contents/my dir/#notes.md');
    expect(w.gh.calls[0].path).not.toContain('#');
    expect(w.gh.calls[0].path).not.toContain(' ');
  });
  it('lists a directory', async () => {
    const w = await world();
    w.gh.when('GET /repos/{owner}/{repo}/contents/{path}').reply(200, [{ name: 'a.md', path: 'docs/a.md', type: 'file', size: 5 }, { name: 'img', path: 'docs/img', type: 'dir', size: 0 }]);
    const { body } = await run(w, 'github_content_get', { ...R, path: 'docs' });
    expect(body).toMatchObject({ type: 'dir', count: 2 });
    expect(body.items[1]).toMatchObject({ name: 'img', type: 'dir' });
  });
  it('does not show a binary file, only its size and link', async () => {
    const w = await world();
    w.gh.when('GET /repos/{owner}/{repo}/contents/{path}').reply(200, fileBody({ content: Buffer.from([0, 1, 2, 3, 255, 0]).toString('base64'), size: 6 }));
    const { body } = await run(w, 'github_content_get', { ...R, path: 'x.png' });
    expect(body).toMatchObject({ binary: true, content: null, download_url: 'd' });
  });
  it('long text is cut and kept behind a handle', async () => {
    const w = await world();
    w.gh.when('GET /repos/{owner}/{repo}/contents/{path}').reply(200, fileBody({ content: b64('line\n'.repeat(5000)), size: 25000 }));
    const { body } = await run(w, 'github_content_get', { ...R, path: 'big.txt' });
    expect(body.kept_result.handle).toMatch(/^res_/);
    expect(body.content.length).toBeLessThan(25000);
  });
  it('recovers a 25 KB minified file byte-exact in two calls through a kept handle', async () => {
    const w = await world();
    const original = Buffer.from('a'.repeat(24990) + 'é😀' + 'z'.repeat(3));
    w.gh.when('GET /repos/{owner}/{repo}/contents/{path}').reply(200,
      fileBody({ content: original.toString('base64'), size: original.length, path: 'minified.js' }));
    const first = await run(w, 'github_content_get', { ...R, path: 'minified.js' });
    expect(first.body.kept_result.handle).toMatch(/^res_/);
    expect(Buffer.byteLength(JSON.stringify(first.body))).toBeLessThan(8192);
    const second = await run(w, 'github_get_result', {
      handle: first.body.kept_result.handle, byteOffset: 0, byteLength: 32768
    });
    expect(second.result.isError).not.toBe(true);
    expect(second.body).toMatchObject({
      type: 'file', encoding: 'base64', byte_offset: 0, byte_length: original.length,
      total_bytes: original.length, complete: true
    });
    expect(Buffer.from(second.body.content_base64, 'base64')).toEqual(original);
    expect(w.gh.calls).toHaveLength(1);
  });
  it('reads a 25 KB binary file exactly in a single explicit byte-window call', async () => {
    const w = await world();
    const original = Buffer.allocUnsafe(25000);
    for (let i = 0; i < original.length; i++) original[i] = i % 256;
    w.gh.when('GET /repos/{owner}/{repo}/contents/{path}').reply(200,
      fileBody({ content: original.toString('base64'), size: original.length }));
    const { body, result } = await run(w, 'github_content_get', {
      ...R, path: 'byte.bin', byteOffset: 0, byteLength: 32768
    });
    expect(result.isError).not.toBe(true);
    expect(body).toMatchObject({ encoding: 'base64', byte_offset: 0, byte_length: 25000, complete: true });
    expect(Buffer.from(body.content_base64, 'base64')).toEqual(original);
    expect(w.gh.invalid).toEqual([]);
  });
  it('supports arbitrary ranges across multi-byte boundaries and rejects mixed or invalid ranges', async () => {
    const w = await world();
    const original = Buffer.from('🙌é'.repeat(6000));
    w.gh.when('GET /repos/{owner}/{repo}/contents/{path}').reply(200,
      fileBody({ content: original.toString('base64'), size: original.length }));
    const { body } = await run(w, 'github_content_get', {
      ...R, path: 'long.txt', byteOffset: 13, byteLength: 32768
    });
    expect(Buffer.from(body.content_base64, 'base64')).toEqual(original.subarray(13, 13 + 32768));
    for (const options of [
      { byteOffset: 0, startLine: 1, endLine: 2 },
      { byteOffset: original.length + 1, byteLength: 1 },
      { byteLength: 32769 }
    ]) {
      expect((await run(w, 'github_content_get', { ...R, path: 'long.txt', ...options })).result.isError).toBe(true);
    }
  });
  it('rejects whole-file credential shapes before base64 encoding even across byte windows', async () => {
    const w = await world();
    const token = 'ghp_FAKEonly_in_fake_tests_never_real_1234';
    const original = Buffer.from('q'.repeat(16370) + token + 'q'.repeat(10000));
    w.gh.when('GET /repos/{owner}/{repo}/contents/{path}').reply(200,
      fileBody({ content: original.toString('base64'), size: original.length }));
    // The byte window is far away from the token. Scanning the requested
    // subarray alone would incorrectly pass and allow credential exfiltration
    // by joining several otherwise innocent-looking chunks.
    const direct = await run(w, 'github_content_get', {
      ...R, path: 'has-token.bin', byteOffset: 20000, byteLength: 200
    });
    expect(direct.result.isError).toBe(true);
    expect(direct.result.content[0].text).toContain('credential-shaped');
    expect(JSON.stringify(direct.result)).not.toContain(token);
    const first = await run(w, 'github_content_get', { ...R, path: 'has-token.bin' });
    expect(first.body.kept_result.handle).toMatch(/^res_/);
    expect(first.body.content).toContain('[hidden]');
    const retained = await run(w, 'github_get_result', {
      handle: first.body.kept_result.handle, byteOffset: 0, byteLength: 32768
    });
    expect(retained.result.isError).toBe(true);
    expect(retained.result.content[0].text).toContain('redacted');
    expect(JSON.stringify(retained.result)).not.toContain(token);
  });
  it('kept file bytes are isolated to the connection, and invalid selectors are refused', async () => {
    const w = await world();
    const original = 'k'.repeat(25000);
    w.gh.when('GET /repos/{owner}/{repo}/contents/{path}').reply(200,
      fileBody({ content: b64(original), size: 25000 }));
    const first = await run(w, 'github_content_get', { ...R, path: 'private.txt' });
    const handle = first.body.kept_result.handle;
    const dispatch = createDispatch({ credentials: w.credentials, gates: [], fetch: w.gh.fetch, now: w.ctx.now });
    const unrelated = { ...w.connection, client_id: 'another-client' };
    const refused = await dispatch({ registry, name: 'github_get_result', args: { handle, byteOffset: 0 },
      connection: unrelated, db: w.db });
    expect(refused.isError).toBe(true);
    expect((await run(w, 'github_get_result', { handle, byteOffset: 0, page: 1 })).result.isError).toBe(true);
    expect((await run(w, 'github_get_result', { handle, byteOffset: 25001 })).result.isError).toBe(true);
  });
  it('says so when a file is too large for the contents API', async () => {
    const w = await world();
    w.gh.when('GET /repos/{owner}/{repo}/contents/{path}').reply(200, fileBody({ encoding: 'none', content: '', size: 5_000_000 }));
    const { body } = await run(w, 'github_content_get', { ...R, path: 'huge.bin' });
    expect(body.content).toBeNull();
    expect(body.note).toContain('too large');
  });
  it('lists the tree of the real default branch and filters by glob', async () => {
    const w = await world();
    w.gh.when('GET /repos/{owner}/{repo}').reply(200, { default_branch: 'trunk' });
    w.gh.when('GET /repos/{owner}/{repo}/git/trees/{tree_sha}').reply(200, { sha: 's', truncated: false, tree: [
      { path: 'src', type: 'tree' }, { path: 'src/a.js', type: 'blob', size: 3 }, { path: 'src/deep/b.js', type: 'blob', size: 4 }, { path: 'README.md', type: 'blob', size: 9 }] });
    const { body } = await run(w, 'github_content_get_tree', { ...R, glob: 'src/**/*.js' });
    expect(body.items.map((i) => i.path)).toEqual(['src/a.js', 'src/deep/b.js']);
    expect(w.gh.calls[1].params.tree_sha).toBe('trunk');
    expect(w.gh.calls[1].query).toMatchObject({ recursive: '1' });
  });
  it('reports GitHub\'s truncated tree', async () => {
    const w = await world();
    w.gh.when('GET /repos/{owner}/{repo}/git/trees/{tree_sha}').reply(200, { sha: 's', truncated: true, tree: [{ path: 'a', type: 'blob' }] });
    const { body } = await run(w, 'github_content_get_tree', { ...R, ref: 'main' });
    expect(body).toMatchObject({ github_truncated: true });
    expect(body.note).toContain('very large');
  });
  it('returns only the redirect link of an archive', async () => {
    const w = await world();
    w.gh.when('GET /repos/{owner}/{repo}/tarball/{ref}').reply(302, '', { location: 'https://codeload.github.com/example-org/hello/legacy.tar.gz/main' });
    const { body } = await run(w, 'github_content_get_archive_link', { ...R, ref: 'main' });
    expect(body.url).toBe('https://codeload.github.com/example-org/hello/legacy.tar.gz/main');
  });
  it('omits signed archive redirects even with full detail or field selection', async () => {
    for (const extra of [{}, { detail: 'full' }, { fields: ['url', 'sensitive_redirect_omitted'] }]) {
      const w = await world();
      const secret = 'signed-only-in-github-redirect-12345';
      w.gh.when('GET /repos/{owner}/{repo}/tarball/{ref}').reply(302, '', {
        location: 'https://codeload.github.com/example-org/hello/legacy.tar.gz/main?access_token=' + secret + '#secret'
      });
      const { result, body } = await run(w, 'github_content_get_archive_link', { ...R, ref: 'main', ...extra });
      if (result.isError) {
        expect(JSON.stringify(result)).not.toContain(secret);
      } else {
        expect(body).toMatchObject({ url: null, sensitive_redirect_omitted: true });
        if (!extra.fields) expect(body.github_web_url).toBe('https://github.com/example-org/hello');
        else expect(body.github_web_url).toBeUndefined();
        expect(JSON.stringify(result)).not.toContain(secret);
      }
    }
  });
  describe('codeowners', () => {
    it('turns each problem into line, column, kind and a plain fix', async () => {
      const w = await world();
      w.gh.when('GET /repos/{owner}/{repo}/codeowners/errors').reply(200, { errors: [{ line: 3, column: 9, kind: 'Unknown owner', source: '*.js @nobody', suggestion: 'Did you mean @somebody?', message: 'Unknown owner on line 3', path: '.github/CODEOWNERS' }] });
      const { body } = await run(w, 'github_content_check_codeowners', R);
      expect(body.problems).toBe(1);
      expect(body.items[0]).toMatchObject({ line: 3, column: 9, kind: 'Unknown owner', fix: expect.stringContaining('not a GitHub user or team') });
    });
    it('says no problems when there are none', async () => {
      const w = await world();
      w.gh.when('GET /repos/{owner}/{repo}/codeowners/errors').reply(200, { errors: [] });
      expect((await run(w, 'github_content_check_codeowners', R)).body).toMatchObject({ problems: 0, ok: expect.any(String) });
    });
    it('says "no CODEOWNERS file", not "no errors", when GitHub answers 404', async () => {
      const w = await world();
      w.gh.when('GET /repos/{owner}/{repo}/codeowners/errors').reply(404, { message: 'Not Found' });
      const { body } = await run(w, 'github_content_check_codeowners', { ...R, ref: 'dev' });
      expect(body).toMatchObject({ no_codeowners_file: true, problems: null });
      expect(body.note).toContain('not the same as "no errors"');
    });
  });
});

describe('commit and git reads (D-2)', () => {
  const commit = (sha, extra = {}) => ({ sha, commit: { message: `msg ${sha}\n\nbody`, author: { name: 'N', date: '2026-10-10T10:00:00Z' }, verification: { verified: true } }, author: { login: 'octo' }, parents: [{ sha: 'p' }], html_url: 'u', ...extra });
  it('lists commits with filters and summarises them', async () => {
    const w = await world();
    w.gh.when('GET /repos/{owner}/{repo}/commits').reply(200, [commit('a1'), commit('b2')]);
    const { body } = await run(w, 'github_commit_list', { ...R, ref: 'dev', author: 'octo', path: 'src' });
    expect(body.count).toBe(2);
    expect(body.items[0]).toMatchObject({ sha: 'a1', author: 'octo', verified: true });
    expect(w.gh.calls[0].query).toMatchObject({ sha: 'dev', author: 'octo', path: 'src' });
    expect(w.gh.invalid).toEqual([]);
  });
  it('gets one commit with patches cut per file', async () => {
    const w = await world();
    w.gh.when('GET /repos/{owner}/{repo}/commits/{ref}').reply(200, commit('a1', { stats: { total: 3 }, files: [{ filename: 'a.js', status: 'modified', additions: 2, deletions: 1, patch: '+'.repeat(5000) }] }));
    const { body } = await run(w, 'github_commit_get', { ...R, ref: 'a1' });
    expect(body).toMatchObject({ sha: 'a1', files_changed: 1, parents: ['p'], verified: true });
    expect(body.files[0].patch.length).toBeLessThan(1700);
    expect(body.files[0].patch).toContain('patch cut');
  });
  it('compares two refs', async () => {
    const w = await world();
    w.gh.when('GET /repos/{owner}/{repo}/compare/{basehead}').reply(200, { status: 'ahead', ahead_by: 2, behind_by: 0, total_commits: 2, merge_base_commit: { sha: 'm' }, commits: [commit('a1'), commit('b2')], files: [] });
    const { body } = await run(w, 'github_commit_compare', { ...R, base: 'main', head: 'ai/claude/x' });
    expect(body).toMatchObject({ status: 'ahead', ahead_by: 2, merge_base: 'm' });
    expect(body.commits[0]).toMatchObject({ sha: 'a1', message: 'msg a1' });
    expect(decodeURIComponent(w.gh.calls[0].params.basehead)).toBe('main...ai/claude/x');
    expect(w.gh.invalid).toEqual([]);
  });
  it('lists the pull requests that contain a commit', async () => {
    const w = await world();
    w.gh.when('GET /repos/{owner}/{repo}/commits/{commit_sha}/pulls').reply(200, [{ number: 4, title: 'T', state: 'open', user: { login: 'octo' }, head: { ref: 'h' }, base: { ref: 'main' } }]);
    const { body } = await run(w, 'github_commit_list_prs', { ...R, sha: 'a1b2' });
    expect(body.items[0]).toMatchObject({ number: 4, head: 'h' });
  });
  it('reads a ref with or without the refs/ prefix', async () => {
    const w = await world();
    w.gh.when('GET /repos/{owner}/{repo}/git/ref/{ref}').reply(200, { ref: 'refs/heads/main', object: { sha: 's1', type: 'commit' } });
    const { body } = await run(w, 'github_git_get_ref', { ...R, ref: 'refs/heads/main' });
    expect(body).toEqual(expect.objectContaining({ ref: 'refs/heads/main', sha: 's1', type: 'commit' }));
    expect(decodeURIComponent(w.gh.calls[0].params.ref)).toBe('heads/main');
  });
  it('reads the low-level commit object', async () => {
    const w = await world();
    w.gh.when('GET /repos/{owner}/{repo}/git/commits/{commit_sha}').reply(200, { sha: 'c1', tree: { sha: 't1' }, parents: [{ sha: 'p1' }], message: 'm', verification: { verified: false, reason: 'unsigned' } });
    expect((await run(w, 'github_git_get_commit', { ...R, sha: 'c1c1' })).body).toMatchObject({ tree: 't1', parents: ['p1'], verified: false, verification_reason: 'unsigned' });
  });
  it('a repository GitHub cannot find gives a plain sentence', async () => {
    const w = await world();
    w.gh.when('GET /repos/{owner}/{repo}/commits').reply(404, { message: 'Not Found' });
    const { result } = await run(w, 'github_commit_list', R);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Next:/);
  });
});

describe('W-3 bounded exact-head file context',()=>{
  it('returns the requested lines without sending local range arguments to GitHub',async()=>{
    const w=await world(),ref='a'.repeat(40),text='one\ntwo\nthree\nfour';
    w.gh.when('GET /repos/{owner}/{repo}/contents/{path}').reply(200,fileBody({content:b64(text),size:text.length}));
    const {body}=await run(w,'github_content_get',{...R,path:'docs/a.md',ref,startLine:2,endLine:3});
    expect(body).toMatchObject({content:'two\nthree',start_line:2,end_line:3,total_lines:4});
    expect(w.gh.calls[0].query).toEqual({ref});expect(w.gh.invalid).toEqual([]);
  });
  it('refuses half, reversed or oversized ranges before calling GitHub',async()=>{
    const w=await world();
    for(const range of [{startLine:2},{startLine:3,endLine:2},{startLine:1,endLine:101}])
      expect((await run(w,'github_content_get',{...R,path:'a.js',...range})).result.isError).toBe(true);
    expect(w.gh.calls).toEqual([]);
  });
});
