#!/usr/bin/env node
// PLAY-2 owner-run first pairing leg. No GitHub/tunnel token is accepted, read
// or sent. This does NOT install/enable the runtime, and never skips its canary.
import {createHash,createPrivateKey,generateKeyPairSync,sign} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import readline from 'node:readline/promises';

const sha=v=>createHash('sha256').update(v).digest('hex');
const KEY_NAME='device-ed25519.pk8';
const message=(deviceId,code,origin)=>JSON.stringify({
  purpose:'robinson-playground-device-pair/v1',deviceId,code,origin
});
export async function loadOrCreateDeviceKey(dir=join(homedir(),'.config','ras-playground')){
 await mkdir(dir,{recursive:true,mode:0o700});
 const keyPath=join(dir,KEY_NAME);
 let privateKey;
 try{privateKey=createPrivateKey({key:await readFile(keyPath),format:'der',type:'pkcs8'});}
 catch(error){
  if(error.code!=='ENOENT')throw error;
  const generated=generateKeyPairSync('ed25519');
  const der=generated.privateKey.export({format:'der',type:'pkcs8'});
  try{await writeFile(keyPath,der,{flag:'wx',mode:0o600});privateKey=generated.privateKey;}
  catch(e){if(e.code!=='EEXIST')throw e;privateKey=createPrivateKey({key:await readFile(keyPath),format:'der',type:'pkcs8'});}
 }
 if(privateKey.asymmetricKeyType!=='ed25519')throw new Error('Device key must be Ed25519');
 // Only the private KeyObject is returned to the current local process.
 return {privateKey};
}
export async function pairOwnedDevice({deviceId,code,origin,control='https://github.robinsonaisystems.com',keyDir,fetchImpl=fetch}={}){
 if(!/^[a-f0-9]{32}$/.test(deviceId??'')||!/^[A-Za-z0-9_-]{43}$/.test(code??''))
  throw new Error('Use the one-time device ID and pairing code from your own My connection page.');
 let tunnel,controller;
 try{tunnel=new URL(origin);controller=new URL(control);}catch{throw new Error('Invalid HTTPS origin.');}
 if(tunnel.protocol!=='https:'||controller.protocol!=='https:'||tunnel.username||tunnel.password||
    tunnel.port||tunnel.pathname!=='/'||tunnel.search||tunnel.hash||controller.username||
    controller.password||controller.search||controller.hash||controller.pathname!=='/')
   throw new Error('The paired device and controller both require bare HTTPS origins.');
 const {privateKey}=await loadOrCreateDeviceKey(keyDir);
 const publicDer=(await import('node:crypto')).createPublicKey(privateKey).export({format:'der',type:'spki'});
 const publicKey='ed25519:'+publicDer.toString('base64url');
 const signature=sign(null,Buffer.from(message(deviceId,code,tunnel.origin)),privateKey).toString('base64url');
 const response=await fetchImpl(new URL('/api/playground/enroll',controller).href,{method:'POST',redirect:'error',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify({deviceId,code,origin:tunnel.origin,publicKey,signature})});
 if(!response.ok)throw new Error('Pairing was not accepted. Obtain a fresh code from My connection.');
 const result=await response.json();
 if(result.deviceId!==deviceId||result.status!=='pending_confirm'||result.fingerprint!==sha(publicDer))
  throw new Error('Pairing response did not confirm this exact device fingerprint.');
 return {deviceId,fingerprint:result.fingerprint,origin:tunnel.origin,status:result.status,
   next:'Compare this fingerprint on My connection and approve it. Canary/runtime admission is a separate step.'};
}
async function main(){
 const rl=readline.createInterface({input:process.stdin,output:process.stdout});
 try{
  const deviceId=(await rl.question('Device ID from your My connection page: ')).trim();
  const code=(await rl.question('One-time pairing code (not a GitHub token): ')).trim();
  const origin=(await rl.question('Your own outbound HTTPS tunnel origin: ')).trim();
  const result=await pairOwnedDevice({deviceId,code,origin});
  process.stdout.write('Device proof accepted. Fingerprint: '+result.fingerprint+'\n'+result.next+'\n');
 }finally{rl.close();}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 main().catch(error=>{process.stderr.write('Pairing failed: '+error.message+'\n');process.exitCode=1;});
}
