import {containsBuiltinCredential} from '../github/content-protection.js';
import {createHash} from 'node:crypto';
import {verifyScannerChanges,assertScannerVerifications,VERIFICATION_SCHEMA} from './scanner-verification.js';
import {isOwnerConnection} from '../core/authority.js';
import {defineRead} from './define-read.js';
import {defineGithubWrite} from './define-github-write.js';
import {ownerOf} from './github-write.js';
import {githubFor} from '../github/client.js';
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
// SCANNER-ALLOW-1 (2026-11-14): allowing a push the scanner refused for a false positive took an agent four tries,
// each refusal naming one more required field (expectedRevision, the verification case, door, valueFingerprint...).
// "allow" builds the whole exception from the guard's own findings in one call, and "describe" gives every action's
// full arguments and a worked example up front, like github_describe_tool does for other tools.
const ALLOW_ARGS={type:'object',additionalProperties:false,properties:{owner:OWNER,repo:REPO,path:{type:'string',minLength:1,maxLength:1000,description:'The refused file, as in the push refusal.'},blobSha:{type:'string',pattern:'^[a-fA-F0-9]{40}$',description:'The refused file\'s blob SHA (in the push refusal). Omit for a committed file to use the one on the default branch.'},rule:{type:'string',maxLength:80,description:'Only findings of this rule (default: every finding in the file).'},reason:{type:'string',minLength:8,maxLength:200,description:'Why this is not a secret, in plain words (no values).'}},required:['repo','path','reason']};
const ACTIONS={
 settings:{tool:'github_security_scanner_get_settings',what:'Read this repo\'s scanner rules, exceptions and revision.',example:{action:'settings',args:{repo:'my-app'}}},
 check:{tool:'github_content_protection_check',what:'List a file\'s findings (rule, line, fingerprint, value_fingerprint) without values; works for a push that was refused (pass its blobSha).',example:{action:'check',args:{repo:'my-app',path:'lib/auth.mjs',blobSha:'<40-hex blob sha from the refusal>'}}},
 allow:{tool:'(this gateway)',what:'ONE CALL to let a refused push through for a false positive: reads the file\'s findings, then adds exact push exceptions (this path, this blob, these values only) with their verification at the current revision. Owner only. The next push re-checks every byte; a changed line needs allowing again.',arguments:ALLOW_ARGS,example:{action:'allow',args:{repo:'my-app',path:'components/SignIn.tsx',blobSha:'<40-hex blob sha from the refusal>',reason:'Password box on the sign-in form; no secret value.'}}},
 scan:{tool:'github_security_scan_files',what:'Scan committed files with this repo\'s rules.',example:{action:'scan',args:{repo:'my-app',paths:['lib/auth.mjs']}}},
 preview:{tool:'github_security_scan_files',what:'Scan with proposed settings without saving them (needs previewSettings).',example:{action:'preview',args:{repo:'my-app',paths:['lib/auth.mjs'],previewSettings:{additionalRules:[]}}}},
 configure:{tool:'github_security_scanner_configure',what:'Full control: add/remove rules and exceptions at an expected revision, each change proven by a pinned verification case.',example:{action:'configure',args:{repo:'my-app',expectedRevision:0,reason:'Fake test value in a fixture',changes:{addSuppressions:[{rule:'generic-credential-assignment',path:'test/fixture.js',blobSha:'<40-hex>',reason:'Fake test value',pushException:true,valueFingerprint:'<64-hex value_fingerprint from check>'}]},verification:[{path:'test/fixture.js',blobSha:'<40-hex>',rule:'generic-credential-assignment',valueFingerprint:'<same 64-hex>',door:'push',expectedBefore:true,expectedAfter:false}]}}},
 rollback:{tool:'github_security_scanner_configure',what:'Restore an earlier revision.',example:{action:'rollback',args:{repo:'my-app',expectedRevision:2,rollbackRevision:1,reason:'Undo the last change',verification:['<one case per exception that changes, as in configure>']}}},
 offer:{tool:'github_security_scanner_get_settings',what:'Offer this repo\'s custom rules to another repo (nothing copied until configured there).',example:{action:'offer',args:{repo:'my-app',targetRepo:'next-app'}}},
 describe:{tool:'(this gateway)',what:'This list: every action with its full arguments and an example.',example:{action:'describe'}}
};
const parseInner=res=>{const text=res?.content?.[0]?.text;let body=null;try{body=text?JSON.parse(text):null;}catch{body=null;}return {body,text,isError:!!res?.isError};};
async function allowFalsePositive(a,c){
 const args=a.args??{};
 for(const k of Object.keys(args))if(!(k in ALLOW_ARGS.properties))throw new TypeError(`allow does not take ${k}; it takes ${Object.keys(ALLOW_ARGS.properties).join(', ')}.`);
 const missing=ALLOW_ARGS.required.filter(k=>args[k]===undefined||args[k]==='');
 if(missing.length)throw new TypeError(`allow needs ${missing.join(', ')} (all at once: repo, path, reason; plus blobSha from the push refusal for a file not yet on GitHub).`);
 if(typeof args.reason!=='string'||args.reason.length<8||args.reason.length>200)throw new TypeError('reason must be 8–200 characters, in plain words, with no secret values.');
 const t=target(args,c);
 const check=parseInner(await c.callTool('github_content_protection_check',{owner:t.owner,repo:t.repo,path:args.path,...(args.blobSha?{blobSha:args.blobSha.toLowerCase()}:{}),...(args.rule?{rule:args.rule}:{})}));
 if(check.isError||!check.body)throw new TypeError(`Could not read the file's findings: ${String(check.text??'no answer').slice(0,300)}`);
 const blobSha=(check.body.sha??args.blobSha??'').toLowerCase();
 const findings=(check.body.findings??[]).filter(f=>f&&typeof f.rule==='string'&&/^[a-f0-9]{64}$/.test(f.value_fingerprint??'')&&(!args.rule||f.rule===args.rule));
 if(!findings.length)throw new TypeError('That file has no finding to allow (it is not blocked, or the rule given does not match). Nothing was changed.');
 const policy=await loadScannerPolicy(c.db,t.owner,t.repo);
 const have=s=>policy.settings.suppressions.some(x=>x.rule===s.rule&&x.path===s.path&&x.blobSha===s.blobSha&&x.valueFingerprint===s.valueFingerprint);
 const unique=new Map();for(const f of findings)unique.set(`${f.rule}|${f.value_fingerprint}`,f);
 const add=[...unique.values()].map(f=>({rule:f.rule,path:args.path,blobSha,reason:args.reason,pushException:true,valueFingerprint:f.value_fingerprint})).filter(s=>!have(s));
 if(!add.length)return {content:[{type:'text',text:JSON.stringify({already_allowed:true,path:args.path,blobSha,revision:policy.revision,next:'Push again; these exact values are already allowed.'})}]};
 if(policy.settings.suppressions.length+add.length>20)throw new TypeError(`This repo already has ${policy.settings.suppressions.length} of 20 exceptions; remove stale ones (configure with removeSuppressions) first.`);
 const verification=add.map(s=>({path:s.path,blobSha:s.blobSha,rule:s.rule,valueFingerprint:s.valueFingerprint,door:'push',expectedBefore:true,expectedAfter:false}));
 return c.callTool(configure.tool.name,{owner:t.owner,repo:t.repo,expectedRevision:policy.revision,changes:{addSuppressions:add},reason:args.reason,verification});
}
// Owner feedback 2026-11-15: "allow" without owner used the connection's default account (a personal account) for a repo
// that lives in the organization, and failed with a bare 404 although the call was otherwise right. When owner is left
// out and the connection has more than one account, use the account that actually has the repo: the default first,
// then the others. Nothing changes when owner is given or only one account matches nothing.
async function withOwner(args,c){
 if(!args||typeof args!=='object'||args.owner!==undefined||typeof args.repo!=='string'||!args.repo)return args;
 const accounts=c.connection?.accounts??[],first=c.connection?.default_account;
 if(accounts.length<2)return args;
 const order=[first,...accounts.filter(x=>x!==first)].filter(Boolean);
 for(const owner of order){
  // One plain GET per account (github_repo_get would also read rules and properties).
  try{const o=await githubFor(c,{owner});const r=await o.request('GET /repos/{owner}/{repo}',{owner,repo:args.repo});if(r?.status===200)return {...args,owner};}catch{continue;}
 }
 return args;
}
const gateway={name:'github_secret_scanner',area:'security',audience:['B','O','Op'],compact:true,usesRegistry:true,passthrough:true,
 description:'Secret scanner: allow a refused push\'s false positive in one call; settings, scan, check, configure, rollback. action describe lists all arguments.',
 guidance:'action "describe" returns every action with its full arguments and an example. A push refused for a false positive or a fake test value: action "allow" with {repo, path, blobSha (from the refusal), reason} — one call, nothing to look up. Otherwise: github_security_scanner_get_settings for settings/offer; github_security_scan_files for scan/preview; github_content_protection_check for check; github_security_scanner_configure for configure/rollback (every change needs a reason and pinned verification cases). Never put secret values in any argument.',
 inputSchema:{type:'object',properties:{action:{type:'string',enum:['describe','allow','settings','scan','preview','check','configure','rollback','offer']},args:{type:'object',additionalProperties:true}},required:['action'],additionalProperties:false},
 annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:true}};
export const tools=[get.tool,configure.tool,gateway];
export const handlers={
 [get.tool.name]:get.handler,[configure.tool.name]:configure.handler,
 [gateway.name]:async(a,c)=>{
  if(a.action==='describe'){
   // Compact by default (every action: what, required arguments, example — about 3 KB); args.action asks for one
   // action's full argument schema. The first version returned every full schema at once (about 20 KB).
   const schemaOf=info=>info.arguments??(info.tool===configure.tool.name?configure.tool.inputSchema:info.tool===get.tool.name?get.tool.inputSchema:c.registry?.tools?.find(t=>t.name===info.tool)?.inputSchema);
   const one=a.args?.action;
   if(one!==undefined){
    const info=ACTIONS[one];if(!info)throw new TypeError(`No action ${String(one).slice(0,40)}; choose one of ${Object.keys(ACTIONS).join(', ')}.`);
    const schema=schemaOf(info);
    return {content:[{type:'text',text:JSON.stringify({action:one,what:info.what,tool:info.tool,...(schema?{arguments:schema,required:schema.required??[]}:{}),example:info.example})}]};
   }
   const actions={};
   for(const [name,info] of Object.entries(ACTIONS)){const schema=schemaOf(info);actions[name]={what:info.what,...(schema?{required:schema.required??[]}:{}),example:info.example};}
   return {content:[{type:'text',text:JSON.stringify({how:'Call github_secret_scanner with {action, args}. For one action\'s full arguments: {action:"describe", args:{action:"<name>"}}.',actions,never:'No secret value in any argument; exceptions are tied to an exact path, blob and value.'})}]};
  }
  a={...a,args:await withOwner(a.args,c)};
  if(a.action==='allow')return allowFalsePositive(a,c);
  const tool={settings:get.tool.name,offer:get.tool.name,scan:'github_security_scan_files',preview:'github_security_scan_files',check:'github_content_protection_check',configure:configure.tool.name,rollback:configure.tool.name}[a.action];
  if(!tool)throw new TypeError('Choose describe, allow, settings, scan, preview, check, configure, rollback or offer.');
  if(a.action==='offer'&&!a.args?.targetRepo)throw new TypeError('Offer requires source repo and targetRepo; nothing is automatically copied.');
  if(a.action==='preview'&&a.args?.previewSettings===undefined)throw new TypeError('Preview requires previewSettings; describe github_security_scan_files for its schema.');
  if(a.action==='rollback'&&a.args?.rollbackRevision===undefined)throw new TypeError('Rollback requires expectedRevision and rollbackRevision.');
  if(a.action==='configure'&&a.args?.changes===undefined)throw new TypeError('Configure requires expectedRevision and changes.');
  return c.callTool(tool,a.args??{});
 }
};
