import { readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runWriteContract, makeWorld, parse } from '../../test/helpers/write-contract.js';
import { protectionGate } from '../../test/helpers/fixture-gates.js';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';
import * as merge from '../../src/tools/pulls-merge.js';

const def = (name) => ({ tool: merge.tools.find((t) => t.name === name), handler: merge.handlers[name] });
const R = { repo: 'hello' };
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const PRS = 'GET /repos/{owner}/{repo}/pulls/{pull_number}';
const seq = (gh, route, steps) => gh.when(route).replySequence(steps.map(([status, body]) => ({ status, body })));
const pr = (extra = {}) => ({ number: 7, node_id: 'PR_x', title: 'T', state: 'open', draft: false, merged: false, mergeable: true, mergeable_state: 'clean', head: { ref: 'feat', sha: A }, base: { ref: 'main' }, html_url: 'u', auto_merge: null, ...extra });
const gate = ({ protectedLevel }) => (protectedLevel ? [protectionGate(protectedLevel === 'pr-only' ? 'none' : protectedLevel)] : []);
const run = (name, status, conclusion) => ({ id: 1, name, status, conclusion, started_at: '2026-10-11T00:00:00Z', app: { id: 15368 } });
const writes = (gh) => gh.calls.filter((c) => !['GET', 'HEAD'].includes(c.method) && !(c.route === 'POST /graphql' && !/^\s*mutation/.test(c.body?.query ?? '')));

/** The repository, its rules and the checks at the head: green by default. */
function world(gh, { runs = [run('ci', 'completed', 'success')], rules = [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'ci' }] } }] } = {}) {
  gh.when('GET /repos/{owner}/{repo}').reply(200, { default_branch: 'main' });
  gh.when('GET /repos/{owner}/{repo}/branches/{branch}').reply(200, { protected: false });
  gh.when('GET /repos/{owner}/{repo}/rules/branches/{branch}').reply(200, rules);
  gh.when('GET /repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks').reply(404, { message: 'Not Found' });
  gh.when('GET /repos/{owner}/{repo}/commits/{ref}/check-runs').reply(200, { total_count: runs.length, check_runs: runs });
  gh.when('GET /repos/{owner}/{repo}/commits/{ref}/status').reply(200, { state: 'success', statuses: [], sha: A, total_count: 0 });
}

runWriteContract({
  label: 'github_pr_merge', definition: def('github_pr_merge'), args: { ...R, number: 7, expectedHeadSha: A }, needsConfirm: true, production: true, conveyor: true, gatesFor: gate,
  arrange(gh, outcome) {
    world(gh);
    seq(gh, PRS, [[200, pr()], [200, pr({ merged: outcome === 'ok', state: 'closed' })]]);
    gh.when('PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge').reply(200, { sha: B, merged: true, message: 'Pull Request successfully merged' });
  }
});
runWriteContract({
  label: 'github_pr_merge_async', definition: def('github_pr_merge_async'), args: { ...R, number: 7, expectedHeadSha: A }, needsConfirm: true, production: true, conveyor: true, gatesFor: gate,
  arrange(gh, outcome) {
    world(gh);
    seq(gh, PRS, [[200, pr()], [200, pr({ merged: outcome === 'ok', state: 'closed' })]]);
    gh.when('PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge-async').reply(200, { status: 'merged', details: { merge_commit_sha: B } });
  }
});
runWriteContract({
  label: 'github_pr_set_auto_merge', definition: def('github_pr_set_auto_merge'), args: { ...R, number: 7, enabled: true, expectedHeadSha: A }, needsConfirm: true, production: true, conveyor: true, gatesFor: gate,
  arrange(gh, outcome) {
    world(gh);
    seq(gh, PRS, [[200, pr()], [200, pr({ auto_merge: outcome === 'ok' ? { merge_method: 'merge' } : null })]]);
    gh.when('POST /graphql').reply(200, { data: { enablePullRequestAutoMerge: { pullRequest: { number: 7 } } } });
  }
});

async function call(w, name, args) {
  const dispatch = createDispatch({ credentials: w.credentials, gates: [], fetch: w.gh.fetch, now: w.ctx.now, sleep: async () => {} });
  const result = await dispatch({ registry, name, args, connection: w.connection, db: w.db });
  let body = null;
  try { body = parse(result); } catch { /* a plain-text validation error */ }
  return { result, body };
}
const live = () => makeWorld({ mode: 'production' });

describe('merging (E-2a)', () => {
  const refused = async (setup, text, extraArgs = {}) => {
    const w = await live();
    setup(w.gh);
    const { body } = await call(w, 'github_pr_merge', { ...R, number: 7, expectedHeadSha: A, confirm: true, ...extraArgs });
    expect(body.done).toBe(false);
    expect(JSON.stringify(body)).toContain(text);
    expect(writes(w.gh)).toEqual([]);
  };
  it('refuses when the head moved since it was read', async () => refused((gh) => { world(gh); gh.when(PRS).reply(200, pr({ head: { ref: 'feat', sha: B } })); }, 'New commits arrived'));
  it('refuses a draft', async () => refused((gh) => { world(gh); gh.when(PRS).reply(200, pr({ draft: true })); }, 'draft'));
  it('refuses when GitHub says it cannot be merged', async () => refused((gh) => { world(gh); gh.when(PRS).reply(200, pr({ mergeable: false, mergeable_state: 'dirty' })); }, 'cannot be merged'));
  it('refuses a closed or already merged pull request', async () => {
    await refused((gh) => { world(gh); gh.when(PRS).reply(200, pr({ state: 'closed' })); }, 'closed');
    await refused((gh) => { world(gh); gh.when(PRS).reply(200, pr({ state: 'closed', merged: true })); }, 'already merged');
  });
  it('refuses when a required check is failing, pending or missing, naming it', async () => {
    for (const [runs, word] of [[[run('ci', 'completed', 'failure')], 'ci: failure'], [[run('ci', 'in_progress', null)], 'ci: pending'], [[], 'ci: missing']]) {
      await refused((gh) => { world(gh, { runs }); gh.when(PRS).reply(200, pr()); }, word);
    }
  });
  it('refuses when the checks cannot be verified (never assumes green)', async () => refused((gh) => {
    world(gh);
    gh.when('GET /repos/{owner}/{repo}/rules/branches/{branch}').reply(500, { message: 'boom' });
    gh.when(PRS).reply(200, pr());
  }, 'could not be verified'));
  it('merges at the exact SHA with a merge commit by default, and with squash when asked', async () => {
    for (const [method, expected] of [[undefined, 'merge'], ['squash', 'squash']]) {
      const w = await live();
      world(w.gh);
      seq(w.gh, PRS, [[200, pr()], [200, pr({ merged: true, state: 'closed' })]]);
      w.gh.when('PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge').reply(200, { sha: B, merged: true, message: 'ok' });
      const { body } = await call(w, 'github_pr_merge', { ...R, number: 7, expectedHeadSha: A, confirm: true, ...(method ? { method } : {}) });
      expect(body).toMatchObject({ done: true, result: { merged: true, merge_commit: B } });
      expect(writes(w.gh)[0].body).toEqual({ sha: A, merge_method: expected });
      expect(w.gh.invalid).toEqual([]);
    }
  });
  it('a merge into the default branch is refused on a preview connection', async () => {
    const w = await makeWorld({ mode: 'preview' });
    world(w.gh);
    w.gh.when(PRS).reply(200, pr());
    const { body } = await call(w, 'github_pr_merge', { ...R, number: 7, expectedHeadSha: A, confirm: true });
    expect(body).toMatchObject({ status: 'refused_by_guard', refusedBy: 'mode' });
    expect(writes(w.gh)).toEqual([]);
  });
  it('needs the exact head even to ask', async () => {
    const w = await live();
    const { result } = await call(w, 'github_pr_merge', { ...R, number: 7 });
    expect(result.isError).toBe(true);
  });
  it('async: a pending merge is recorded with its id and never sends the bypass option', async () => {
    const w = await live();
    world(w.gh);
    seq(w.gh, PRS, [[200, pr()], [200, pr()]]);
    w.gh.when('PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge-async').reply(202, { status: 'pending', details: { message: 'queued', uuid: 'u-1' } });
    const { body } = await call(w, 'github_pr_merge_async', { ...R, number: 7, expectedHeadSha: A, confirm: true });
    expect(body).toMatchObject({ done: true, result: { status: 'pending', uuid: 'u-1', merged: false } });
    const sent = writes(w.gh)[0].body;
    expect(sent).toEqual({ sha: A, merge_method: 'merge', merge_action: 'direct_merge' });
    expect(JSON.stringify(sent)).not.toContain('bypass');
  });
  it('async: a merge that is already pending (409) is reported, not an error', async () => {
    const w = await live();
    world(w.gh);
    seq(w.gh, PRS, [[200, pr()], [200, pr()]]);
    w.gh.when('PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge-async').reply(409, { status: 'pending', details: { message: 'already', uuid: 'u-2' } });
    const { body } = await call(w, 'github_pr_merge_async', { ...R, number: 7, expectedHeadSha: A, confirm: true });
    expect(body).toMatchObject({ done: true, result: { status: 'pending', uuid: 'u-2' } });
  });
  it('async: a failed merge says why and is not confirmed', async () => {
    const w = await live();
    world(w.gh);
    seq(w.gh, PRS, [[200, pr()], [200, pr()]]);
    w.gh.when('PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge-async').reply(200, { status: 'failed', details: { message: 'merge conflict' } });
    const { body } = await call(w, 'github_pr_merge_async', { ...R, number: 7, expectedHeadSha: A, confirm: true });
    expect(body.done).toBe(false);
    expect(body.result).toMatchObject({ status: 'failed', reason: 'merge conflict' });
  });
  it('auto-merge pins the head, uses the schema-valid mutation, and turning it off needs no head', async () => {
    const w = await live();
    world(w.gh);
    seq(w.gh, PRS, [[200, pr()], [200, pr({ auto_merge: { merge_method: 'merge' } })]]);
    w.gh.when('POST /graphql').reply(200, { data: { enablePullRequestAutoMerge: { pullRequest: { number: 7 } } } });
    const on = await call(w, 'github_pr_set_auto_merge', { ...R, number: 7, enabled: true, expectedHeadSha: A, method: 'squash', confirm: true });
    expect(on.body.done).toBe(true);
    expect(w.gh.graphql[0].variables.input).toMatchObject({ pullRequestId: 'PR_x', expectedHeadOid: A, mergeMethod: 'SQUASH' });
    expect(w.gh.invalid).toEqual([]);
    const w2 = await live();
    world(w2.gh);
    seq(w2.gh, PRS, [[200, pr({ auto_merge: { merge_method: 'merge' } })], [200, pr()]]);
    w2.gh.when('POST /graphql').reply(200, { data: { disablePullRequestAutoMerge: { pullRequest: { number: 7 } } } });
    const off = await call(w2, 'github_pr_set_auto_merge', { ...R, number: 7, enabled: false, confirm: true });
    expect(off.body.done).toBe(true);
    expect(w2.gh.invalid).toEqual([]);
    const missingHead = await call(await live(), 'github_pr_set_auto_merge', { ...R, number: 7, enabled: true });
    expect(missingHead.result.isError).toBe(true);
  });
});

describe('rules are bypassed only on purpose (GOD-6)', () => {
  it('exactly one source line sends the bypass option: the deliberate override merge in pulls-merge.js', () => {
    const hits = [];
    const walk = (dir) => { for (const name of readdirSync(dir)) { const path = `${dir}/${name}`; if (statSync(path).isDirectory()) walk(path); else if (path.endsWith('.js')) readFileSync(path, 'utf8').split('\n').forEach((line, i) => { if (/bypass_rules/.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line)) hits.push(`${path}:${i + 1}`); }); } };
    walk('src');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatch(/^src\/tools\/pulls-merge\.js:\d+$/);
  });
});
