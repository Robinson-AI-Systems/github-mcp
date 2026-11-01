// PLAY-2: purpose-separated signed reachability, NEVER a runtime canary or command permit.
// The controller chooses an origin from its authenticated tenant enrollment record.
// DNS is resolved once, every answer must be public IPv4 and the connection is pinned
// to that address while TLS certificate/SNI still verifies the enrolled hostname.
import {createPublicKey,verify,randomBytes} from 'node:crypto';
import {resolve4} from 'node:dns/promises';
import {request as httpsRequest} from 'node:https';

const fail=()=>Object.assign(new TypeError('Device reachability was not verified. No execution was admitted.'),{safeCode:'device_probe_unavailable'});
const sigPattern=/^ed25519:[A-Za-z0-9_-]{86}$/;
const idPattern=/^[a-f0-9]{32}$/;
const shaPattern=/^[a-f0-9]{64}$/;
const keyOf=encoded=>{
 if(typeof encoded!=='string'||!encoded.startsWith('ed25519:'))throw fail();
 let key;try{key=createPublicKey({key:Buffer.from(encoded.slice(8),'base64'),format:'der',type:'spki'});}catch{throw fail();}
 if(key.asymmetricKeyType!=='ed25519')throw fail();
 return key;
};
export function publicDeviceIPv4(ip){
 if(typeof ip!=='string'||!/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(ip))return false;
 const a=ip.split('.').map(Number),[p,q,r]=a;
 if(a.some(n=>n>255)||p===0||p===10||p===127||p>=224||p===169&&q===254||
    p===100&&q>=64&&q<=127||p===172&&q>=16&&q<=31||
    p===192&&(q===168||q===0||q===88&&r===99)||
    p===198&&(q===18||q===19||q===51&&r===100)||p===203&&q===0&&r===113||
    p===255)return false;
 return true;
}
export function pinnedDeviceOrigin(value){
 let u;try{u=new URL(value);}catch{throw fail();}
 if(typeof value!=='string'||u.protocol!=='https:'||u.origin!==value||u.username||u.password||u.port||
    u.pathname!=='/'||u.search||u.hash||u.hostname.includes(':')||
    u.hostname==='localhost'||u.hostname.endsWith('.localhost')||
    u.hostname.endsWith('.local')||u.hostname.endsWith('.internal')||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/.test(u.hostname)||/^[0-9.]+$/.test(u.hostname))
    throw fail();
 return u;
}
const CLAIM='robinson-playground-device-probe/v1';
const PROOF='robinson-playground-device-probe-proof/v1';
export function deviceProbeClaim({deviceId,origin,generation,now=Date.now,nonce=randomBytes(16).toString('hex')}={}){
 pinnedDeviceOrigin(origin);
 if(!idPattern.test(deviceId??'')||!Number.isSafeInteger(generation)||generation<1||
    typeof nonce!=='string'||!/^[a-f0-9]{32}$/.test(nonce))throw fail();
 return {purpose:CLAIM,deviceId,origin,generation,nonce,expiresAt:now()+60000};
}
export function verifyDeviceProbeClaim(body,signature,controlPublicKey,{deviceId,origin,generation,now=Date.now}={}){
 if(typeof body!=='string'||Buffer.byteLength(body)>4096||!sigPattern.test(signature??''))throw fail();
 if(!verify(null,Buffer.from(body),keyOf(controlPublicKey),Buffer.from(signature.slice(8),'base64url')))throw fail();
 let c;try{c=JSON.parse(body);}catch{throw fail();}
 if(!c||Array.isArray(c)||c.purpose!==CLAIM||c.deviceId!==deviceId||c.origin!==origin||
    c.generation!==generation||!idPattern.test(c.deviceId)||!/^[a-f0-9]{32}$/.test(c.nonce??'')||
    !Number.isSafeInteger(c.expiresAt)||c.expiresAt<=now()||c.expiresAt>now()+90000||
    Object.keys(c).sort().join(',')!=='deviceId,expiresAt,generation,nonce,origin,purpose')throw fail();
 return c;
}
export function deviceProbeResponse(claim,{now=Date.now}={}){
 return {purpose:PROOF,deviceId:claim.deviceId,origin:claim.origin,
  generation:claim.generation,nonce:claim.nonce,observedAt:now(),expiresAt:now()+30000};
}
export function verifyDeviceProbeResponse(body,signature,devicePublicKey,claim,{now=Date.now}={}){
 if(typeof body!=='string'||Buffer.byteLength(body)>4096||!sigPattern.test(signature??'')||
    !verify(null,Buffer.from(body),keyOf(devicePublicKey),Buffer.from(signature.slice(8),'base64url')))throw fail();
 let p;try{p=JSON.parse(body);}catch{throw fail();}
 if(!p||Array.isArray(p)||p.purpose!==PROOF||p.deviceId!==claim.deviceId||p.origin!==claim.origin||
    p.generation!==claim.generation||p.nonce!==claim.nonce||!idPattern.test(p.deviceId)||
    !Number.isSafeInteger(p.observedAt)||!Number.isSafeInteger(p.expiresAt)||
    p.observedAt<now()-60000||p.observedAt>now()+15000||p.expiresAt<=now()||
    p.expiresAt>now()+90000||p.expiresAt<p.observedAt||
    Object.keys(p).sort().join(',')!=='deviceId,expiresAt,generation,nonce,observedAt,origin,purpose')throw fail();
 return p;
}
export async function pinnedDeviceRequest({origin,body,signature,dnsResolve=resolve4,requestImpl=httpsRequest}={}){
 const u=pinnedDeviceOrigin(origin);
 if(typeof body!=='string'||Buffer.byteLength(body)>4096||!sigPattern.test(signature??''))throw fail();
 const addresses=await dnsResolve(u.hostname).catch(()=>{throw fail();});
 if(!Array.isArray(addresses)||addresses.length<1||addresses.length>16||
    !addresses.every(publicDeviceIPv4))throw fail();
 const ip=addresses[0];
 return await new Promise((resolve,reject)=>{
  const req=requestImpl({protocol:'https:',hostname:u.hostname,port:443,path:'/v1/enrollment/probe',
   method:'POST',rejectUnauthorized:true,servername:u.hostname,
   lookup:(host,options,cb)=>cb(null,ip,4),
   headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),'x-robinson-signature':signature}},res=>{
    if(res.statusCode!==200||res.headers.location){res.resume();reject(fail());return;}
    const chunks=[];let length=0;
    res.on('data',part=>{length+=part.length;if(length>8192){req.destroy(fail());return;}chunks.push(part);});
    res.on('end',()=>resolve({body:Buffer.concat(chunks).toString('utf8'),
      signature:String(res.headers['x-robinson-device-signature']??'')}));
    res.on('error',()=>reject(fail()));
   });
  req.on('error',()=>reject(fail()));req.setTimeout(8000,()=>req.destroy(fail()));req.end(body);
 });
}
export async function probeEnrolledDevice({record,signClaim,transport=pinnedDeviceRequest,now=Date.now}={}){
 if(!record||record.status!=='pending_canary'||!idPattern.test(record.deviceId??'')||
    !shaPattern.test(record.fingerprint??'')||typeof signClaim!=='function'||!record.publicKey)throw fail();
 const claim=deviceProbeClaim({...record,now}),body=JSON.stringify(claim),signature=signClaim(body);
 const response=await transport({origin:record.origin,body,signature});
 const proof=verifyDeviceProbeResponse(response.body,response.signature,record.publicKey,claim,{now});
 return {deviceId:record.deviceId,generation:record.generation,origin:record.origin,
  fingerprint:record.fingerprint,observedAt:proof.observedAt,transportVerified:true,executionReady:false};
}
