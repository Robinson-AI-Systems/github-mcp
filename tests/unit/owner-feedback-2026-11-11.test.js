// Owner feedback 2026-11-11: (1) writes that had succeeded said "reading it back did not show the expected result";
// (2) a call with no owner looked only in the default account; (3) workflow inputs given as an object were refused.
import { describe, expect, it } from 'vitest';
import { makeWorld, parse, NOW } from '../../test/helpers/write-contract.js';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';

const call = (w, name, args) => createDispatch({ env: w.ctx.env, credentials: w.credentials, fetch: w.gh.fetch, gates: [], now: w.ctx.now, sleep: w.ctx.sleep })({ registry, name, args, connection: w.connection, db: w.db });
const workflow = (gh) => {
  gh.when('GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}').reply(200, { id: 3, name: 'ci', path: '.github/workflows/ci.yml', state: 'active' });
  gh.when('GET /repos/{owner}/{repo}/contents/{path}').reply(200, { type: 'file', path: '.github/workflows/ci.yml', encoding: 'base64', content: Buffer.from('jobs:\n  test:\n    runs-on: ubuntu-latest\n').toString('base64') });
  gh.when('GET /repos/{owner}/{repo}').reply(200, { default_branch: 'main' });
  gh.when('GET /repos/{owner}/{repo}/branches/{branch}').reply(200, { protected: false });
  gh.when('GET /repos/{owner}/{repo}/rules/branches/{branch}').reply(200, []);
  gh.when('GET /repos/{owner}/{repo}/environments/{environment_name}').reply(404, { message: 'Not Found' });
};

describe('workflow start', () => {
  it('accepts inputs as an object as well as a list, and is confirmed when GitHub answers 204 with no run id', async () => {
    const w = await makeWorld({ profile: 'full' });
    workflow(w.gh);
    w.gh.when('POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches').reply(204);
    w.gh.when('GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs').reply(200, { total_count: 1, workflow_runs: [{ id: 77, status: 'queued', html_url: 'https://github.com/x', created_at: new Date(NOW).toISOString() }] });
    const out = parse(await call(w, 'github_actions_dispatch', { repo: 'hello', workflow: 'ci.yml', ref: 'feature', inputs: { target: 'staging', count: 3 }, confirm: true }));
    expect(out).toMatchObject({ status: 'applied', confirmed: true, result: { run_id: 77 } });
    expect(w.gh.calls.find((c) => c.route.endsWith('/dispatches')).body).toEqual({ ref: 'feature', inputs: { target: 'staging', count: '3' } });
    expect(w.gh.invalid).toEqual([]);
  });
  it('is still confirmed when the started run is not visible yet (GitHub accepted it)', async () => {
    const w = await makeWorld({ profile: 'full' });
    workflow(w.gh);
    w.gh.when('POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches').reply(204);
    w.gh.when('GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs').reply(200, { total_count: 0, workflow_runs: [] });
    const out = parse(await call(w, 'github_actions_dispatch', { repo: 'hello', workflow: 'ci.yml', ref: 'feature', confirm: true }));
    expect(out).toMatchObject({ status: 'applied', confirmed: true });
  });
});

describe('a write is read back again once before it is called unconfirmed', () => {
  it('confirms when the first read-back lags and the second shows the result', async () => {
    const w = await makeWorld({ profile: 'full' });
    workflow(w.gh);
    w.gh.when('POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches').reply(200, { workflow_run_id: 55, run_url: 'https://api.github.com/x', html_url: 'https://github.com/x' });
    w.gh.when('GET /repos/{owner}/{repo}/actions/runs/{run_id}').replySequence([{ status: 404, body: { message: 'Not Found' } }, { status: 200, body: { id: 55, status: 'queued', html_url: 'u' } }]);
    const out = parse(await call(w, 'github_actions_dispatch', { repo: 'hello', workflow: 'ci.yml', ref: 'feature', confirm: true }));
    expect(out).toMatchObject({ status: 'applied', confirmed: true, result: { run_id: 55 } });
    expect(w.gh.calls.filter((c) => c.route.endsWith('/dispatches'))).toHaveLength(1); // the change itself is never sent twice
  });
});

describe('no owner named', () => {
  const quiet = (gh) => { gh.when('GET /repos/{owner}/{repo}/rules/branches/{branch}').reply(200, []); gh.when('GET /repos/{owner}/{repo}/properties/values').reply(200, []); };
  it('uses the one connected account that holds the repository when the default account does not', async () => {
    const w = await makeWorld({ accounts: ['example-user', 'example-org'], profile: 'full' });
    quiet(w.gh);
    // The default account has no such repository.
    w.gh.when('GET /repos/{owner}/{repo}').replySequence([{ status: 404, body: { message: 'Not Found' } }, { status: 200, body: { default_branch: 'main', name: 'only-in-org', full_name: 'example-org/only-in-org' } }, { status: 200, body: { default_branch: 'main', name: 'only-in-org', full_name: 'example-org/only-in-org' } }]);
    const out = parse(await call(w, 'github_repo_get', { repo: 'only-in-org' }));
    expect(out.error ?? null).toBeNull();
    const owners = w.gh.calls.filter((c) => c.route === 'GET /repos/{owner}/{repo}').map((c) => c.params.owner);
    expect(owners).toEqual(['example-user', 'example-org', 'example-org']);
  });
  it('leaves the call alone when the default account holds the repository or the connection has one account', async () => {
    const w = await makeWorld({ accounts: ['example-user', 'example-org'], profile: 'full' });
    quiet(w.gh);
    w.gh.when('GET /repos/{owner}/{repo}').reply(200, { default_branch: 'main', name: 'mine', full_name: 'example-user/mine' });
    await call(w, 'github_repo_get', { repo: 'mine' });
    expect(w.gh.calls.filter((c) => c.route === 'GET /repos/{owner}/{repo}').every((c) => c.params.owner === 'example-user')).toBe(true);
    const single = await makeWorld({ profile: 'full' });
    quiet(single.gh);
    single.gh.when('GET /repos/{owner}/{repo}').reply(200, { default_branch: 'main', name: 'solo', full_name: 'example-org/solo' });
    await call(single, 'github_repo_get', { repo: 'solo' });
    expect(single.gh.calls.filter((c) => c.route === 'GET /repos/{owner}/{repo}')).toHaveLength(1);
  });
});
