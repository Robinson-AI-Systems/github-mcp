// An authenticated control request may read a development server on this
// allocation's loopback only. Never accept URLs, cookies or provider headers.
import {request} from 'node:http';
import {createHash} from 'node:crypto';
import {redact} from '../../src/github/content-protection.js';
const fail=(code,message)=>Object.assign(new TypeError(message),{code});
const MAX_BYTES=2*1024*1024;
const defaults=[3001,4173,5173,8000,8080];
export function previewPorts(value,controlPort=3000){
 const ports=value===undefined?defaults:String(value).split(',').map(x=>Number(x.trim()));
 if(!ports.length||ports.length>32||ports.some(p=>!Number.isSafeInteger(p)||p<1024||p>65535||[controlPort,5432].includes(p)))throw fail('invalid_preview_configuration','Preview ports must be explicit unprivileged development ports, excluding control and database ports.');
 return [...new Set(ports)];
}
export async function readPreview({port,path='/',offset=0,length=8192,expectedBodyHash}={}, {ports=defaults,controlPort=3000,timeoutMs=5000}={}){
 // Validate before constructing an HTTP request, including unsafe node HTTP paths.
 if(!Number.isSafeInteger(port)||!ports.includes(port)||port===controlPort||port===5432||port<1024||port>65535)throw fail('preview_port_denied','This development port is not enabled for the workspace.');
 if(typeof path!=='string'||path.length>4096||!path.startsWith('/')||path.startsWith('//')||/[\\\s\x00-\x1f\x7f]/.test(path)||path.includes('#'))throw fail('invalid_preview_path','Supply an origin-relative development path, never a URL.');
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(length)||length<1||length>32768||expectedBodyHash!==undefined&&!/^[a-f0-9]{64}$/.test(expectedBodyHash))throw fail('invalid_window','Preview windows require a nonnegative offset and1–32768 bytes.');
 if(offset>0&&expectedBodyHash===undefined)throw fail('preview_changed','Continuation requires the previous bodyHash.');
 const response=await new Promise((resolve,reject)=>{
  let size=0,settled=false;
  const done=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);if(error)reject(error);else resolve(result);};
  const req=request({hostname:'127.0.0.1',port,path,method:'GET',agent:false,headers:{Accept:'text/html, application/json, text/plain, */*','Accept-Encoding':'identity','Connection':'close'}},res=>{
   const rejectResponse=code=>{res.destroy();req.destroy();done(fail(code,'Development response was withheld.'));};
   // A Location is never fetched or returned (it can contain private credentials).
   if(res.statusCode>=300&&res.statusCode<400)return rejectResponse('preview_redirect');
   if(res.headers['content-encoding']&&res.headers['content-encoding']!=='identity')return rejectResponse('preview_encoding');
   const type=String(res.headers['content-type']??'').split(';')[0].trim().toLowerCase();
   if(!/^(?:text\/[a-z0-9.+-]+|application\/(?:json|javascript|xml|[a-z0-9.+-]+\+json)|image\/svg\+xml)$/.test(type))return rejectResponse('preview_content_type');
   const chunks=[];
   res.on('data',chunk=>{size+=chunk.length;if(size>MAX_BYTES)return rejectResponse('preview_too_large');chunks.push(chunk);});
   res.on('end',()=>{if(!res.complete)return done(fail('preview_unavailable','Development response was incomplete.'));done(null,{status:res.statusCode,contentType:type,bytes:Buffer.concat(chunks)});});
   res.on('error',()=>done(fail('preview_unavailable','Development response was incomplete.')));
  });
  // Absolute watchdog bounds slow headers and slow drip bodies alike.
  const timer=setTimeout(()=>{req.destroy();done(fail('preview_timeout','Development server did not answer within the bounded preview window.'));},timeoutMs);
  req.on('error',()=>done(fail('preview_unavailable','Development server is unavailable.')));
  req.end();
 });
 // Scan the whole retained text before paging. Never return response headers,
 // raw scripts as rendered HTML, cookies, credentials, or incomplete success.
 const safe=Buffer.from(redact(response.bytes.toString('utf8'))),bodyHash=createHash('sha256').update(safe).digest('hex');
 if(expectedBodyHash!==undefined&&expectedBodyHash!==bodyHash)throw fail('preview_changed','Development output changed; restart at byte offset zero.');
 const end=Math.min(safe.length,offset+length);
 return {status:response.status,contentType:response.contentType,bodyHash,base64:safe.subarray(offset,end).toString('base64'),offset,nextOffset:Math.max(offset,end),totalBytes:safe.length,complete:end>=safe.length,redacted:!safe.equals(response.bytes),untrusted:true,bodyLimitBytes:MAX_BYTES,transport:'authenticated-control-loopback',browserSession:false};
}
