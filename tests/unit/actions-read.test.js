import zlib from 'node:zlib';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';
import { readZip, summarizeLog, testFailureReport, testFailures } from '../../src/github/log-summary.js';
import { makeWorld, parse } from '../../test/helpers/write-contract.js';

const R = { repo: 'hello' };
const RUNS = 'GET /repos/{owner}/{repo}/actions/runs';
const JOBS = 'GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs';
async function run(world, name, args) {
  const dispatch = createDispatch({ credentials: world.credentials, gates: [], fetch: world.gh.fetch, now: world.ctx.now, sleep: async () => {} });
  const result = await dispatch({ registry, name, args, connection: world.connection, db: world.db });
  return { result, body: result.isError ? null : (result.structuredContent?.full_payload_location === 'content[0].text' ? JSON.parse(result.content[0].text) : (result.structuredContent ?? parse(result))) };
}
/** A small zip writer for fixtures: [name, text, deflate?] */
function zip(files) {
  const parts = []; const central = []; let offset = 0;
  for (const [name, text, deflate = true] of files) {
    const raw = Buffer.from(text); const data = deflate ? zlib.deflateRawSync(raw) : raw; const nm = Buffer.from(name);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(deflate ? 8 : 0, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nm.length, 26);
    const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(deflate ? 8 : 0, 10); cen.writeUInt32LE(data.length, 20); cen.writeUInt32LE(raw.length, 24); cen.writeUInt16LE(nm.length, 28); cen.writeUInt32LE(offset, 42);
    parts.push(local, nm, data); central.push(cen, nm); offset += 30 + nm.length + data.length;
  }
  const dir = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end]);
}
const FAILED_JOB = { id: 5, name: 'build', status: 'completed', conclusion: 'failure', started_at: 'a', completed_at: 'b', runner_name: 'r', html_url: 'u', steps: [{ number: 1, name: 'Set up job', conclusion: 'success' }, { number: 3, name: 'Run tests', conclusion: 'failure' }] };

describe('log summaries (pure)', () => {
  it('keeps the tail, finds error lines once, strips timestamps and never passes long encoded text', () => {
    const text = ['2026-10-11T00:00:00.123Z ok', '2026-10-11T00:00:01Z ##[error]Process completed with exit code 1.', `2026-10-11T00:00:02Z ${'QUJD'.repeat(100)}`, 'ok', '##[error]Process completed with exit code 1.'].join('\n');
    const s = summarizeLog(text, { tailLines: 3 });
    expect(s.tail).toHaveLength(3);
    expect(s.tail_cut).toBe(true);
    expect(s.errors).toEqual(['##[error]Process completed with exit code 1.']);
    expect(JSON.stringify(s)).not.toMatch(/QUJD(QUJD){20}/);
  });
  it('reads stored and deflated zip entries and refuses a non-zip', () => {
    expect(readZip(zip([['a.txt', 'one'], ['dir/b.txt', 'two', false]]))).toEqual([{ name: 'a.txt', text: 'one' }, { name: 'dir/b.txt', text: 'two' }]);
    expect(() => readZip(Buffer.from('not a zip at all, definitely not'))).toThrow(/not a zip/);
  });
});

describe('failing tests with their reasons (LOG-FAILURES-1)', () => {
  it('xUnit: every failing test keeps its own reason lines', () => {
    const log = [
      '2026-11-17T16:24:30.1Z [xUnit.net 00:00:08.90]     Door.Unit.Tests.Stager.WrongBytes [FAIL]',
      '2026-11-17T16:24:30.1Z   Assert.Throws() Failure: Exception type was not an exact match',
      '2026-11-17T16:24:30.1Z   Expected: typeof(RackWorkException)',
      '2026-11-17T16:24:30.2Z [xUnit.net 00:00:09.92]     Door.Unit.Tests.Abilities.Files_ListSearchAndRoots [FAIL]',
      '2026-11-17T16:24:30.2Z   Assert.True() Failure',
      '2026-11-17T16:24:30.2Z   Door.Adapters.Windows.DoorFileException : relative path is required',
      '2026-11-17T16:24:30.3Z ##[error]Process completed with exit code 1.',
    ].join('\n');
    const f = testFailures(log);
    expect(f.map((x) => x.test)).toEqual(['Door.Unit.Tests.Stager.WrongBytes', 'Door.Unit.Tests.Abilities.Files_ListSearchAndRoots']);
    expect(f[1].runner).toBe('xunit');
    expect(f[1].reason.join(' ')).toContain('relative path is required');
    expect(f[0].reason.join(' ')).not.toContain('relative path');
  });
  it('dotnet test: the xUnit [FAIL] line, then "Failed <test> [time]" with the reason (as on the PC runner)', () => {
    const log = [
      '[xUnit.net 00:00:09.92]     Door.Unit.Tests.SessionAbilityTests.Files_ListSearchAndRoots [FAIL]',
      '  Failed Door.Unit.Tests.SessionAbilityTests.Files_ListSearchAndRoots [158 ms]',
      '  Error Message:',
      '   relative path is required',
      '  Stack Trace:',
      '     at Door.Unit.Tests.SessionAbilityTests.Files_ListSearchAndRoots() in SessionAbilityTests.cs:line 226',
      '[xUnit.net 00:00:10.01]     Door.Unit.Tests.Other.Two [FAIL]',
      '  Failed Door.Unit.Tests.Other.Two [3 ms]',
      '  Error Message:',
      '   Assert.Equal() Failure',
      '  Stack Trace:',
      '     at Door.Unit.Tests.Other.Two() in Other.cs:line 9',
      'Results File: C:\\actions-runner\\_work\\TestResults\\unit.trx',
      'Failed!  - Failed:     2, Passed:   548, Skipped:     0, Total:   550, Duration: 2 s - Door.Unit.Tests.dll (net10.0)',
      '##[error]Process completed with exit code 1.',
      'with:',
    ].join('\n');
    const f = testFailures(log);
    expect(f.map((x) => x.test)).toEqual(['Door.Unit.Tests.SessionAbilityTests.Files_ListSearchAndRoots', 'Door.Unit.Tests.Other.Two']);
    expect(f[0].reason).toContain('relative path is required');
    expect(f[1].reason).toContain('Assert.Equal() Failure');
    // LOG-FAILURES-3: the run's own summary and the step's end are not part of the last test's reason.
    expect(f[1].reason.at(-1)).toBe('at Door.Unit.Tests.Other.Two() in Other.cs:line 9');
    expect(f[1].reason.join(' ')).not.toMatch(/Results File|Failed!|##\[error\]|^with:/);
  });
  it('LOG-FAILURES-3: vitest, node:test, pytest and go run summaries end the last reason', () => {
    const cases = [
      ['FAIL src/a.test.js > adds', 'AssertionError: expected 1 to be 2', ' Test Files  1 failed (1)'],
      ['not ok 3 - parses', '  error: bad input', '# tests 3'],
      ['FAILED tests/test_a.py::test_x - assert 1 == 2', 'E   assert 1 == 2', '==== 1 failed, 4 passed in 0.12s ===='],
      ['--- FAIL: TestX (0.00s)', '    x_test.go:9: want 2', 'FAIL\tgithub.com/a/b\t0.012s'],
    ];
    for (const [m, why, end] of cases) {
      const f = testFailures([m, why, end, 'after the summary'].join('\n'));
      expect(f).toHaveLength(1);
      expect(f[0].reason).toEqual([why.trim()]);
    }
  });
  it('node:test, go and pytest markers', () => {
    expect(testFailures('not ok 3 - restart refuses while gaming\n  error: expected refused').map((x) => [x.runner, x.test]))
      .toEqual([['node:test', 'restart refuses while gaming']]);
    expect(testFailures('--- FAIL: TestRoute (0.01s)\n    route_test.go:12: want 200 got 502')[0].reason).toEqual(['route_test.go:12: want 200 got 502']);
    expect(testFailures('FAILED tests/test_a.py::test_b - AssertionError: 1 != 2')[0].test).toBe('tests/test_a.py::test_b');
  });
  it('a clean log has none', () => { expect(testFailures('all good\nok 1 - fine')).toEqual([]); });
  it('LOG-FAILURES-4: never a silent cap — the real count and how many are not listed', () => {
    const log = Array.from({ length: 15 }, (_, k) => `not ok ${k + 1} - case ${k + 1}\n  error: boom ${k + 1}`).join('\n');
    const r = testFailureReport(log);
    expect(r.test_failures).toHaveLength(12);
    expect(r.tests_failing).toBe(15);
    expect(r.tests_cut).toBe(3);
    expect(testFailureReport('ok 1 - fine')).toEqual({ test_failures: [], tests_failing: 0, tests_cut: 0 });
  });
  it('LOG-FAILURES-4: failures in every log text of a job are kept, and one test seen twice is one entry', () => {
    const stepA = 'not ok 1 - alpha\n  error: alpha broke';
    const stepB = 'not ok 2 - beta\n  error: beta broke';
    const whole = `${stepA}\n${stepB}`; // the job's full log repeats the step logs
    const r = testFailureReport([stepA, stepB, whole]);
    expect(r.test_failures.map((f) => f.test)).toEqual(['alpha', 'beta']);
    expect(r.tests_failing).toBe(2);
    expect(r.tests_cut).toBe(0);
    // A bare marker in one text and the reason in another: the entry with the reason wins.
    const merged = testFailureReport(['not ok 1 - gamma', 'not ok 1 - gamma\n  error: gamma reason']);
    expect(merged.test_failures).toEqual([expect.objectContaining({ test: 'gamma', reason: ['error: gamma reason'] })]);
  });
  // LOG-FIXTURES-1: real logs, saved verbatim, instead of hand-written imitations.
  const fixture = (name) => readFileSync(new URL(`../fixtures/logs/${name}`, import.meta.url), 'utf8');
  it('LOG-FIXTURES-1: a real dotnet/xUnit log (windows-door run 44125265769) — each test once, with its reason', () => {
    const r = testFailureReport([fixture('dotnet-xunit-windows-door-44125265769.txt')]);
    expect(r.tests_failing).toBe(3); // the xUnit "[FAIL]" line and dotnet "Failed" line are the same test
    expect(r.test_failures.map((f) => f.test)).toEqual([
      'Door.Unit.Tests.RackBlobStagerTests.WrongBytes_AreRefusedAndLeaveNothing',
      'Door.Unit.Tests.RackBlobStagerTests.Poller_DispatchesWithTheStagedPath_ThenCleansUpAfterReporting',
      'Door.Unit.Tests.RackBlobStagerTests.Poller_ABadBlobFailsTheItem_WithoutDispatching',
    ]);
    expect(r.test_failures[0].reason).toContain('Assert.Throws() Failure: Exception type was not an exact match');
    expect(r.test_failures[1].reason).toContain('Assert.True() Failure');
    // The next test's marker ends the previous reason: no stack lines leak across tests.
    expect(r.test_failures[0].reason.join('\n')).not.toContain('Poller_');
  });
  it('LOG-FIXTURES-1: a real vitest 5.1.1 log — both failures, not the summary lines', () => {
    const r = testFailureReport([fixture('vitest-5.1.1-two-failures.txt')]);
    expect(r.tests_failing).toBe(2);
    expect(r.test_failures.map((f) => f.test)).toEqual(['totals > adds two numbers', 'totals > keeps names']);
    expect(r.test_failures[0].reason[0]).toBe('AssertionError: expected 2 to be 3 // Object.is equality');
    expect(r.test_failures[1].reason[0]).toMatch(/^AssertionError: expected \{ name: 'a' \} to deeply equal/);
  });
  it.each([
    ['node-test-tap-22.23.4.txt', 'node:test', 'adds two numbers', '2 !== 3'],
    ['node-test-spec-22.23.4.txt', 'node:test', 'adds two numbers', '2 !== 3'],
    ['pytest-9.1.1.txt', 'pytest', 'test_a.py::test_adds', 'assert (1 + 1) == 3'],
    ['pytest-9.1.1-quiet.txt', 'pytest', 'test_a.py::test_adds', 'assert (1 + 1) == 3'],
    ['go-1.24.7.txt', 'go', 'TestRoute', 'x_test.go:3: want 3 got 2'],
    ['go-1.24.7-verbose.txt', 'go', 'TestRoute', 'x_test.go:3: want 3 got 2'],
  ])('LOG-FIXTURES-1: real %s — one failure, its real reason, no summary or passing-test lines', (file, runner, test, why) => {
    const r = testFailureReport([fixture(file)]);
    expect(r.tests_failing).toBe(1);
    expect(r.test_failures[0]).toMatchObject({ runner, test });
    expect(r.test_failures[0].reason).toContain(why);
    const reason = r.test_failures[0].reason.join('\n');
    expect(reason).not.toMatch(/passed|duration_ms|TestOk|ℹ |^---$|failureType/m);
  });
});

describe('Actions read tools (G-1)', () => {
  it('lists runs for one workflow with filters, and runs for the repository otherwise', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    w.gh.when('GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs').reply(200, { total_count: 1, workflow_runs: [{ id: 1, name: 'ci', status: 'completed', conclusion: 'success', head_sha: 'a'.repeat(40), actor: { login: 'a' } }] });
    w.gh.when(RUNS).reply(200, { total_count: 0, workflow_runs: [] });
    const one = (await run(w, 'github_actions_list_runs', { ...R, workflow: 'ci.yml', branch: 'main', status: 'completed' })).body;
    expect(one.items[0]).toMatchObject({ id: 1, conclusion: 'success' });
    expect(w.gh.calls.find((c) => c.route.includes('workflows/{workflow_id}/runs')).query).toMatchObject({ branch: 'main', status: 'completed' });
    expect((await run(w, 'github_actions_list_runs', R)).body.count).toBe(0);
    w.gh.when('GET /repos/{owner}/{repo}/actions/workflows').reply(200, { total_count: 1, workflows: [{ id: 3, name: 'ci', path: '.github/workflows/ci.yml', state: 'active' }] });
    expect((await run(w, 'github_actions_list_workflows', R)).body.items[0]).toMatchObject({ path: '.github/workflows/ci.yml', state: 'active' });
    expect(w.gh.invalid).toEqual([]);
  });

  it('get_run shows the jobs with their failed steps', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    w.gh.when('GET /repos/{owner}/{repo}/actions/runs/{run_id}').reply(200, { id: 9, name: 'ci', status: 'completed', conclusion: 'failure', run_attempt: 2, head_sha: 'a'.repeat(40), actor: { login: 'a' } });
    w.gh.when(JOBS).reply(200, { total_count: 1, jobs: [FAILED_JOB] });
    const { body } = await run(w, 'github_actions_get_run', { ...R, runId: 9 });
    expect(body).toMatchObject({ id: 9, run_attempt: 2, jobs: [{ name: 'build', failed_steps: [{ number: 3, name: 'Run tests' }] }] });
    expect(w.gh.invalid).toEqual([]);
  });

  it('job log: failed steps first, error lines and the tail, in short form', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    w.gh.when('GET /repos/{owner}/{repo}/actions/jobs/{job_id}').reply(200, FAILED_JOB);
    w.gh.when('GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs').reply(200, `${'line\n'.repeat(1000)}Error: expected 1 to be 2\n##[error]Process completed with exit code 1.`);
    const { body } = await run(w, 'github_actions_get_job_log', { ...R, jobId: 5, tailLines: 50 });
    expect(body.failed_steps_first).toEqual([{ number: 3, name: 'Run tests' }]);
    expect(body.errors).toEqual(expect.arrayContaining(['Error: expected 1 to be 2']));
    expect(body.tail.length).toBe(50);
    expect(body.tail_cut).toBe(true);
  });

  it('run log summary reads the archive and returns only the failed job\'s error lines', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    w.gh.when(JOBS).reply(200, { total_count: 2, jobs: [FAILED_JOB, { id: 6, name: 'lint', status: 'completed', conclusion: 'success', steps: [] }] });
    const archive = zip([['build/1_Set up job.txt', 'fine'], ['build/3_Run tests.txt', 'FAIL src/a.test.js\n##[error]Process completed with exit code 1.'], ['lint/1_x.txt', 'Error: not mine']]);
    w.gh.when('GET /repos/{owner}/{repo}/actions/runs/{run_id}/logs').reply(200, archive, { 'content-type': 'application/zip' });
    const { body } = await run(w, 'github_actions_get_run_logs_summary', { ...R, runId: 9 });
    expect(body.failed_jobs).toHaveLength(1);
    expect(body.failed_jobs[0]).toMatchObject({ name: 'build', failed_steps: [{ name: 'Run tests' }] });
    expect(body.failed_jobs[0].error_lines).toEqual(['FAIL src/a.test.js', '##[error]Process completed with exit code 1.']);
    expect(JSON.stringify(body)).not.toContain('not mine');
    expect(w.gh.invalid).toEqual([]);
  });

  it('run log summary says so when nothing failed, without downloading the archive', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    w.gh.when(JOBS).reply(200, { total_count: 1, jobs: [{ id: 6, name: 'lint', status: 'completed', conclusion: 'success', steps: [] }] });
    const { body } = await run(w, 'github_actions_get_run_logs_summary', { ...R, runId: 9 });
    expect(body.failed_jobs).toEqual([]);
    expect(w.gh.calls.some((c) => c.route.endsWith('/logs'))).toBe(false);
  });

  it('lists runs waiting for approval with the environment and who can approve', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    w.gh.when(RUNS).reply(200, { total_count: 1, workflow_runs: [{ id: 9, name: 'deploy', head_branch: 'main', html_url: 'u', status: 'waiting' }] });
    w.gh.when('GET /repos/{owner}/{repo}/actions/runs/{run_id}/pending_deployments').reply(200, [{ environment: { id: 1, name: 'production' }, current_user_can_approve: false, wait_timer: 0, reviewers: [{ type: 'User', reviewer: { login: 'chris' } }] }]);
    const { body } = await run(w, 'github_actions_list_pending_deployments', R);
    expect(body.items[0]).toMatchObject({ run_id: 9, environments: [{ name: 'production', current_user_can_approve: false, reviewers: ['chris'] }] });
    expect(w.gh.calls.find((c) => c.route === RUNS).query.status).toBe('waiting');
    expect(w.gh.invalid).toEqual([]);
  });
});

it('reads every redacted log character beyond the tail and long-line caps with a pinned hash and job_id alias',async()=>{
 const w=await makeWorld({profile:'read_only'}),text=Array.from({length:12},(_,i)=>`line ${i} ${'detail '.repeat(150)}\n`).join('');
 w.gh.when('GET /repos/{owner}/{repo}/actions/jobs/{job_id}').reply(200,FAILED_JOB);
 w.gh.when('GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs').reply(200,text);
 let offset=0,hash,joined='';
 do{const {body}=await run(w,'github_actions_get_job_log',{...R,job_id:5,fullText:true,textOffset:offset,maxChars:2000,...(hash?{expectedLogHash:hash}:{})});
  expect(body.text.length).toBeLessThanOrEqual(2000);joined+=body.text;hash=body.log_hash;offset=body.next_text_offset;if(body.complete)break;
 }while(offset<text.length);
 expect(joined).toBe(text);expect(w.gh.invalid).toEqual([]);
 const missing=await run(w,'github_actions_get_job_log',{...R,jobId:5,fullText:true,textOffset:2});expect(missing.result.isError).toBe(true);
 w.gh.when('GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs').reply(200,'new attempt');
 expect((await run(w,'github_actions_get_job_log',{...R,jobId:5,fullText:true,textOffset:1,expectedLogHash:hash})).result.isError).toBe(true);
});
it('falls back to the exact failed job when archive naming does not match instead of returning an empty diagnosis',async()=>{
 const w=await makeWorld({profile:'read_only'});
 w.gh.when(JOBS).reply(200,{total_count:1,jobs:[FAILED_JOB]});
 w.gh.when('GET /repos/{owner}/{repo}/actions/runs/{run_id}/logs').reply(200,zip([['renamed/1.txt','unrelated']]));
 w.gh.when('GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs').reply(200,'Error: exact job failure');
 const {body}=await run(w,'github_actions_get_run_logs_summary',{...R,run_id:9});
 expect(body.failed_jobs[0]).toMatchObject({logs_source:'job_log',logs_readable:true,error_lines:['Error: exact job failure']});expect(w.gh.invalid).toEqual([]);
});
it('falls back to job logs when the run archive cannot be read and redacts full-window credentials',async()=>{
 const w=await makeWorld({profile:'read_only'}),candidate='rtc_pass_'+'a'.repeat(43);
 w.gh.when(JOBS).reply(200,{total_count:1,jobs:[FAILED_JOB]});
 w.gh.when('GET /repos/{owner}/{repo}/actions/runs/{run_id}/logs').reply(403,{message:'Archive unavailable'});
 w.gh.when('GET /repos/{owner}/{repo}/actions/jobs/{job_id}').reply(200,FAILED_JOB);
 w.gh.when('GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs').reply(200,'Error: failed\n'+candidate+'\n'+'QUJD'.repeat(100));
 const summary=await run(w,'github_actions_get_run_logs_summary',{...R,runId:9});
 expect(summary.body).toMatchObject({archive_readable:false,failed_jobs:[{logs_source:'job_log',logs_readable:true}]});
 const full=await run(w,'github_actions_get_job_log',{...R,jobId:5,fullText:true});
 expect(JSON.stringify(full.body)).not.toContain(candidate);expect(full.body.text).not.toContain('QUJD'.repeat(100));
 expect(w.gh.invalid).toEqual([]);
});
it('never advances past multibyte or JSON-escaped log characters removed by a result budget',async()=>{
 const w=await makeWorld({profile:'read_only'}),text=('漢字😀\\\"\n').repeat(1500);
 w.gh.when('GET /repos/{owner}/{repo}/actions/jobs/{job_id}').reply(200,FAILED_JOB);
 w.gh.when('GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs').reply(200,text);
 let offset=0,hash,joined='';
 for(let n=0;n<50;n++){
  const {body}=await run(w,'github_actions_get_job_log',{...R,jobId:5,fullText:true,textOffset:offset,maxChars:4000,...(hash?{expectedLogHash:hash}:{})});
  expect(body.next_text_offset-offset).toBe(body.text.length);expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThan(8192);
  expect([...body.text].some(c=>c.codePointAt(0)>=0xd800&&c.codePointAt(0)<=0xdfff)).toBe(false);
  joined+=body.text;hash=body.log_hash;offset=body.next_text_offset;if(body.complete)break;
 }
 expect(joined).toBe(text);
});
// JOB-NOT-STARTED-1: GitHub refused to start the job (billing on 2026-11-15); its only reason is an annotation.
const NOT_STARTED = { id: 7, name: 'tests', status: 'completed', conclusion: 'failure', started_at: 'a', completed_at: 'a', runner_name: '', html_url: 'u', steps: [] };
const BILLING = [{ annotation_level: 'failure', message: 'The job was not started because recent account payments have failed or your spending limit needs to be increased.' },
 { annotation_level: 'notice', message: 'The ubuntu-latest label will migrate.' }];
it('a job GitHub never started: the summary gives GitHub\'s own reason and no dead log pointer', async () => {
 const w = await makeWorld({ profile: 'read_only' });
 w.gh.when(JOBS).reply(200, { total_count: 1, jobs: [NOT_STARTED] });
 w.gh.when('GET /repos/{owner}/{repo}/actions/runs/{run_id}/logs').reply(404, { message: 'Not Found' });
 w.gh.when('GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs').reply(404, { message: 'Not Found' });
 w.gh.when('GET /repos/{owner}/{repo}/check-runs/{check_run_id}/annotations').reply(200, BILLING);
 const { body } = await run(w, 'github_actions_get_run_logs_summary', { ...R, runId: 9 });
 const job = body.failed_jobs[0];
 expect(job.error_lines).toEqual([BILLING[0].message]);
 expect(job).toMatchObject({ never_started: true, logs_source: 'annotations', logs_readable: false });
 expect(job.full_log).toBeUndefined();
});
it('a job GitHub never started: the job log answers with the reason instead of "not found"', async () => {
 const w = await makeWorld({ profile: 'read_only' });
 w.gh.when('GET /repos/{owner}/{repo}/actions/jobs/{job_id}').reply(200, NOT_STARTED);
 w.gh.when('GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs').reply(404, { message: 'Not Found' });
 w.gh.when('GET /repos/{owner}/{repo}/check-runs/{check_run_id}/annotations').reply(200, BILLING);
 const { result, body } = await run(w, 'github_actions_get_job_log', { ...R, jobId: 7 });
 expect(result.isError, JSON.stringify(result)).toBeFalsy();
 expect(body).toMatchObject({ never_started: true, logs_readable: false });
 expect(body.annotations[0].message).toContain('spending limit');
});
