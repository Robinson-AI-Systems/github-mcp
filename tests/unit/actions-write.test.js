// G-1 part 2: every Actions change tool passes the write contract through all three doors, then the rules the contract does not cover.
import { describe, expect, it } from 'vitest';
import { runWriteContract, makeWorld, parse } from '../../test/helpers/write-contract.js';
import { protectionGate } from '../../test/helpers/fixture-gates.js';
import { environmentsIn } from '../../src/github/workflow-env.js';
import * as actions from '../../src/tools/actions-write.js';

const def = (name) => ({ tool: actions.tools.find((t) => t.name === name), handler: actions.handlers[name] });
const R = { repo: 'hello' };
const WF = 'GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}';
const RUN = 'GET /repos/{owner}/{repo}/actions/runs/{run_id}';
const b64 = (t) => Buffer.from(t).toString('base64');
const seq = (gh, route, steps) => gh.when(route).replySequence(steps.map(([status, body]) => ({ status, body })));
const gatesFor = ({ protectedLevel }) => (protectedLevel ? [protectionGate(protectedLevel === 'pr-only' ? 'none' : protectedLevel)] : []);
const FILE = (env) => ({ type: 'file', path: '.github/workflows/ci.yml', encoding: 'base64', content: b64(env ? `jobs:\n  ship:\n    runs-on: ubuntu-latest\n    environment: ${env}\n` : 'jobs:\n  test:\n    runs-on: ubuntu-latest\n') });
const workflow = (gh, env) => {
  gh.when(WF).reply(200, { id: 3, name: 'ci', path: '.github/workflows/ci.yml', state: 'active' });
  gh.when('GET /repos/{owner}/{repo}/contents/{path}').reply(200, FILE(env));
  gh.when('GET /repos/{owner}/{repo}').reply(200, { default_branch: 'main' });
  gh.when('GET /repos/{owner}/{repo}/branches/{branch}').reply(200, { protected: false });
  gh.when('GET /repos/{owner}/{repo}/rules/branches/{branch}').reply(200, []);
  gh.when('GET /repos/{owner}/{repo}/environments/{environment_name}').reply(404, { message: 'Not Found' });
};
const base = { gatesFor, conveyor: true };
const strict = { gatesFor: undefined, conveyor: false }; // production work is refused under pr-only (the fixture gate does that)

for (const [label, env] of [['ordinary workflow', null], ['deploys to production', 'production']]) {
  const production = env !== null;
  runWriteContract({
    ...base, label: `github_actions_dispatch (${label})`, definition: def('github_actions_dispatch'), args: { ...R, workflow: 'ci.yml', ref: 'feature', inputs: [{ name: 'target', value: 'staging' }] }, needsConfirm: production, production, ...(production ? strict : {}),
    arrange(gh, outcome) {
      workflow(gh, env);
      gh.when('POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches').reply(200, { workflow_run_id: 55, run_url: 'https://api.github.com/x', html_url: 'https://github.com/x' });
      gh.when(RUN).reply(outcome === 'ok' ? 200 : 404, outcome === 'ok' ? { id: 55, status: 'queued', html_url: 'u' } : { message: 'Not Found' });
    }
  });
  runWriteContract({
    ...base, label: `github_actions_set_workflow_enabled (${label})`, definition: def('github_actions_set_workflow_enabled'), args: { ...R, workflow: 'ci.yml', enabled: false }, needsConfirm: production, production, ...(production ? strict : {}), profile: 'full',
    arrange(gh, outcome) {
      workflow(gh, env);
      seq(gh, WF, [[200, { id: 3, name: 'ci', path: '.github/workflows/ci.yml', state: 'active' }], [200, { id: 3, name: 'ci', path: '.github/workflows/ci.yml', state: outcome === 'ok' ? 'disabled_manually' : 'active' }]]);
      gh.when('PUT /repos/{owner}/{repo}/actions/workflows/{workflow_id}/disable').reply(204, null);
    }
  });
  runWriteContract({
    ...base, label: `github_actions_rerun (${label})`, definition: def('github_actions_rerun'), args: { ...R, runId: 9 }, needsConfirm: production, production, ...(production ? strict : {}),
    arrange(gh, outcome) {
      workflow(gh, env);
      const done = { id: 9, name: 'ci', path: '.github/workflows/ci.yml', head_branch: 'feature', status: 'completed', conclusion: 'failure', run_attempt: 1 };
      seq(gh, RUN, [[200, done], [200, outcome === 'ok' ? { ...done, status: 'queued', run_attempt: 2 } : done]]);
      gh.when('POST /repos/{owner}/{repo}/actions/runs/{run_id}/rerun-failed-jobs').reply(201, {});
    }
  });
}

runWriteContract({
  ...base, label: 'github_actions_cancel_run', definition: def('github_actions_cancel_run'), args: { ...R, runId: 9 }, needsConfirm: false,
  arrange(gh, outcome) {
    const going = { id: 9, name: 'ci', status: 'in_progress' };
    seq(gh, RUN, [[200, going], [outcome === 'ok' ? 200 : 404, outcome === 'ok' ? { ...going, status: 'completed', conclusion: 'cancelled' } : { message: 'Not Found' }]]);
    gh.when('POST /repos/{owner}/{repo}/actions/runs/{run_id}/cancel').reply(202, {});
  }
});

runWriteContract({
  ...base, label: 'github_actions_delete_run', definition: def('github_actions_delete_run'), args: { ...R, runId: 9 }, needsConfirm: true, profile: 'full',
  arrange(gh, outcome) {
    const done = { id: 9, name: 'ci', status: 'completed', conclusion: 'success' };
    seq(gh, RUN, outcome === 'ok' ? [[200, done], [404, { message: 'Not Found' }]] : [[200, done], [200, done]]);
    gh.when('DELETE /repos/{owner}/{repo}/actions/runs/{run_id}').reply(204, null);
  }
});

runWriteContract({
  ...base, label: 'github_actions_review_pending_deployment', definition: def('github_actions_review_pending_deployment'), args: { ...R, runId: 9, environments: ['production'], state: 'approved', comment: 'Ship it' }, needsConfirm: true, production: true, ...strict, profile: 'full',
  arrange(gh, outcome) {
    const waiting = [{ environment: { id: 11, name: 'production' }, current_user_can_approve: true }];
    seq(gh, 'GET /repos/{owner}/{repo}/actions/runs/{run_id}/pending_deployments', [[200, waiting], [200, outcome === 'ok' ? [] : waiting]]);
    gh.when('POST /repos/{owner}/{repo}/actions/runs/{run_id}/pending_deployments').reply(200, [{ id: 1 }]);
  }
});

const call = async (name, w, args) => parse(await actions.handlers[name](args, w.ctx));

describe('workflow environments (pure)', () => {
  it('reads inline, block and flow forms, and flags what it cannot read', () => {
    expect(environmentsIn('jobs:\n  a:\n    environment: production # live\n  b:\n    environment:\n      name: "staging"\n      url: x\n  c:\n    environment: { name: qa, url: y }').names.sort()).toEqual(['production', 'qa', 'staging']);
    expect(environmentsIn('jobs:\n  a:\n    environment: ${{ inputs.target }}\n')).toMatchObject({ names: [], unknown: true });
    expect(environmentsIn('jobs:\n  a:\n    runs-on: x\n')).toEqual({ names: [], unknown: false });
  });
});

describe('Actions change rules', () => {
  it('dispatch returns the run it started, and the undo cancels that run', async () => {
    const w = await makeWorld({});
    workflow(w.gh, null);
    w.gh.when('POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches').reply(200, { workflow_run_id: 55, run_url: 'https://api.github.com/x', html_url: 'https://github.com/x' });
    w.gh.when(RUN).reply(200, { id: 55, status: 'queued', html_url: 'u' });
    const out = await call('github_actions_dispatch', w, { ...R, workflow: 'ci.yml', ref: 'feature', inputs: [{ name: 'a', value: 'b' }], confirm: true });
    expect(out).toMatchObject({ status: 'applied', result: { run_id: 55 } });
    expect(w.gh.calls.find((c) => c.route.endsWith('/dispatches')).body).toEqual({ ref: 'feature', inputs: { a: 'b' } });
    expect((await w.db.getChange(1)).inverse).toMatchObject({ tool: 'github_actions_cancel_run', args: { runId: 55 } });
    expect(w.gh.invalid).toEqual([]);
  });

  it('dispatch accepts the provider spelling workflow_id for the workflow argument', async () => {
    const w = await makeWorld({});
    workflow(w.gh, null);
    w.gh.when('POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches').reply(200, { workflow_run_id: 55, run_url: 'https://api.github.com/x', html_url: 'https://github.com/x' });
    w.gh.when(RUN).reply(200, { id: 55, status: 'queued', html_url: 'u' });
    const out = await call('github_actions_dispatch', w, { ...R, workflow_id: 'ci.yml', ref: 'feature', inputs: [{ name: 'a', value: 'b' }], confirm: true });
    expect(out).toMatchObject({ status: 'applied', result: { run_id: 55 } });
    expect(w.gh.calls.find((c) => c.route.endsWith('/dispatches')).body).toEqual({ ref: 'feature', inputs: { a: 'b' } });
    expect(w.gh.invalid).toEqual([]);
  });

  it('a workflow whose environment cannot be read from its file counts as production (refused on a preview connection)', async () => {
    const w = await makeWorld({});
    workflow(w.gh, '${{ inputs.target }}');
    const out = await call('github_actions_dispatch', w, { ...R, workflow: 'ci.yml', ref: 'feature', confirm: true });
    expect(out).toMatchObject({ status: 'refused_by_guard', refusedBy: 'mode' });
    expect(w.gh.calls.some((c) => c.route.endsWith('/dispatches'))).toBe(false);
  });

  it('dispatching on the default branch is production even when the workflow deploys nowhere', async () => {
    const w = await makeWorld({});
    workflow(w.gh, null);
    expect((await call('github_actions_dispatch', w, { ...R, workflow: 'ci.yml', ref: 'main', confirm: true })).status).toBe('refused_by_guard');
  });

  it('a run still going cannot be rerun or deleted; a finished one cannot be cancelled', async () => {
    const w = await makeWorld({ profile: 'full' });
    workflow(w.gh, null);
    w.gh.when(RUN).reply(200, { id: 9, name: 'ci', path: '.github/workflows/ci.yml', head_branch: 'feature', status: 'in_progress', run_attempt: 1 });
    expect((await call('github_actions_rerun', w, { ...R, runId: 9, confirm: true })).status).toBe('rejected');
    expect((await call('github_actions_delete_run', w, { ...R, runId: 9, confirm: true })).status).toBe('rejected');
    w.gh.when(RUN).reply(200, { id: 9, name: 'ci', status: 'completed', conclusion: 'success' });
    expect((await call('github_actions_cancel_run', w, { ...R, runId: 9, confirm: true })).status).toBe('rejected');
  });

  it('force-cancel without confirm is refused with a plain reason; with confirm it uses the force endpoint', async () => {
    const w = await makeWorld({});
    seq(w.gh, RUN, [[200, { id: 9, name: 'ci', status: 'in_progress' }], [200, { id: 9, status: 'in_progress' }]]);
    w.gh.when('POST /repos/{owner}/{repo}/actions/runs/{run_id}/force-cancel').reply(202, {});
    const refused = await call('github_actions_cancel_run', w, { ...R, runId: 9, force: true });
    expect(refused.status).toBe('rejected');
    expect(JSON.stringify(refused)).toMatch(/needs confirm/);
    const w2 = await makeWorld({});
    seq(w2.gh, RUN, [[200, { id: 9, name: 'ci', status: 'in_progress' }], [200, { id: 9, status: 'in_progress' }]]);
    w2.gh.when('POST /repos/{owner}/{repo}/actions/runs/{run_id}/force-cancel').reply(202, {});
    expect((await call('github_actions_cancel_run', w2, { ...R, runId: 9, force: true, confirm: true })).status).toBe('applied');
    expect(w2.gh.invalid).toEqual([]);
  });

  it('rerun by job needs a job id, and rerun-all uses the right endpoint', async () => {
    const w = await makeWorld({});
    expect((await call('github_actions_rerun', w, { ...R, runId: 9, mode: 'job' })).status).toBe('refused');
    workflow(w.gh, null);
    const done = { id: 9, name: 'ci', path: '.github/workflows/ci.yml', head_branch: 'feature', status: 'completed', conclusion: 'failure', run_attempt: 1 };
    seq(w.gh, RUN, [[200, done], [200, { ...done, status: 'queued', run_attempt: 2 }]]);
    w.gh.when('POST /repos/{owner}/{repo}/actions/runs/{run_id}/rerun').reply(201, {});
    expect((await call('github_actions_rerun', w, { ...R, runId: 9, mode: 'all', confirm: true })).result).toMatchObject({ attempt: 2, previous_attempt: 1 });
    expect(w.gh.invalid).toEqual([]);
  });

  it('reviewing a deployment uses the owner\'s own sign-in and refuses an environment the run is not waiting on', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    w.gh.when('GET /repos/{owner}/{repo}/actions/runs/{run_id}/pending_deployments').reply(200, [{ environment: { id: 11, name: 'staging' }, current_user_can_approve: true }]);
    const out = await call('github_actions_review_pending_deployment', w, { ...R, runId: 9, environments: ['production'], state: 'approved', comment: 'ok', confirm: true });
    expect(out.status).toBe('rejected');
    expect(w.gh.calls.every((c) => /ghu_FAKE/.test(c.headers?.authorization ?? 'ghu_FAKE'))).toBe(true);
  });
});

describe('W-4 pinned durable automatic rerun',()=>{
  const A='a'.repeat(40);
  it('reuses the claim across new run IDs and time windows for the same head/workflow',async()=>{
    const w=await makeWorld({});workflow(w.gh,null);
    const done={id:9,workflow_id:3,head_sha:A,name:'ci',path:'.github/workflows/ci.yml',head_branch:'feature',status:'completed',conclusion:'failure',run_attempt:1};
    seq(w.gh,RUN,[[200,done],[200,done],[200,{...done,status:'queued',run_attempt:2}],[200,{...done,id:10}]]);
    w.gh.when('POST /repos/{owner}/{repo}/actions/runs/{run_id}/rerun-failed-jobs').reply(201,{});
    const input={...R,runId:9,mode:'failed',expectedHeadSha:A,expectedWorkflowId:3,confirm:true};
    const first=parse(await actions.handlers.github_actions_rerun(input,w.ctx));
    expect(first).toMatchObject({status:'applied',confirmed:true});
    const prior=w.ctx.now;w.ctx.now=()=>prior()+20*60*1000;
    const again=parse(await actions.handlers.github_actions_rerun({...input,runId:10},w.ctx));
    expect(again).toMatchObject({status:'replayed',confirmed:true,requestKey:first.requestKey});
    expect(w.gh.calls.filter(c=>c.method==='POST')).toHaveLength(1);expect(w.gh.invalid).toEqual([]);
  });
  it('refuses an advanced attempt immediately before applying the retry',async()=>{
    const w=await makeWorld({});workflow(w.gh,null);
    const done={id:9,workflow_id:3,head_sha:A,name:'ci',path:'.github/workflows/ci.yml',head_branch:'feature',status:'completed',conclusion:'failure',run_attempt:1};
    seq(w.gh,RUN,[[200,done],[200,{...done,run_attempt:2}]]);
    const r=parse(await actions.handlers.github_actions_rerun({...R,runId:9,mode:'failed',expectedHeadSha:A,expectedWorkflowId:3,confirm:true},w.ctx));
    expect(r.done).toBe(false);expect(w.gh.calls.filter(c=>c.method==='POST')).toEqual([]);
  });
});
