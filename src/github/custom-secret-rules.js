// Typed rules only. User input never becomes arbitrary executable code or regex syntax.
import {assignedLiteral,HIDDEN} from './secret-literals.js';
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function* customCredentialRanges(text,rules){
 for(const r of rules){
  if(r.type==='prefix'){
   if(!text.includes(r.prefix))continue;
   const alphabet={alnum:'A-Za-z0-9',base64url:'A-Za-z0-9_-',hex:'A-Fa-f0-9'}[r.alphabet];
   const pattern=new RegExp(escape(r.prefix)+'['+alphabet+']{'+r.minLength+',}','g');
   for(const m of text.matchAll(pattern))if(m[0].length-r.prefix.length<=r.maxLength){const marker=text.lastIndexOf(HIDDEN,m.index);if(marker<0||m.index+m[0].length>marker+HIDDEN.length)yield {index:m.index,length:m[0].length,rule:r.id,description:r.label};}
  }else{
   if(!r.keys.some(k=>text.includes(k)))continue;
   const pattern=new RegExp('\\b(?:'+r.keys.map(escape).join('|')+')["\']?[ \\t]*[:=][ \\t]*','g');
   for(const m of text.matchAll(pattern)){const v=assignedLiteral(text,m.index+m[0].length);if(v.length>=r.minLength)yield {...v,rule:r.id,description:r.label};}
  }
 }
}
