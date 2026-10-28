import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {makeWorld,parse,runWriteContract} from '../../test/helpers/write-contract.js';
import {createDispatch} from '../../src/tools/dispatch.js';
import {registry} from '../../src/tools/index.js';
import * as settingsTool from '../../src/tools/security-scanner-settings.js';
import {scannerSettingKey} from '../../src/github/scanner-policy.js';
const rule={id:'custom_fixture_token',label:'Fixture credential shape',type:'prefix',prefix:'fixture_',alphabet:'alnum',minLength:12,maxLength:80};
const fixture='fixture_'+'FAKEONLY123456789';
const definition={tool:settingsTool.tools.find(t=>t.name==='github_security_scanner_configure'),handler:settingsTool.handlers.github_security_scanner_configure};
runWriteContract({label:'repository scanner settings',definition,args:{repo:'fixture',expectedRevision:0,changes:{additionalRules:[rule]},reason:'Learn a synthetic project credential shape',verification:[{path:'docs/fixture.md',blobSha:file(fixture).sha,rule:rule.id,door:'scan',expectedBefore:false,expectedAfter:true}]},profile:'full',needsConfirm:false,expectedWrites:0,
 arrange:(gh,result)=>{gh.scannerOutcome=result;gh.when('GET /repos/{owner}/{repo}/git/blobs/{file_sha}').reply(200,file(fixture));},prepare:async w=>{if(w.gh.scannerOutcome==='mismatch')w.db.compareAndSetSetting=async(_k,_r,value)=>value;}});
const dispatch=w=>createDispatch({env:w.ctx.env,credentials:w.credentials,fetch:w.gh.fetch,gates:[],now:w.ctx.now,sleep:w.ctx.sleep});
const call=(w,name,args)=>dispatch(w)({registry,name,args,connection:w.connection,db:w.db});
const configure=async(w,args)=>{
 const payload=w.scannerPayload??file(fixture);if(!w.scannerPayload)arrangeFile(w,payload);
 const suppression=args.changes?.suppressions?.[0],reset=args.rollbackRevision!==undefined;
 const verification=args.verification??[{path:payload.path,blobSha:payload.sha,rule:suppression?.rule??rule.id,...(suppression?.fingerprint?{fingerprint:suppression.fingerprint}:{}),door:suppression?.fileReadException?'file_read':'scan',expectedBefore:!!suppression||reset,expectedAfter:!suppression&&!reset}];
 return call(w,'github_security_scanner_configure',{repo:'fixture',expectedRevision:0,reason:'Refine the reviewed synthetic project fixture',verification,...args});
};
function file(source){const bytes=Buffer.from(source);return {type:'file',path:'docs/fixture.md',sha:createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex'),size:bytes.length,encoding:'base64',content:bytes.toString('base64')};}
function arrangeFile(w,payload){w.scannerPayload=payload;w.gh.when('GET /repos/{owner}/{repo}/contents/{path}').reply(200,payload);w.gh.when('GET /repos/{owner}/{repo}/git/blobs/{file_sha}').reply(200,payload);}
const read=(w,args={})=>call(w,'github_content_get',Object.fromEntries(Object.entries({repo:'fixture',path:'docs/fixture.md',fullText:true,...args}).filter(([,v])=>v!==undefined)));
describe('agent-managed repository scanner policy',()=>{
 it('has one direct compact gateway and routes into normal validated write/read tools',async()=>{
  const w=await makeWorld({profile:'full'});arrangeFile(w,file(fixture));expect(registry.tools.find(t=>t.name==='github_secret_scanner').compact).toBe(true);
  const out=parse(await call(w,'github_secret_scanner',{action:'configure',args:{repo:'fixture',expectedRevision:0,changes:{additionalRules:[rule]},reason:'Learn a reviewed synthetic project shape',verification:[{path:'docs/fixture.md',blobSha:file(fixture).sha,rule:rule.id,door:'scan',expectedBefore:false,expectedAfter:true}]}}));expect(out).toMatchObject({status:'applied',confirmed:true,result:{revision:1}});
  const state=parse(await call(w,'github_secret_scanner',{action:'settings',args:{repo:'fixture'}}));expect(state.settings.additionalRules).toEqual([rule]);
  expect((await w.db.getChange(out.logged.id)).inverse.args).toMatchObject({repo:'fixture',expectedRevision:1});
 });
 it('keeps policies isolated by account, repository and database tenant',async()=>{
  const w=await makeWorld({profile:'full',accounts:['example-org','another-example-org']});await configure(w,{changes:{additionalRules:[rule]}});
  for(const args of [{owner:'example-org',repo:'other'},{owner:'another-example-org',repo:'fixture'}])expect(parse(await call(w,'github_security_scanner_get_settings',args)).revision).toBe(0);
  const otherTenant=await makeWorld({profile:'full'});expect(parse(await call(otherTenant,'github_security_scanner_get_settings',{repo:'fixture'})).revision).toBe(0);
 });
 it('refuses stale changes and supports revision-bound rollback without resetting another repository',async()=>{
  const w=await makeWorld({profile:'full'});await configure(w,{changes:{additionalRules:[rule]}});
  expect((await configure(w,{changes:{additionalRules:[]}})).isError).toBe(true);
  const rolled=parse(await configure(w,{expectedRevision:1,rollbackRevision:0}));expect(rolled).toMatchObject({status:'applied',result:{revision:2,settings:{additionalRules:[]}}});
  expect(parse(await call(w,'github_security_scanner_get_settings',{repo:'other'})).revision).toBe(0);
 });
 it('readonly and full-profile restricted passes cannot change policy through the compact gateway',async()=>{
  for(const opts of [{profile:'read_only'},{profile:'full',delegated:true}]){
   const w=await makeWorld(opts);const out=await call(w,'github_secret_scanner',{action:'configure',args:{repo:'fixture',expectedRevision:0,changes:{additionalRules:[rule]},reason:'Learn a reviewed synthetic project shape',verification:[{path:'docs/fixture.md',blobSha:file(fixture).sha,rule:rule.id,door:'scan',expectedBefore:false,expectedAfter:true}]}});expect(out.isError).toBe(true);expect(await w.db.getSetting(scannerSettingKey('example-org','fixture'))).toBeNull();
  }
 });
 it('previews new rules against committed files without persisting and labels policy source',async()=>{
  const w=await makeWorld({profile:'full'});arrangeFile(w,file(fixture));
  const out=parse(await call(w,'github_secret_scanner',{action:'preview',args:{repo:'fixture',paths:['docs/fixture.md'],previewSettings:{additionalRules:[rule]}}}));
  expect(out.findings).toMatchObject([{rule:rule.id}]);expect(out.scanner_policy).toMatchObject({revision:0,source:'preview'});expect(JSON.stringify(out)).not.toContain(fixture);expect(await w.db.getSetting(scannerSettingKey('example-org','fixture'))).toBeNull();
 });
 it('new repository rules protect both scanning and file reads without affecting the other repo',async()=>{
  const w=await makeWorld({profile:'full'});arrangeFile(w,file(fixture));await configure(w,{changes:{additionalRules:[rule]}});
  const output=parse(await read(w));expect(output.content).toBe('[hidden]');expect(output.content_protection.byte_exact_available).toBe(false);
  const byte=await read(w,{fullText:undefined,byteOffset:0,byteLength:5});expect(byte.isError).toBe(true);
  const other=parse(await read(w,{repo:'other'}));expect(other.content).toBe(fixture);
 });
 it('an exact reasoned false-positive exception restores full/byte reads through github_call',async()=>{
  const w=await makeWorld({profile:'full'}),source='Host=example.invalid;Database=sample;Password=FAKE_DOCUMENTED_SAMPLE;';const payload=file(source);arrangeFile(w,payload);
  const report=parse(await call(w,'github_content_protection_check',{repo:'fixture',path:payload.path}));const finding=report.findings[0];expect(finding.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  await configure(w,{changes:{suppressions:[{rule:finding.rule,path:payload.path,blobSha:payload.sha,fingerprint:finding.fingerprint,reason:'Reviewed synthetic documentation fixture',fileReadException:true}]}});
  const out=parse(await call(w,'github_call',{name:'github_content_get',args:{repo:'fixture',path:payload.path,fullText:true}}));expect(out.content).toBe(source);expect(out.content_protection).toMatchObject({content_exact:true,excepted_findings:1});
  const bytes=parse(await read(w,{fullText:undefined,byteOffset:0,byteLength:32768}));expect(Buffer.from(bytes.content_base64,'base64').toString()).toBe(source);
  const other=parse(await read(w,{repo:'other'}));expect(other.content).not.toContain('FAKE_DOCUMENTED_SAMPLE');
 });
 it('changed bytes, wrong fingerprints and report-only suppressions cannot unmask a file',async()=>{
  for(const kind of ['wrong-fingerprint','report-only','changed-bytes']){
   const w=await makeWorld({profile:'full'}),payload=file('Host=example.invalid;Database=sample;Password=FAKE_ORIGINAL;');arrangeFile(w,payload);
   const report=parse(await call(w,'github_content_protection_check',{repo:'fixture',path:payload.path})),finding=report.findings[0];
   await configure(w,{changes:{suppressions:[{rule:finding.rule,path:payload.path,blobSha:payload.sha,fingerprint:kind==='wrong-fingerprint'?'0'.repeat(64):finding.fingerprint,reason:'Reviewed non-secret fixture only',fileReadException:kind!=='report-only'}]}});
   if(kind==='changed-bytes')arrangeFile(w,file('Host=example.invalid;Database=sample;Password=FAKE_CHANGED;'));
   expect((await read(w,{fullText:undefined,byteOffset:0})).isError).toBe(true);
  }
 });
 it('report-only suppression is visible and never disables built-in file output guards',async()=>{
  const w=await makeWorld({profile:'full'});arrangeFile(w,file('Host=example.invalid;Database=sample;Password=FAKE_ONLY;'));
  const p=w.scannerPayload;await configure(w,{changes:{suppressions:[{rule:'database-connection-password',path:p.path,blobSha:p.sha,reason:'Reviewed synthetic fixture, scan reporting only'}]}});
  const out=parse(await call(w,'github_security_scan_files',{repo:'fixture',paths:['docs/fixture.md']}));expect(out.findings).toEqual([]);expect(out.scanner_policy.suppressed_findings).toBe(1);expect(out.repository_clean).toBeNull();
  expect(parse(await read(w)).content).not.toContain('FAKE_ONLY');
 });
 it('request-local exceptions do not bleed into simultaneous unrelated calls',async()=>{
  const w=await makeWorld({profile:'full'}),source='Host=example.invalid;Database=sample;Password=FAKE_ISOLATION;',payload=file(source);arrangeFile(w,payload);
  const report=parse(await call(w,'github_content_protection_check',{repo:'fixture',path:payload.path})),f=report.findings[0];await configure(w,{changes:{suppressions:[{rule:f.rule,path:payload.path,blobSha:payload.sha,fingerprint:f.fingerprint,fileReadException:true,reason:'Reviewed synthetic fixture for scope test'}]}});
  const [a,b]=await Promise.all([read(w),read(w,{repo:'other'})]);expect(parse(a).content).toBe(source);expect(parse(b).content).not.toContain('FAKE_ISOLATION');
 });
 it('rejects arbitrary regex, malformed rules, wildcard exceptions and credential-bearing settings',async()=>{
  for(const changes of [{additionalRules:[{...rule,regex:'(a+)+$'}]},{additionalRules:[{...rule,maxLength:999999}]},{suppressions:[{rule:'private_key',path:'*',blobSha:'a'.repeat(40),reason:'bad scope'}]},{additionalRules:[{...rule,label:'ghp_'+'FAKE'+'a'.repeat(36)}]}]){
   const w=await makeWorld({profile:'full'});expect((await configure(w,{changes})).isError).toBe(true);expect(await w.db.getSetting(scannerSettingKey('example-org','fixture'))).toBeNull();
  }
 });
});

it('rejects an untested tune or a verification that does not prove the changed rule',async()=>{
 for(const verification of [undefined,[{path:'docs/fixture.md',blobSha:file(fixture).sha,rule:rule.id,door:'scan',expectedBefore:false,expectedAfter:false}],[{path:'docs/fixture.md',blobSha:file(fixture).sha,rule:'github-token',door:'scan',expectedBefore:false,expectedAfter:false}]]){
  const w=await makeWorld({profile:'full'});arrangeFile(w,file(fixture));
  const out=await call(w,'github_security_scanner_configure',{repo:'fixture',expectedRevision:0,changes:{additionalRules:[rule]},reason:'Try a synthetic credential shape',...(verification?{verification}:{})});
  expect(out.isError).toBe(true);expect(await w.db.getSetting(scannerSettingKey('example-org','fixture'))).toBeNull();
 }
});
it('offers only portable rules and requires a new destination receipt before adoption',async()=>{
 const w=await makeWorld({profile:'full'});await configure(w,{changes:{additionalRules:[rule]}});
 const p=w.scannerPayload;await configure(w,{expectedRevision:1,changes:{suppressions:[{rule:rule.id,path:p.path,blobSha:p.sha,reason:'Only this source documentation sample'}]}});
 const offer=parse(await call(w,'github_secret_scanner',{action:'offer',args:{repo:'fixture',targetRepo:'next-project'}}));
 expect(offer.portable_profile.additionalRules).toEqual([rule]);expect(offer.portable_profile.file_suppressions_included).toBe(false);
 expect(offer.offer).toMatchObject({applied:false,expectedRevision:0,changes:{additionalRules:[rule]}});expect(offer.offer.changes.suppressions).toBeUndefined();
 expect(await w.db.getSetting(scannerSettingKey('example-org','next-project'))).toBeNull();
 const adopted=parse(await configure(w,{repo:'next-project',changes:offer.offer.changes}));expect(adopted).toMatchObject({status:'applied',confirmed:true,result:{revision:1}});
});
it('records who/when/why and observed before/after in each successful tune receipt',async()=>{
 const w=await makeWorld({profile:'full'}),out=parse(await configure(w,{changes:{additionalRules:[rule]},reason:'Catch the synthetic project-specific marker'}));
 expect(out).toMatchObject({confirmed:true,result:{reason:'Catch the synthetic project-specific marker',changed_by:{client_id:'client-1'},last_verification:[{before_detected:false,after_detected:true,matched_values_returned:false}]}});
 const entry=await w.db.getChange(out.logged.id);expect(entry.before.test).toMatchObject([{before_detected:false,after_detected:true}]);expect(JSON.stringify(entry)).not.toContain(fixture);
});
it('cannot disable a whole built-in rule and keeps the control plane usable with a noisy custom rule',async()=>{
 const w=await makeWorld({profile:'full'});const rejected=await configure(w,{changes:{disabledRules:['github-token']}});expect(rejected.isError).toBe(true);
 const noisy={...rule,id:'custom_additional_word',prefix:'additional',minLength:1,maxLength:80};arrangeFile(w,file('additional'+'FAKEONLY12345'));
 await configure(w,{changes:{additionalRules:[noisy]},verification:[{path:w.scannerPayload.path,blobSha:w.scannerPayload.sha,rule:noisy.id,door:'scan',expectedBefore:false,expectedAfter:true}]});
 const state=parse(await call(w,'github_secret_scanner',{action:'settings',args:{repo:'fixture'}}));expect(state.settings.additionalRules).toEqual([noisy]);
 const reset=parse(await configure(w,{expectedRevision:1,rollbackRevision:0,verification:[{path:w.scannerPayload.path,blobSha:w.scannerPayload.sha,rule:noisy.id,door:'scan',expectedBefore:true,expectedAfter:false}]}));expect(reset.status).toBe('applied');
});
it('applies project rules to other repo-bound results without leaking them into a different repo',async()=>{
 const w=await makeWorld({profile:'full'});await configure(w,{changes:{additionalRules:[rule]}});
 const synthetic={name:'github_fixture_policy_read',area:'repo',annotations:{readOnlyHint:true},readContract:'defineRead-v1',inputSchema:{type:'object',properties:{repo:{type:'string'}},required:['repo']}};
 const combined={...registry,tools:[...registry.tools,synthetic],handlers:{...registry.handlers,[synthetic.name]:()=>({body:fixture})}};
 const run=repo=>dispatch(w)({registry:combined,name:synthetic.name,args:{repo},connection:w.connection,db:w.db});
 const [a,b]=await Promise.all([run('fixture'),run('other')]);expect(parse(a).body).toBe('[hidden]');expect(parse(b).body).toBe(fixture);
});
it('pages diagnostics and exempts one finding without hiding other matches',async()=>{
 const w=await makeWorld({profile:'full'}),source=Array.from({length:34},(_,i)=>`Host=example.invalid;Database=sample;Password=FAKE_ITEM_${i};`).join('\n\n'),payload=file(source);arrangeFile(w,payload);
 const first=parse(await call(w,'github_content_protection_check',{repo:'fixture',path:payload.path,maxFindings:1}));
 expect(first).toMatchObject({total_findings:34,next_finding_offset:1,blocked_findings:34});
 const second=parse(await call(w,'github_content_protection_check',{repo:'fixture',path:payload.path,maxFindings:1,findingOffset:1}));
 expect(second.findings[0].fingerprint).not.toBe(first.findings[0].fingerprint);
 const f=second.findings[0];const out=parse(await configure(w,{changes:{suppressions:[{rule:f.rule,path:payload.path,blobSha:payload.sha,fingerprint:f.fingerprint,fileReadException:true,reason:'Reviewed only the second synthetic match'}]}}));
 expect(out.confirmed).toBe(true);expect((await read(w,{fullText:undefined,byteOffset:0})).isError).toBe(true);
 const after=parse(await call(w,'github_content_protection_check',{repo:'fixture',path:payload.path}));expect(after).toMatchObject({blocked_findings:33,excepted_findings:1});
});
it('can verify and correct an exact-file false positive in a file larger than scan limits',async()=>{
 const w=await makeWorld({profile:'full'}),payload=file('// harmless padding\n'.repeat(6000)+'Host=example.invalid;Database=sample;Password=FAKE_LARGE;');arrangeFile(w,payload);
 const report=parse(await call(w,'github_content_protection_check',{repo:'fixture',path:payload.path})),f=report.findings[0];
 expect(payload.size).toBeGreaterThan(100000);
 const out=parse(await configure(w,{changes:{suppressions:[{rule:f.rule,path:payload.path,blobSha:payload.sha,fingerprint:f.fingerprint,fileReadException:true,reason:'Reviewed synthetic match in a larger code file'}]}}));
 expect(out.confirmed).toBe(true);expect((await read(w,{fullText:undefined,byteOffset:0})).isError).not.toBe(true);
});
it('keeps identical text protected in another repository within a nested workflow',async()=>{
 const w=await makeWorld({profile:'full'}),source='Host=example.invalid;Database=sample;Password=FAKE_NESTED;',payload=file(source);arrangeFile(w,payload);
 const f=parse(await call(w,'github_content_protection_check',{repo:'fixture',path:payload.path})).findings[0];
 await configure(w,{changes:{suppressions:[{rule:f.rule,path:payload.path,blobSha:payload.sha,fingerprint:f.fingerprint,fileReadException:true,reason:'Reviewed only this repository synthetic match'}]}});
 const sibling={name:'github_fixture_sibling',area:'repo',annotations:{readOnlyHint:true},readContract:'defineRead-v1',inputSchema:{type:'object',properties:{repo:{type:'string'}},required:['repo']}};
 const flow={name:'github_fixture_nested',area:'workflow',usesRegistry:true,passthrough:true,inputSchema:{type:'object',properties:{}}};
 const combined={...registry,tools:[...registry.tools,sibling,flow],handlers:{...registry.handlers,[sibling.name]:()=>({body:source}),[flow.name]:async(_a,c)=>{const allowed=await c.callTool('github_content_get',{repo:'fixture',path:payload.path,fullText:true});const other=await c.callTool(sibling.name,{repo:'other'});return {content:[{type:'text',text:JSON.stringify({allowed:parse(allowed),other:parse(other)})}]};}}};
 const out=parse(await dispatch(w)({registry:combined,name:flow.name,args:{},connection:w.connection,db:w.db}));expect(out.allowed.content).toBe(source);expect(out.other.body).not.toContain('FAKE_NESTED');
});
