import {customCredentialRanges} from './custom-secret-rules.js';
import {OPEN_SECRET_RULE_IDS} from './open-secret-rules.js';
// Tenant/account/repository policy. File-read exceptions remain pinned to an exact blob and finding.
import {createHash} from 'node:crypto';
import {containsBuiltinCredential} from './content-protection.js';
export const SCANNER_RULE_IDS=['github_personal_access_token','github_oauth_or_app_token','slack_api_token','private_key','aws_access_key_id','aws_secret_key_assignment','database-uri-password','database-connection-password','database-password-assignment','robinson-rtc-pass','robinson-tenant-bearer','github-token','github-fine-grained-token','private-key','cloud-secret-assignment','generic-credential-assignment',...OPEN_SECRET_RULE_IDS];
const STR={type:'string',minLength:1,maxLength:80};
export const SCANNER_SETTINGS_SCHEMA={type:'object',additionalProperties:false,properties:{
 additionalRules:{type:'array',maxItems:8,items:{type:'object',additionalProperties:false,properties:{id:{type:'string',pattern:'^custom_[a-z][a-z0-9_]{1,39}$'},label:STR,type:{type:'string',enum:['prefix','assignment']},prefix:{type:'string',pattern:'^[A-Za-z][A-Za-z0-9_-]{2,31}$'},keys:{type:'array',minItems:1,maxItems:8,uniqueItems:true,items:{type:'string',pattern:'^[A-Za-z][A-Za-z0-9_.-]{1,63}$'}},alphabet:{type:'string',enum:['alnum','base64url','hex']},minLength:{type:'integer',minimum:1,maximum:128},maxLength:{type:'integer',minimum:1,maximum:4096}},required:['id','label','type','minLength']}},
 disabledRules:{type:'array',maxItems:8,uniqueItems:true,items:STR},
 suppressions:{type:'array',maxItems:20,items:{type:'object',additionalProperties:false,properties:{rule:STR,path:{type:'string',minLength:1,maxLength:1000},blobSha:{type:'string',pattern:'^[a-f0-9]{40}$'},reason:{type:'string',minLength:8,maxLength:200},fileReadException:{type:'boolean'},fingerprint:{type:'string',pattern:'^[a-f0-9]{64}$'}},required:['rule','path','blobSha','reason']}}
}};
export const defaultScannerSettings=()=>({additionalRules:[],disabledRules:[],suppressions:[]});
export const scannerSettingKey=(owner,repo)=>'scanner_'+createHash('sha256').update(JSON.stringify([owner.toLowerCase(),repo.toLowerCase()])).digest('hex').slice(0,32);
const knownKeys=(o,keys)=>Object.keys(o).every(k=>keys.includes(k));
export function scannerSettings(value,base=defaultScannerSettings()) {
 if(!value||typeof value!=='object'||Array.isArray(value)||!knownKeys(value,['additionalRules','disabledRules','suppressions']))throw new TypeError('Use scanner setting fields from github_security_scanner_configure.');
 if(containsBuiltinCredential(JSON.stringify(value)))throw new TypeError('Scanner settings accept rule structure, never credential values.');
 const s={...base,...value};
 if(!Array.isArray(s.additionalRules)||s.additionalRules.length>8||!Array.isArray(s.disabledRules)||s.disabledRules.length>8||!Array.isArray(s.suppressions)||s.suppressions.length>20)throw new TypeError('Scanner policy exceeds its bounded rule/suppression limits.');
 const ids=new Set(SCANNER_RULE_IDS);
 for(const r of s.additionalRules){
  if(!r||!knownKeys(r,['id','label','type','prefix','keys','alphabet','minLength','maxLength'])||!/^custom_[a-z][a-z0-9_]{1,39}$/.test(r.id)||ids.has(r.id)||typeof r.label!=='string'||r.label.length<1||r.label.length>80||!Number.isInteger(r.minLength)||r.minLength<1||r.minLength>128)throw new TypeError('Custom rules need unique custom_ IDs, labels and bounded lengths.');
  ids.add(r.id);
  if(r.type==='prefix'){
   if(!/^[A-Za-z][A-Za-z0-9_-]{2,31}$/.test(r.prefix??'')||r.keys!==undefined||!['alnum','base64url','hex'].includes(r.alphabet)||!Number.isInteger(r.maxLength)||r.maxLength<r.minLength||r.maxLength>4096)throw new TypeError('Prefix rules require a literal prefix, alphabet and min/max lengths; arbitrary regex is unsupported.');
  }else if(r.type==='assignment'){
   if(r.prefix!==undefined||r.alphabet!==undefined||r.maxLength!==undefined||!Array.isArray(r.keys)||r.keys.length<1||r.keys.length>8||new Set(r.keys).size!==r.keys.length||r.keys.some(k=>!/^[A-Za-z][A-Za-z0-9_.-]{1,63}$/.test(k)))throw new TypeError('Assignment rules require 1–8 literal key names.');
  }else throw new TypeError('Use a prefix or assignment rule.');
 }
 if(new Set(s.disabledRules).size!==s.disabledRules.length||s.disabledRules.some(id=>!s.additionalRules.some(r=>r.id===id)))throw new TypeError('Only custom rules may be disabled; built-in false positives require an exact-file suppression.');
 for(const x of s.suppressions)if(!x||!knownKeys(x,['rule','path','blobSha','reason','fileReadException','fingerprint'])||!ids.has(x.rule)||typeof x.path!=='string'||x.path.length>1000||x.path.startsWith('/')||x.path.includes('*')||x.path.split('/').some(p=>!p||p==='.'||p==='..')||/[\\\x00-\x1f?#%]/.test(x.path)||!/^[a-f0-9]{40}$/.test(x.blobSha)||typeof x.reason!=='string'||x.reason.length<8||x.reason.length>200||x.fileReadException!==undefined&&typeof x.fileReadException!=='boolean'||x.fingerprint!==undefined&&!/^[a-f0-9]{64}$/.test(x.fingerprint)||x.fileReadException===true&&!x.fingerprint)throw new TypeError('Suppressions require an exact relative path, blob SHA, known rule and a reason.');
 return structuredClone(s);
}
export async function loadScannerPolicy(db,owner,repo){
 const raw=await db.getSetting(scannerSettingKey(owner,repo));
 if(raw===null)return {revision:0,settings:defaultScannerSettings(),history:[]};
 if(!raw||!Number.isSafeInteger(raw.revision)||raw.revision<1||!Array.isArray(raw.history)||raw.history.length>10)throw new TypeError('Stored scanner policy is invalid; do not interpret this as a successful scan.');
 return {...raw,settings:scannerSettings(raw.settings)};
}
export function customScannerFindings(text,path,settings){
 return [...customCredentialRanges(text,settings.additionalRules)].map(r=>({path,line:text.slice(0,r.index).split('\n').length,rule:r.rule,kind:r.description,byte_offset:Buffer.byteLength(text.slice(0,r.index)),byte_length:Buffer.byteLength(text.slice(r.index,r.index+r.length)),action:'Review locally; rotate or revoke exposed credentials.'}));
}
export function filterScannerFindings(findings,settings,path,blobSha){
 const kept=[];let disabled=0,suppressed=0;
 for(const f of findings){if(settings.disabledRules.includes(f.rule)){disabled++;continue;}if(settings.suppressions.some(s=>(s.rule===f.rule||f.detector_rules?.includes(s.rule))&&s.path===path&&s.blobSha===blobSha)){suppressed++;continue;}kept.push(f);}
 return {findings:kept,disabled,suppressed};
}
