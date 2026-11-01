// FLEET-2 slim-runtime gate: on (small + no browser/database signals) and off (every other case),
// the slim -> full -> source-build fallback chain, signal detection from workspace files, and the
// decision recorded on a real allocation row and shown by github_playground_read allocation.
import {afterEach, describe, expect, it} from 'vitest';
import {signalsFromFiles, slimDecision, autoSizeFor, chooseRuntimeImage, repositorySignals, SIGNAL_FILES} from '../../src/playground/runtime-variant.js';
import {resolvePrebuiltImage, _resetPrebuiltImageCache} from '../../src/playground/prebuilt-image.js';
import {runWriteContract, makeWorld, parse} from '../../test/helpers/write-contract.js';
import {prepareNativeWorld} from '../../test/helpers/native-git-world.js';
import * as playground from '../../src/tools/playground.js';
import {nativeRecord} from '../../src/native-git/client.js';

const SHA = 'c'.repeat(40), SLIM = 'sha256:' + 'e'.repeat(64), FULL = 'sha256:' + 'd'.repeat(64), REPO = 'ghcr.io/example-org/runtime';
const env = {PLAYGROUND_IMAGE_REPOSITORY: REPO, PLAYGROUND_BUILD_SOURCE_SHA: SHA};
function registry({slim = true, full = true} = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push(url);
    if (url.startsWith('https://ghcr.io/token')) return {status: 200, json: async () => ({token: 'anon-pull-token'})};
    const tag = url.split('/manifests/')[1];
    const digest = tag === SHA + '-slim' ? (slim ? SLIM : null) : tag === SHA ? (full ? FULL : null) : null;
    return {status: digest ? 200 : 404, headers: {get: k => (k === 'docker-content-digest' ? digest : null)}};
  };
  return {fetch, calls};
}
afterEach(() => _resetPrebuiltImageCache());
const pkg = deps => JSON.stringify({name: 'x', devDependencies: deps});
const none = Object.fromEntries(SIGNAL_FILES.map(p => [p, null]));

describe('repository signals', () => {
  it('finds browser and database packages, compose Postgres services and Python drivers', () => {
    expect(signalsFromFiles({...none, 'package.json': pkg({vitest: '1', eslint: '9'})})).toEqual([]);
    expect(signalsFromFiles({...none, 'package.json': pkg({'@playwright/test': '1'})})).toEqual([{kind: 'browser', name: '@playwright/test', file: 'package.json'}]);
    for (const name of ['playwright', 'puppeteer', 'cypress']) expect(signalsFromFiles({...none, 'package.json': pkg({[name]: '1'})})[0]).toMatchObject({kind: 'browser', name});
    for (const name of ['pg', 'postgres', 'prisma', '@prisma/client', 'typeorm', 'sequelize', 'knex']) expect(signalsFromFiles({...none, 'package.json': JSON.stringify({dependencies: {[name]: '1'}})})[0]).toMatchObject({kind: 'database', name});
    expect(signalsFromFiles({...none, 'docker-compose.yml': 'services:\n  db:\n    image: postgres:16\n'})).toEqual([{kind: 'database', name: 'postgres service', file: 'docker-compose.yml'}]);
    expect(signalsFromFiles({...none, 'compose.yaml': 'services:\n  cache:\n    image: redis\n'})).toEqual([]);
    expect(signalsFromFiles({...none, 'requirements.txt': 'psycopg2-binary==2.9\n'})[0]).toMatchObject({kind: 'database', name: 'psycopg'});
    expect(signalsFromFiles({...none, 'pyproject.toml': 'dependencies = ["selenium>=4"]'})[0]).toMatchObject({kind: 'browser', name: 'selenium'});
    expect(signalsFromFiles({...none, 'requirements.txt': 'requests\nflask\n'})).toEqual([]);
  });
  it('treats an unreadable or invalid file as a signal, so unsure means the full image', () => {
    expect(signalsFromFiles({...none, 'package.json': undefined})).toEqual([{kind: 'unknown', name: 'unreadable', file: 'package.json'}]);
    expect(signalsFromFiles({...none, 'package.json': '{not json'})).toEqual([{kind: 'unknown', name: 'invalid_json', file: 'package.json'}]);
  });
  it('reads the files through the Git worker: 404 is absent, other failures unknown, large files paged', async () => {
    const big = pkg({playwright: '1', filler: 'x'.repeat(40000)}), b64 = Buffer.from(big);
    const call = async (_c, {operation, options}) => {
      expect(operation).toBe('read_file');
      if (options.path === 'package.json') { const end = Math.min(b64.length, options.byteOffset + options.byteLength); if (options.byteOffset > 0) expect(options.expectedFileHash).toBe('h'); return {file_hash: 'h', content_base64: b64.subarray(options.byteOffset, end).toString('base64'), next_byte_offset: end, complete: end >= b64.length}; }
      if (options.path === 'requirements.txt') throw Object.assign(new Error('blocked'), {status: 400});
      throw Object.assign(new Error('missing'), {status: 404});
    };
    const signals = await repositorySignals({}, {binding: {}, job: {}, worker: 'git_x'}, {call});
    expect(signals).toEqual([{kind: 'browser', name: 'playwright', file: 'package.json'}, {kind: 'unknown', name: 'unreadable', file: 'requirements.txt'}]);
  });
});

describe('slim gate', () => {
  it('ON: size small and no signals', () => {
    expect(slimDecision({size: 'small', signals: []})).toMatchObject({useSlim: true, reason: expect.stringMatching(/slim image \(no Chromium, no PostgreSQL\)/)});
  });
  it('OFF: any other size, any signal, or files not checked', () => {
    for (const size of ['medium', 'large', undefined]) expect(slimDecision({size, signals: []}).useSlim).toBe(false);
    expect(slimDecision({size: 'small', signals: [{kind: 'browser', name: 'playwright', file: 'package.json'}]})).toMatchObject({useSlim: false, reason: expect.stringMatching(/playwright in package\.json/)});
    expect(slimDecision({size: 'small', signals: [{kind: 'database', name: 'pg', file: 'package.json'}]}).useSlim).toBe(false);
    expect(slimDecision({size: 'small', signals: undefined}).useSlim).toBe(false);
  });
  it('auto size for one-off runs: small without signals, medium with a database or unsure, large with a browser', () => {
    expect(autoSizeFor([]).size).toBe('small');
    expect(autoSizeFor([{kind: 'database', name: 'pg', file: 'package.json'}]).size).toBe('medium');
    expect(autoSizeFor([{kind: 'unknown', name: 'unreadable', file: 'package.json'}]).size).toBe('medium');
    expect(autoSizeFor([{kind: 'browser', name: 'cypress', file: 'package.json'}, {kind: 'database', name: 'pg', file: 'package.json'}]).size).toBe('large');
    expect(autoSizeFor(undefined).size).toBe('medium');
  });
});

describe('image choice and fallbacks', () => {
  const ctx = r => ({env, fetch: r.fetch});
  it('resolves the <sha>-slim tag only when asked for the slim variant', async () => {
    const r = registry();
    expect(await resolvePrebuiltImage(env, {fetch: r.fetch, variant: 'slim'})).toBe(`${REPO}@${SLIM}`);
    expect(await resolvePrebuiltImage(env, {fetch: r.fetch})).toBe(`${REPO}@${FULL}`);
    expect(r.calls.filter(u => u.includes('/manifests/'))).toEqual([`https://ghcr.io/v2/example-org/runtime/manifests/${SHA}-slim`, `https://ghcr.io/v2/example-org/runtime/manifests/${SHA}`]);
    expect(await resolvePrebuiltImage(env, {fetch: r.fetch, variant: 'tiny'})).toBeNull();
  });
  it('gate on: slim image when published, else the full image, else a source build', async () => {
    expect(await chooseRuntimeImage(ctx(registry()), null, 'small', {signals: []})).toMatchObject({image: `${REPO}@${SLIM}`, record: {variant: 'slim'}});
    _resetPrebuiltImageCache();
    const noSlim = await chooseRuntimeImage(ctx(registry({slim: false})), null, 'small', {signals: []});
    expect(noSlim).toMatchObject({image: `${REPO}@${FULL}`, record: {variant: 'full', reason: expect.stringMatching(/No slim image is published/)}});
    _resetPrebuiltImageCache();
    expect(await chooseRuntimeImage(ctx(registry({slim: false, full: false})), null, 'small', {signals: []})).toMatchObject({image: null, record: {variant: 'source_build'}});
  });
  it('gate off: medium/large or signals never ask for the slim tag; an operator pin is used as-is', async () => {
    const r = registry();
    expect(await chooseRuntimeImage(ctx(r), null, 'medium')).toMatchObject({image: `${REPO}@${FULL}`, record: {variant: 'full'}});
    expect(await chooseRuntimeImage(ctx(r), null, 'small', {signals: [{kind: 'database', name: 'pg', file: 'package.json'}]})).toMatchObject({image: `${REPO}@${FULL}`, record: {variant: 'full', signals: [{name: 'pg'}]}});
    expect(r.calls.some(u => u.endsWith('-slim'))).toBe(false);
    const pinned = registry();
    expect(await chooseRuntimeImage({env: {...env, PLAYGROUND_IMAGE: `${REPO}@${FULL}`}, fetch: pinned.fetch}, null, 'small', {signals: []})).toMatchObject({image: null, record: {variant: 'operator_pinned'}});
    expect(pinned.calls).toEqual([]);
  });
  it('detects signals only for small jobs and treats a detection failure as a signal', async () => {
    let detected = 0;
    await chooseRuntimeImage(ctx(registry()), null, 'large', {detect: async () => { detected++; return []; }});
    expect(detected).toBe(0);
    expect((await chooseRuntimeImage(ctx(registry()), null, 'small', {detect: async () => { throw new Error('down'); }})).record.variant).toBe('full');
  });
});

// The decision as stored on a real allocation and shown to agents. Same Dokploy fake as the sizing
// contract; no operator pin, so the published slim image is chosen for a small job of this fixture
// repository (it has no package.json or other signal files).
const name = 'github_playground_workspace';
const arrange = (gh, outcome) => { gh.nativeOutcome = outcome; gh.when('GET /repos/{owner}/{repo}').reply(200, {full_name: 'example-org/hello'}); };
const cleanups = []; afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });
async function dokployWorld(w) {
  cleanups.push(await prepareNativeWorld(w, {existing: true})); const rows = new Map(); let sequence = 0; const reg = registry(), prior = w.ctx.fetch;
  w.composes = rows;
  const fetch = async (url, init) => {
    if (String(url).startsWith('https://ghcr.io/')) return reg.fetch(url, init);
    if (new URL(url).origin !== 'https://dokploy.example.test') return prior(url, init);
    const u = new URL(url), op = u.pathname.split('/').pop(), input = init.method === 'GET' ? Object.fromEntries(u.searchParams) : JSON.parse(init.body), row = rows.get(input.composeId);
    if (op === 'project.one') return Response.json({projectId: 'fixture', environments: [{environmentId: 'fixture-env', compose: [...rows.values()]}]});
    if (op === 'compose.create') { const created = {...input, composeId: 'compose-' + ++sequence, environment: {projectId: 'fixture'}, domains: [], composeStatus: 'idle', afterDeploy: 0}; rows.set(created.composeId, created); return Response.json(created); }
    if (op === 'compose.one') { if (row?.composeStatus === 'done' && !row.appName.includes('manager') && ++row.afterDeploy > 1 && w.gh.nativeOutcome === 'mismatch') return Response.json(null, {status: 404}); return Response.json(row ?? null, {status: row ? 200 : 404}); }
    if (op === 'domain.create') { rows.get(input.composeId).domains.push(input); return Response.json(input); }
    if (op === 'compose.deploy') { row.composeStatus = 'done'; return Response.json({}); }
    throw Error('Unexpected provider operation ' + op);
  };
  w.gh.fetch = fetch; w.ctx = {...w.ctx, fetch, env: {...w.ctx.env, ...env, PUBLIC_BASE_URL: 'https://mcp.example.test', PLAYGROUND_DOKPLOY_ORIGIN: 'https://dokploy.example.test', PLAYGROUND_DOKPLOY_API_KEY: 'FAKE_PROJECT_KEY', PLAYGROUND_DOKPLOY_PROJECT_ID: 'fixture', PLAYGROUND_DOKPLOY_ENVIRONMENT_ID: 'fixture-env', PLAYGROUND_INGRESS_IPV4: '107.90.116.157', PLAYGROUND_ADMISSION: JSON.stringify({project: 'fixture', observedAt: w.ctx.now(), availableMemoryBytes: 8 * 1024 ** 3, availableDiskBytes: 10 * 1024 ** 3, pressure: 0})}};
  await w.nativeReady();
}
runWriteContract({label: name + ' small on the slim image', definition: {tool: playground.tools.find(t => t.name === name), handler: playground.handlers[name]}, args: {owner: 'example-org', repo: 'hello', workspace_id: 'job_0123456789abcdef', operation: 'provision', size: 'small', requestKey: 'provision-slim'}, needsConfirm: true, profile: 'full', expectedWrites: 0, arrange, prepare: dokployWorld});

it('a small provision records the slim decision in its plan and github_playground_read allocation shows it; medium stays full', async () => {
  for (const [size, variant, digest] of [['small', 'slim', SLIM], ['medium', 'full', FULL]]) {
    _resetPrebuiltImageCache();
    const w = await makeWorld({profile: 'full', mode: 'production', gates: []}); arrange(w.gh, 'ok'); await dokployWorld(w);
    const out = parse(await playground.handlers[name]({owner: 'example-org', repo: 'hello', workspace_id: 'job_0123456789abcdef', operation: 'provision', size, requestKey: 'p-' + size}, w.ctx));
    expect(out.status).toBe('applied');
    const read = await playground.handlers.github_playground_read({owner: 'example-org', repo: 'hello', workspace_id: 'job_0123456789abcdef', operation: 'allocation'}, w.ctx), shown = read.structuredContent ?? read;
    expect(shown.runtime_image).toMatchObject({variant, reason: expect.any(String)});
    const workspace = [...w.composes.values()].find(c => !c.appName?.includes('manager') && !c.name?.includes('manager'));
    expect(workspace.composeFile).toContain(`${REPO}@${digest}`);
    if (variant === 'slim') expect(shown.runtime_image.signals).toEqual([]);
    const record = await nativeRecord(w.ctx, 'job_0123456789abcdef');
    expect(record.row.id).toBe('job_0123456789abcdef');
  }
});
