// PLAY-2: user-operated, fixed local runtime observation. The Ed25519 device
// private key is read from the owner's local file and never sent to the MCP.
// This is NOT attachment, network egress, runtime lease or execution admission.
import {createPrivateKey,createPublicKey,sign,verify,createHash,randomBytes} from 'node:crypto';
import {mkdir,lstat,realpath,open,rename,readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {resolve,join} from 'node:path';
import {pinnedDeviceOrigin} from '../../src/playground/device-probe.js';

const ID=/^[a-f0-9]{32}$/,BIND=/^[a-f0-9]{64}$/;
const IMAGE=/^[a-z0-9][a-z0-9._/-]*(?::[a-z0-9._-]+)?@sha256:[a-f0-9]{64}$/;
const fail=()=>new TypeError('Local device canary receipt does not match this approved image or enrollment.');
const fixedRoot=()=>join(homedir(),'.config','ras-playground');
const localKey=()=>join(fixedRoot(),'device-ed25519.pk8');
const canaryRoot=()=>join(fixedRoot(),'canary-receipts');
async function checkDir(dir){
 const s=await lstat(dir);
 if(!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o077)!==0||
   (await realpath(dir))!==resolve(dir))throw fail();
}
async function keyFromFile(path){
 const s=await lstat(path);
 if(!s.isFile()||s.isSymbolicLink()||s.size>512||(s.mode&0o077)!==0)throw fail();
 let key;try{key=createPrivateKey({key:await readFile(path),format:'der',type:'pkcs8'});}catch{throw fail();}
 if(key.asymmetricKeyType!=='ed25519')throw fail();
 return key;
}
export function localCanaryRecord({plan,origin,generation,proof,now=Date.now}={}){
 if(!plan||!ID.test(plan.deviceId??'')||!BIND.test(plan.binding??'')||
  !IMAGE.test(plan.image??'')||!Number.isSafeInteger(generation)||generation<1||
  proof?.canaryPassed!==true||proof?.controllerAdmission!==false||
  proof.deviceId!==plan.deviceId||proof.binding!==plan.binding||
  proof.node!=='24'||proof.postgres!=='15'||proof.chromium!==true||
  proof.verifiedLocalOnly!==true||proof.limits?.storageQuotaBytes!==null)throw fail();
 pinnedDeviceOrigin(origin);
 return {purpose:'robinson-playground-local-canary/v1',deviceId:plan.deviceId,
  generation,origin,workspaceBinding:plan.binding,image:plan.image,
  observedAt:now(),node24Uid1000:true,postgres15StartStop:true,chromium:true,
  localDockerIsolation:true,storageQuotaBytes:null,repositoryAttached:false,
  controllerAdmission:false};
}
export function verifyLocalCanaryReceipt(receipt,{deviceId,generation,origin,binding,image,now=Date.now,publicKey}={}){
 const {body,signature}=receipt??{};
 if(typeof body!=='string'||Buffer.byteLength(body)>4096||typeof signature!=='string'||
    !/^ed25519:[A-Za-z0-9_-]{86}$/.test(signature)||typeof publicKey!=='string'||
    !publicKey.startsWith('ed25519:'))throw fail();
 let key,row;
 try{
  key=createPublicKey({key:Buffer.from(publicKey.slice(8),'base64'),format:'der',type:'spki'});
  if(key.asymmetricKeyType!=='ed25519'||!verify(null,Buffer.from(body),key,Buffer.from(signature.slice(8),'base64url')))throw fail();
  row=JSON.parse(body);
 }catch{throw fail();}
 if(!row||Array.isArray(row)||row.purpose!=='robinson-playground-local-canary/v1'||
    row.deviceId!==deviceId||row.generation!==generation||row.origin!==origin||
    row.workspaceBinding!==binding||row.image!==image||!ID.test(row.deviceId??'')||
    !BIND.test(row.workspaceBinding??'')||!IMAGE.test(row.image??'')||
    !Number.isSafeInteger(row.observedAt)||row.observedAt>now()+15000||
    row.observedAt<=now()-300000||row.node24Uid1000!==true||row.postgres15StartStop!==true||
    row.chromium!==true||row.localDockerIsolation!==true||
    row.storageQuotaBytes!==null||row.repositoryAttached!==false||
    row.controllerAdmission!==false||
    Object.keys(row).sort().join(',')!=='chromium,controllerAdmission,deviceId,generation,image,localDockerIsolation,node24Uid1000,observedAt,origin,postgres15StartStop,purpose,repositoryAttached,storageQuotaBytes,workspaceBinding')throw fail();
 return {row,digest:createHash('sha256').update(body).digest('hex')};
}
export async function writeLocalCanaryReceipt({
 plan,origin,generation,proof,now=Date.now,root=canaryRoot(),keyPath=localKey()
}={}){
 const row=localCanaryRecord({plan,origin,generation,proof,now});
 const key=await keyFromFile(keyPath),publicKey='ed25519:'+
  createPublicKey(key).export({format:'der',type:'spki'}).toString('base64');
 const body=JSON.stringify(row),signature='ed25519:'+
  sign(null,Buffer.from(body),key).toString('base64url');
 const receipt={body,signature};
 verifyLocalCanaryReceipt(receipt,{deviceId:row.deviceId,generation,origin,
  binding:row.workspaceBinding,image:row.image,publicKey,now});
 const dir=resolve(root);
 await mkdir(dir,{recursive:true,mode:0o700});await checkDir(dir);
 const name=row.deviceId+'.json',temporary=join(dir,name+'.'+randomBytes(8).toString('hex'));
 const f=await open(temporary,'wx',0o600);
 try{await f.writeFile(JSON.stringify(receipt));await f.sync();}finally{await f.close();}
 await rename(temporary,join(dir,name));
 return {deviceId:row.deviceId,observedAt:row.observedAt,
  image:row.image,workspaceBinding:row.workspaceBinding,signatureStoredLocally:true,executionReady:false};
}
export async function readLocalCanaryReceipt({
 deviceId,origin,generation,binding,image,now=Date.now,root=canaryRoot(),publicKey
}={}){
 if(!ID.test(deviceId??''))throw fail();
 const dir=resolve(root);await checkDir(dir);
 const file=join(dir,deviceId+'.json'),s=await lstat(file);
 if(!s.isFile()||s.isSymbolicLink()||s.size>8192||(s.mode&0o077)!==0)throw fail();
 let receipt;try{receipt=JSON.parse(await readFile(file,'utf8'));}catch{throw fail();}
 return verifyLocalCanaryReceipt(receipt,{deviceId,origin,generation,binding,image,now,publicKey});
}
