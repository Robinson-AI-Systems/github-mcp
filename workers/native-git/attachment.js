import {createHash,randomBytes} from 'node:crypto';
import {mkdir,readFile,writeFile,open,rm,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {exportWorkspaceFile,importMountedWorkspace} from './snapshot.js';
const atomic=async(path,value)=>{const temp=path+'.'+randomBytes(12).toString('hex');try{const f=await open(temp,'wx',0o600);try{await f.writeFile(JSON.stringify(value));await f.sync();}finally{await f.close();}await rename(temp,path);}finally{await rm(temp,{force:true});}};
const hash=b=>createHash('sha256').update(b).digest('hex');
export async function attachmentRequest(worker,claim,{singleWorkspaceId}={}){
 const o=claim.options??{},id=claim.workspace_id;
 if(!/^git_[a-f0-9]{32}$/.test(id??''))throw new TypeError('Invalid attachment workspace.');
 if(!/^[a-f0-9]{64}$/.test(o.transferId??'')||Object.keys(o).some(k=>!['transferId','mode','key','offset','base64','bytes','digest','expectedGeneration'].includes(k)))throw new TypeError('Invalid private attachment envelope.');
 if(claim.allowWrite!==true)throw new TypeError('Attachment requires current write authorization.');await worker.access(claim.binding,true);
 const dir=join(worker.root,'.attachments',id,o.transferId);await mkdir(dir,{recursive:true,mode:0o700});
 const requestLock=await open(join(dir,'request.lock'),'wx',0o600);
 try{
 const metaPath=join(dir,'transfer.json'),dataPath=join(dir,'sealed.bin');
 if(claim.action==='attachment_export'){
  const w=await worker.workspace(id,claim.binding,false,o.mode==='release');
  if(o.mode==='prepare'){
   if(!Number.isSafeInteger(o.expectedGeneration)||o.expectedGeneration!==w.meta.generation)throw new TypeError('Attachment source generation changed.');
   let prior;try{prior=JSON.parse(await readFile(metaPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
   if(prior){if(prior.generation!==o.expectedGeneration)throw new TypeError('Attachment intent conflicts.');return prior;}
   await rm(dataPath,{force:true});await exportWorkspaceFile({root:worker.root,id,key:o.key,path:dataPath,expectedGeneration:o.expectedGeneration});const digest=createHash('sha256'),file=await open(dataPath,'r');let size=0;try{const buffer=Buffer.alloc(262144);for(;;){const r=await file.read(buffer,0,buffer.length,size);if(!r.bytesRead)break;digest.update(buffer.subarray(0,r.bytesRead));size+=r.bytesRead;}}finally{await file.close();}const meta={transferId:o.transferId,generation:o.expectedGeneration,bytes:size,digest:digest.digest('hex')};
   await atomic(metaPath,meta);return meta;
  }
  if(o.mode==='release'){let freeze;try{freeze=JSON.parse(await readFile(join(w.dir,'attachment-freeze.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}if(freeze?.transferId===o.transferId){await rm(join(w.dir,'attachment-freeze.json'),{force:true});await rm(join(w.dir,'mutation.lock'),{force:true});}await rm(dir,{recursive:true,force:true});return {released:true};}
  const meta=JSON.parse(await readFile(metaPath,'utf8'));
  if(meta.generation!==w.meta.generation)throw new TypeError('Attachment source changed; no stale transfer can be finalized.');
  if(o.mode==='freeze'){
   let old;try{old=JSON.parse(await readFile(join(w.dir,'attachment-freeze.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
   if(old){if(old.transferId!==o.transferId||old.generation!==meta.generation)throw new TypeError('Another attachment owns the source lease.');return {frozen:true,generation:meta.generation};}
   const lease=await open(join(w.dir,'mutation.lock'),'wx',0o600);try{if(JSON.parse(await readFile(join(w.dir,'workspace.json'),'utf8')).generation!==meta.generation)throw new TypeError('Source changed before attachment finalization.');await writeFile(join(w.dir,'attachment-freeze.json'),JSON.stringify({transferId:o.transferId,generation:meta.generation}),{flag:'wx',mode:0o600});}catch(e){await rm(join(w.dir,'mutation.lock'),{force:true});throw e;}finally{await lease.close();}return {frozen:true,generation:meta.generation};
  }
  if(o.mode!=='read'||!Number.isSafeInteger(o.offset)||o.offset<0||o.offset>meta.bytes)throw new TypeError('Invalid attachment byte window.');
  const f=await open(dataPath,'r');try{const b=Buffer.alloc(Math.min(262144,meta.bytes-o.offset));const {bytesRead}=await f.read(b,0,b.length,o.offset);return {...meta,offset:o.offset,base64:b.subarray(0,bytesRead).toString('base64'),nextOffset:o.offset+bytesRead};}finally{await f.close();}
 }
 if(singleWorkspaceId!==id)throw new TypeError('Attachment import is restricted to one immutable dedicated Git broker.');
 if(o.mode==='begin'){
  if(!Number.isSafeInteger(o.bytes)||o.bytes<32||o.bytes>150*1024*1024||!/^[a-f0-9]{64}$/.test(o.digest??''))throw new TypeError('Invalid sealed attachment size/hash.');
  const meta={transferId:o.transferId,bytes:o.bytes,digest:o.digest,offset:0};try{await writeFile(metaPath,JSON.stringify(meta),{flag:'wx',mode:0o600});await writeFile(dataPath,Buffer.alloc(0),{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;const prior=JSON.parse(await readFile(metaPath,'utf8'));if(prior.bytes!==meta.bytes||prior.digest!==meta.digest)throw new TypeError('Attachment intent differs.');return prior;}return meta;
 }
 const meta=JSON.parse(await readFile(metaPath,'utf8'));
 if(o.mode==='append'){
  if(o.offset!==meta.offset||typeof o.base64!=='string'||o.base64.length>349528||Buffer.from(o.base64,'base64').toString('base64')!==o.base64)throw new TypeError('Attachment window differs; inspect its original offset.');
  const b=Buffer.from(o.base64,'base64');if(!b.length||meta.offset+b.length>meta.bytes)throw new TypeError('Attachment exceeds its declared bound.');const f=await open(dataPath,'r+');try{await f.write(b,0,b.length,meta.offset);await f.sync();}finally{await f.close();}meta.offset+=b.length;await atomic(metaPath,meta);return meta;
 }
 if(o.mode==='status')return meta;
 if(o.mode!=='finish'||meta.offset!==meta.bytes)throw new TypeError('Attachment upload is incomplete.');const bytes=await readFile(dataPath);if(bytes.length!==meta.bytes||hash(bytes)!==meta.digest)throw new TypeError('Attachment ciphertext hash differs.');
 const expectedBinding=createHash('sha256').update(JSON.stringify(['authority','connection','owner','repo'].map(k=>claim.binding[k]))).digest('hex');
 return importMountedWorkspace({root:worker.root,id,bytes,key:o.key,expectedBinding});
 }finally{await requestLock.close();await rm(join(dir,'request.lock'),{force:true});}
}
