import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';
import { readZip, summarizeLog } from '../../src/github/log-summary.js';
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
