import {createHash} from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { runWriteContract, makeWorld, doorsFor, parse } from '../../test/helpers/write-contract.js';
import * as gitData from '../../src/tools/git-data-commit.js';
import { createGates } from '../../src/tools/gates.js';

const A = 'a'.repeat(40), B = 'b'.repeat(40), C = 'c'.repeat(40);
const E = 'e'.repeat(40);
const blobSha = bytes => createHash('sha1').update(Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes])).digest('hex');
const pdf = Buffer.from('%PDF-1.7\n' + String.fromCharCode(0, 255) + '\n%%EOF');
const D = blobSha(pdf);
const args = { repo: 'hello', branch: 'main', message: 'Add the official form',
  files: [{ path: 'forms/official.pdf', encoding: 'base64', content: pdf.toString('base64') }] };
const definition = { tool: gitData.tools[0], handler: gitData.handlers.github_content_commit_git_data };
function arrange(gh, mismatch = false) {
  gh.when('GET /repos/{owner}/{repo}').reply(200, { default_branch: 'main' });
  gh.when('GET /repos/{owner}/{repo}/rules/branches/{branch}').reply(200, []);
  gh.when('GET /repos/{owner}/{repo}/branches/{branch}').replySequence([
    { status: 200, body: { protected: false, commit: { sha: A } } },
    { status: 200, body: { protected: false, commit: { sha: mismatch ? A : B } } }
  ]);
  gh.when('GET /repos/{owner}/{repo}/git/commits/{commit_sha}').reply(200, r =>
    r.params.commit_sha === A ? { sha: A, tree: { sha: C }, parents: [] } : {sha:B,tree:{sha:E},parents:[{sha:A}]});
  gh.when('POST /repos/{owner}/{repo}/git/blobs').reply(201, r => ({sha:blobSha(Buffer.from(r.body.content,'base64'))}));
  let entries=[];
  gh.when('POST /repos/{owner}/{repo}/git/trees').reply(201, r => {entries=r.body.tree;return {sha:E};});
  gh.when('GET /repos/{owner}/{repo}/git/trees/{tree_sha}').reply(200,()=>({sha:E,truncated:false,tree:entries.filter(e=>e.sha!==null)}));
  gh.when('POST /repos/{owner}/{repo}/git/refs').reply(201,{ref:'refs/heads/dev',object:{sha:B}});
  gh.when('POST /repos/{owner}/{repo}/git/commits').reply(201, { sha: B });
  gh.when('PATCH /repos/{owner}/{repo}/git/refs/{ref}').reply(200,
    { ref: 'refs/heads/main', object: { sha: B } });
}
runWriteContract({
  label: 'github_content_commit_git_data (default branch)', definition,
  args, production: true, needsConfirm: true, expectedWrites: 4,
  advanceClockOnSleep: true,
  arrange: (gh, outcome) => arrange(gh, outcome !== 'ok')
});

describe('Git Data binary commits', () => {
  const run = async (w, a) => parse(await doorsFor(definition)[0].call(w, a));
  it('preserves binary PDF bytes and supplies one exact parent with nonforced fast-forward', async () => {
    const w = await makeWorld({ mode: 'preview', advanceClockOnSleep: true });
    arrange(w.gh);
    // Feature branch is not production; main remains protected by production guard.
    w.gh.when('GET /repos/{owner}/{repo}').reply(200, { default_branch: 'main' });
    const out = await run(w, { ...args, branch: 'docs/pdf', confirm: true, expectedHead: A });
    expect(out.status).toBe('applied');
    const calls = w.gh.calls;
    const blob = calls.find(c => c.route === 'POST /repos/{owner}/{repo}/git/blobs');
    const tree = calls.find(c => c.route === 'POST /repos/{owner}/{repo}/git/trees');
    const commit = calls.find(c => c.route === 'POST /repos/{owner}/{repo}/git/commits');
    const ref = calls.find(c => c.route === 'PATCH /repos/{owner}/{repo}/git/refs/{ref}');
    expect(Buffer.from(blob.body.content, 'base64')).toEqual(pdf);
    expect(blob.body.encoding).toBe('base64');
    expect(tree.body).toMatchObject({ base_tree: C,
      tree: [{ path: 'forms/official.pdf', sha: D, mode: '100644', type: 'blob' }] });
    expect(commit.body).toMatchObject({ tree: E, parents: [A] });
    expect(ref.params.ref).toBe('heads/docs/pdf');
    expect(ref.body).toMatchObject({ sha: B, force: false });
    expect(w.gh.invalid).toEqual([]);
  });
  it('refuses a stale exact head before creating blobs or commits', async () => {
    const w = await makeWorld();
    arrange(w.gh);
    const out = await run(w, { ...args, branch: 'docs/pdf', expectedHead: B, confirm: true });
    expect(JSON.stringify(out)).toMatch(/moved since your preview/i);
    expect(w.gh.calls.filter(c => c.method === 'POST' || c.method === 'PATCH')).toHaveLength(0);
  });
  it('rejects noncanonical base64, traversal, duplicate paths and inconsistent deletion', () => {
    const good = { path: 'doc.pdf', content: pdf.toString('base64'), encoding: 'base64' };
    expect(() => gitData.bytesOf({ ...good, content: 'a===' })).toThrow(/base64/);
    expect(() => gitData.bytesOf({ ...good, content: 'YQ=' })).toThrow(/base64/);
    expect(() => gitData.checkGitFiles([{ ...good, path: '../secret' }])).toThrow(/relative path/);
    expect(() => gitData.checkGitFiles([good, good])).toThrow(/Duplicate/);
    expect(() => gitData.bytesOf({ path: 'x', delete: true, content: 'y' })).toThrow(/deletion/);
    expect(() => gitData.bytesOf({ path: 'x', content: 'x', mode: '120000' })).toThrow(/mode/);
  });
  it('accepts UTF-8 text, an empty file, executable mode and a deletion', () => {
    expect(gitData.checkGitFiles([
      { path: 'a.txt', content: 'hello' },
      { path: 'empty.txt', content: '' },
      { path: 'run.sh', content: '#!/bin/sh', mode: '100755' },
      { path: 'gone.txt', delete: true }
    ])).toMatchObject({ additions: 3, deletions: 1 });
  });
  it('rejects oversized files before any remote requests', async () => {
    const w = await makeWorld();
    const out = await run(w, { ...args, branch: 'dev',
      files: [{ path: 'large.bin', content: 'a'.repeat(1_500_001) }] });
    expect(JSON.stringify(out)).toMatch(/limit|large|size/i);
    expect(w.gh.calls).toHaveLength(0);
  });
  it('does not advance a branch if the remote ref moved while building the commit', async () => {
    const w = await makeWorld({ advanceClockOnSleep: true });
    arrange(w.gh);
    w.gh.when('PATCH /repos/{owner}/{repo}/git/refs/{ref}')
      .reply(422, { message: 'Update is not a fast forward' });
    const out = await run(w, { ...args, branch: 'dev', confirm: true });
    expect(out.status).not.toBe('applied');
    expect(w.gh.calls.filter(c => c.route === 'POST /repos/{owner}/{repo}/git/commits')).toHaveLength(1);
    expect(w.gh.calls.filter(c => c.route === 'PATCH /repos/{owner}/{repo}/git/refs/{ref}')).toHaveLength(1);
  });
  it('refuses a tree that would produce no change, without creating a commit', async () => {
    const w = await makeWorld({ advanceClockOnSleep: true });
    arrange(w.gh);
    w.gh.when('POST /repos/{owner}/{repo}/git/trees').reply(201, { sha: C });
    const out = await run(w, { ...args, branch: 'dev', confirm: true });
    expect(JSON.stringify(out)).toMatch(/no effect/i);
    expect(w.gh.calls.some(c => c.route === 'POST /repos/{owner}/{repo}/git/commits')).toBe(false);
  });
  it('allows a protected pr-only repository feature branch, but forbids a default-branch bypass', async () => {
    const permitted = await makeWorld({ accounts: ['Robinson-AI-Systems'], advanceClockOnSleep: true, gates: createGates() });
    arrange(permitted.gh);
    const input = { ...args, repo: 'github-mcp', branch: 'ai/fix-binary', confirm: true };
    const added = parse(await doorsFor(definition)[1].call(permitted, input));
    expect(added.status).toBe('applied');
    const main = await makeWorld({ accounts: ['Robinson-AI-Systems'], mode: 'preview', advanceClockOnSleep: true, gates: createGates() });
    arrange(main.gh);
    const refused = parse(await doorsFor(definition)[1].call(main, { ...input, branch: 'main' }));
    expect(refused.status).toBe('refused_by_guard');
    expect(refused.refusedBy).toBe('mode'); // Default-branch production classification blocks PREVIEW before PR-only is considered.
    expect(main.gh.calls.filter(c => c.method === 'POST' || c.method === 'PATCH')).toHaveLength(0);
  });
  it('uses null tree SHA for deletion and does not upload a blob', async () => {
    const w = await makeWorld({ advanceClockOnSleep: true });
    arrange(w.gh);
    const out = await run(w, { ...args, branch: 'dev',
      files: [{ path: 'old.txt', delete: true }], confirm: true });
    expect(out.status).toBe('applied');
    expect(w.gh.calls.some(c => c.route === 'POST /repos/{owner}/{repo}/git/blobs')).toBe(false);
    const tree = w.gh.calls.find(c => c.route === 'POST /repos/{owner}/{repo}/git/trees');
    expect(tree.body.tree).toEqual([{ path: 'old.txt', mode: '100644', type: 'blob', sha: null }]);
    expect(w.gh.invalid).toEqual([]);
  });
});

describe('fleet batch integrity',()=>{
 const run=async(w,a,door=0)=>parse(await doorsFor(definition)[door].call(w,a));
 const files=Array.from({length:29},(_,i)=>({path:`batch/f-${i}.bin`,content:Buffer.from([i,0,255]).toString('base64'),encoding:'base64'}));
 it.each([0,1,2])('publishes all 29 files once with independent full manifest verification through door %i',async door=>{
  const w=await makeWorld({advanceClockOnSleep:true});arrange(w.gh);
  const input={...args,branch:'dev',files,expectedFileCount:29,expectedHead:A,confirm:true,requestKey:'batch-29'};
  const out=await run(w,input,door);expect(out.status,JSON.stringify(out)).toBe('applied');
  expect(out.result).toMatchObject({branch_head:B,commit:B,parent:A,submitted_files:29,confirmed_files:29,manifest_complete:true});
  const blobs=w.gh.calls.filter(c=>c.route==='POST /repos/{owner}/{repo}/git/blobs');expect(blobs).toHaveLength(29);
  const tree=w.gh.calls.find(c=>c.route==='POST /repos/{owner}/{repo}/git/trees');
  expect(tree.body.tree.map(e=>({path:e.path,sha:e.sha}))).toEqual(files.map(f=>({path:f.path,sha:blobSha(Buffer.from(f.content,'base64'))})));
  expect(w.gh.calls.filter(c=>c.route==='POST /repos/{owner}/{repo}/git/commits')).toHaveLength(1);
  expect(w.gh.calls.filter(c=>c.route==='PATCH /repos/{owner}/{repo}/git/refs/{ref}')).toHaveLength(1);
  expect(w.gh.invalid).toEqual([]);
 });
 it('rejects a count mismatch and 51 files before any provider request',async()=>{
  for(const input of [{...args,files:files.slice(0,12),expectedFileCount:29},{...args,files:Array.from({length:51},(_,i)=>({path:'f'+i,content:'x'}))}]){
   const w=await makeWorld();const out=await run(w,input);expect(out.done).toBe(false);expect(w.gh.calls).toHaveLength(0);
  }
 });
 it('creates an absent branch from the explicit parent after building a single complete commit',async()=>{
  const w=await makeWorld({advanceClockOnSleep:true});arrange(w.gh);
  w.gh.when('GET /repos/{owner}/{repo}/branches/{branch}').replySequence([{status:404,body:{message:'Not Found'}},{status:200,body:{commit:{sha:B}}}]);
  const out=await run(w,{...args,branch:'dev',createFrom:A,expectedHead:'',confirm:true});
  expect(out.status,JSON.stringify(out)).toBe('applied');expect(out.result.parent).toBe(A);
  const ref=w.gh.calls.find(c=>c.route==='POST /repos/{owner}/{repo}/git/refs');expect(ref.body).toEqual({ref:'refs/heads/dev',sha:B});
  expect(w.gh.calls.some(c=>c.method==='PATCH')).toBe(false);expect(w.gh.invalid).toEqual([]);
 });
 it('explains an absent branch without blaming App setup or sending a write',async()=>{
  const w=await makeWorld({mode:'production',advanceClockOnSleep:true});arrange(w.gh);
  w.gh.when('GET /repos/{owner}/{repo}/branches/{branch}').reply(404,{message:'Not Found'});
  const out=await run(w,{...args,branch:'dev',confirm:true});expect(out.error).toContain('createFrom');
  expect(w.gh.calls.some(c=>c.method==='POST'||c.method==='PATCH')).toBe(false);
 });
 it('never overwrites a destination that appeared while the new commit was being built',async()=>{
  const w=await makeWorld({advanceClockOnSleep:true});arrange(w.gh);
  w.gh.when('GET /repos/{owner}/{repo}/branches/{branch}').reply(404,{message:'Not Found'});
  w.gh.when('POST /repos/{owner}/{repo}/git/refs').reply(422,{message:'Reference already exists'});
  const out=await run(w,{...args,branch:'dev',createFrom:A,expectedHead:'',confirm:true});expect(out.done).toBe(false);
  expect(w.gh.calls.some(c=>c.method==='PATCH')).toBe(false);
 });
 it.each(['missing','truncated','wrong-parent','wrong-blob'])('never calls %s readback complete',async fault=>{
  const w=await makeWorld({advanceClockOnSleep:true});arrange(w.gh);
  if(fault==='wrong-parent')w.gh.when('GET /repos/{owner}/{repo}/git/commits/{commit_sha}').reply(200,r=>r.params.commit_sha===A?{sha:A,tree:{sha:C}}:{sha:B,tree:{sha:E},parents:[{sha:C}]});
  else w.gh.when('GET /repos/{owner}/{repo}/git/trees/{tree_sha}').reply(200,{sha:E,truncated:fault==='truncated',tree:fault==='wrong-blob'?[{path:args.files[0].path,type:'blob',mode:'100644',sha:C}]:[]});
  const out=await run(w,{...args,branch:'dev',confirm:true});expect(out.status).toBe('unconfirmed');expect(out.done).toBe(false);
 });
});
it('rejects an acknowledged wrong blob hash before creating a tree or advancing a ref',async()=>{
 const w=await makeWorld({advanceClockOnSleep:true});arrange(w.gh);
 w.gh.when('POST /repos/{owner}/{repo}/git/blobs').reply(201,{sha:C});
 const result=parse(await doorsFor(definition)[0].call(w,{...args,branch:'dev',confirm:true}));
 expect(result.done).toBe(false);expect(w.gh.calls.some(c=>c.route==='POST /repos/{owner}/{repo}/git/trees'||c.method==='PATCH')).toBe(false);
});
it('accepts all 50 operations while preserving the independent total byte bound',()=>{
 expect(gitData.checkGitFiles(Array.from({length:50},(_,i)=>({path:'f'+i,content:'x'}))).additions).toBe(50);
 expect(()=>gitData.checkGitFiles(Array.from({length:50},(_,i)=>({path:'f'+i,content:'x'.repeat(50000)})))).toThrow(/2 MB/);
});
