import { describe, it, expect } from 'vitest';
import { runWriteContract, makeWorld, doorsFor, parse } from '../../test/helpers/write-contract.js';
import * as env from '../../src/tools/environments-write.js';

const R = { repo: 'hello', environment: 'staging' };
const ROUTE = 'GET /repos/{owner}/{repo}/environments/{environment_name}';
const PUT = 'PUT /repos/{owner}/{repo}/environments/{environment_name}';
const DEL = 'DELETE /repos/{owner}/{repo}/environments/{environment_name}';
const simple = { name: 'staging', protection_rules: [], deployment_branch_policy: null };
const policy = { protected_branches: true, custom_branch_policies: false };
const changed = { ...simple, deployment_branch_policy: policy };
const rich = { ...simple, protection_rules: [
  { type: 'wait_timer', wait_timer: 15 },
  { type: 'required_reviewers', prevent_self_review: true, reviewers: [{ type: 'User', reviewer: { id: 25, login: 'ops' } }] }
] };
const def = (name) => ({ tool: env.tools.find((t) => t.name === name), handler: env.handlers[name] });
const seq = (gh, route, steps) => gh.when(route).replySequence(steps.map(([status, body]) => ({ status, body })));
const writes = (gh) => gh.calls.filter((c) => ['PUT', 'DELETE', 'POST'].includes(c.method));
const call = async (name, w, args) => parse(await doorsFor(def(name))[0].call(w, args));

runWriteContract({
  label: 'github_env_save (preserves settings)', definition: def('github_env_save'),
  args: { ...R, deploymentBranchPolicy: policy },
  needsConfirm: true, profile: 'full',
  arrange(gh, outcome) {
    seq(gh, ROUTE, [[200, simple], [200, simple], [200, outcome === 'ok' ? changed : simple]]);
    gh.when(PUT).reply(200, changed);
  }
});

runWriteContract({
  label: 'github_env_delete (irreversible)', definition: def('github_env_delete'),
  args: R, needsConfirm: true, profile: 'full',
  arrange(gh, outcome) {
    seq(gh, ROUTE, [[200, simple], [200, simple],
      outcome === 'ok' ? [404, { message: 'Not Found' }] : [200, simple]]);
    gh.when(DEL).reply(204, '');
  }
});

describe('G-4 environment write behavior', () => {
  it('only changes supplied branch policy and preserves reviewers, wait and self-review', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    seq(w.gh, ROUTE, [[200, rich], [200, rich], [200, { ...rich, deployment_branch_policy: policy }]]);
    w.gh.when(PUT).reply(200, changed);
    const out = await call('github_env_save', w, { ...R, deploymentBranchPolicy: policy, confirm: true });
    expect(out.status).toBe('applied');
    expect(writes(w.gh)[0].body).toMatchObject({
      wait_timer: 15, prevent_self_review: true, reviewers: [{ type: 'User', id: 25 }],
      deployment_branch_policy: policy
    });
    expect(w.gh.invalid).toEqual([]);
  });

  it('gaining required reviewers is classified as production before any write', async () => {
    const w = await makeWorld({delegated:true, profile: 'full' });
    seq(w.gh, ROUTE, [[200, simple], [200, simple]]);
    const result = await call('github_env_save', w, { ...R, reviewers: [{ type: 'Team', id: 8 }], confirm: true });
    expect(result).toMatchObject({ status: 'refused_by_guard', refusedBy: 'mode' });
    expect(writes(w.gh)).toEqual([]);
  });

  it('explicit zero, false, empty reviewers and null branch policy clear only what was named', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    const before = { ...rich, deployment_branch_policy: policy };
    const after = { ...simple, protection_rules: [] };
    seq(w.gh, ROUTE, [[200, before], [200, before], [200, after]]);
    w.gh.when(PUT).reply(200, after);
    const result = await call('github_env_save', w, {
      ...R, waitTimer: 0, preventSelfReview: false, reviewers: [], clearDeploymentBranchPolicy: true, confirm: true
    });
    expect(result.status).toBe('applied');
    expect(writes(w.gh)[0].body).toMatchObject({ wait_timer: 0, prevent_self_review: false,
      reviewers: [], deployment_branch_policy: null });
  });

  it('unsupported custom protections are never silently removed', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    const custom = { ...simple, protection_rules: [{ type: 'custom', id: 101 }] };
    seq(w.gh, ROUTE, [[200, custom]]);
    const result = await call('github_env_save', w, { ...R, waitTimer: 5, confirm: true });
    expect(['rejected', 'refused']).toContain(result.status);
    expect(writes(w.gh)).toEqual([]);
  });

  it('an unreadable before-state cannot be interpreted as missing', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    w.gh.when(ROUTE).reply(403, { message: 'Forbidden' });
    const result = await call('github_env_save', w, { ...R, waitTimer: 3, confirm: true });
    expect(result.status).not.toBe('applied');
    expect(writes(w.gh)).toEqual([]);
  });

  it('previews deletion as irreversible and refuses a production environment in preview mode', async () => {
    const w = await makeWorld({delegated:true, mode: 'preview', profile: 'full' });
    seq(w.gh, ROUTE, [[200, simple]]);
    const result = await call('github_env_delete', w, { ...R, environment: 'production', confirm: true });
    expect(result.status).toBe('refused_by_guard');
    expect(writes(w.gh)).toEqual([]);
  });

  it('refuses an unsupported null policy argument before reading GitHub', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    const out = await call('github_env_save', w, { ...R, deploymentBranchPolicy: null, confirm: true });
    expect(out.status).toBe('refused');
    expect(w.gh.calls).toEqual([]);
  });

  it('refuses simultaneously setting and clearing a policy, and false clearing flags', async () => {
    for (const extraArgs of [
      { deploymentBranchPolicy: policy, clearDeploymentBranchPolicy: true },
      { clearDeploymentBranchPolicy: false }
    ]) {
      const w = await makeWorld({ mode: 'production', profile: 'full' });
      const out = await call('github_env_save', w, { ...R, ...extraArgs, confirm: true });
      expect(out.status).toBe('refused');
      expect(w.gh.calls).toEqual([]);
    }
  });

  it('cannot confirm success when the environment disappears after the PUT', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    seq(w.gh, ROUTE, [[200, simple], [200, simple], [404, { message: 'Not Found' }]]);
    w.gh.when(PUT).reply(200, simple);
    const out = await call('github_env_save', w, { ...R, clearDeploymentBranchPolicy: true, confirm: true });
    expect(out).toMatchObject({ status: 'unconfirmed', confirmed: false });
    expect(writes(w.gh)).toHaveLength(1);
  });

  it('rejects contradictory branch modes and sends no PUT', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    seq(w.gh, ROUTE, [[200, simple]]);
    const result = await call('github_env_save', w, { ...R,
      deploymentBranchPolicy: { protected_branches: true, custom_branch_policies: true }, confirm: true });
    expect(['rejected', 'refused']).toContain(result.status);
    expect(writes(w.gh)).toEqual([]);
  });
});
