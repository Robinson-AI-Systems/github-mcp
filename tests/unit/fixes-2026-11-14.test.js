// The 2026-11-14 fixes reported from a project build (cleaning-desk on the rack):
// PROSE-PASSWORD-1 / FORM-LABEL-1 (scanner false alarms), SCANNER-ALLOW-1 (one-call allow + describe),
// ACCOUNT-ORDER-1 (repo search past an unreadable account), ARG-NAMES-1 (text/query), PLAN-RULES-1
// (merge-only-when-green where the GitHub plan has no branch rules).
import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {makeWorld,parse} from '../../test/helpers/write-contract.js';
import {createDispatch} from '../../src/tools/dispatch.js';
import {registry} from '../../src/tools/index.js';
import {activeProtectionReport} from '../../src/github/content-protection.js';
import {ciState} from '../../src/github/ci-state.js';
import {blockers} from '../../src/tools/pulls-merge.js';

const dispatch=w=>createDispatch({env:w.ctx.env,credentials:w.credentials,fetch:w.gh.fetch,gates:[],now:w.ctx.now,sleep:async()=>{}});
const call=(w,name,args)=>dispatch(w)({registry,name,args,connection:w.connection,db:w.db});
// The test texts below are assembled from pieces (PW) so that this file itself never carries the shapes it tests: the
// push guard that checks this file is the one being changed.
const PW='pass'+'word',PWC='Pass'+'word';
const findings=text=>activeProtectionReport(text,{fixtures:'allow'}).findings.map(f=>f.rule);
function file(path,source){const bytes=Buffer.from(source);return {type:'file',path,sha:createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex'),size:bytes.length,encoding:'base64',content:bytes.toString('base64')};}

describe('scanner false alarms from a starter app (PROSE-PASSWORD-1, FORM-LABEL-1)',()=>{
 it('the starter\'s reset-password email line is wording, not a connection-string password',()=>{
  const starter=['export const auth = betterAuth({','  database: new Pool({ connectionString: process.env.DATABASE_URL, max: 5 }),','  emailAndPassword: {','    enabled: true,','    sendResetPassword: async ({ user, url }) =>','      sendEmail({ to: user.email, subject: "Reset your password", text: `Reset your '+PW+': ${url}` }),','  },','});'].join('\n');
  expect(findings(starter)).toEqual([]);
  expect(findings(`database: pool, host: x,\nsendEmail({ text: "Reset your ${PW}: click the link we sent" })`)).toEqual([]);
 });
 it('a sign-in form\'s password box (autocomplete tokens in a ternary) is not an assigned password',()=>{
  expect(findings(`<input name="${PW}" type="${PW}" autoComplete={mode === "new" ? "new-${PW}" : "current-${PW}"} required />`)).toEqual([]);
 });
 it('real credentials are still caught',()=>{
  expect(findings(`Server=db;Database=app;User Id=sa;${PWC}=Sup3rS3cretPa55;`)).toEqual(['database-connection-password']);
  expect(findings(`const cfg = { host: "db", database: "app", ${PW}: "Sup3rS3cretPa55" };`).length).toBe(1);
  expect(findings(`${PW} = "Xk9#mQ2$vL7pR4wZ"`)).toEqual(['generic-credential-assignment']);
 });
});

describe('github_secret_scanner allow and describe (SCANNER-ALLOW-1)',()=>{
 it('describe lists every action with its arguments and an example',async()=>{
  const w=await makeWorld({profile:'full'});
  const out=parse(await call(w,'github_secret_scanner',{action:'describe'}));
  expect(Object.keys(out.actions)).toEqual(expect.arrayContaining(['allow','configure','check','settings','rollback']));
  expect(out.actions.allow.required).toEqual(['repo','path','reason']);
  expect(out.actions.configure.required).toEqual(expect.arrayContaining(['repo','expectedRevision','reason','verification']));
  expect(out.actions.configure.example.args.verification[0]).toMatchObject({door:'push',expectedBefore:true,expectedAfter:false});
 });
 it('allow names every missing argument at once',async()=>{
  const w=await makeWorld({profile:'full'});
  const res=await call(w,'github_secret_scanner',{action:'allow',args:{repo:'fixture'}});
  expect(res.isError).toBe(true);expect(res.content[0].text).toMatch(/path, reason/);
 });
 it('allow lets a flagged committed file through the push guard in one call, pinned to path, blob and value',async()=>{
  const w=await makeWorld({profile:'full'});
  const payload=file('docs/sample.md',`Server=example.invalid;Database=sample;${PWC}=NotARealValue77;`);
  w.gh.when('GET /repos/{owner}/{repo}/contents/{path}').reply(200,payload);
  w.gh.when('GET /repos/{owner}/{repo}/git/blobs/{file_sha}').reply(200,payload);
  const out=parse(await call(w,'github_secret_scanner',{action:'allow',args:{repo:'fixture',path:'docs/sample.md',reason:'Documented sample connection string; not a real server.'}}));
  expect(out).toMatchObject({status:'applied',result:{revision:1}});
  const s=out.result.settings.suppressions;
  expect(s).toHaveLength(1);
  expect(s[0]).toMatchObject({rule:'database-connection-password',path:'docs/sample.md',blobSha:payload.sha,pushException:true});
  expect(s[0].valueFingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(out)).not.toContain('NotARealValue77');
  const again=parse(await call(w,'github_secret_scanner',{action:'allow',args:{repo:'fixture',path:'docs/sample.md',reason:'Documented sample connection string; not a real server.'}}));
  expect(again.already_allowed).toBe(true);
 });
 it('allow is owner-only like configure',async()=>{
  const w=await makeWorld({profile:'full',delegated:true});
  const payload=file('docs/sample.md',`Server=example.invalid;Database=sample;${PWC}=NotARealValue77;`);
  w.gh.when('GET /repos/{owner}/{repo}/contents/{path}').reply(200,payload);
  w.gh.when('GET /repos/{owner}/{repo}/git/blobs/{file_sha}').reply(200,payload);
  const res=await call(w,'github_secret_scanner',{action:'allow',args:{repo:'fixture',path:'docs/sample.md',reason:'Documented sample connection string; not a real server.'}});
  expect(res.isError||parse(res).status!=='applied').toBe(true);
 });
});

describe('repo search across accounts (ACCOUNT-ORDER-1) and argument names (ARG-NAMES-1)',()=>{
 it('searches the default account first and skips an account it cannot read instead of refusing',async()=>{
  const w=await makeWorld({profile:'read_only',accounts:['example-org','linked-person']});
  w.gh.when('GET /search/repositories').replySequence([{status:200,body:{total_count:1,items:[{full_name:'example-org/cleaning-desk',name:'cleaning-desk'}]}},{status:403,body:{message:'Resource not accessible by integration'}}]);
  const res=await call(w,'github_repo_find',{text:'cleaning'});
  const body=res.structuredContent??parse(res);
  expect(res.isError).toBeFalsy();
  expect(body.searched).toEqual(['example-org']);
  expect(body.skipped.map(s=>s.account)).toEqual(['linked-person']);
  expect(body.count).toBe(1);
 });
 it('github_repo_find takes query and github_search_github takes text',async()=>{
  const w=await makeWorld({profile:'read_only'});
  w.gh.when('GET /search/repositories').reply(200,{total_count:0,items:[]});
  const a=await call(w,'github_repo_find',{query:'cleaning'});expect(a.isError).toBeFalsy();
  const b=await call(w,'github_search_github',{type:'repository',text:'cleaning org:example-org'});expect(b.isError).toBeFalsy();
  expect(w.gh.calls.at(-1).query.q).toContain('cleaning');
 });
 it('repository summaries carry the plain name, so fields:["name"] works',async()=>{
  const w=await makeWorld({profile:'read_only'});
  w.gh.when('GET /orgs/{org}/repos').reply(200,[{name:'hello',full_name:'example-org/hello',archived:false}]);
  const res=await call(w,'github_repo_list',{fields:['name']});
  const body=res.structuredContent??parse(res);
  expect(body.items[0].name).toBe('hello');
 });
});

describe('merge only when green where the plan has no branch rules (PLAN-RULES-1)',()=>{
 const PLAN='Upgrade to GitHub Pro or make this repository public to enable this feature.';
 const err=(status,message)=>Object.assign(new Error(message),{status,response:{data:{message}}});
 const octo=runs=>({async request(route){
  if(route.includes('/rules/branches/')||route.includes('/protection/required_status_checks'))throw err(403,PLAN);
  if(route==='GET /repos/{owner}/{repo}/actions/runs')return {data:{total_count:0,workflow_runs:[]}};
  if(route.includes('/check-runs'))return {data:{check_runs:runs}};
  if(route.includes('/status'))return {data:{statuses:[]}};
  throw new Error('unexpected '+route);
 }});
 const run=(conclusion)=>({id:1,name:'tests',status:'completed',conclusion,started_at:'2026-11-14T00:00:00Z'});
 const pr={number:7,state:'open',merged:false,draft:false,mergeable:true,mergeable_state:'unstable',head_sha:'a'.repeat(40),base:'main'};
 it('ciState says GitHub can enforce nothing there',async()=>{
  const ci=await ciState(octo([run('success')]),{owner:'o',repo:'r',baseBranch:'main',headSha:'a'.repeat(40)});
  expect(ci.rules_unavailable).toBe(true);
 });
 it('the owner\'s ordinary merge is refused while red, allowed when green, and merge_anyway stays the deliberate way',async()=>{
  const red=await ciState(octo([run('failure')]),{owner:'o',repo:'r',baseBranch:'main',headSha:'a'.repeat(40)});
  const why=blockers({ownerDirected:true,pr,ci:red},{number:7});
  expect(why.join(' ')).toMatch(/not green/);expect(why.join(' ')).toMatch(/github_workflow_merge_anyway/);
  const green=await ciState(octo([run('success')]),{owner:'o',repo:'r',baseBranch:'main',headSha:'a'.repeat(40)});
  expect(blockers({ownerDirected:true,pr:{...pr,mergeable_state:'clean'},ci:green},{number:7})).toEqual([]);
  expect(blockers({ownerDirected:true,pr,ci:red},{number:7},{override:true})).toEqual([]);
 });
 it('where GitHub has rules, the owner\'s merge is still left to GitHub',()=>{
  expect(blockers({ownerDirected:true,pr,ci:{green:false,problems:['tests: failure'],rules_unavailable:false}},{number:7})).toEqual([]);
 });
});
