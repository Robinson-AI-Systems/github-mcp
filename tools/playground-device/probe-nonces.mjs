// PLAY-2 device-side replay tombstones survive receiver restarts. This is
// local-only, owner-private state; no GitHub credentials or private key content.
import {createHash} from 'node:crypto';
import {mkdir,lstat,realpath,readdir,rm,open} from 'node:fs/promises';
import {homedir} from 'node:os';
import {resolve,join} from 'node:path';

const ID=/^[a-f0-9]{32}$/;
const deny=()=>new TypeError('Signed device claim replay storage unavailable or already consumed.');
const checkDir=async(dir)=>{
 const stat=await lstat(dir);
 if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o077)!==0||
    (await realpath(dir))!==resolve(dir))throw deny();
};
export async function createPersistentProbeNonceStore({
 root=join(homedir(),'.config','ras-playground','probe-replay'),now=Date.now
}={}){
 if(typeof root!=='string'||!root.startsWith('/')||root.length>2048)throw deny();
 const dir=resolve(root);
 await mkdir(dir,{recursive:true,mode:0o700});
 await checkDir(dir);
 let lastPrunedBucket=-1;
 return async claim=>{
  if(!claim||!ID.test(claim.deviceId??'')||!ID.test(claim.nonce??'')||
     !Number.isSafeInteger(claim.generation)||claim.generation<1||
     !Number.isSafeInteger(claim.expiresAt)||claim.expiresAt<=now()||
     claim.expiresAt>now()+90000)throw deny();
  const bucket=Math.floor(claim.expiresAt/86400000);
  if(lastPrunedBucket!==bucket){
   const names=await readdir(dir,{withFileTypes:true});
   for(const entry of names){
    if(!/^day-[0-9]{1,8}$/.test(entry.name))throw deny();
    const old=Number(entry.name.slice(4));
    if(old<bucket-2){
     if(!entry.isDirectory())throw deny();
     await rm(join(dir,entry.name),{recursive:true,force:true});
    }
   }
   lastPrunedBucket=bucket;
  }
  const folder=join(dir,'day-'+bucket);
  await mkdir(folder,{mode:0o700});await checkDir(folder);
  const key=createHash('sha256').update(JSON.stringify([
   claim.deviceId,claim.generation,claim.nonce,claim.origin
  ])).digest('hex');
  let handle;
  try{handle=await open(join(folder,key),'wx',0o600);}
  catch{throw deny();}
  try{await handle.writeFile(String(claim.expiresAt));await handle.sync();}
  finally{await handle.close();}
  return true;
 };
}
