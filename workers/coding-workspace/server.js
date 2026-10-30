import {createServer} from 'node:http';
import {createPublicKey,verify} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {CodingRuntime} from './runtime.js';
import {withProtectionContext,withRepositoryProtection} from '../../src/github/content-protection.js';
import {scannerSettings,defaultScannerSettings} from '../../src/github/scanner-policy.js';
import {codingCapacity} from './capacity.js';
import {readPreview,previewPorts} from './preview.js';
const actions=['capabilities','start','status','logs','cancel','preview'];
export function verifyCodingClaim(body,signature,key,binding,now=Date.now()){
 if(!key?.startsWith('ed25519:')||typeof signature!=='string'||!/^ed25519:[A-Za-z0-9_-]{86}$/.test(signature))throw new TypeError('Invalid coding authorization.');
 const pub=createPublicKey({key:Buffer.from(key.slice(8),'base64'),format:'der',type:'spki'});
 if(pub.asymmetricKeyType!=='ed25519'||!verify(null,Buffer.from(body),pub,Buffer.from(signature.slice(8),'base64url')))throw new TypeError('Invalid coding authorization.');
 const claim=JSON.parse(body);
 if(!claim||claim.purpose!=='robinson-coding/v1'||claim.binding!==binding||!Number.isSafeInteger(claim.expiresAt)||claim.expiresAt<=now||claim.expiresAt>now+90000||!actions.includes(claim.action)||Object.keys(claim).some(k=>!['purpose','binding','expiresAt','action','options','scannerPolicy'].includes(k)))throw new TypeError('Invalid coding authorization.');
 return claim;
}
export function codingServer({runtime,key,now=Date.now,capacity=codingCapacity,ports=previewPorts(),controlPort=3000}={}){
 if(!key?.startsWith('ed25519:'))throw new TypeError('Pin only the control public verification key; no shared credential belongs in a coding container.');
 const server=createServer({requestTimeout:15000,headersTimeout:10000,maxHeaderSize:8192},async(req,res)=>withProtectionContext(async()=>{
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
  const send=(code,data)=>{res.statusCode=code;res.end(JSON.stringify(data));};
  if(req.method==='GET'&&req.url==='/health')return send(200,{service:'robinson-coding',product:"Robinson's Playground",protocol:1});
  if(req.method!=='POST'||req.url!=='/v1/coding')return send(404,{error:'not_found'});
  let claim;try{
   let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>65536)return send(413,{error:'request_too_large'});chunks.push(chunk);}
   claim=verifyCodingClaim(Buffer.concat(chunks).toString('utf8'),req.headers['x-robinson-signature'],key,runtime.binding,now());
   const activity=result=>({...result,idle_timeout_ms:runtime.idleMs,last_activity_at:runtime.lastActivity,expires_at:runtime.lastActivity+runtime.idleMs});
   const o=claim.options??{};const fields={capabilities:[],start:['requestKey','argv','cwd','timeoutMs'],status:['id'],logs:['id','offset','length','expectedLogHash'],cancel:['id'],preview:['port','path','offset','length','expectedBodyHash']}[claim.action];
   if(typeof o!=='object'||Array.isArray(o)||Object.keys(o).some(k=>!fields.includes(k)))return send(400,{error:'invalid_arguments'});
   const policy=scannerSettings(claim.scannerPolicy?.settings??defaultScannerSettings());
   if(['logs','preview'].includes(claim.action)&&(!Number.isSafeInteger(claim.scannerPolicy?.revision)||claim.scannerPolicy.revision<0))throw new TypeError('Current repository scanner policy is required for protected output.');
   return await withRepositoryProtection(policy.additionalRules.filter(r=>!policy.disabledRules.includes(r.id)),async()=>{switch(claim.action){
    case 'capabilities':return send(200,{product:"Robinson's Playground",protocol:1,execution:'dedicated-container',idleTimeoutMs:runtime.idleMs,capacity:await capacity({root:runtime.root}),providerCredentials:false,arbitraryCommands:true,preview:{transport:'authenticated-control-loopback',ports,browserSession:false,textBodyLimitBytes:2097152}});
    case 'start':return send(202,activity(await runtime.start(o)));
    case 'status':return send(200,activity(await runtime.status(o.id)));
    case 'logs':return send(200,activity(await runtime.logs(o.id,{offset:o.offset,length:o.length,expectedLogHash:o.expectedLogHash})));
    case 'preview':await runtime.touch();if(runtime.resources&&!((await runtime.resources.check()).allowed))throw Object.assign(new TypeError('Measured runtime resource pressure.'),{code:'resource_pressure'});return send(200,activity(await readPreview(o,{ports,controlPort})));
    case 'cancel':return send(200,activity(await runtime.cancel(o.id)));
   }});
  }catch(e){const status=claim?({resource_pressure:429,execution_busy:409,intent_conflict:409,log_changed:409,preview_changed:409,preview_timeout:504,preview_unavailable:502,preview_too_large:413,execution_not_found:404,workspace_expired:410}[e.code]??(e instanceof TypeError?400:500)):401;if(status===429)res.setHeader('Retry-After','2');return send(status,{error:claim&&/^[a-z_]{1,64}$/.test(e.code??'')?e.code:claim?'execution_unconfirmed':'invalid_authorization',next:claim?'Inspect the original execution; do not start another intent to retry an uncertain command.':'Obtain current workspace authorization from the MCP.'});}
 }));
 const timer=setInterval(()=>runtime.expire().then(expired=>{if(expired)server.close();}).catch(()=>{process.stderr.write('Coding lease cleanup could not be confirmed.\n');}),30000);timer.unref();
 server.on('close',()=>clearInterval(timer));return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const runtime=await new CodingRuntime({root:process.env.CODING_STORAGE_ROOT,binding:process.env.CODING_WORKSPACE_BINDING,idleMs:Number(process.env.CODING_IDLE_TIMEOUT_MS??14400000)}).init();
 const server=codingServer({runtime,key:process.env.CODING_CONTROL_PUBLIC_KEY,ports:previewPorts(process.env.CODING_PREVIEW_PORTS,Number(process.env.PORT??3000)),controlPort:Number(process.env.PORT??3000)});server.listen(Number(process.env.PORT??3000),'0.0.0.0');
 for(const signal of ['SIGTERM','SIGINT'])process.once(signal,async()=>{await runtime.shutdown();server.close();});
}
