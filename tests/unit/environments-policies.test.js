import { describe, it, expect } from 'vitest';
import { runWriteContract, makeWorld, doorsFor, parse } from '../../test/helpers/write-contract.js';
import * as policy from '../../src/tools/environments-policies.js';

const A = { repo: 'hello', environment: 'staging' };
const ENV = 'GET /repos/{owner}/{repo}/environments/{environment_name}';
const LIST = 'GET /repos/{owner}/{repo}/environments/{environment_name}/deployment-branch-policies';
const ONE = 'GET /repos/{owner}/{repo}/environments/{environment_name}/deployment-branch-policies/{branch_policy_id}';
const POST = 'POST /repos/{owner}/{repo}/environments/{environment_name}/deployment-branch-policies';
const PUT = 'PUT /repos/{owner}/{repo}/environments/{environment_name}/deployment-branch-policies/{branch_policy_id}';
const DELETE = 'DELETE /repos/{owner}/{repo}/environments/{environment_name}/deployment-branch-policies/{branch_policy_id}';
const env = { name: 'staging', protection_rules: [], deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } };
const original = { id: 6, name: 'release/*', type: 'branch' };
const updated = { ...original, name: 'hotfix/*' };
const added = { id: 9, name: 'v*', type: 'tag' };
const data = (items) => ({ total_count: items.length, branch_policies: items });
const sequence = (gh, route, steps) => gh.when(route).replySequence(steps.map(([status, body]) => ({ status, body })));
const def = (name) => ({ tool: policy.tools.find((t) => t.name === name), handler: policy.handlers[name] });
const writes = (gh) => gh.calls.filter((x) => ['POST','PUT','DELETE'].includes(x.method));
const call = async (name, w, args) => parse(await doorsFor(def(name))[0].call(w, args));
const base = (gh) => gh.when(ENV).reply(200, env);

runWriteContract({
  label: 'github_env_policy_create', definition: def('github_env_policy_create'),
  args: { ...A, name: 'v*', type: 'tag' }, needsConfirm: true, profile: 'full', accessWidening: true,
  arrange(gh, outcome) {
    base(gh);
    sequence(gh, LIST, [[200, data([original])], [200, data(outcome === 'ok' ? [original, added] : [original])]]);
    gh.when(POST).reply(200, added);
  }
});
runWriteContract({
  label: 'github_env_policy_update', definition: def('github_env_policy_update'),
  args: { ...A, policyId: 6, name: 'hotfix/*' }, needsConfirm: true, profile: 'full', accessWidening: true,
  arrange(gh, outcome) {
    base(gh);
    sequence(gh, ONE, [[200, original], [200, outcome === 'ok' ? updated : original]]);
    gh.when(LIST).reply(200, data([original]));
    gh.when(PUT).reply(200, updated);
  }
});
runWriteContract({
  label: 'github_env_policy_delete', definition: def('github_env_policy_delete'),
  args: { ...A, policyId: 6 }, needsConfirm: true, profile: 'full', accessWidening: true,
  arrange(gh, outcome) {
    base(gh);
    sequence(gh, ONE, [[200, original], outcome === 'ok'
      ? [404, { message: 'not found' }] : [200, original]]);
    gh.when(DELETE).reply(204, '');
  }
});

describe('G-4 separate branch/tag policies', () => {
  it('preserves all environment settings and sends a type with branch/tag creation', async () => {
    const w = await makeWorld({ profile: 'full', mode: 'production' });
    base(w.gh);
    sequence(w.gh, LIST, [[200, data([original])], [200, data([original, added])]]);
    w.gh.when(POST).reply(200, added);
    const out = await call('github_env_policy_create', w, { ...A, name: 'v*', type: 'tag', confirm: true });
    expect(out.status).toBe('applied');
    expect(writes(w.gh)).toHaveLength(1);
    expect(writes(w.gh)[0].body).toMatchObject({ name: 'v*', type: 'tag' });
    expect(w.gh.invalid).toEqual([]);
  });

  it('refuses when custom branch policies are disabled', async () => {
    const w = await makeWorld({ profile: 'full' });
    w.gh.when(ENV).reply(200, { ...env, deployment_branch_policy: { protected_branches: true, custom_branch_policies: false } });
    const out = await call('github_env_policy_create', w, { ...A, name: 'v*', type: 'tag', confirm: true });
    expect(out.status).not.toBe('applied');
    expect(writes(w.gh)).toEqual([]);
  });

  it('refuses incomplete lists instead of missing a conflicting policy', async () => {
    const w = await makeWorld({ profile: 'full' });
    base(w.gh);
    w.gh.when(LIST).reply(200, { total_count: 101, branch_policies: [original] });
    const out = await call('github_env_policy_create', w, { ...A, name: 'v*', type: 'tag', confirm: true });
    expect(out.status).not.toBe('applied');
    expect(writes(w.gh)).toEqual([]);
  });

  it('preserves a separate policy type while renaming', async () => {
    const w = await makeWorld({ profile: 'full', mode: 'production' });
    base(w.gh);
    sequence(w.gh, ONE, [[200, original], [200, updated]]);
    w.gh.when(LIST).reply(200, data([original]));
    w.gh.when(PUT).reply(200, updated);
    const out = await call('github_env_policy_update', w, { ...A, policyId: 6, name: 'hotfix/*', confirm: true });
    expect(out.status).toBe('applied');
    expect(writes(w.gh)[0].body).toEqual({ name: 'hotfix/*' });
    expect(w.gh.invalid).toEqual([]);
  });

  it('protects a reviewer-gated environment from preview mutation', async () => {
    const w = await makeWorld({delegated:true, profile: 'full', mode: 'preview' });
    w.gh.when(ENV).reply(200, { ...env, protection_rules: [{ type: 'required_reviewers', reviewers: [] }] });
    w.gh.when(LIST).reply(200, data([original]));
    const out = await call('github_env_policy_create', w, { ...A, name: 'v*', type: 'tag', confirm: true });
    expect(out).toMatchObject({ status: 'refused_by_guard', refusedBy: 'mode' });
    expect(writes(w.gh)).toEqual([]);
  });
});
