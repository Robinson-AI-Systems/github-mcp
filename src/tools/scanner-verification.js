// Tune receipts contain only immutable identity, rule IDs and observed booleans, never source or matches.
import {createHash} from 'node:crypto';
import {readerFor} from './github-read.js';
import {detectCredentialPatterns} from './security-scan-files.js';
import {filterScannerFindings} from '../github/scanner-policy.js';
import {evaluateFileProtection} from '../github/file-protection.js';
export const VERIFICATION_SCHEMA={type:'object',additionalProperties:false,properties:{path:{type:'string',minLength:1,maxLength:1000},blobSha:{type:'string',pattern:'^[a-f0-9]{40}$'},rule:{type:'string',minLength:1,maxLength:80},fingerprint:{type:'string',pattern:'^[a-f0-9]{64}$'},door:{type:'string',enum:['scan','file_read']},expectedBefore:{type:'boolean'},expectedAfter:{type:'boolean'}},required:['path','blobSha','rule','door','expectedBefore','expectedAfter']};
const matchRule=(finding,id)=>finding.rule===id||finding.detector_rules?.includes(id);
export async function verifyScannerChange(ctx,target,before,after,input){
 if(!input||!input.path||input.path.startsWith('/')||input.path.split('/').some(p=>!p||p==='.'||p==='..')||/[\\\x00-\x1f?#%*]/.test(input.path)||!['scan','file_read'].includes(input.door)||typeof input.expectedBefore!=='boolean'||typeof input.expectedAfter!=='boolean')throw new TypeError('A pinned committed-file verification case is required for every tune.');
 const {octokit}=await readerFor({owner:target.owner,repo:target.repo},ctx);
 const {data}=await octokit.request('GET /repos/{owner}/{repo}/git/blobs/{file_sha}',{owner:target.owner,repo:target.repo,file_sha:input.blobSha});
 if(data.encoding!=='base64'||typeof data.content!=='string'||data.size>(input.door==='scan'?100000:1000000))throw new TypeError('Verification requires one readable UTF-8 blob up to 100 KB for scans or 1 MB for file-read verification.');
 const bytes=Buffer.from(data.content,'base64');if(bytes.length!==data.size||!Buffer.from(bytes.toString()).equals(bytes)||createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')!==input.blobSha)throw new TypeError('GitHub did not return the exact readable verification blob.');
 const source=bytes.toString(),observe=settings=>{
  if(input.door==='file_read'){const report=evaluateFileProtection({source,path:input.path,sha:input.blobSha,settings,findingRule:input.rule,findingFingerprint:input.fingerprint,maxFindings:1}).report;return report.selected_blocked_findings>0;}
  const raw=detectCredentialPatterns(source,input.path,1000,settings);if(raw.capped)throw new TypeError('Verification findings are capped; choose a smaller isolated sample.');
  return filterScannerFindings(raw.findings,settings,input.path,input.blobSha).findings.some(f=>matchRule(f,input.rule));
 };
 return {path:input.path,blobSha:input.blobSha,rule:input.rule,...(input.fingerprint?{fingerprint:input.fingerprint}:{}),door:input.door,before_detected:observe(before),after_detected:observe(after),expected_before:input.expectedBefore,expected_after:input.expectedAfter,checked_at:new Date((ctx.now??Date.now)()).toISOString(),matched_values_returned:false};
}
export function assertScannerVerification(receipt){if(receipt.before_detected!==receipt.expected_before||receipt.after_detected!==receipt.expected_after)throw new TypeError('The pinned verification case did not produce the expected before/after detection. Settings were not activated.');}

export function assertTuneCoverage(before,after,checks){
 const changed=new Set(),meaning=r=>r&&Object.fromEntries(Object.entries(r).filter(([k])=>k!=='label')),exceptionMeaning=s=>Object.fromEntries(Object.entries(s).filter(([k])=>k!=='reason'));
 for(const r of [...before.additionalRules,...after.additionalRules])if(JSON.stringify(meaning(before.additionalRules.find(x=>x.id===r.id)))!==JSON.stringify(meaning(after.additionalRules.find(x=>x.id===r.id))))changed.add(r.id);
 for(const id of new Set([...before.disabledRules,...after.disabledRules]))if(before.disabledRules.includes(id)!==after.disabledRules.includes(id))changed.add(id);
 const exceptions=[...before.suppressions,...after.suppressions].filter(s=>!before.suppressions.some(x=>JSON.stringify(exceptionMeaning(x))===JSON.stringify(exceptionMeaning(s)))||!after.suppressions.some(x=>JSON.stringify(exceptionMeaning(x))===JSON.stringify(exceptionMeaning(s))));
 for(const id of changed)if(!checks.some(c=>c.rule===id&&c.before_detected!==c.after_detected))throw new TypeError('Every changed custom rule needs a verification that proves detection changed.');
 for(const s of exceptions)if(!checks.some(c=>c.rule===s.rule&&c.path===s.path&&c.blobSha===s.blobSha&&c.before_detected!==c.after_detected&&(s.fileReadException!==true||c.door==='file_read'&&c.fingerprint===s.fingerprint)))throw new TypeError('Every changed exception needs its exact pinned-file verification; file-read exceptions must test that door.');
}
export async function verifyScannerChanges(ctx,target,before,after,inputs){
 if(!Array.isArray(inputs)||inputs.length<1||inputs.length>32)throw new TypeError('Supply 1–32 pinned-file verification cases.');
 const checks=[];for(const input of inputs)checks.push(await verifyScannerChange(ctx,target,before,after,input));return checks;
}
export function assertScannerVerifications(before,after,checks){for(const c of checks)assertScannerVerification(c);assertTuneCoverage(before,after,checks);}
