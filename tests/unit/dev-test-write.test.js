import { describe, expect, it } from 'vitest';
import { makeWorld, parse, runWriteContract } from '../../test/helpers/write-contract.js';
import { runDevMutationOnce } from '../../src/dev/execute.js';
import * as testWrite from '../../src/tools/dev-test-write.js';

const OWNER = 'example-org', REPO = 'host-repo', RUN = 'run-ci-101', NAME = 'one';
const BRANCH = `rtc/${RUN}/${NAME}`, FILE = `rtc/${RUN}/${NAME}.md`;
const A = 'a'.repeat(40), B = 'b'.repeat(40);
const def = (name) => ({ tool: testWrite.tools.find((t) => t.name === name), handler: testWrite.handlers[name] });
const create = def('github_dev_create_test_branch'), openPr = def('github_dev_open_test_pr');
const host = (changes = {}) => ({ full_name: `${OWNER}/${REPO}`, default_branch: 'main', private: true, archived: false, ...changes });
const branchBody = (sha, changes = {}) => ({ name: BRANCH, protected: false, commit: { sha }, ...changes });

/** Routes shared by the read side and the production classifier. */
function common(gh, { rules = [] } = {}) {
  gh.when('GET /repos/{owner}/{repo}').reply(200, host());
  gh.when('GET /repos/{owner}/{repo}/rules/branches/{branch}').reply(200, rules);
  gh.when('GET /repos/{owner}/{repo}/commits/{ref}').reply(200, { sha: A });
}
const arrangeBranch = (gh, outcome) => {
  common(gh);
  // read, production classifier, read-back (later calls see the created branch)
  gh.when('GET /repos/{owner}/{repo}/branches/{branch}').replySequence([
    { status: 404, body: { message: 'Not Found' } }, { status: 404, body: { message: 'Not Found' } },
    { status: 200, body: branchBody(outcome === 'mismatch' ? B : A) }
  ]);
  gh.when('POST /repos/{owner}/{repo}/git/refs').reply(201, { ref: `refs/heads/${BRANCH}`, object: { sha: A } });
};
runWriteContract({ label: 'github_dev_create_test_branch', definition: create, args: { repo: REPO, runId: RUN, name: NAME }, previewOnly: true, needsConfirm: false, arrange: arrangeBranch });

const prBody = (changes = {}) => ({ number: 42, draft: true, state: 'open', html_url: 'https://github.com/x/42', head: { ref: BRANCH, sha: B }, base: { ref: 'main' }, body: `Run-owned draft review fixture.\n\n<!-- rtc_run=${RUN} -->`, ...changes });
const arrangePr = (gh, outcome) => {
  common(gh);
  gh.when('GET /repos/{owner}/{repo}/branches/{branch}').replySequence([
    { status: 200, body: branchBody(A) }, { status: 200, body: branchBody(A) }, { status: 200, body: branchBody(B) }
  ]);
  gh.when('PUT /repos/{owner}/{repo}/contents/{path}').reply(201, { content: { path: FILE }, commit: { sha: B } });
  gh.when('POST /repos/{owner}/{repo}/labels').reply(201, { name: `rtc-run-${RUN}`, description: `rtc_run=${RUN}` });
  gh.when('GET /repos/{owner}/{repo}/git/ref/{ref}').reply(200, { ref: `refs/heads/${BRANCH}`, object: { sha: B } });
  gh.when('POST /repos/{owner}/{repo}/pulls').reply(201, prBody());
  gh.when('POST /repos/{owner}/{repo}/issues/{issue_number}/labels').reply(200, [{ name: `rtc-run-${RUN}` }]);
  gh.when('GET /repos/{owner}/{repo}/pulls/{pull_number}').reply(200, prBody(outcome === 'mismatch' ? { draft: false } : {}));
  gh.when('GET /repos/{owner}/{repo}/issues/{issue_number}/labels').reply(200, [{ name: `rtc-run-${RUN}` }]);
};
const recordBranch = (w) => runDevMutationOnce(w.ctx, { runId: RUN, account: OWNER, connection: 'client-1', stepId: `test-branch-${NAME}`, type: 'branch', owner: OWNER, repo: REPO, objectName: BRANCH,
  create: async () => ({ objectId: BRANCH, createdSha: A }) });
runWriteContract({ label: 'github_dev_open_test_pr', definition: openPr, args: { repo: REPO, runId: RUN, name: NAME }, previewOnly: true, needsConfirm: false, expectedWrites: 4, advanceClockOnSleep: true, arrange: arrangePr, prepare: recordBranch });

const run = async (tool, w, args) => parse(await tool.handler({ repo: REPO, runId: RUN, name: NAME, ...args }, w.ctx));
describe('V-3 test branch guards', () => {
  it('refuses production connections before reading GitHub', async () => {
    const w = await makeWorld({ mode: 'production' });
    const out = await create.handler({ repo: REPO, runId: RUN, name: NAME, confirm: true }, w.ctx);
    expect(out.isError).toBe(true);
    expect(w.gh.calls).toEqual([]);
  });
  it('refuses a ruleset-governed branch name as production and a missing start ref', async () => {
    const w = await makeWorld();
    common(w.gh, { rules: [{ type: 'required_status_checks' }] });
    w.gh.when('GET /repos/{owner}/{repo}/branches/{branch}').reply(404, { message: 'Not Found' });
    const out = await run(create, w, { confirm: true });
    expect(out.status).toBe('refused_by_guard');
    expect(w.gh.calls.filter((c) => c.method === 'POST')).toEqual([]);
    const gone = await makeWorld();
    gone.gh.when('GET /repos/{owner}/{repo}').reply(200, host());
    gone.gh.when('GET /repos/{owner}/{repo}/commits/{ref}').reply(404, { message: 'Not Found' });
    gone.gh.when('GET /repos/{owner}/{repo}/branches/{branch}').reply(404, { message: 'Not Found' });
    expect((await run(create, gone, { from: 'nope', confirm: true })).error).toMatch(/no commit, branch or tag/);
  });
  it('refuses to adopt a branch it did not create and to extend a seeded scenario run', async () => {
    const w = await makeWorld();
    common(w.gh);
    w.gh.when('GET /repos/{owner}/{repo}/branches/{branch}').reply(200, branchBody(A));
    expect((await run(create, w, { confirm: true })).error).toMatch(/did not create it/);
    const s = await makeWorld();
    common(s.gh);
    await s.db.createDevRun({ id: RUN, account: OWNER, connection: 'client-1', scenarios: ['stack-of-three'] });
    expect((await run(create, s, { confirm: true })).error).toMatch(/seeded scenario/);
    expect(s.gh.calls.filter((c) => c.method === 'POST')).toEqual([]);
  });
  it('stops at 40 recorded objects so cleanup can always list the whole run', async () => {
    const w = await makeWorld();
    common(w.gh);
    for (let i = 0; i < 40; i += 1) {
      await runDevMutationOnce(w.ctx, { runId: RUN, account: OWNER, connection: 'client-1', stepId: `s-${i}`, type: 'label', owner: OWNER, repo: REPO, objectName: `l${i}`, create: async () => ({ objectId: `rtc-run-${i}` }) });
    }
    expect((await run(create, w, { confirm: true })).error).toMatch(/at most 40/);
  });
  it('refuses a second repository for the same run', async () => {
    const w = await makeWorld();
    common(w.gh);
    await runDevMutationOnce(w.ctx, { runId: RUN, account: OWNER, connection: 'client-1', stepId: 'other', type: 'label', owner: OWNER, repo: 'another', objectName: 'x', create: async () => ({ objectId: 'rtc-run' }) });
    expect((await run(create, w, { confirm: true })).error).toMatch(/exactly one repository/);
  });
});
describe('V-3 draft PR guards', () => {
  it('requires a recorded branch and an unchanged tip', async () => {
    const w = await makeWorld();
    arrangePr(w.gh, 'ok');
    expect((await run(openPr, w, { confirm: true })).error).toMatch(/not a recorded test branch/);
    const moved = await makeWorld();
    arrangePr(moved.gh, 'ok');
    await recordBranch(moved);
    moved.gh.when('GET /repos/{owner}/{repo}/branches/{branch}').reply(200, branchBody('c'.repeat(40)));
    expect((await run(openPr, moved, { confirm: true })).error).toMatch(/changed after the run recorded it/);
    expect(moved.gh.calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });
  it('journals file, label, PR and association and refuses a base outside default or run branches', async () => {
    const w = await makeWorld({ advanceClockOnSleep: true });
    arrangePr(w.gh, 'ok');
    await recordBranch(w);
    const out = await run(openPr, w, { confirm: true });
    expect(out.status).toBe('applied');
    const kinds = (await w.db.listDevObjects({ runId: RUN, account: OWNER, connection: 'client-1', limit: 50 })).map((o) => o.object_type).sort();
    expect(kinds).toEqual(['branch', 'fixture_file', 'label', 'pr', 'pr_label']);
    expect(w.gh.calls.find((c) => c.route === 'POST /repos/{owner}/{repo}/pulls').body).toMatchObject({ head: BRANCH, base: 'main', draft: true });
    const bad = await makeWorld({ advanceClockOnSleep: true });
    arrangePr(bad.gh, 'ok');
    await recordBranch(bad);
    expect((await run(openPr, bad, { base: 'production', confirm: true })).done).toBe(false);
    expect(bad.gh.calls.filter((c) => c.route === 'POST /repos/{owner}/{repo}/pulls')).toEqual([]);
  });
});

it('full owner creates a journal-bound test branch in production mode',async()=>{
  const w=await makeWorld({mode:'production',profile:'full'});arrangeBranch(w.gh,'ok');
  const result=await run(create,w,{});
  expect(result).toMatchObject({status:'applied',confirmed:true});
  expect(w.gh.invalid).toEqual([]);
});
