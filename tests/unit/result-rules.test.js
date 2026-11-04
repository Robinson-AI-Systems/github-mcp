import { describe, expect, it } from 'vitest';
import { RULES, capText, describeBody, fitToBudget, listKeyOf, listPathOf, pageOfBody, pageOfBodyAt, projectFields, sizeOf } from '../../src/core/result-rules.js';

describe('projectFields', () => {
  const pr = { number: 7, title: 'T', user: { login: 'a', id: 1 }, labels: [{ name: 'x', color: 'f' }, { name: 'y', color: 'e' }], head: { ref: 'r', sha: 's' } };
  it('keeps only the named paths, through objects and lists', () => {
    expect(projectFields(pr, ['number', 'user.login', 'labels.name', 'head.ref']).value).toEqual({ number: 7, user: { login: 'a' }, labels: [{ name: 'x' }, { name: 'y' }], head: { ref: 'r' } });
  });
  it('applies to every element of a list and merges paths that share a parent', () => {
    expect(projectFields([pr, { number: 8, user: { login: 'b' } }], ['number', 'user.login', 'user.id']).value)
      .toEqual([{ number: 7, user: { login: 'a', id: 1 } }, { number: 8, user: { login: 'b' } }]);
  });
  it('names the paths that matched nothing and leaves the value alone when no fields are asked for', () => {
    const r = projectFields(pr, ['number', 'nope', 'user.nope']);
    expect(r.unknown).toEqual(['nope', 'user.nope']);
    expect(r.value).toEqual({ number: 7 });
    expect(projectFields(pr, undefined)).toEqual({ value: pr, unknown: [] });
    expect(projectFields(pr, [])).toEqual({ value: pr, unknown: [] });
  });
  it('keeps safety marks and companion fields without counting them as unknown', () => {
    const v = { body: 'x', untrusted: true, updated_at: 't', updated_at_local: 'T', other: 1 };
    const r = projectFields(v, ['body', 'updated_at'], { alsoKeep: ['untrusted', 'mode'], twins: ['_local', '_display'] });
    expect(r).toEqual({ value: { body: 'x', untrusted: true, updated_at: 't', updated_at_local: 'T' }, unknown: [] });
  });
  it('preserves own JSON fields named __proto__ without changing output prototypes', () => {
    const stored=JSON.parse('{"__proto__":{"safe":"kept","second":"present"},"constructor":{"id":2},"other":1}');
    const out=projectFields(stored,['__proto__.safe','__proto__.second','constructor.id']).value;
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(Object.hasOwn(out,'__proto__')).toBe(true);
    const wire=JSON.parse(JSON.stringify(out));
    expect(Object.hasOwn(wire,'__proto__')).toBe(true);
    expect(wire['__proto__']).toEqual({safe:'kept',second:'present'});
    expect(wire.constructor).toEqual({id:2});
    expect(({}).safe).toBeUndefined();
    expect(stored.other).toBe(1);
  });
  it('does not walk the prototype', () => {
    expect(projectFields({ a: 1 }, ['__proto__', 'constructor']).unknown).toEqual(['__proto__', 'constructor']);
  });
});

describe('capText', () => {
  it('leaves short text alone and cuts long text, saying how much was left out', () => {
    const r = capText({ title: 'short', body: 'x'.repeat(5000), nested: [{ message: 'y'.repeat(4001) }] });
    expect(r.value.title).toBe('short');
    expect(r.value.body.length).toBeLessThan(4100);
    expect(r.value.body).toContain('1000 more characters left out');
    expect(r.cut).toEqual([{ path: 'body', kept: 4000, total: 5000, unit: 'characters' }, { path: 'nested[0].message', kept: 4000, total: 4001, unit: 'characters' }]);
  });
  it('keeps the last 400 lines of a log and says how many earlier lines went', () => {
    const log = Array.from({ length: 1000 }, (_, i) => `line ${i}`).join('\n');
    const r = capText({ log });
    expect(r.value.log.startsWith('[600 earlier lines left out]\nline 600')).toBe(true);
    expect(r.value.log.endsWith('line 999')).toBe(true);
    expect(r.cut[0]).toMatchObject({ path: 'log', kept: 400, total: 1000, unit: 'lines' });
  });
  it('reads on from an offset', () => {
    const text = 'a'.repeat(4000) + 'b'.repeat(3000);
    const r = capText({ body: text }, { offset: 4000 });
    expect(r.value.body).toBe('b'.repeat(3000));
    expect(r.cut).toEqual([]);
  });
  it('does not erase unrelated short metadata when continuing one long field', () => {
    const original={id:'a-123',title:'Important short title',
      body:'a'.repeat(4000)+'b'.repeat(5000),
      nested:{label:'Keep this label'}};
    const r=capText(original,{offset:4000});
    expect(r.value.id).toBe('a-123');
    expect(r.value.title).toBe('Important short title');
    expect(r.value.nested.label).toBe('Keep this label');
    expect(r.value.body.startsWith('b'.repeat(100))).toBe(true);
    expect(r.value.body).toContain('1000 more characters left out');
    expect(r.cut).toHaveLength(1);
    expect(r.cut[0].path).toBe('body');
    expect(original.body).toHaveLength(9000);
  });
  it('does not change what it was given', () => {
    const input = { body: 'x'.repeat(5000) };
    capText(input);
    expect(input.body.length).toBe(5000);
  });
});

describe('fitToBudget', () => {
  const item = (i) => ({ id: i, text: 'word '.repeat(40) });
  it('leaves a small value alone', () => {
    const v = { a: 1 };
    expect(fitToBudget(v)).toEqual({ value: v, fitted: false, shown: null, of: null });
  });
  it('shortens the biggest list of an object to fit, keeping the other fields', () => {
    const v = { total: 100, items: Array.from({ length: 100 }, (_, i) => item(i)) };
    const r = fitToBudget(v);
    expect(r.fitted).toBe(true);
    expect(sizeOf(r.value)).toBeLessThanOrEqual(RULES.maxBytes - 700);
    expect(r.value.total).toBe(100);
    expect(r.value.items[0]).toEqual(item(0));
    expect(r.of).toBe(100);
    expect(r.shown).toBe(r.value.items.length);
    expect(r.shown).toBeGreaterThan(5);
  });
  it('shortens a root list, then long strings, then whole fields as a last resort', () => {
    expect(fitToBudget(Array.from({ length: 200 }, (_, i) => item(i))).value.length).toBeLessThan(200);
    const long = fitToBudget({ a: 'x'.repeat(20000), b: 'y'.repeat(20000) });
    expect(sizeOf(long.value)).toBeLessThanOrEqual(RULES.maxBytes);
    const many = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`k${i}`, 'z'.repeat(60)]));
    const r = fitToBudget(many);
    expect(sizeOf(r.value)).toBeLessThanOrEqual(RULES.maxBytes);
    expect(r.value._left_out.count).toBeGreaterThan(100);
  });
});

describe('describeBody, listKeyOf and pageOfBody', () => {
  const body = { total: 45, items: Array.from({ length: 45 }, (_, i) => ({ id: i })) };
  it('describes a result in one line', () => {
    expect(describeBody(body)).toMatch(/^45 items, \d+ KB$/);
    expect(describeBody([1, 2, 3])).toMatch(/^3 items/);
    expect(describeBody({ a: 1 })).toMatch(/^one result/);
    expect(listKeyOf(body)).toBe('items');
    expect(listKeyOf([1])).toBe('');
    expect(listKeyOf('text')).toBeNull();
  });
  it('pages a list: the first page keeps the other fields, later pages do not, and the page number is kept in range', () => {
    const p1 = pageOfBody(body);
    expect(p1).toMatchObject({ page: 1, pages: 3, total: 45 });
    expect(p1.value.total).toBe(45);
    expect(p1.value.items).toHaveLength(20);
    const p3 = pageOfBody(body, { page: 3 });
    expect(p3.value.items.map((x) => x.id)).toEqual(Array.from({ length: 5 }, (_, i) => 40 + i));
    expect(p3.value).not.toHaveProperty('total');
    expect(pageOfBody(body, { page: 99 }).page).toBe(3);
    expect(pageOfBody(body, { page: 0 }).page).toBe(1);
    expect(pageOfBody(body, { pageSize: 1000 }).value.items).toHaveLength(45);
    expect(pageOfBody(body, { pageSize: 10 }).pages).toBe(5);
  });
  it('pages a root list and returns a plain object whole', () => {
    expect(pageOfBody([1, 2, 3], { pageSize: 2 }).value).toEqual({ items: [1, 2], page_info: { page: 1, pages: 2, page_size: 2, total: 3 } });
    expect(pageOfBody({ a: 1 })).toEqual({ value: { a: 1 }, page: 1, pages: 1, total: null });
  });
});

describe('listPathOf and pageOfBodyAt: lists nested one level down (universal API reads)', () => {
  // The shape github_api_read retains: the provider body sits under `data`, its list under a named key.
  const envelope = { operationId: 'listWorkflowRuns', route: 'GET /repos/{owner}/{repo}/actions/runs', status: 200,
    data: { total_count: 45, workflow_runs: Array.from({ length: 45 }, (_, i) => ({ id: i, name: 'ci' })) } };
  it('finds the nested list path when no top-level list exists', () => {
    expect(listPathOf(envelope)).toEqual(['data', 'workflow_runs']);
    expect(listPathOf({ items: [1] })).toEqual(['items']);
    expect(listPathOf([1, 2])).toEqual([]);
    expect(listPathOf({ a: { b: 1 } })).toBeNull();
    expect(listPathOf('text')).toBeNull();
    expect(describeBody(envelope)).toMatch(/^45 data\.workflow_runs, \d+ KB$/);
  });
  it('pages the nested list: page 1 keeps the wrapper, later pages return just the chain', () => {
    const p1 = pageOfBodyAt(envelope, ['data', 'workflow_runs']);
    expect(p1).toMatchObject({ page: 1, pages: 3, total: 45 });
    expect(p1.value.operationId).toBe('listWorkflowRuns');
    expect(p1.value.data.total_count).toBe(45);
    expect(p1.value.data.workflow_runs).toHaveLength(20);
    const p3 = pageOfBodyAt(envelope, ['data', 'workflow_runs'], { page: 3 });
    expect(p3.value).toEqual({ data: { workflow_runs: envelope.data.workflow_runs.slice(40) },
      page_info: { page: 3, pages: 3, page_size: 20, total: 45 } });
    expect(pageOfBodyAt(envelope, ['data', 'workflow_runs'], { page: 99 }).page).toBe(3);
    expect(pageOfBodyAt(envelope, ['data', 'missing'])).toEqual({ value: envelope, page: 1, pages: 1, total: null });
  });
  it('a data body that is itself a list still resolves at the top level', () => {
    expect(listPathOf({ operationId: 'x', data: [1, 2, 3] })).toEqual(['data']);
  });
});
