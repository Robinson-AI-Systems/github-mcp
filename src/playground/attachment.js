import {indexAllocation} from './index.js';
import {createHash} from 'node:crypto';
import {callNativeWorker} from '../native-git/client.js';
import {signNativeWorkerBody} from '../native-git/signing.js';
import {playgroundBinding,callPlayground} from './client.js';
const hash=x=>createHash('sha256').update(x).digest('hex');
const failure=message=>Object.assign(new TypeError(message),{safeMessage:true,safeCode:'playground_attachment_pending'});
const keyFor=(ctx,binding,id)=>createHash('sha256').update(signNativeWorkerBody(JSON.stringify({purpose:'robinson-playground-attachment-key/v1',binding,id}),ctx.env)).digest('base64');
export async function attachRepository(ctx,record,{budgetMs=15000}={}){
 const binding=playgroundBinding(record),setting='playground.'+binding.slice(0,40),started=Date.now();
 let stored=await ctx.db.getSetting(setting);if(stored?.binding!==binding||!stored.composeId||!['allocated','attaching','attached'].includes(stored.phase))throw failure('Allocate this exact workspace before attaching its repository.');
 const save=async patch=>{const next=await ctx.db.compareAndSetSetting(setting,stored.revision,{...stored,...patch,revision:stored.revision+1});if(!next)throw failure('Another attachment transition is in progress; inspect the original allocation.');stored=next;await indexAllocation(ctx,stored);};
 const sourceJob={...record.job,brokerOrigin:undefined,allocationBinding:undefined};
 const brokerJob={...record.job,brokerOrigin:stored.plan.origin,allocationBinding:binding};
 const invoke=(job,action,options)=>callNativeWorker(ctx,{binding:record.binding,workspace_id:record.worker,job,action,options,allowWrite:true,renewLease:false});
 if(stored.phase==='attached'){if(stored.transfer)await invoke(sourceJob,'attachment_export',{mode:'release',transferId:stored.transfer.transferId});return stored;}
 const [sourceCap,brokerCap]=await Promise.all([callNativeWorker(ctx,{action:'capabilities',job:sourceJob}),callNativeWorker(ctx,{action:'capabilities',job:brokerJob})]);
 if(sourceCap.repository_attachment!=='sealed-mounted-v1'||brokerCap.repository_attachment!=='sealed-mounted-v1')throw failure('Update the Git worker/broker to the checked sealed attachment protocol. No shared-worker command execution is used.');
 if(!stored.transfer){
  const state=await callNativeWorker(ctx,{binding:record.binding,workspace_id:record.worker,job:sourceJob,action:'inspect'});
  const id=hash(JSON.stringify([binding,state.generation])),key=keyFor(ctx,binding,id);
  const prepared=await invoke(sourceJob,'attachment_export',{mode:'prepare',transferId:id,key,expectedGeneration:state.generation});
  if(prepared.transferId!==id||prepared.generation!==state.generation||!Number.isSafeInteger(prepared.bytes)||prepared.bytes<32||prepared.bytes>150*1024*1024||!/^[a-f0-9]{64}$/.test(prepared.digest??''))throw failure('Source attachment manifest was not independently confirmed.');
  await save({phase:'attaching',transfer:{...prepared,sourceHead:state.head,sourceStatus:state.status,offset:0}});
 }
 const t=stored.transfer,key=keyFor(ctx,binding,t.transferId);
 let receiver=await invoke(brokerJob,'attachment_import',{mode:'begin',transferId:t.transferId,bytes:t.bytes,digest:t.digest});
 if(receiver.transferId!==t.transferId||receiver.bytes!==t.bytes||receiver.digest!==t.digest||!Number.isSafeInteger(receiver.offset)||receiver.offset<0||receiver.offset>t.bytes)throw failure('Receiver attachment identity/offset differs.');
 while(receiver.offset<t.bytes&&Date.now()-started<budgetMs){
  const page=await invoke(sourceJob,'attachment_export',{mode:'read',transferId:t.transferId,offset:receiver.offset});
  if(page.digest!==t.digest||page.offset!==receiver.offset||page.nextOffset<=receiver.offset||page.nextOffset>t.bytes||typeof page.base64!=='string'||Buffer.from(page.base64,'base64').length!==page.nextOffset-page.offset)throw failure('Sealed attachment window differs; no unverified bytes were accepted.');
  receiver=await invoke(brokerJob,'attachment_import',{mode:'append',transferId:t.transferId,offset:receiver.offset,base64:page.base64});
 }
 if(receiver.offset<t.bytes){await save({transfer:{...t,offset:receiver.offset}});return stored;}
 const frozen=await invoke(sourceJob,'attachment_export',{mode:'freeze',transferId:t.transferId});if(!frozen.frozen||frozen.generation!==t.generation)throw failure('Source finalization lease differs.');
 const imported=await invoke(brokerJob,'attachment_import',{mode:'finish',transferId:t.transferId,key});
 if(imported.digest!==t.digest||imported.complete!==true||imported.generation!==t.generation)throw failure('Receiver did not verify the full repository attachment.');
 const [source,target,runtime]=await Promise.all([
  invoke(sourceJob,'inspect',{includeRepository:true}),invoke(brokerJob,'inspect',{includeRepository:true}),
  callPlayground(ctx,{...record,job:brokerJob,allocation:{binding,url:new URL('/v1/coding',stored.plan.origin).href}},'capabilities')
 ]);
 if(source.generation!==t.generation||target.generation!==t.generation||source.head!==t.sourceHead||target.head!==source.head||source.status!==target.status||!/^ed25519:[A-Za-z0-9+/=]+$/.test(runtime.identity_key??'')||!runtime.repository?.worktree||runtime.repository.worktree!==brokerCap.repository?.worktree||runtime.repository.git!==brokerCap.repository?.git||runtime.repository.gitReadOnly!==true||brokerCap.repository.gitReadOnly!==false)throw failure('Generation, ancestry, local changes or shared/read-only mount evidence differs. Both copies remain preserved.');
 await save({phase:'attached',origin:stored.plan.origin,brokerOrigin:stored.plan.origin,repositoryAttached:true,runtimePublicKey:runtime.identity_key,attachment:{cipherHash:t.digest,generation:t.generation,head:t.sourceHead,files:imported.files,bytes:imported.bytes,mounts:runtime.repository}});
 await invoke(sourceJob,'attachment_export',{mode:'release',transferId:t.transferId});return stored;
}
