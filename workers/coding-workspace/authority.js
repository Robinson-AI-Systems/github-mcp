import {createPublicKey,createPrivateKey,generateKeyPairSync,sign,verify,randomBytes} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
export async function runtimeIdentity(root){
 const path=join(root,'control','identity.pem');let key;
 try{key=createPrivateKey(await readFile(path));}catch(e){if(e.code!=='ENOENT')throw e;key=generateKeyPairSync('ed25519').privateKey;await writeFile(path,key.export({format:'pem',type:'pkcs8'}),{mode:0o600,flag:'wx'});}
 return {key,publicKey:'ed25519:'+createPublicKey(key).export({format:'der',type:'spki'}).toString('base64')};
}
export function verifyAuthority(body,signature,key,binding,nonce,now=Date.now()){
 const pub=createPublicKey({key:Buffer.from(key.slice(8),'base64'),format:'der',type:'spki'});
 if(pub.asymmetricKeyType!=='ed25519'||typeof signature!=='string'||!signature.startsWith('ed25519:')||!verify(null,Buffer.from(body),pub,Buffer.from(signature.slice(8),'base64url')))throw new TypeError('Invalid control authority.');
 const c=JSON.parse(body);if(c.purpose!=='robinson-coding/v1'||c.binding!==binding||c.action!=='authority'||c.requestNonce!==nonce||!Number.isSafeInteger(c.expiresAt)||c.expiresAt<=now||c.expiresAt>now+90000||typeof c.allowed!=='boolean')throw new TypeError('Invalid bound authority lease.');return c;
}
// A signed denial stops the runtime at once. A control plane that cannot be
// reached (network, Vercel or Neon trouble) is different: no new command is
// admitted once the last signed lease expires (runtime.js), but processes that
// are already running get a bounded grace before the whole runtime stops.
// The lease itself is never extended. graceMs is capped at 15 minutes.
export function watchAuthority({runtime,key,url,onLost,fetch:fetchImpl=globalThis.fetch,intervalMs=30000,retryMs=10000,graceMs=300000}){
 let busy=false,closed=false,unreachableSince=null,timer=null;
 graceMs=Math.max(0,Math.min(Number.isSafeInteger(graceMs)?graceMs:300000,900000));
 const tick=async()=>{if(busy||closed)return;busy=true;try{
  const nonce=randomBytes(16).toString('hex'),body=JSON.stringify({purpose:'robinson-playground-heartbeat/v1',binding:runtime.binding,expiresAt:runtime.now()+30000,nonce});
  const signature='ed25519:'+sign(null,Buffer.from(body),runtime.identity.key).toString('base64url');
  const res=await fetchImpl(url,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json','x-robinson-runtime-signature':signature},body,signal:AbortSignal.timeout(10000)});let text='';for await(const chunk of res.body){text+=Buffer.from(chunk).toString();if(Buffer.byteLength(text)>16384)throw new TypeError('Authority response exceeded its bound.');}
  const lease=verifyAuthority(text,res.headers.get('x-robinson-signature'),key,runtime.binding,nonce,runtime.now());
  if(lease.allowed){if(!Number.isSafeInteger(lease.activityAt)||lease.activityAt>runtime.now()+90000)throw new TypeError('Invalid workspace activity.');await runtime.recordAuthorizedActivity(lease.activityAt);}
  runtime.authorityLease=lease;unreachableSince=null;runtime.authorityUnreachableSince=null;
  if(!lease.allowed&&!lease.bootstrap)await onLost(lease.reason??'authorization_lost');
 }catch{
  const now=runtime.now();unreachableSince??=now;runtime.authorityUnreachableSince=unreachableSince;
  const lease=runtime.authorityLease;
  // Never had a lease, or the last answer was a denial: nothing to preserve.
  if(!lease||!lease.allowed){if(!lease?.bootstrap){runtime.authorityLease=null;await onLost('authorization_unavailable');}}
  else if(lease.expiresAt<=now&&now-unreachableSince>=graceMs){runtime.authorityLease=null;await onLost('authorization_unavailable');}
 }finally{busy=false;schedule();}};
 const schedule=()=>{if(closed)return;timer=setTimeout(()=>{void tick();},unreachableSince===null?intervalMs:retryMs);timer.unref?.();};
 void tick();return()=>{closed=true;if(timer)clearTimeout(timer);};
}
