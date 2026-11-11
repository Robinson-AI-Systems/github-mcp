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
// A version or version range (1.0.5, ^1.0.5, ~2.1, >=4, 1.x, 2.0.0-beta.1) or a structure opening ({ or [) assigned to a
// password-looking key is a dependency entry, not a credential (owner feedback 2026-11-02: package-lock.json was refused).
const NOT_A_PASSWORD=/^(?:[{[]|(?:[\^~]|[<>]=?|=)?v?\d+(?:\.(?:\d+|[xX*]))*(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/;
const DATABASE_VARIABLE = /\b(?:db|database|postgres(?:ql)?|mysql|mariadb|mongo(?:db)?|redis|mssql|sqlserver|pg)_?(?:password|pass)\b["']?[ \t]*[:=](?![=>])[ \t]*/gi;

// HIDDEN-GUARD-1: the whole value is one template interpolation: Python/JS/shell/printf/Jinja forms.
export const INTERPOLATION=/^(?:\{[A-Za-z_][\w.]*(?:![rsa])?(?::[^{}]*)?\}|\$\{[A-Za-z_][\w.]*\}|\$[A-Za-z_]\w*|%(?:\([A-Za-z_]\w*\))?s|\{\{\s*[A-Za-z_][\w.]*\s*\}\})$/;
export const isInterpolation=value=>INTERPOLATION.test(value);
/** Return a literal's range, excluding quote delimiters. Never evaluate code or expand variables. */
function* databaseMatches(text) {
 for (const m of text.matchAll(DATABASE_URI)) {
  const first = m[0].indexOf('://')+3, at = m[0].lastIndexOf('@'), colon = m[0].indexOf(':',first);
  // HIDDEN-GUARD-1: a password slot holding only a code interpolation ({pw}, ${PW}, $PW, %s, {{ pw }}) is
  // source code, not a credential; treating it as one blanked real code in reads and refused its restore.
  const slot=at > colon ? m[0].slice(colon+1,at) : '';
  if (at > colon && colon >= first && at > colon+1 && slot!==HIDDEN && !isInterpolation(slot)) yield { index:m.index+colon+1,length:at-colon-1,rule:'database-uri-password',description:'Password in a database connection URI' };
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
  // Package manifests and lockfiles name the npm package whose name is pg plus pass, followed by a version number such as
  // 1.0.5 or by an opening brace for its lockfile entry: a dependency version or an opening brace is not a password.
  if (value.length && !NOT_A_PASSWORD.test(text.slice(value.index,value.index+value.length))) yield { ...value,rule:'database-password-assignment',description:'Explicit database password assignment' };
 }
}
// Generic key/value detection is adapted from the corpus's generic-api-key concept,
// restricted to explicit key names, quoted literals and an entropy threshold to reduce code false positives.
const GENERIC_ASSIGNMENT=/\b(?:password|passwd|api_?key|access_token|refresh_token|client_secret|secret_key|auth_token)\b["']?[ \t]*[:=][ \t]*(?=["'])/gi;
function entropy(value){const counts=new Map();for(const c of value)counts.set(c,(counts.get(c)??0)+1);let h=0;for(const n of counts.values()){const p=n/value.length;h-=p*Math.log2(p);}return h;}
// PUSH-FIXTURE-1: AGENTS.md requires fake test credentials: the GitHub token prefixes followed by the word FAKE. In pushed or
// written file content (and only there: callers opt in with {fixtures:'allow'}), a GitHub token shape whose payload starts with
// the word FAKE (case-sensitive) followed by characters holding no other credential prefix is a documented fixture, not a
// credential. A FAKE payload that itself contains another GitHub token prefix is still a match. Redaction never passes the
// option, so text returned to AIs still hides fakes.
const FIXTURE_PREFIX={'github-token':4,'github-fine-grained-token':11};
const OTHER_CREDENTIAL_PREFIX=/gh[pousr]_|github_pat_|rtc_pass_|rg[kc]_|tac_|trf_/;
const allowsFixtures=options=>options?.fixtures==='allow';
function isDocumentedFixture(value,rule){
 const skip=FIXTURE_PREFIX[rule];if(skip===undefined)return false;
 const payload=value.slice(skip);return payload.startsWith('FAKE')&&!OTHER_CREDENTIAL_PREFIX.test(payload.slice(4));
}
// PUSH-FIXTURE-2: under the same opt-in, a generic key/value match whose whole literal is an evident placeholder is test
// text, not a credential. Evident means either (a) lowercase words joined by hyphens or underscores, at least one word being
// a stop word below, no word longer than 20 characters and no run of more than 4 digits; or (b) the literal starts with the
// word FAKE or fake and holds none of the credential prefixes above. Mixed-case random text never qualifies under (a).
// Redaction and the scanner report never pass the option, so outputs still hide these values.
const PLACEHOLDER_WORDS=new Set(['fake','fixture','example','dummy','placeholder','wrong','test','sample','changeme','redacted']);
function isEvidentPlaceholder(literal){
 if(/^(?:FAKE|fake)/.test(literal))return !OTHER_CREDENTIAL_PREFIX.test(literal);
 if(!/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(literal)||/\d{5}/.test(literal))return false;
 const words=literal.split(/[-_]/);return words.every(w=>w.length<=20)&&words.some(w=>PLACEHOLDER_WORDS.has(w));
}
function* credentialMatches(text,options={}) {
 const seen=text.length<=1000000?new Set():null,fixtures=allowsFixtures(options);
 function* remember(matches){for(const r of matches){seen?.add(`${r.index}:${r.length}`);yield r;}}
 for(const m of text.matchAll(CLOUD_VARIABLE)){const value=assignedLiteral(text,m.index+m[0].length);if(value.length>=40)yield* remember([{...value,rule:'cloud-secret-assignment',description:'Assigned cloud provider secret or storage key'}]);}
 for(let index=0;index<TOKEN_SHAPES.length;index++)for(const m of text.matchAll(TOKEN_SHAPES[index])){
  // A fixture literal is judged by the token rule alone: it is remembered so the generic assignment rule does not re-flag exactly it.
  if(fixtures&&isDocumentedFixture(m[0],RULE_INFO[index][0])){seen?.add(`${m.index}:${m[0].length}`);continue;}
  yield* remember([{index:m.index,length:m[0].length,rule:RULE_INFO[index][0],description:RULE_INFO[index][1]}]);
 }
 yield* remember(databaseMatches(text));yield* remember(openSecretMatches(text));
 for(const m of text.matchAll(GENERIC_ASSIGNMENT)){const value=assignedLiteral(text,m.index+m[0].length),literal=text.slice(value.index,value.index+value.length);if(value.length>=10&&!seen?.has(`${value.index}:${value.length}`)&&entropy(literal)>=3.5&&!(fixtures&&isEvidentPlaceholder(literal)))yield {...value,rule:'generic-credential-assignment',description:'High-entropy literal assigned to an explicit credential key'};}
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
/** Where the first matches are, for a refusal message: "line 12 (database-password-assignment)". Never a value or snippet. */
export function credentialLocations(value,{max=3,fixtures}={}){
 const r=activeProtectionReport(value,{maxFindings:max,fixtures});
 return r.findings.map(f=>`line ${f.line} (${f.rule})`).join(', ')+(r.total_findings>max?` and ${r.total_findings-max} more`:'');
}
export function activeProtectionReport(value,options={}){const text=String(value);return reportMatches(text,(function*(){yield* credentialMatches(text,options);yield* customCredentialRanges(text,protectionContext.getStore()?.rules??[]);})(),options);}
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
function* effectiveRanges(text,options={}){
 const files=protectionContext.getStore()?.files,entry=files?.size?files.get(textKey(text)):undefined;
 for(const r of (function*(){yield* credentialMatches(text,options);yield* customCredentialRanges(text,protectionContext.getStore()?.rules??[]);})())if(!entry?.exceptions?.has(rangeKey(r.rule,Buffer.byteLength(text.slice(0,r.index)),Buffer.byteLength(text.slice(r.index,r.index+r.length)))))yield r;
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
/** options.fixtures==='allow' is for push/write gates on file content only (PUSH-FIXTURE-1); never for arguments or results. */
export function containsCredential(value,options={}) {
 const stack=[String(value)];while(stack.length){
  const item=stack.pop();if(typeof item==='string'){
   if(protectionContext.getStore()?.files.size&&protectionContext.getStore().files.has(textKey(item))){if(!effectiveRanges(item,options).next().done)return true;continue;}
   if(/^[\s]*[\[{"]/.test(item)){try{const parsed=JSON.parse(item);if(parsed!==item){stack.push(parsed);continue;}}catch{/* ordinary source text */}}
   if(!effectiveRanges(item,options).next().done)return true;
  }else if(item&&typeof item==='object'){for(const [key,v] of Object.entries(item)){if(typeof v==='string'&&/^(?:(?:db|database|postgres(?:ql)?|mysql|mariadb|mongo(?:db)?|redis|mssql|sqlserver|pg)_?(?:password|pass)|AWS_SECRET_ACCESS_KEY|AZURE_STORAGE_ACCOUNT_KEY|AZURE_STORAGE_KEY|password|passwd|api_?key|access_token|refresh_token|client_secret|secret_key|auth_token)$/i.test(key)&&!effectiveRanges(JSON.stringify({[key]:v}),options).next().done)return true;stack.push(key,v);}}
 }
 return false;
}
// GIT-REMOTE-1: git remote session keys and setup codes are hidden in every excerpt too.
export const redactExcerpt = value => redact(value).replace(/rtc_pass_[A-Za-z0-9_-]+/g,HIDDEN).replace(/\brg[kc]_[a-f0-9]{32}_[A-Za-z0-9_-]{43}/g,HIDDEN);
export const redactPreservingLines = value => redactRanges(value,effectiveRanges(String(value)),true);
