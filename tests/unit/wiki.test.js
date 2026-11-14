import { afterAll, describe, expect, it } from 'vitest';
import { runWriteContract, makeWorld, parse } from '../../test/helpers/write-contract.js';
import { startGitServer } from '../../test/helpers/git-http-server.js';
import * as wiki from '../../src/tools/wiki.js';
import { pageFile, wikiUrl, wikiHttp } from '../../src/github/wiki-git.js';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';

const def = (name) => ({ tool: wiki.tools.find((t) => t.name === name), handler: wiki.handlers[name] });
const servers = [];
afterAll(async () => { for (const s of servers) await s.close(); });
const O = 'example-org';

/** A lazily started git server for one world; 'mismatch' makes it forget every push so the read-back disagrees. */
const serve = (gh, outcome, pages) => {
  let started = null;
  const ensure = () => (started ??= startGitServer({ pages }).then((s) => { servers.push(s); return s; }));
  gh.when('GET /repos/{owner}/{repo}').reply(200, { has_wiki: true, default_branch: 'main' });
  gh.serveWiki(async (input, init) => {
    const s = await ensure();
    const res = await s.fetchVia(() => { throw new Error('unexpected'); })(input, init);
    if (outcome !== 'ok' && String(input?.url ?? input).endsWith('git-receive-pack') && init?.method === 'POST') { const bytes = await res.arrayBuffer(); s.forgetPushes(); return new Response(bytes, { status: res.status, headers: res.headers }); }
    return res;
  });
  return () => started;
};

runWriteContract({ label: 'github_wiki_write', definition: def('github_wiki_write'), args: { owner: O, repo: 'app', page: 'Home', body: '# New home\n' }, needsConfirm: true, expectedWrites: 0, profile: 'full',
  arrange: (gh, o) => { serve(gh, o); } });

describe('wiki tools', () => {
  const run = async (w, name, args) => {
    const result = await createDispatch({ env: w.ctx.env, credentials: w.credentials, gates: [], fetch: w.gh.fetch, now: w.ctx.now, sleep: async () => {} })({ registry, name, args, connection: w.connection, db: w.db });
    let body; try { body = parse(result); } catch { body = { message: result.content?.[0]?.text }; }
    return { result, body };
  };
  it('lists, reads, writes a new page and reads it back; the token is sent as the password only', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    const started = serve(w.gh, 'ok', { 'Home.md': '# Home\n', 'Guide.md': 'steps' });
    expect((await run(w, 'github_wiki_list', { owner: O, repo: 'app' })).body).toMatchObject({ count: 2, pages: expect.arrayContaining([{ page: 'Guide', size: 5 }]) });
    expect((await run(w, 'github_wiki_read', { owner: O, repo: 'app', page: 'Guide' })).body).toMatchObject({ text: 'steps', size: 5 });
    const written = await run(w, 'github_wiki_write', { owner: O, repo: 'app', page: 'Notes', body: 'hello wiki', confirm: true });
    expect(written.body).toMatchObject({ done: true });
    expect(JSON.stringify(written.body)).not.toContain('hello wiki');
    expect((await run(w, 'github_wiki_read', { owner: O, repo: 'app', page: 'Notes' })).body.text).toBe('hello wiki');
    const server = await started();
    expect(server.log('log', '-1', '--format=%an|%s')).toContain('GitHub Unleashed|Create Notes');
    const auth = server.seen.map((r) => r.authorization).filter(Boolean);
    expect(auth.length).toBeGreaterThan(0);
    expect(auth.every((a) => a.startsWith('Basic '))).toBe(true);
    expect(server.seen.every((r) => !/token|ghp_|github_pat/.test(r.path))).toBe(true);
  });
  it('refuses same text, bad names, a missing page and a switched-off wiki', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    serve(w.gh, 'ok', { 'Home.md': 'same' });
    expect((await run(w, 'github_wiki_write', { owner: O, repo: 'app', page: 'Home', body: 'same', confirm: true })).body.done).not.toBe(true);
    for (const page of ['../x', 'a/b', 'x.md', '']) expect((await run(w, 'github_wiki_read', { owner: O, repo: 'app', page })).result.isError).toBe(true);
    expect((await run(w, 'github_wiki_read', { owner: O, repo: 'app', page: 'Nope' })).result.isError).toBe(true);
    w.gh.when('GET /repos/{owner}/{repo}').reply(200, { has_wiki: false });
    expect((await run(w, 'github_wiki_list', { owner: O, repo: 'app' })).result.isError).toBe(true);
  });
});

describe('wiki helpers', () => {
  it('validates names and only reaches the wiki git paths', async () => {
    expect(pageFile('My Page')).toBe('My Page.md');
    expect(() => pageFile('a..b')).toThrow();
    expect(wikiUrl('o', 'r')).toBe('https://github.com/o/r.wiki.git');
    expect(() => wikiUrl('o/x', 'r')).toThrow();
    const http = wikiHttp(async () => { throw new Error('should not be called'); });
    for (const url of ['https://evil.example/o/r.wiki.git/info/refs', 'https://github.com/o/r.git/info/refs', 'http://github.com/o/r.wiki.git/info/refs', 'https://api.github.com/o/r.wiki.git/info/refs']) {
      await expect(http.request({ url })).rejects.toThrow(/Only the repository wiki/);
    }
  });
});
