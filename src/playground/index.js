import {neon} from '@neondatabase/serverless';
import {createDb} from '../db.js';
export const rootAllocationDb=ctx=>ctx.publicDb??(ctx.db.playgroundScope?.tenantId?createDb(neon(ctx.env.DATABASE_URL)):ctx.db);
export const indexKey=binding=>'pg_index.'+binding.slice(0,40);
export async function indexAllocation(ctx,allocation){
 const db=rootAllocationDb(ctx),key=indexKey(allocation.binding);
 for(let attempt=0;attempt<3;attempt++){
  const old=await db.getSetting(key);if(old?.allocation?.binding&&old.allocation.binding!==allocation.binding)throw new TypeError('Allocation index identity differs.');
  if((old?.allocation?.revision??0)>allocation.revision)return;
  if(await db.compareAndSetSetting(key,old?.revision??0,{kind:'playground-index',allocation,revision:(old?.revision??0)+1}))return;
 }
 throw new TypeError('Allocation index update conflicted; inspect the recorded provider intent.');
}
// Trusted maintenance only. Survives removal of a tenant namespace without
// falling back to an owner's credentials or guessing provider resource ownership.
export function orphanAllocationContext(root,index,env){
 let current=index;
 const key='playground.'+current.allocation.binding.slice(0,40);
 return {env,publicDb:root,namespaceMissing:true,stored:current.allocation,connection:{client_id:current.allocation.clientId,pass_id:current.allocation.passId},db:{
  getSetting:async name=>name===key?current.allocation:null,
  compareAndSetSetting:async(name,revision,value)=>{if(name!==key||revision!==current.allocation.revision)return null;const next=await root.compareAndSetSetting(indexKey(value.binding),current.revision,{...current,revision:current.revision+1,allocation:value});if(!next)return null;current=next;return value;}
 }};
}
