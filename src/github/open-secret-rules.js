// Reviewed MIT Gitleaks rules; pinned provenance and license are under vendor/gitleaks.
import pack from '../../vendor/gitleaks/reviewed-rules.json' with {type:'json'};
const rules=pack.rules.map(r=>({...r,expression:new RegExp(r.pattern,r.flags)}));
export const OPEN_SECRET_RULE_IDS=rules.map(r=>r.id);
export const OPEN_SECRET_RULE_SOURCE={revision:pack.revision,url:pack.source,rules:rules.length};
export function* openSecretMatches(text){
 if(text.length<18)return;const lower=text.toLowerCase();
 for(const r of rules){
  if(!r.keywords.some(k=>lower.includes(k.toLowerCase())))continue;
  for(const m of text.matchAll(r.expression)){
   const span=m.indices[1]??m.indices[0];let end=span[1];
   // Source delimiters are not part of the secret; a longer recognized token is never partially revealed.
   while(end<text.length&&/[A-Za-z0-9._=\-]/.test(text[end]))end++;
   yield {index:span[0],length:end-span[0],rule:r.id,description:r.label};
  }
 }
}
