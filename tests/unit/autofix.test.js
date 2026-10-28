import { describe, expect, it } from 'vitest';
import { runWriteContract, makeWorld, parse } from '../../test/helpers/write-contract.js';
import * as autofix from '../../src/tools/autofix.js';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';

const def = (name) => ({ tool: autofix.tools.find((t) => t.name === name), handler: autofix.handlers[name] });
const O = 'example-org';
const FIX = '/repos/{owner}/{repo}/code-scanning/alerts/{alert_number}/autofix';
const SHA = 'c'.repeat(40);

runWriteContract({
  label: 'github_code_scanning_autofix_start', definition: def('github_code_scanning_autofix_start'), args: { owner: O, repo: 'app', alertNumber: 3 }, profile: 'full',
  arrange: (gh, o) => {
    gh.when(`GET ${FIX}`).reply(404, { message: 'No autofix' });
    gh.when(`POST ${FIX}`).reply(202, () => { gh.when(`GET ${FIX}`).reply(200, { status: o === 'ok' ? 'pending' : 'error', description: 'd', started_at: '2026-10-16T00:00:00Z' }); return { status: 'pending', description: 'd', started_at: '2026-10-16T00:00:00Z' }; });
  }
});

runWriteContract({
  label: 'github_code_scanning_autofix_commit', definition: def('github_code_scanning_autofix_commit'), args: { owner: O, repo: 'app', alertNumber: 3, targetRef: 'fix-branch' }, needsConfirm: true, production: true, profile: 'full',
  arrange: (gh, o) => {
    gh.when('GET /repos/{owner}/{repo}').reply(200, { default_branch: 'fix-branch' });
    gh.when(`GET ${FIX}`).reply(200, { status: 'success', description: 'Escape the input', started_at: '2026-10-16T00:00:00Z' });
    gh.when(`POST ${FIX}/commits`).reply(201, { target_ref: 'fix-branch', sha: SHA });
    gh.when('GET /repos/{owner}/{repo}/commits/{ref}').reply(o === 'ok' ? 200 : 404, o === 'ok' ? { sha: SHA } : { message: 'Not Found' });
  }
});

describe('autofix job', () => {
  it('starts a job and finishes ready only when GitHub says success', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    const run = async (name, args) => parse(await createDispatch({ env: w.ctx.env, credentials: w.credentials, gates: [], fetch: w.gh.fetch, now: w.ctx.now, sleep: async () => {} })({ registry, name, args, connection: w.connection, db: w.db }));
    w.gh.when(`GET ${FIX}`).reply(404, { message: 'none' });
    w.gh.when(`POST ${FIX}`).reply(202, () => { w.gh.when(`GET ${FIX}`).reply(200, { status: 'pending', description: 'd', started_at: 'x' }); return { status: 'pending', description: 'd', started_at: 'x' }; });
    const started = await run('github_code_scanning_autofix_start', { repo: 'app', alertNumber: 3, confirm: true });
    expect(started.done).toBe(true);
    const id = JSON.stringify(started).match(/job_[0-9a-f]{16}/)[0];
    w.gh.when(`GET ${FIX}`).reply(200, { status: 'pending', description: 'd', started_at: 'x' });
    expect((await run('github_job_status', { job_id: id })).state).toBe('pending');
    expect(w.gh.invalid).toEqual([]);
  });
});

describe('autofix commit', () => {
  const setup = async (fix) => {
    const w = await makeWorld({ mode: 'preview', profile: 'full' });
    w.gh.when('GET /repos/{owner}/{repo}').reply(200, { default_branch: 'main' });
    w.gh.when('GET /repos/{owner}/{repo}/branches/{branch}').reply(200, { protected: false });
    w.gh.when('GET /repos/{owner}/{repo}/rules/branches/{branch}').reply(200, []);
    w.gh.when(`GET ${FIX}`).reply(200, fix);
    w.gh.when(`POST ${FIX}/commits`).reply(201, { target_ref: 'fix-branch', sha: SHA });
    w.gh.when('GET /repos/{owner}/{repo}/commits/{ref}').reply(200, { sha: SHA });
    return w;
  };
  const call = async (w, args) => parse(await createDispatch({ env: w.ctx.env, credentials: w.credentials, gates: [], fetch: w.gh.fetch, now: w.ctx.now, sleep: async () => {} })({ registry, name: 'github_code_scanning_autofix_commit', args, connection: w.connection, db: w.db }));
  it('commits to a plain side branch, but never when no fix is ready', async () => {
    const w = await setup({ status: 'success', description: 'x', started_at: 'y' });
    expect((await call(w, { repo: 'app', alertNumber: 3, targetRef: 'fix-branch', confirm: true })).status).toBe('applied');
    const w2 = await setup({ status: 'pending', description: 'x', started_at: 'y' });
    expect((await call(w2, { repo: 'app', alertNumber: 3, targetRef: 'fix-branch', confirm: true })).status).not.toBe('applied');
    expect(w2.gh.calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });
  it('allows an instructed owner change to the default branch through GitHub', async () => {
    const w = await setup({ status: 'success', description: 'x', started_at: 'y' });
    expect((await call(w, { repo: 'app', alertNumber: 3, targetRef: 'main', confirm: true })).status).toBe('applied');
  });
});
