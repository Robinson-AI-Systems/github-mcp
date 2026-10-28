import {containsBuiltinCredential} from '../github/content-protection.js';
import {createHash} from 'node:crypto';
import {verifyScannerChanges,assertScannerVerifications,VERIFICATION_SCHEMA} from './scanner-verification.js';
import {isOwnerConnection} from '../core/authority.js';
import {defineRead} from './define-read.js';
import {defineGithubWrite} from './define-github-write.js';
import {ownerOf} from './github-write.js';
import {SCANNER_RULE_IDS,SCANNER_SETTINGS_SCHEMA,stableScannerJson,defaultScannerSettings,scannerSettings,scannerSettingKey,loadScannerPolicy} from '../github/scanner-policy.js';
const OWNER={type:'string',minLength:1,maxLength:39};
const REPO={type:'string',minLength:1,maxLength:100,pattern:'^[A-Za-z0-9_.-]+$'};
const REVISION={type:'integer',minimum:0,maximum:2147483646};
const target=(a,c)=>{
 const owner=ownerOf(a,c);if(!c.connection.accounts?.some(x=>x.toLowerCase()===owner.toLowerCase()))throw new TypeError('Scanner account is outside this connection.');
 if(!/^[A-Za-z0-9_.-]{1,100}$/.test(a.repo??''))throw new TypeError('Name the exact repository for these scanner settings.');
 return {owner,repo:a.repo,scope:'repo',kind:'scanner-settings'};
};
const candidateSettings=(a,b)=>{if(a.rollbackRevision===undefined)return scannerSettings(a.changes,b.settings);const prior=a.rollbackRevision===0?{settings:defaultScannerSettings()}:b.history.find(h=>h.revision===a.rollbackRevision);if(!prior)throw new TypeError('Rollback revision is not retained; revision 0 restores defaults.');return scannerSettings(prior.settings);};
const summary=p=>({revision:p.revision,settings:p.settings,history:p.history.map(x=>({revision:x.revision,changed_at:x.changed_at,reason:x.reason??null,changed_by:x.changed_by??null})),
 builtin_rules:SCANNER_RULE_IDS,last_verification:p.verification_receipts??null,changed_by:p.changed_by??null,reason:p.reason??null,scope:'this repository in this tenant',file_output_protection:'built-in rules enforced except explicitly reasoned exact-blob/finding file-read exceptions',
 custom_rule_effect:'scan findings and committed-file protection; reporting-only disabled rules do not turn off built-in output guards',repository_clean:null});
const get=defineRead({name:'github_security_scanner_get_settings',area:'security',audience:['B','O','Op'],description:'Read repository-scoped scanner rules, exact-blob suppressions and rollback revisions; no credential values.',properties:{owner:OWNER,repo:REPO,targetOwner:OWNER,targetRepo:REPO},required:['repo'],
 handler:async(a,c)=>{
  const t=target(a,c),p=await loadScannerPolicy(c.db,t.owner,t.repo),portable={version:1,source:{owner:t.owner,repo:t.repo,revision:p.revision},additionalRules:p.settings.additionalRules};
  const result={...summary(p),portable_profile:{...portable,fingerprint:createHash('sha256').update(stableScannerJson(portable)).digest('hex'),file_suppressions_included:false}};
  if(a.targetOwner&&!a.targetRepo)throw new TypeError('Offering a profile requires targetRepo.');
  if(a.targetRepo){
   if(!isOwnerConnection(c.connection))throw new TypeError('Only the full owner may offer a profile across repositories.');
   const destination=target({owner:a.targetOwner??t.owner,repo:a.targetRepo},c),current=await loadScannerPolicy(c.db,destination.owner,destination.repo),merged=[...current.settings.additionalRules];
   for(const rule of p.settings.additionalRules){const old=merged.find(r=>r.id===rule.id);if(old&&stableScannerJson(old)!==stableScannerJson(rule))throw new TypeError('Destination has a different rule under the same ID; rename or review it explicitly.');if(!old)merged.push(rule);}
   scannerSettings({additionalRules:merged},current.settings);
   result.offer={owner:destination.owner,repo:destination.repo,expectedRevision:current.revision,changes:{additionalRules:merged},applied:false,requires:'A destination pinned-file verification and reason before github_security_scanner_configure. No suppression or output exception is copied.'};
  }
  return result;
 }});
const configure=defineGithubWrite({name:'github_security_scanner_configure',area:'security',audience:['O'],description:'Change or roll back scanner reporting rules and exact-file exceptions at an expected revision; no blanket output bypass.',
 properties:{owner:OWNER,repo:REPO,expectedRevision:REVISION,changes:SCANNER_SETTINGS_SCHEMA,rollbackRevision:REVISION,reason:{type:'string',minLength:8,maxLength:200},verification:{type:'array',minItems:1,maxItems:32,items:VERIFICATION_SCHEMA}},required:['repo','expectedRevision','reason','verification'],declarations:{profiles:['full'],production:'never',confirm:'when-needed'},
 target:(a,c)=>{if(containsBuiltinCredential(a.reason??''))throw new TypeError('Tuning reasons must not contain credential values.');if(!isOwnerConnection(c.connection))throw new TypeError('Only the full ordinary repository owner may change scanner settings; restricted passes cannot.');if((a.changes===undefined)===(a.rollbackRevision===undefined))throw new TypeError('Provide changes or rollbackRevision, exclusively.');return target(a,c);},
 classifyError:error=>error instanceof TypeError?'rejected':'uncertain',
 read:async(a,c,t)=>{const p=await loadScannerPolicy(c.db,t.owner,t.repo);return {...p,test:await verifyScannerChanges(c,t,p.settings,candidateSettings(a,p),a.verification)};},
 classify:()=>({}),summarize:({args:a,target:t})=>`${a.rollbackRevision===undefined?'Update':'Roll back'} scanner reporting for ${t.owner}/${t.repo} from revision ${a.expectedRevision}; exact-file exceptions are explicit and version-bound`,
 apply:async({args:a,ctx:c,target:t,before:b})=>{
  if(b.revision!==a.expectedRevision)throw new TypeError('Scanner settings changed; no overwrite was made. Read the current revision first.');
  const settings=candidateSettings(a,b);
  const verification_receipts=await verifyScannerChanges(c,t,b.settings,settings,a.verification);assertScannerVerifications(b.settings,settings,verification_receipts);
  const changed_at=new Date((c.now??Date.now)()).toISOString();
  const value={revision:b.revision+1,settings,changed_at,reason:a.reason,changed_by:{client_id:c.connection.client_id,actor:c.actor?.summary?.()?.as??'authenticated owner'},verification_receipts,history:[...b.history,{revision:b.revision,settings:b.settings,changed_at:b.changed_at??null,reason:b.reason??null,changed_by:b.changed_by??null}].slice(-10)};
  const saved=await c.db.compareAndSetSetting(scannerSettingKey(t.owner,t.repo),b.revision,value);if(!saved)throw new TypeError('Scanner settings changed concurrently; no overwrite was made.');return {revision:value.revision,settings};
 },readAfter:async({args:a,ctx:c,target:t,before:b})=>{const p=await loadScannerPolicy(c.db,t.owner,t.repo);return {...p,post_verification:await verifyScannerChanges(c,t,b.settings,p.settings,a.verification)};},
 verify:({after:a,response:r})=>a.revision===r.revision&&stableScannerJson(a.settings)===stableScannerJson(r.settings)&&a.post_verification.every(c=>c.after_detected===c.expected_after&&c.before_detected===c.expected_before),
 inverse:({before:b,after:a,target:t})=>({tool:'github_security_scanner_configure',args:{owner:t.owner,repo:t.repo,expectedRevision:a.revision,changes:b.settings,reason:'Restore the previous journaled scanner configuration',verification:b.test.map(c=>({path:c.path,blobSha:c.blobSha,rule:c.rule,...(c.fingerprint?{fingerprint:c.fingerprint}:{}),door:c.door,expectedBefore:c.after_detected,expectedAfter:c.before_detected}))}}),present:({after:a})=>summary(a)});
const gateway={name:'github_secret_scanner',area:'security',audience:['B','O','Op'],compact:true,usesRegistry:true,passthrough:true,
 description:'Secret scanner: settings, scan/preview, configure, rollback or offer a profile. Detailed schemas load on demand.',
 guidance:'Describe github_security_scanner_get_settings for settings/profile offers; github_security_scan_files for scan/preview; github_security_scanner_configure for changes/rollback. Call this gateway with action and those arguments. Every change needs a reason and pinned verification cases; no secret values.',
 inputSchema:{type:'object',properties:{action:{type:'string',enum:['settings','scan','preview','configure','rollback','offer']},args:{type:'object',additionalProperties:true}},required:['action'],additionalProperties:false},
 annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:true}};
export const tools=[get.tool,configure.tool,gateway];
export const handlers={
 [get.tool.name]:get.handler,[configure.tool.name]:configure.handler,
 [gateway.name]:async(a,c)=>{
  const tool={settings:get.tool.name,offer:get.tool.name,scan:'github_security_scan_files',preview:'github_security_scan_files',configure:configure.tool.name,rollback:configure.tool.name}[a.action];
  if(!tool)throw new TypeError('Choose settings, scan, preview, configure or rollback.');
  if(a.action==='offer'&&!a.args?.targetRepo)throw new TypeError('Offer requires source repo and targetRepo; nothing is automatically copied.');
  if(a.action==='preview'&&a.args?.previewSettings===undefined)throw new TypeError('Preview requires previewSettings; describe github_security_scan_files for its schema.');
  if(a.action==='rollback'&&a.args?.rollbackRevision===undefined)throw new TypeError('Rollback requires expectedRevision and rollbackRevision.');
  if(a.action==='configure'&&a.args?.changes===undefined)throw new TypeError('Configure requires expectedRevision and changes.');
  return c.callTool(tool,a.args??{});
 }
};
