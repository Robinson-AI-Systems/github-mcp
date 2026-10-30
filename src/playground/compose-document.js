// Bounded data-only reader for the block YAML emitted by Compose serializers.
// Unsupported YAML features fail closed: no tags, aliases, merge keys or folds.
// This is a parser, not a text search for a reassuring network declaration.
export function composeDocument(input){
 if(typeof input!=='string')return input;
 if(Buffer.byteLength(input)>2*1024*1024)throw new TypeError('Compose document exceeds bound.');
 if(input.trimStart().startsWith('{'))return JSON.parse(input);
 let nodes=0,index=0;
 const scalar=text=>{
  if(++nodes>100000)throw new TypeError('Compose node bound.');
  if(!text||/^[!&*|>]/.test(text))throw new TypeError('Unsupported YAML scalar.');
  if(text.startsWith('"'))return JSON.parse(text);
  if(text.startsWith("'")){if(!/^'(?:[^']|'')*'$/.test(text))throw new TypeError('Invalid quoted scalar.');return text.slice(1,-1).replaceAll("''","'");}
  if(text.startsWith('[')||text.startsWith('{'))return JSON.parse(text);
  if(/[\[\]{}]/.test(text))throw new TypeError('Unsupported YAML flow value.');
  if(text==='true')return true;if(text==='false')return false;if(text==='null'||text==='~')return null;
  if(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)){const n=Number(text);if(!Number.isFinite(n))throw new TypeError('Invalid numeric scalar.');return n;}
  return text;
 };
 const lines=input.replaceAll('\r\n','\n').split('\n').flatMap((raw,n)=>{
  if(raw.includes('\t')||raw.includes('\r'))throw new TypeError('Unsupported YAML whitespace.');
  let quote=null,body='';
  for(let i=0;i<raw.length;i++){const c=raw[i];if(!quote&&c==='#'&&(i===0||/\s/.test(raw[i-1])))break;body+=c;if(quote==='"'&&c==='\\'){if(i+1<raw.length)body+=raw[++i];continue;}if(quote==="'"&&c==="'"&&raw[i+1]==="'"){body+=raw[++i];continue;}if(c===quote)quote=null;else if(!quote&&(c==='"'||c==="'"))quote=c;}
  if(quote)throw new TypeError('Multiline quoted YAML is unsupported.');
  body=body.trimEnd();if(!body.trim())return [];
  if(body==='---'&&n===0)return [];
  if(body.trim()==='...'||body.trim()==='---'||body.trimStart().startsWith('%'))throw new TypeError('Multiple/directive YAML documents are unsupported.');
  const indent=body.length-body.trimStart().length;
  if(indent>128)throw new TypeError('Compose indentation bound.');
  return [{indent,text:body.slice(indent)}];
 });
 if(lines.length>50000||!lines.length||lines[0].indent!==0)throw new TypeError('Invalid Compose document.');
 const pair=text=>{
  let quote=null;
  for(let i=0;i<text.length;i++){const c=text[i];if(quote==='"'&&c==='\\'){i++;continue;}if(quote==="'"&&c==="'"&&text[i+1]==="'"){i++;continue;}if(c===quote)quote=null;else if(!quote&&(c==='"'||c==="'"))quote=c;else if(!quote&&c===':'&&(i+1===text.length||text[i+1]===' ')){const key=scalar(text.slice(0,i).trim());if(typeof key!=='string'||['__proto__','constructor','prototype','<<'].includes(key))throw new TypeError('Invalid YAML mapping key.');return [key,text.slice(i+1).trim()];}}
  return null;
 };
 const sequence=t=>t==='-'||t.startsWith('- ');
 const block=(indent,depth=0,initial)=>{
  if(depth>32)throw new TypeError('Compose nesting bound.');
  const list=!initial&&sequence(lines[index]?.text??''),out=list?[]:Object.create(null);
  const assign=(text,keyIndent)=>{const p=pair(text);if(!p||Object.hasOwn(out,p[0]))throw new TypeError('Invalid/duplicate YAML mapping.');const [key,value]=p;out[key]=value?scalar(value):lines[index]&&(lines[index].indent>keyIndent||lines[index].indent===keyIndent&&sequence(lines[index].text))?block(lines[index].indent,depth+1):null;};
  if(initial)assign(initial,indent);
  while(index<lines.length&&lines[index].indent===indent){
   if(list&&!sequence(lines[index].text))break;
   const text=lines[index++].text;
   if(list){if(!sequence(text))break;const value=text.slice(1).trim();if(!value){if(!lines[index]||lines[index].indent<=indent)throw new TypeError('Empty YAML sequence entry.');out.push(block(lines[index].indent,depth+1));}else if(pair(value))out.push(block(indent+2,depth+1,value));else out.push(scalar(value));}
   else{if(sequence(text))throw new TypeError('Unexpected YAML sequence.');assign(text,indent);}
  }
  return out;
 };
 const result=block(0);if(index!==lines.length||Array.isArray(result))throw new TypeError('Unconsumed Compose document.');return result;
}
