import { describe, expect, it } from 'vitest';
import { defineWrite, normalizeClassification, marksOf } from '../../src/core/write.js';
import { classifyGithubError, explainGithubError } from '../../src/tools/define-github-write.js';
import { GithubClientError } from '../../src/github/errors.js';
import { createDispatch } from '../../src/tools/dispatch.js';
import { mergeNamespaces } from '../../src/core/registry.js';
import { makeWorld, parse, doorsFor } from '../../test/helpers/write-contract.js';
import { sampleLabel, sampleSetting } from '../../test/helpers/sample-writes.js';

const R = { owner: 'example-org', repo: 'hello', issue_number: 7, label: 'bug' };
const LABELS = 'GET /repos/{owner}/{repo}/issues/{issue_number}/labels';
const POST = 'POST /repos/{owner}/{repo}/issues/{issue_number}/labels';
const ok = (gh) => { gh.when(LABELS).replySequence([{ status: 200, body: [] }, { status: 200, body: [{ name: 'bug' }] }]); gh.when(POST).reply(200, [{ name: 'bug' }]); };
const writes = (gh) => gh.calls.filter((c) => c.method !== 'GET');

describe('defining a write tool', () => {
  const minimal = { name: 'github_x_y', description: 'd', declarations: { production: 'never' }, target: () => ({}), read: async () => null, classify: () => ({}), summarize: () => 's', apply: async () => null, readAfter: async () => null, verify: () => true, requestKey: () => 'rmcp_x' };
  it('accepts a complete definition and describes it for the registry', () => {
    const { tool } = defineWrite(minimal);
    expect(tool).toMatchObject({ writes: true, writeContract: 'defineWrite-v1', profiles: ['everyday', 'full'] });
    expect(tool.inputSchema.properties).toHaveProperty('dryRun');
    expect(tool.inputSchema.properties).toHaveProperty('confirm');
    expect(tool.inputSchema.additionalProperties).toBe(false);
    expect(Object.isFrozen(tool)).toBe(true);
  });
  it('refuses incomplete or unsafe definitions', () => {
    expect(() => defineWrite({ ...minimal, name: 'Bad Name' })).toThrow(TypeError);
    expect(() => defineWrite({ ...minimal, description: '' })).toThrow(TypeError);
    expect(() => defineWrite({ ...minimal, apply: undefined })).toThrow(/apply/);
    expect(() => defineWrite({ ...minimal, declarations: {} })).toThrow(/production/);
    expect(() => defineWrite({ ...minimal, declarations: { production: 'never', confirm: 'sometimes' } })).toThrow(/confirm/);
    expect(() => defineWrite({ ...minimal, declarations: { production: 'never', profiles: ['read_only'] } })).toThrow(/everyday and full/);
    expect(() => defineWrite({ ...minimal, declarations: { production: 'never', spend: true } })).toThrow(/price function/);
    expect(() => defineWrite({ ...minimal, price: 5 })).toThrow(/price must be a function/);
    expect(() => defineWrite({ ...minimal, properties: { confirm: { type: 'boolean' } } })).toThrow(/added by the write layer/);
  });
  it('classifies and marks consistently', () => {
    const decl = { production: 'when-target' };
    expect(normalizeClassification({}, { declarations: decl })).toEqual({ production: null, accessWidening: null, notifies: [], spendCents: 0, spendUnknown: false });
    expect(normalizeClassification({}, { readFailed: true, declarations: decl }).production).toContain('could not be read');
    expect(normalizeClassification({}, { declarations: { production: 'always' } }).production).toContain('always');
    expect(normalizeClassification({ spendCents: -5, notifies: 'x' }, { declarations: decl })).toMatchObject({ spendCents: 0, notifies: [] });
    expect(marksOf({ production: 'x', accessWidening: 'y', notifies: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], spendCents: 190 })).toEqual(['PRODUCTION', 'ACCESS CHANGE', 'NOTIFIES a, b, c, d, e and 2 more', 'COSTS $1.90']);
  });
});

describe('the price function of a spend tool', () => {
  const spendy = (price) => defineWrite({ name: 'github_x_spend', description: 'd', declarations: { production: 'never', spend: true, confirm: 'always' },
    target: () => ({ owner: 'example-org', scope: 'org' }), read: async () => null, classify: () => ({ spendCents: 99999 }), price, summarize: () => 's', apply: async () => null,
    readAfter: async () => null, verify: () => true, requestKey: () => 'rmcp_x' });
  it('marks the tool as priced and uses the price, not the classifier, for the cost', async () => {
    const def = spendy(() => 1900);
    expect(def.tool.priced).toBe(true);
    const w = await makeWorld({ gates: [] });
    const res = parse(await def.handler({ dryRun: true }, w.ctx));
    expect(JSON.stringify(res)).toContain('COSTS $19.00');
    expect(JSON.stringify(res)).not.toContain('999.99');
  });
  it('refuses when the price cannot be worked out', async () => {
    const w = await makeWorld({ gates: [] });
    for (const price of [() => { throw new Error('no price table'); }, () => -5, () => 1.5, () => 'x']) {
      const res = await spendy(price).handler({ confirm: true }, w.ctx);
      expect(res.isError).toBe(true);
      expect(parse(res)).toMatchObject({ status: 'refused_by_guard', refusedBy: 'spend' });
    }
  });
});

describe('the write layer refuses what it cannot do safely', () => {
  it('refuses a read-only profile, an account outside the connection, bad flags and unknown arguments', async () => {
    const readOnly = await makeWorld({ profile: 'read_only' });
    ok(readOnly.gh);
    const res = await sampleLabel.handler({ ...R, confirm: true }, readOnly.ctx);
    expect(res.isError).toBe(true);
    expect(parse(res).error).toContain('read_only');
    expect(writes(readOnly.gh)).toEqual([]);

    const w = await makeWorld();
    ok(w.gh);
    expect(parse(await sampleLabel.handler({ ...R, owner: 'someone-else' }, w.ctx)).error).toContain('not one of the GitHub accounts');
    expect(parse(await sampleLabel.handler({ ...R, dryRun: 'yes' }, w.ctx)).error).toContain('true or false');
    expect(parse(await sampleLabel.handler(null, w.ctx)).error).toContain('invalid');
    expect(parse(await sampleLabel.handler({ ...R, owner: undefined }, w.ctx)).status).toBe('refused');
    const viaDispatch = await createDispatch({ credentials: w.credentials, gates: [] }).call(null, { registry: mergeNamespaces([sampleLabel && { tools: [sampleLabel.tool], handlers: { github_sample_label: sampleLabel.handler } }]), name: 'github_sample_label', args: { ...R, extra: 1 }, connection: w.connection, db: w.db });
    expect(viaDispatch.isError).toBe(true);
    expect(viaDispatch.content[0].text).toContain('Unknown argument');
    expect(writes(w.gh)).toEqual([]);
  });

  it('fails closed without a change log or a gate list', async () => {
    const w = await makeWorld();
    ok(w.gh);
    const noDb = await sampleLabel.handler({ ...R, confirm: true }, { ...w.ctx, db: {} });
    expect(parse(noDb).error).toContain('change log');
    const noGates = await sampleLabel.handler({ ...R, confirm: true }, { ...w.ctx, gates: undefined });
    expect(parse(noGates).error).toContain('safety checks');
    expect(writes(w.gh)).toEqual([]);
  });

  it('treats a failed read as production: refused on preview, a confirmed preview on production, never sent without confirm', async () => {
    const w = await makeWorld();
    w.gh.when(LABELS).reply(500, { message: 'boom' });
    const refused = parse(await sampleLabel.handler({ ...R, confirm: true }, w.ctx));
    expect(refused).toMatchObject({ status: 'refused_by_guard', refusedBy: 'mode' });
    expect(refused.error).toContain('could not be read');
    const live = await makeWorld({ mode: 'production' });
    live.gh.when(LABELS).reply(500, { message: 'boom' });
    const out = parse(await sampleLabel.handler({ ...R, confirm: true }, live.ctx));
    expect(out).toMatchObject({ status: 'refused_by_guard', refusedBy: 'read' });
    expect(writes(live.gh)).toEqual([]);
  });

  it('refuses when a gate refuses, throws, or demands confirmation', async () => {
    const throwing = await makeWorld({ gates: [async () => { throw new Error('db down'); }] });
    ok(throwing.gh);
    expect(parse(await sampleLabel.handler({ ...R, confirm: true }, throwing.ctx))).toMatchObject({ status: 'refused_by_guard', refusedBy: 'guard' });
    const confirming = await makeWorld({ gates: [async () => ({ confirm: 'This repository is shared with a client.' })] });
    ok(confirming.gh);
    const asked = parse(await sampleLabel.handler({ ...R }, confirming.ctx));
    expect(asked).toMatchObject({ status: 'needs_confirmation', because: 'This repository is shared with a client.' });
    expect(writes(confirming.gh)).toEqual([]);
    expect(parse(await sampleLabel.handler({ ...R, confirm: true }, confirming.ctx)).status).toBe('applied');
  });

  it('records refusals and previews in the change log without any request key', async () => {
    const w = await makeWorld();
    ok(w.gh);
    await sampleSetting.handler({ owner: 'example-org', repo: 'hello', description: 'x', confirm: true }, w.ctx);
    const row = await w.db.getChange(1);
    expect(row).toMatchObject({ dryRun: true, confirmed: false, production: true, requestKey: null });
    expect(row.summary).toContain('REFUSED (mode)');
  });
});

describe('failures and retries', () => {
  it('a definite rejection is explained, logged, and frees the key so a corrected retry is not a replay', async () => {
    const w = await makeWorld();
    w.gh.when(LABELS).reply(200, []);
    w.gh.when(POST).reply(422, { message: 'Validation Failed' });
    const failed = parse(await sampleLabel.handler({ ...R }, w.ctx));
    expect(failed).toMatchObject({ done: false, status: 'rejected' });
    expect(failed.error).toContain('HTTP 422');
    expect(writes(w.gh)).toHaveLength(1);
    ok(w.gh);
    const retry = parse(await sampleLabel.handler({ ...R }, w.ctx));
    expect(retry.status).toBe('applied');
    expect(writes(w.gh)).toHaveLength(2);
  });

  it('an uncertain failure keeps the key: a repeat is a replay with a warning, never a second write', async () => {
    const w = await makeWorld();
    w.gh.when(LABELS).reply(200, []);
    w.gh.when(POST).reply(502, { message: 'bad gateway' });
    const first = parse(await sampleLabel.handler({ ...R }, w.ctx));
    expect(first).toMatchObject({ status: 'uncertain' });
    expect(first.warning).toContain('may or may not');
    const second = parse(await sampleLabel.handler({ ...R }, w.ctx));
    expect(second).toMatchObject({ status: 'replayed', replayed: true });
    expect(second.warning).toContain('could not be confirmed');
    expect(writes(w.gh)).toHaveLength(1);
  });

  it('a caller request key makes differently worded retries one change', async () => {
    const w = await makeWorld();
    ok(w.gh);
    const first = parse(await sampleLabel.handler({ ...R, requestKey: 'my-key-1' }, w.ctx));
    const second = parse(await sampleLabel.handler({ ...R, label: 'bug', issue_number: 7, requestKey: 'my-key-1' }, w.ctx));
    expect(first.requestKey).toBe(second.requestKey);
    expect(second.replayed).toBe(true);
    expect(writes(w.gh)).toHaveLength(1);
  });

  it('two identical requests sent together result in one write', async () => {
    const w = await makeWorld();
    ok(w.gh);
    const results = await Promise.all([sampleLabel.handler({ ...R }, w.ctx), sampleLabel.handler({ ...R }, w.ctx)]);
    expect(results.map((r) => parse(r).status).sort()).toEqual(['applied', 'replayed']);
    expect(writes(w.gh)).toHaveLength(1);
  });

  it('a result that looks like a credential is withheld by the dispatcher', async () => {
    const w = await makeWorld();
    ok(w.gh);
    const leaky = { tool: sampleLabel.tool, handler: async () => ({ content: [{ type: 'text', text: JSON.stringify({ token: 'ghs_FAKEinstallationtoken1' }) }] }) };
    const [, dispatch] = doorsFor(leaky);
    const out = await dispatch.call(w, { ...R });
    expect(out.isError).toBe(true);
    expect(out.content[0].text).not.toContain('ghs_');
  });

  it('classifies and explains GitHub failures in plain words', () => {
    expect(classifyGithubError(new GithubClientError('rate_limited', 'slow down'))).toBe('rejected');
    for (const status of [400, 403, 404, 409, 422, 429]) expect(classifyGithubError({ status })).toBe('rejected');
    for (const status of [408, 500, 502, 503, undefined]) expect(classifyGithubError({ status })).toBe('uncertain');
    expect(explainGithubError(new GithubClientError('outside_scope', 'Not one of your accounts.'))).toContain('Not one of your accounts.');
    expect(explainGithubError({ status: 403, response: { headers: { 'x-github-request-id': 'ABCD:1' } } })).toContain('request id ABCD:1');
    expect(explainGithubError(new Error('socket hang up with token ghp_FAKE'))).not.toContain('ghp_');
  });
});

it('awaits verified asynchronous target identity and denies rejected or foreign targets before a send', async () => {
 const w = await makeWorld({ profile: 'full', gates: [] }); let sent = 0;
 const make = target => defineWrite({ name: 'github_x_async_target', description: 'Resolve target identity from current stored authorization.', declarations: { production: 'never', profiles: ['full'] },
 target, read: async () => ({}), classify: () => ({}), summarize: () => 'Async target write', apply: async () => { sent++; }, readAfter: async () => ({}), verify: () => true, requestKey: () => 'rmcp_async_target' });
 const accepted = await make(async () => ({ owner: 'example-org', scope: 'repo', repo: 'hello' })).handler({}, w.ctx);
 expect(parse(accepted).status).toBe('applied'); expect(sent).toBe(1);
 expect(parse(await make(async () => ({ owner: 'foreign', scope: 'repo', repo: 'hello' })).handler({}, w.ctx)).status).toBe('refused');
 expect(parse(await make(async () => { throw new TypeError('Stored grant revoked'); }).handler({}, w.ctx)).error).toContain('Stored grant revoked');
 expect(sent).toBe(1);
});

describe('failed previews',()=>{
 it.each([true,false])('marks failed current-state reads without an actionable confirmation (safe=%s)',async safe=>{
  const w=await makeWorld({gates:[],mode:'production'});let sent=0;
  const def=defineWrite({name:'github_x_preflight',description:'d',declarations:{production:'never',confirm:'always'},
   target:()=>({owner:'example-org',scope:'org'}),read:()=>{throw Object.assign(new Error('private backend detail'),safe?{safeMessage:true}:{});},
   classify:()=>({}),summarize:()=> 'summary',apply:()=>{sent++;},readAfter:()=>null,verify:()=>true,requestKey:()=> 'rmcp_failed_preview'});
  const result=parse(await def.handler({dryRun:true},w.ctx));
  expect(result).toMatchObject({status:'preview',done:false,preflight_failed:true,needsConfirmation:false});
  expect(result.warning.includes('private backend detail')).toBe(safe);expect(sent).toBe(0);
 });
});
