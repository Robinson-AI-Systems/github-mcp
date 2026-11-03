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


import { leafKey, lineWindow, nextPageCall, nextWindowCall, textContinueCall } from '../../src/core/continuation.js';

describe('continuation helpers', () => {
  it('names the field a cut path ends in and refuses unsafe names', () => {
    expect(leafKey('jobs[2].log')).toBe('log');
    expect(leafKey('body')).toBe('body');
    expect(leafKey('a.b c')).toBeNull();
    expect(leafKey('')).toBeNull();
  });
  it('gives the next page call only while pages remain', () => {
    const h = 'res_' + 'a'.repeat(22);
    expect(nextPageCall(h, { page: 2, pages: 5, page_size: 7 }, { fields: ['number'] })).toEqual({ tool: 'github_get_result', arguments: { handle: h, page: 3, pageSize: 7, fields: ['number'] } });
    expect(nextPageCall(h, { page: 5, pages: 5, page_size: 7 })).toBeNull();
    expect(nextPageCall(h, null)).toBeNull();
  });
  it('reads whole-line windows within the line and character limits, reporting where they ended', () => {
    const text = Array.from({ length: 1200 }, (_, i) => 'line ' + (i + 1)).join('\n');
    const w = lineWindow(text, { startLine: 1, endLine: 10 });
    expect(w).toMatchObject({ start_line: 1, end_line: 10, total_lines: 1200, complete: false });
    expect(w.text.split('\n')).toHaveLength(10);
    expect(lineWindow(text, { startLine: 1 }).end_line).toBe(500);
    expect(lineWindow(text, { startLine: 1190, endLine: 1500 })).toMatchObject({ end_line: 1200, complete: true });
    expect(lineWindow(text, { startLine: 5000 })).toMatchObject({ past_end: true, complete: true, text: '' });
    const wide = lineWindow(Array.from({ length: 40 }, () => 'x'.repeat(2000)).join('\n'), { startLine: 1 });
    expect(wide.text.length).toBeLessThanOrEqual(24000);
    expect(wide.end_line).toBeLessThan(40);
    expect(nextWindowCall('res_' + 'b'.repeat(22), 'log', wide).arguments.startLine).toBe(wide.end_line + 1);
    expect(nextWindowCall('res_' + 'b'.repeat(22), 'log', { complete: true, end_line: 3, total_lines: 3 })).toBeNull();
    const huge = lineWindow('y'.repeat(30000) + '\nshort', { startLine: 1 });
    expect(huge).toMatchObject({ end_line: 1, line_cut: 1 });
  });
  it('points a cut log at its first lines and cut text at its next characters', () => {
    const h = 'res_' + 'c'.repeat(22);
    expect(textContinueCall(h, { path: 'jobs[0].log', kept: 200, total: 900, unit: 'lines' }).arguments).toEqual({ handle: h, fields: ['log'], startLine: 1, endLine: 500 });
    expect(textContinueCall(h, { path: 'body', kept: 4000, total: 7000, unit: 'characters' }, { offset: 0 }).arguments).toEqual({ handle: h, fields: ['body'], offset: 4000 });
    expect(textContinueCall(h, null)).toBeNull();
  });
});

describe('a cut result says exactly which call reads the rest', () => {
  it('a long list: every call carries the next one until complete', async () => {
    const { run } = await setup();
    current = () => Array.from({ length: 60 }, (_, i) => pr(i + 1));
    const first = out(await run('github_t_plain', {}));
    const next = first.kept_result.continue;
    expect(next).toMatchObject({ tool: 'github_get_result', arguments: { handle: first.kept_result.handle, page: 2, pageSize: first.kept_result.shown }, remaining: 60 - first.kept_result.shown });
    const seen = new Set(first.items.map((i) => i.number));
    let step = next, guard = 0, last;
    while (step && guard++ < 20) {
      last = out(await run(step.tool, step.arguments));
      last.items.forEach((i) => seen.add(i.number));
      step = last.continue;
    }
    expect(last.complete).toBe(true);
    expect(last.continue).toBeUndefined();
    expect(seen.size).toBe(60);
  });
  it('cut text: text_continue reads the next characters, and the last part is marked complete', async () => {
    const { run } = await setup();
    current = () => ({ title: 'T', body: 'a'.repeat(4000) + 'b'.repeat(3000) });
    const r = out(await run('github_t_plain', {}));
    expect(r.kept_result.text_continue.arguments).toEqual({ handle: r.kept_result.handle, fields: ['body'], offset: 4000 });
    const more = out(await run('github_get_result', r.kept_result.text_continue.arguments));
    expect(more.body).toBe('b'.repeat(3000));
    expect(more.text_continue).toBeUndefined();
  });
  it('a long log keeps its last lines and the first lines can be read in windows to the end', async () => {
    const { run } = await setup();
    const lines = Array.from({ length: 900 }, (_, i) => 'step ' + (i + 1));
    current = () => ({ title: 'build', log: lines.join('\n') });
    const r = out(await run('github_t_plain', {}));
    expect(r.log).toContain('earlier lines left out');
    const call = r.kept_result.text_continue;
    expect(call.arguments).toMatchObject({ fields: ['log'], startLine: 1 });
    const collected = [];
    let step = call, guard = 0, window;
    while (step && guard++ < 10) {
      window = out(await run(step.tool, step.arguments));
      collected.push(...window.text.split('\n'));
      step = window.next_window;
    }
    // the windows read the earlier lines only up to the line before the tail that was already shown
    expect(collected[0]).toBe('step 1');
    expect(collected.length).toBe(call.arguments.endLine);
    expect(window.end_line).toBe(call.arguments.endLine);
    // an open-ended window runs to the true end of the log
    const all = [];
    let open = { tool: 'github_get_result', arguments: { handle: r.kept_result.handle, fields: ['log'], startLine: 1 } };
    guard = 0;
    while (open && guard++ < 10) { const w = out(await run(open.tool, open.arguments)); all.push(...w.text.split('\n')); open = w.next_window; }
    expect(all).toEqual(lines);
  });
  it('refuses a line window that is ambiguous, and says what to pass', async () => {
    const { run } = await setup();
    current = () => ({ title: 'build', log: 'x\n'.repeat(900) });
    const r = out(await run('github_t_plain', {}));
    const h = r.kept_result.handle;
    const refused = async (args) => { const res = await run('github_get_result', { handle: h, ...args }); return JSON.stringify(res); };
    expect(await refused({ startLine: 1 })).toMatch(/one long text field/);
    expect(await refused({ fields: ['log'], startLine: 5, endLine: 2 })).toMatch(/endLine must not be before startLine/);
    expect(await refused({ fields: ['log'], startLine: 1, page: 2 })).toMatch(/cannot be combined/);
    expect(await refused({ fields: ['nothing'], startLine: 1 })).toMatch(/No text field named/);
  });
});
