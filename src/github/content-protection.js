import {openSecretMatches} from './open-secret-rules.js';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash} from 'node:crypto';
// Provider credential detection shared by output shaping and pre-truncation text boundaries.
import {HIDDEN,assignedLiteral} from './secret-literals.js';
import {customCredentialRanges} from './custom-secret-rules.js';
export {HIDDEN,assignedLiteral} from './secret-literals.js';
// GitHub's stateless installation tokens (2026) are JWTs: `ghs_` + three base64url parts joined by dots (~520 characters),
// so a token shape must include `.`, `-` and `_` or redaction would stop at the first dot and leave the rest visible.
const TOKEN_SHAPES = [/rtc_pass_[A-Za-z0-9_-]{43,}/g, /\b(?:tac|trf)_[A-Za-z0-9_-]{40,}/g, /gh[pousr]_[A-Za-z0-9._-]{4,}/g, /github_pat_[A-Za-z0-9_]{4,}/g, /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g];
const RULE_INFO = [
  ['robinson-rtc-pass', 'Robinson RTC pass (43-character issued suffix)'],
  ['robinson-tenant-bearer', 'Robinson tenant access or refresh credential'],
  ['github-token', 'GitHub token prefix and payload'],
  ['github-fine-grained-token', 'GitHub fine-grained personal token'],
  ['private-key', 'Private key block']
];

// Only credential-bearing structures are matched; ordinary identifiers are not secrets.
const DATABASE_URI = /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|rediss?|mssql|sqlserver):\/\/[^\s/?#"'`<>]+/gi;
const PASSWORD_FIELD = /\b(?:password|pwd)["']?[ \t]*[:=](?![=>])[ \t]*/gi;
const DATABASE_FIELD = /\b(?:host|server|data source|database|initial catalog|user ?id|username|uid|port)["']?[ \t]*[:=]/i;
const CLOUD_VARIABLE=/\b(?:AWS_SECRET_ACCESS_KEY|AZURE_STORAGE_ACCOUNT_KEY|AZURE_STORAGE_KEY)["']?[ \t]*[:=][ \t]*/g;
const DATABASE_VARIABLE = /\b(?:db|database|postgres(?:ql)?|mysql|mariadb|mongo(?:db)?|redis|mssql|sqlserver|pg)_?(?:password|pass)\b["']?[ \t]*[:=](?![=>])[ \t]*/gi;

/** Return a literal's range, excluding quote delimiters. Never evaluate code or expand variables. */
function* databaseMatches(text) {
 for (const m of text.matchAll(DATABASE_URI)) {
  const first = m[0].indexOf('://')+3, at = m[0].lastIndexOf('@'), colon = m[0].indexOf(':',first);
  if (at > colon && colon >= first && at > colon+1 && m[0].slice(colon+1,at)!==HIDDEN) yield { index:m.index+colon+1,length:at-colon-1,rule:'database-uri-password',description:'Password in a database connection URI' };
 }
 for (const m of text.matchAll(PASSWORD_FIELD)) {
  const start = Math.max(0,m.index-1024), end = Math.min(text.length,m.index+1024);
  const window=text.slice(start,end),relative=m.index-start;let low=0,high=window.length;
  for(const blank of window.matchAll(/\r?\n[ \t]*\r?\n/g)){if(blank.index+blank[0].length<=relative)low=blank.index+blank[0].length;else if(blank.index>=relative){high=blank.index;break;}}
  const context=window.slice(low,high);
  if (!/[;,]/.test(context) || !DATABASE_FIELD.test(context)) continue;
  const value = assignedLiteral(text,m.index+m[0].length,{allowExpressions:true});
  if (value.length) yield { ...value,rule:'database-connection-password',description:'Password or Pwd in a database connection string' };
 }
 for (const m of text.matchAll(DATABASE_VARIABLE)) {
  const value = assignedLiteral(text,m.index+m[0].length);
  if (value.length) yield { ...value,rule:'database-password-assignment',description:'Explicit database password assignment' };
 }
}
// Generic key/value detection is adapted from the corpus's generic-api-key concept,
// restricted to explicit key names, quoted literals and an entropy threshold to reduce code false positives.
const GENERIC_ASSIGNMENT=/\b(?:password|passwd|api_?key|access_token|refresh_token|client_secret|secret_key|auth_token)\b["']?[ \t]*[:=][ \t]*(?=["'])/gi;
function entropy(value){const counts=new Map();for(const c of value)counts.set(c,(counts.get(c)??0)+1);let h=0;for(const n of counts.values()){const p=n/value.length;h-=p*Math.log2(p);}return h;}
function* credentialMatches(text) {
 const seen=text.length<=1000000?new Set():null;
 function* remember(matches){for(const r of matches){seen?.add(`${r.index}:${r.length}`);yield r;}}
 for(const m of text.matchAll(CLOUD_VARIABLE)){const value=assignedLiteral(text,m.index+m[0].length);if(value.length>=40)yield* remember([{...value,rule:'cloud-secret-assignment',description:'Assigned cloud provider secret or storage key'}]);}
 for(let index=0;index<TOKEN_SHAPES.length;index++)for(const m of text.matchAll(TOKEN_SHAPES[index]))yield* remember([{index:m.index,length:m[0].length,rule:RULE_INFO[index][0],description:RULE_INFO[index][1]}]);
 yield* remember(databaseMatches(text));yield* remember(openSecretMatches(text));
 for(const m of text.matchAll(GENERIC_ASSIGNMENT)){const value=assignedLiteral(text,m.index+m[0].length);if(value.length>=10&&!seen?.has(`${value.index}:${value.length}`)&&entropy(text.slice(value.index,value.index+value.length))>=3.5)yield {...value,rule:'generic-credential-assignment',description:'High-entropy literal assigned to an explicit credential key'};}
}
function reportMatches(text,matches,{maxFindings=30}={}) {
 const findings=[];let total=0;
 for (const match of matches) {
  total++;if(findings.length>=maxFindings)continue;
  const prefix=text.slice(0,match.index);
  findings.push({rule:match.rule,description:match.description,line:prefix.split('\n').length,
   column:Array.from(prefix.slice(prefix.lastIndexOf('\n')+1)).length+1,column_unit:'unicode_code_points',
   byte_offset:Buffer.byteLength(prefix),byte_length:Buffer.byteLength(text.slice(match.index,match.index+match.length)),
   classification:'format_match',credential_validity:'not_checked'});
 }
 return {detector_revision:'2026-10-28.2',total_findings:total,findings,findings_truncated:total>findings.length,matched_values_returned:false,
  byte_exact_available:total===0,note:'Format detection only; no match does not prove that a file contains no secrets.'};
}
/** Same matchers as redaction; locations/rules only, NEVER values or snippets. */
export function contentProtectionReport(value,options={}) {const text=String(value);return reportMatches(text,credentialMatches(text),options);}
export function activeProtectionReport(value,options={}){const text=String(value);return reportMatches(text,(function*(){yield* credentialMatches(text);yield* customCredentialRanges(text,protectionContext.getStore()?.rules??[]);})(),options);}
export function databaseProtectionReport(value,options={}) {const text=String(value);return reportMatches(text,databaseMatches(text),options);}
const protectionContext=new AsyncLocalStorage();
const textKey=text=>createHash('sha256').update(text).digest('hex');
const rangeKey=(rule,offset,length)=>JSON.stringify([rule,offset,length]);
export const withProtectionContext=fn=>protectionContext.getStore()?fn():protectionContext.run({files:new Map(),repositories:new Map(),rules:[]},fn);
export const withRepositoryProtection=(rules,fn,{isolateFiles=false,repository}={})=>{
 const parent=protectionContext.getStore(),repositories=isolateFiles?new Map():parent?.repositories??new Map();
 let files=isolateFiles?new Map():parent?.files??new Map(),publish=parent?.publish;
 if(repository){if(!repositories.has(repository))repositories.set(repository,new Map());files=repositories.get(repository);publish=parent?.publish??parent?.files;}
 return protectionContext.run({files,repositories,publish:isolateFiles?undefined:publish,rules},fn);
};
export const containsBuiltinCredential=value=>withRepositoryProtection([],()=>containsCredential(value),{isolateFiles:true});
export const credentialRanges=text=>[...credentialMatches(String(text))];
export function registerFileProtection(text,entry){const state=protectionContext.getStore();if(!state||!entry.exceptions?.size)return;const key=textKey(text);for(const context of new Set([state.files,state.publish].filter(Boolean))){const old=context.get(key);context.set(key,{exceptions:new Set([...(old?.exceptions??[]),...entry.exceptions])});}}
function* effectiveRanges(text){
 const files=protectionContext.getStore()?.files,entry=files?.size?files.get(textKey(text)):undefined;
 for(const r of (function*(){yield* credentialMatches(text);yield* customCredentialRanges(text,protectionContext.getStore()?.rules??[]);})())if(!entry?.exceptions?.has(rangeKey(r.rule,Buffer.byteLength(text.slice(0,r.index)),Buffer.byteLength(text.slice(r.index,r.index+r.length)))))yield r;
}
/** Only exact contiguous views of a verified file inherit its position-bound exceptions. */
export function registerFileView(view,original){
 const context=protectionContext.getStore()?.files,entry=context?.get(textKey(original));if(!entry||view===original)return;
 const index=original.indexOf(view);if(index<0)return;const offset=Buffer.byteLength(original.slice(0,index)),length=Buffer.byteLength(view),exceptions=new Set();
 for(const key of entry.exceptions??[]){const [rule,start,size]=JSON.parse(key);if(start>=offset&&start+size<=offset+length)exceptions.add(rangeKey(rule,start-offset,size));}
 registerFileProtection(view,{exceptions});
}
export function redactRanges(value,inputRanges,preserveLines=false) {
 const text=String(value),ranges=[...inputRanges].sort((a,b)=>a.index-b.index),merged=[];
 for(const r of ranges){const prev=merged.at(-1);if(prev&&r.index<=prev.end)prev.end=Math.max(prev.end,r.index+r.length);else merged.push({start:r.index,end:r.index+r.length});}
 let out='',at=0;for(const r of merged){out+=text.slice(at,r.start);out+=preserveLines?text.slice(r.start,r.end).split('\n').map(line=>line.length?HIDDEN:'').join('\n'):HIDDEN;at=r.end;}
 return out+text.slice(at);
}
export const redact = value => redactRanges(value,effectiveRanges(String(value)));
export function containsCredential(value) {
 const stack=[String(value)];while(stack.length){
  const item=stack.pop();if(typeof item==='string'){
   if(protectionContext.getStore()?.files.size&&protectionContext.getStore().files.has(textKey(item))){if(!effectiveRanges(item).next().done)return true;continue;}
   if(/^[\s]*[\[{"]/.test(item)){try{const parsed=JSON.parse(item);if(parsed!==item){stack.push(parsed);continue;}}catch{/* ordinary source text */}}
   if(!effectiveRanges(item).next().done)return true;
  }else if(item&&typeof item==='object'){for(const [key,v] of Object.entries(item)){if(typeof v==='string'&&/^(?:(?:db|database|postgres(?:ql)?|mysql|mariadb|mongo(?:db)?|redis|mssql|sqlserver|pg)_?(?:password|pass)|AWS_SECRET_ACCESS_KEY|AZURE_STORAGE_ACCOUNT_KEY|AZURE_STORAGE_KEY|password|passwd|api_?key|access_token|refresh_token|client_secret|secret_key|auth_token)$/i.test(key)&&!effectiveRanges(JSON.stringify({[key]:v})).next().done)return true;stack.push(key,v);}}
 }
 return false;
}
export const redactExcerpt = value => redact(value).replace(/rtc_pass_[A-Za-z0-9_-]+/g,HIDDEN);
export const redactPreservingLines = value => redactRanges(value,effectiveRanges(String(value)),true);
