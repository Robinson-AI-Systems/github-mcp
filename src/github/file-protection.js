// Repository policy applies only to authenticated committed file reads, with immutable exception binding.
import {createHash} from 'node:crypto';
import {credentialRanges,redactRanges,registerFileProtection} from './content-protection.js';
import {loadScannerPolicy,customScannerFindings} from './scanner-policy.js';
export const findingFingerprint=(sha,rule,offset,length)=>createHash('sha256').update(JSON.stringify([sha,rule,offset,length])).digest('hex');
export function evaluateFileProtection({path,sha,source,settings,revision=0,findingRule,findingFingerprint:focusFingerprint,findingOffset=0,maxFindings=30}){
 const policy={settings,revision},bytes=Buffer.from(source),base=credentialRanges(source);
 const additional=customScannerFindings(source,path,policy.settings).filter(r=>!policy.settings.disabledRules.includes(r.rule)).map(r=>({rule:r.rule,description:r.kind,index:bytes.subarray(0,r.byte_offset).toString().length,length:bytes.subarray(r.byte_offset,r.byte_offset+r.byte_length).toString().length}));
 const all=[...base,...additional].sort((a,b)=>a.index-b.index||a.rule.localeCompare(b.rule)),exceptions=new Set(),findings=[];let exempted=0,selected=0,selectedBlocked=0;
 const needsException=policy.settings.suppressions.some(s=>s.fileReadException&&s.path===path&&s.blobSha===sha);
 const actualSha=needsException?createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex'):null;
 for(const r of all){
  const prefix=source.slice(0,r.index),offset=Buffer.byteLength(prefix),length=Buffer.byteLength(source.slice(r.index,r.index+r.length)),fingerprint=findingFingerprint(sha,r.rule,offset,length);
  const exemption=actualSha===sha&&policy.settings.suppressions.find(s=>s.fileReadException===true&&s.rule===r.rule&&s.path===path&&s.blobSha===sha&&s.fingerprint===fingerprint);
  if(exemption){exempted++;exceptions.add(JSON.stringify([r.rule,offset,length]));}
  if((!findingRule||r.rule===findingRule)&&(!focusFingerprint||fingerprint===focusFingerprint)){selected++;if(!exemption)selectedBlocked++;if(selected>findingOffset&&findings.length<maxFindings)findings.push({rule:r.rule,description:r.description,line:prefix.split('\n').length,column:Array.from(prefix.slice(prefix.lastIndexOf('\n')+1)).length+1,column_unit:'unicode_code_points',byte_offset:offset,byte_length:length,fingerprint,classification:'format_match',credential_validity:'not_checked',file_read_exception_applied:!!exemption});}
 }
 const active=all.filter(r=>!exceptions.has(JSON.stringify([r.rule,Buffer.byteLength(source.slice(0,r.index)),Buffer.byteLength(source.slice(r.index,r.index+r.length))])));
 return {context:{exceptions},text:redactRanges(source,active),lines:redactRanges(source,active,true),report:{detector_revision:'2026-10-28.2',policy_revision:policy.revision,
  total_findings:all.length,blocked_findings:all.length-exempted,excepted_findings:exempted,matching_findings:selected,selected_blocked_findings:selectedBlocked,finding_offset:findingOffset,next_finding_offset:findingOffset+findings.length<selected?findingOffset+findings.length:null,findings,findings_truncated:findingOffset+findings.length<selected,matched_values_returned:false,
  byte_exact_available:active.length===0,note:'Format matching only. Exact-file exceptions are owner policy, not credential validity proof. No matches never proves absence.'}};
}

export async function protectRepositoryFile(ctx,{owner,repo,...file}){
 const policy=await loadScannerPolicy(ctx.db,owner,repo);const result=evaluateFileProtection({...file,settings:policy.settings,revision:policy.revision});
 registerFileProtection(file.source,result.context);return result;
}
