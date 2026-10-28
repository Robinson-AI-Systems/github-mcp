import { describe, expect, it } from 'vitest';
import { createDispatch } from '../../src/tools/dispatch.js';
import { mergeNamespaces } from '../../src/core/registry.js';
import { registry as realRegistry } from '../../src/tools/index.js';
import { defineRead } from '../../src/tools/define-read.js';
import { createFakeDb } from '../../test/helpers/fake-db.js';
import { sizeOf } from '../../src/core/result-rules.js';

const pr = (n, extra = {}) => ({ number: n, title: `PR ${n}`, state: 'open', draft: false, merged: false, user: { login: 'octo', id: 1 }, head: { ref: 'h', sha: 's' }, base: { ref: 'main' },
  mergeable_state: 'clean', labels: [{ name: 'bug', color: 'f' }], updated_at: '2026-10-10T18:00:00Z', html_url: 'u', body: 'x'.repeat(300), author_association: 'NONE', ...extra });

let current;
const things = defineRead({ name: 'github_t_list', description: 'List.', summaryType: 'pull_request', properties: { n: { type: 'integer' } }, handler: async (args) => current(args) });
const plain = defineRead({ name: 'github_t_plain', description: 'Plain.', handler: async (args) => current(args) });
const registry = mergeNamespaces([{ tools: [things.tool, plain.tool, ...realRegistry.tools.filter((t) => t.name === 'github_get_result')],
  handlers: { github_t_list: things.handler, github_t_plain: plain.handler, github_get_result: realRegistry.handlers.github_get_result } }]);
const conn = (id = 'client-1') => Object.freeze({ client_id: id, default_account: 'example-org', accounts: Object.freeze(['example-org']), mode: 'preview', profile: 'read_only', listing: 'compact' });

async function setup() {
  const db = createFakeDb();
  await db.initSchema();
  const run = (name, args, connection = conn()) => createDispatch({}).call(null, { registry, name, args, connection, db });
  return { db, run };
}
const out = (r) => r.structuredContent?.full_payload_location === 'content[0].text' ? JSON.parse(r.content[0].text) : r.structuredContent;

describe('detail and fields', () => {
  it('returns the summary by default and the whole object with detail=full, marking outsiders\' text untrusted', async () => {
    const { run } = await setup();
    current = () => ({ ...pr(1), big_extra: { a: 1 } });
    const s = out(await run('github_t_list', {}));
    expect(s).toMatchObject({ number: 1, user: 'octo', head: 'h', labels: ['bug'], untrusted: true, updated_at_local: expect.stringContaining('2026') });
    expect(s).not.toHaveProperty('big_extra');
    expect(out(await run('github_t_list', { detail: 'full' }))).toMatchObject({ big_extra: { a: 1 }, untrusted: true });
  });
  it('wraps a list, summarises each item, and applies fields to the items while keeping the safety mark', async () => {
    const { run } = await setup();
    current = () => [pr(1), pr(2)];
    const all = out(await run('github_t_list', {}));
    expect(all).toMatchObject({ count: 2 });
    expect(all.items.map((i) => i.number)).toEqual([1, 2]);
    const some = out(await run('github_t_list', { fields: ['number', 'title', 'nope'] }));
    expect(some.items[0]).toEqual({ number: 1, title: 'PR 1', untrusted: true });
    expect(some.unknown_fields).toEqual(['nope']);
    expect(some.count).toBe(2);
  });
  it('hides credential-shaped text before anything is returned or kept', async () => {
    const { run, db } = await setup();
    current = () => ({ note: 'x'.repeat(5000) + ' ghp_FAKE0123456789abcdefgh', list: [1] });
    const r = out(await run('github_t_plain', {}));
    expect(JSON.stringify(r)).not.toContain('ghp_FAKE');
    const stored = await db.getResult(r.kept_result.handle, 'client-1');
    expect(JSON.stringify(stored.body)).not.toContain('ghp_FAKE');
  });
});

describe('long text and big results are kept behind a handle', () => {
  it('cuts long text, says so, and the whole text can be read on with the handle and an offset', async () => {
    const { run } = await setup();
    const text = 'a'.repeat(4000) + 'b'.repeat(3000);
    current = () => ({ title: 'T', body: text });
    const r = out(await run('github_t_plain', {}));
    expect(r.body.length).toBeLessThan(4100);
    expect(r.body).toContain('3000 more characters left out');
    expect(r.kept_result).toMatchObject({ what: 'one result, 7 KB', text_cut: [{ path: 'body', kept: 4000, total: 7000, unit: 'characters' }] });
    const more = out(await run('github_get_result', { handle: r.kept_result.handle, fields: ['body'], offset: 4000 }));
    expect(more.body).toBe('b'.repeat(3000));
    expect(more.text_cut).toBeUndefined();
  });
  it('turns an oversize list into a preview with a note, and pages through the rest', async () => {
    const { run } = await setup();
    current = () => Array.from({ length: 60 }, (_, i) => pr(i + 1));
    const r = out(await run('github_t_plain', {}));
    expect(sizeOf(r)).toBeLessThanOrEqual(8192);
    expect(r.kept_result.of).toBe(60);
    expect(r.items.length).toBe(r.kept_result.shown);
    const shown = r.kept_result.shown;
    expect(r.kept_result.next).toEqual({ page: 2, pageSize: shown });
    const p2 = out(await run('github_get_result', { handle: r.kept_result.handle, ...r.kept_result.next }));
    expect(p2.page_info).toMatchObject({ page: 2, page_size: shown, total: 60 });
    expect(p2.items.map((i) => i.number)).toEqual(Array.from({ length: shown }, (_, i) => shown + 1 + i));
    expect(sizeOf(p2)).toBeLessThanOrEqual(8192);
    const big = out(await run('github_get_result', { handle: r.kept_result.handle, page: 2, pageSize: 20 }));
    expect(big.page_info.page_size).toBeLessThan(20);
    expect(big.note).toContain('Keep using pageSize');
    expect(sizeOf(big)).toBeLessThanOrEqual(8192);
    const narrow = out(await run('github_get_result', { handle: r.kept_result.handle, page: 3, fields: ['number', 'title'] }));
    expect(narrow.items[0]).toEqual({ number: 41, title: 'PR 41', untrusted: true });
    expect(out(await run('github_get_result', { handle: r.kept_result.handle, page: 3, fields: ['number', 'zzz'] })).unknown_fields).toEqual(['zzz']);
  });
  it('a result within the limits has no handle', async () => {
    const { run } = await setup();
    current = () => [pr(1), pr(2)];
    expect(out(await run('github_t_list', {}))).not.toHaveProperty('kept_result');
  });
  it('says plainly when the result could not be kept', async () => {
    const { run, db } = await setup();
    current = () => ({ body: 'x'.repeat(9000) });
    db.putResult = async () => { throw new Error('down'); };
    const r = out(await run('github_t_plain', {}));
    expect(r.kept_result.note).toContain('could not be kept');
    expect(sizeOf(r)).toBeLessThanOrEqual(8192);
  });
});

describe('github_get_result', () => {
  it('shows a result only to the connection that made it, and refuses unknown, expired or malformed handles', async () => {
    const { run } = await setup();
    current = () => ({ body: 'x'.repeat(9000) });
    const r = out(await run('github_t_plain', {}));
    const handle = r.kept_result.handle;
    expect((await run('github_get_result', { handle }, conn('client-2'))).isError).toBe(true);
    expect((await run('github_get_result', { handle })).isError).toBeUndefined();
    const bad = await run('github_get_result', { handle: `res_${'z'.repeat(22)}` });
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toContain('not found');
    expect((await run('github_get_result', { handle: 'nope' })).isError).toBe(true);
    expect((await run('github_get_result', { handle, page: 0 })).isError).toBe(true);
  });
  it('does not keep its own output behind another handle', async () => {
    const { run } = await setup();
    current = () => Array.from({ length: 100 }, (_, i) => pr(i, { body: 'y'.repeat(200) }));
    const r = out(await run('github_t_plain', {}));
    const page = out(await run('github_get_result', { handle: r.kept_result.handle, pageSize: 100 }));
    expect(page).not.toHaveProperty('kept_result');
    expect(page.note).toContain('Keep using pageSize');
    expect(sizeOf(page)).toBeLessThanOrEqual(8192);
  });
});

describe('the tools built before this card', () => {
  it('still answer as before (small, no handle)', async () => {
    const { db } = await setup();
    const r = await createDispatch({}).call(null, { registry: realRegistry, name: 'github_whoami', args: {}, connection: conn(), db });
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent).not.toHaveProperty('kept_result');
  });
});
