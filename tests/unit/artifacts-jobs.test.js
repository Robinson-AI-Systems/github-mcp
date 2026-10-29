import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildZip } from '../../test/helpers/zip-builder.js';
import { listZip, readEntry, unsafeName } from '../../src/core/zip-reader.js';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';
import { makeWorld, parse } from '../../test/helpers/write-contract.js';

const served = { bytes: Buffer.alloc(0), calls: [] };
vi.mock('../../src/github/public-url.js', async (orig) => ({ ...(await orig()), downloadPublicAsset: async (url, options) => { served.calls.push({ url, options }); return { bytes: served.bytes, size: served.bytes.length, contentType: 'application/zip' }; } }));

const run = async (w, name, args, gates = []) => {
  const result = await createDispatch({ env: w.ctx.env, credentials: w.credentials, gates, fetch: w.gh.fetch, now: w.ctx.now, sleep: async () => {} })({ registry, name, args, connection: w.connection, db: w.db });
  let body = null; try { body = parse(result); } catch { body = { message: result.content?.[0]?.text }; }
  return { result, body };
};
const R = { repo: 'hello' };

describe('zip reader', () => {
  it('lists and reads stored and deflated files', () => {
    const zip = buildZip([{ name: 'a.txt', data: 'hello' }, { name: 'dir/', data: '' }, { name: 'dir/b.txt', data: 'world'.repeat(50), stored: true }]);
    const entries = listZip(zip);
    expect(entries.map((e) => e.name)).toEqual(['a.txt', 'dir/', 'dir/b.txt']);
    expect(readEntry(zip, entries[0]).toString()).toBe('hello');
    expect(readEntry(zip, entries[2]).toString()).toBe('world'.repeat(50));
  });
  it('refuses unsafe names, links, too many files, too big and lying sizes', () => {
    expect(unsafeName('../x')).toBe(true); expect(unsafeName('/etc/x')).toBe(true); expect(unsafeName('a/b.txt')).toBe(false);
    expect(() => listZip(buildZip([{ name: '../evil', data: 'x' }]))).toThrow(/unsafe file name/);
    expect(() => listZip(buildZip([{ name: 'l', data: 'x', link: true }]))).toThrow(/link/);
    expect(() => listZip(buildZip([{ name: 'a', data: 'x' }, { name: 'b', data: 'y' }, { name: 'c', data: 'z' }]), { compressed: 1e6, expanded: 1e6, entries: 2 })).toThrow(/more than 2/);
    expect(() => listZip(buildZip([{ name: 'a', data: 'x'.repeat(100) }]), { compressed: 1e6, expanded: 50, entries: 5 })).toThrow(/expand beyond/);
    expect(() => listZip(Buffer.from('not a zip at all, definitely'))).toThrow(/not a zip/);
    const lying = buildZip([{ name: 'a', data: 'x'.repeat(100), lie: 5 }]);
    expect(() => readEntry(lying, listZip(lying)[0])).toThrow(/stated size/);
  });
});

describe('artifact and archive readers', () => {
  beforeEach(() => { served.calls = []; });
  it('lists files, reads text, describes binary, and never shows the download address', async () => {
    served.bytes = buildZip([{ name: 'report.txt', data: 'all green' }, { name: 'bin.dat', data: Buffer.from([0, 1, 2, 3]) }]);
    const w = await makeWorld({ profile: 'read_only' });
    w.gh.when('GET /repos/{owner}/{repo}/actions/artifacts/{artifact_id}').reply(200, { id: 8, name: 'build', size_in_bytes: 100, expired: false });
    w.gh.when('GET /repos/{owner}/{repo}/actions/artifacts/{artifact_id}/{archive_format}').reply(302, '', { location: 'https://pipelines.actions.githubusercontent.com/x?sig=SECRETSIG' });
    const list = await run(w, 'github_artifact_read', { ...R, artifactId: 8 });
    expect(list.body).toMatchObject({ artifact: { id: 8, name: 'build' }, file_count: 2 });
    expect(JSON.stringify(list.body)).not.toContain('SECRETSIG');
    const text = await run(w, 'github_artifact_read', { ...R, artifactId: 8, path: 'report.txt' });
    expect(text.body).toMatchObject({ text: 'all green', size: 9 });
    const bin = await run(w, 'github_artifact_read', { ...R, artifactId: 8, path: 'bin.dat' });
    expect(bin.body).toMatchObject({ binary: true, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(bin.body.text).toBeUndefined();
    expect((await run(w, 'github_artifact_read', { ...R, artifactId: 8, path: 'nope' })).result.isError).toBe(true);
    expect(served.calls[0].options.maxBytes).toBe(50 * 1024 * 1024);
    expect(w.gh.invalid).toEqual([]);
  });
  it('refuses expired, oversized and hostile artifacts', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    w.gh.when('GET /repos/{owner}/{repo}/actions/artifacts/{artifact_id}').reply(200, { id: 8, name: 'b', size_in_bytes: 1, expired: true, expires_at: '2026-10-01' });
    expect((await run(w, 'github_artifact_read', { ...R, artifactId: 8 })).result.isError).toBe(true);
    w.gh.when('GET /repos/{owner}/{repo}/actions/artifacts/{artifact_id}').reply(200, { id: 8, name: 'b', size_in_bytes: 60 * 1024 * 1024, expired: false });
    expect((await run(w, 'github_artifact_read', { ...R, artifactId: 8 })).result.isError).toBe(true);
    w.gh.when('GET /repos/{owner}/{repo}/actions/artifacts/{artifact_id}').reply(200, { id: 8, name: 'b', size_in_bytes: 10, expired: false });
    w.gh.when('GET /repos/{owner}/{repo}/actions/artifacts/{artifact_id}/{archive_format}').reply(302, '', { location: 'https://pipelines.actions.githubusercontent.com/x' });
    served.bytes = buildZip([{ name: '../../etc/passwd', data: 'x' }]);
    expect((await run(w, 'github_artifact_read', { ...R, artifactId: 8 })).result.isError).toBe(true);
  });
  it('reads a repository snapshot, hiding the top folder', async () => {
    served.bytes = buildZip([{ name: 'hello-abc123/', data: '' }, { name: 'hello-abc123/README.md', data: '# hi' }]);
    const w = await makeWorld({ profile: 'read_only' });
    w.gh.when('GET /repos/{owner}/{repo}').reply(200, { default_branch: 'main' });
    w.gh.when('GET /repos/{owner}/{repo}/zipball/{ref}').reply(302, '', { location: 'https://codeload.github.com/o/r/legacy.zip/main?token=T' });
    expect((await run(w, 'github_content_read_archive', R)).body).toMatchObject({ ref: 'main', files: [{ path: 'README.md', size: 4 }] });
    expect((await run(w, 'github_content_read_archive', { ...R, path: 'README.md' })).body).toMatchObject({ text: '# hi' });
    expect(w.gh.invalid).toEqual([]);
  });
  it('exports an SBOM as names and versions', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    w.gh.when('GET /repos/{owner}/{repo}/dependency-graph/sbom').reply(200, { sbom: { spdxVersion: 'SPDX-2.3', name: 'com.github.o/hello', creationInfo: { created: '2026-10-01T00:00:00Z' }, packages: [{ name: 'npm:left-pad', versionInfo: '1.3.0', licenseConcluded: 'MIT', SPDXID: 'x' }] } });
    expect((await run(w, 'github_security_export_sbom', R)).body).toMatchObject({ package_count: 1, packages: [{ name: 'npm:left-pad', version: '1.3.0', license: 'MIT' }] });
  });
});

describe('background jobs', () => {
  const UUID = '0b1c2d3e-aaaa-bbbb-cccc-1234567890ab';
  const startedWorld = async () => {
    const w = await makeWorld({ profile: 'full', mode: 'production' });
    w.gh.when('GET /repos/{owner}/{repo}/dependency-graph/sbom/generate-report').reply(201, { sbom_url: `https://api.github.com/repos/example-org/hello/dependency-graph/sbom/fetch-report/${UUID}` });
    const started = await run(w, 'github_security_sbom_report_start', R);
    return { w, id: started.body.job_id };
  };
  it('starts a job, stays pending, then ready with a result handle; a second call too soon does not ask GitHub', async () => {
    const { w, id } = await startedWorld();
    expect(id).toMatch(/^job_[0-9a-f]{16}$/);
    w.gh.when('GET /repos/{owner}/{repo}/dependency-graph/sbom/fetch-report/{sbom_uuid}').reply(202, '');
    expect((await run(w, 'github_job_status', { job_id: id })).body).toMatchObject({ state: 'pending' });
    const before = w.gh.calls.length;
    expect((await run(w, 'github_job_status', { job_id: id })).body).toMatchObject({ state: 'pending', note: expect.stringContaining('10 seconds') });
    expect(w.gh.calls.length).toBe(before);
  });
  it('turns ready when GitHub redirects to the report', async () => {
    const { w, id } = await startedWorld();
    w.gh.when('GET /repos/{owner}/{repo}/dependency-graph/sbom/fetch-report/{sbom_uuid}').reply(302, '', { location: 'https://example.invalid-host.net/report.json' });
    served.bytes = Buffer.from(JSON.stringify({ sbom: { spdxVersion: 'SPDX-2.3', packages: [{ name: 'npm:a', versionInfo: '1' }] } }));
    const done = await run(w, 'github_job_status', { job_id: id });
    expect(done.body).toMatchObject({ state: 'ready', result_handle: expect.stringMatching(/^res_/) });
    const read = await run(w, 'github_get_result', { handle: done.body.result_handle });
    expect(JSON.stringify(read.body)).toContain('npm:a');
    expect((await run(w, 'github_job_status', { job_id: id })).body.state).toBe('ready');
  });
  it('does not show one connection\'s job to another, and rejects bad ids', async () => {
    const { w, id } = await startedWorld();
    const other = { ...w, connection: Object.freeze({ ...w.connection, client_id: 'client-2' }) };
    expect((await run(other, 'github_job_status', { job_id: id })).result.isError).toBe(true);
    expect((await run(w, 'github_job_status', { job_id: 'job_nope' })).result.isError).toBe(true);
  });
  it('cancel stops a pending job', async () => {
    const { w, id } = await startedWorld();
    const out = (await run(w, 'github_job_cancel', { job_id: id, confirm: true })).body;
    expect(out).toMatchObject({ done: true });
    expect((await run(w, 'github_job_status', { job_id: id })).body).toMatchObject({ state: 'failed', detail: 'Stopped by you.' });
  });
});

it.each(['github_artifact_read','github_content_read_archive'])('reconstructs exact binary windows with full-entry protection and immutable hashes through %s',async name=>{
 const original=Buffer.from(Array.from({length:70000},(_,i)=>i%256));served.bytes=buildZip([{name:'binary.dat',data:original}]);
 const w=await makeWorld({profile:'read_only'});
 w.gh.when('GET /repos/{owner}/{repo}/actions/artifacts/{artifact_id}').reply(200,{id:8,name:'build',size_in_bytes:100,expired:false});
 w.gh.when('GET /repos/{owner}/{repo}/actions/artifacts/{artifact_id}/{archive_format}').reply(302,'',{location:'https://pipelines.actions.githubusercontent.com/x'});
 w.gh.when('GET /repos/{owner}/{repo}/zipball/{ref}').reply(302,'',{location:'https://pipelines.actions.githubusercontent.com/x'});
 // A repository zip normally has one leading directory.
 if(name==='github_content_read_archive')served.bytes=buildZip([{name:'root/',data:''},{name:'root/binary.dat',data:original}]);
 let offset=0,hash,chunks=[];
 do{const {body,result}=await run(w,name,{...R,...(name==='github_artifact_read'?{artifact_id:8}:{ref:'main'}),path:'binary.dat',byteOffset:offset,byteLength:32768,...(hash?{expectedFileHash:hash}:{})});
  expect(result.isError,JSON.stringify(body)).not.toBe(true);chunks.push(Buffer.from(body.content_base64,'base64'));hash=body.file_hash;offset=body.next_byte_offset;if(body.complete)break;
 }while(offset<original.length);
 expect(Buffer.concat(chunks)).toEqual(original);expect(w.gh.invalid).toEqual([]);
 const stale=await run(w,name,{...R,...(name==='github_artifact_read'?{artifactId:8}:{ref:'main'}),path:'binary.dat',byteOffset:1,expectedFileHash:'a'.repeat(64)});expect(stale.result.isError).toBe(true);
});
it('never releases a harmless window from a protected full archive entry',async()=>{
 const {describeZip}=await import('../../src/tools/artifacts-read.js');
 const candidate='rtc_pass_'+'a'.repeat(43),bytes=buildZip([{name:'protected.txt',data:'safe prefix\n'+candidate}]);
 expect(()=>describeZip(bytes,{path:'protected.txt',byteOffset:0,byteLength:4})).toThrow(/content protection/);
});
