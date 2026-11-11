// SWEEP-ORPHAN-1: a cleanup-requested allocation whose provider app was never
// created (no composeId, and provider inventory holds zero matches for its plan
// name) could never be adopted by the sweep's one-match rule, so it deferred
// every cycle forever — the Nov-8 record job_b4dc31759005e8d8 sat in 'creating'
// across 16 healthy sweep cycles in the 2026-11-11 deliberate fire while a
// composeId-bearing record beside it disposed in the same window. These tests
// pin the retirement: zero matches + cleanupRequested + no composeId retires
// the record in place with orphan journaling; every neighbouring shape still
// defers or follows the unchanged adoption/disposal paths.
import {it,expect} from 'vitest';
import {sweepAllocations} from '../../src/playground/manager.js';
import {playgroundBinding} from '../../src/playground/client.js';
import {nativeConnection} from '../../src/native-git/client.js';
const NOW=1794422400000;
const PLAN_NAME='ras-pg-e195a6df41d59e9d71e439232394b48f';
const env={PLAYGROUND_DOKPLOY_ORIGIN:'https://dokploy.example.test',PLAYGROUND_DOKPLOY_API_KEY:'FAKE_PROVIDER_KEY',PLAYGROUND_DOKPLOY_PROJECT_ID:'fixture-project',PLAYGROUND_DOKPLOY_ENVIRONMENT_ID:'fixture-env',PLAYGROUND_BUILD_SOURCE_SHA:'a'.repeat(40),PLAYGROUND_INGRESS_IPV4:'107.90.116.157',PUBLIC_BASE_URL:'https://mcp.example.test'};
// The stored record, modeled on the LIVE Nov-8 record the fire read back:
// phase 'creating', cleanupRequested true, revision 3, a full plan — and no
// composeId, because the provider create never landed.
function liveRecord(patch={}){
 const native={binding:{authority:'authority-fixture',connection:'connection-fixture',owner:'christcr2012',repo:'penpal'},worker:'git_'+'a'.repeat(32),job:{id:'job_b4dc31759005e8d8',idleTimeoutMs:3600000}};
 const binding=playgroundBinding({row:{id:'job_b4dc31759005e8d8',owner:'christcr2012',repo:'penpal'},...native});
 const connection=nativeConnection({connection:{client_id:'client-fixture',pass_id:'pass-fixture'}});
 return {kind:'playground-allocation',revision:3,pool:'default',scope:{legacy:true},delegated:false,
  providerOrigin:'https://dokploy.example.test',providerProject:'fixture-project',providerEnvironment:'fixture-env',
  binding,connection,clientId:'client-fixture',passId:'pass-fixture',
  workspace:'job_b4dc31759005e8d8',owner:'christcr2012',repo:'penpal',phase:'creating',cleanupRequested:true,
  planHash:'b'.repeat(64),plan:{name:PLAN_NAME,planHash:'b'.repeat(64)},
  native,createdAt:1793918400000,progressAt:1793918400000,expiresAt:1794528000000,...patch};
}
function makeDb(record){
 let current=record;const writes=[];const key='playground.'+record.binding.slice(0,40);
 return {writes,get current(){return current;},
  getSetting:async name=>name===key?current:null,
  compareAndSetSetting:async(name,revision,value)=>{if(name!==key||revision!==current.revision)return null;current=value;writes.push(value);return value;}};
}
function makeRoot(record){
 let cursor=null;const indexKey='pg_index.'+record.binding.slice(0,40);
 const indexes=new Map([[indexKey,{kind:'playground-index',allocation:record,revision:1}]]);
 return {indexKey,get cursor(){return cursor;},get indexed(){return indexes.get(indexKey);},
  getSetting:async key=>key==='playground_sweep_cursor'?cursor:(indexes.get(key)??null),
  compareAndSetSetting:async(key,revision,value)=>{
   if(key==='playground_sweep_cursor'){if(revision!==(cursor?.revision??0))return null;cursor=value;return value;}
   const old=indexes.get(key);if(revision!==(old?.revision??0))return null;indexes.set(key,value);return value;},
  listPlaygroundIndexes:async()=>[{setting:indexKey,value:indexes.get(indexKey)}]};
}
function providerFake({inventory=[],inventoryError=null}={}){
 const calls={inventory:0,inspect:[],stop:0,remove:0,absent:0};
 return {calls,
  inventory:async()=>{calls.inventory++;if(inventoryError)throw inventoryError;return inventory;},
  inspect:async(id,plan)=>{calls.inspect.push(id);return {composeId:id,appName:plan.name+'-x1abcd',composeStatus:'done'};},
  stop:async()=>{calls.stop++;},containers:async()=>[],remove:async()=>{calls.remove++;},
  absent:async()=>{calls.absent++;return true;}};
}
async function runSweep(record,provider){
 const db=makeDb(record),root=makeRoot(record);
 const ctx={stored:record,db,env,fetch:undefined};
 const result=await sweepAllocations({root,env,now:()=>NOW,load:async()=>ctx,authorityOf:async()=>({cleanup:true}),
  providerFactory:()=>provider,warm:async()=>({enabled:false,running:0,pending:false})});
 return {result,db,root};
}
it('retires a cleanup-requested record whose provider app was never created (the live Nov-8 shape)',async()=>{
 const provider=providerFake({inventory:[]});
 const {result,db,root}=await runSweep(liveRecord(),provider);
 expect(provider.calls.inventory).toBe(1);
 expect(result).toMatchObject({inspected:1,disposed:1,pending:0});
 const retired=db.current;
 expect(retired).toMatchObject({phase:'disposed',disposed:true,disposedAt:NOW,neverAllocated:true,
  orphanRetired:true,orphanReason:'provider_inventory_zero_matches',revision:4,workspace:'job_b4dc31759005e8d8'});
 expect(retired.composeId).toBeUndefined();
 // The index the sweep reads back carries the same terminal, journaled record,
 // and the cursor still advanced past the row.
 expect(root.indexed.allocation).toMatchObject({phase:'disposed',orphanRetired:true});
 expect(root.cursor.revision).toBe(1);
 // No provider mutation of any kind: nothing existed to stop, remove or adopt.
 expect(provider.calls.inspect).toEqual([]);expect(provider.calls.stop).toBe(0);expect(provider.calls.remove).toBe(0);
});
it('defers a zero-match record that was never asked to clean up',async()=>{
 const provider=providerFake({inventory:[]});
 const {result,db}=await runSweep(liveRecord({cleanupRequested:false}),provider);
 expect(result).toMatchObject({inspected:1,disposed:0,pending:1});
 expect(db.writes).toEqual([]);expect(db.current.phase).toBe('creating');expect(db.current.orphanRetired).toBeUndefined();
});
it('defers when inventory holds more than one match for the plan name',async()=>{
 const provider=providerFake({inventory:[{name:PLAN_NAME,composeId:'ambiguous-1'},{appName:PLAN_NAME,composeId:'ambiguous-2'}]});
 const {result,db}=await runSweep(liveRecord(),provider);
 expect(result).toMatchObject({inspected:1,disposed:0,pending:1});
 expect(db.writes).toEqual([]);expect(db.current.phase).toBe('creating');
 expect(provider.calls.inspect).toEqual([]);
});
it('defers when the inventory read itself fails — nothing is retired on an unreadable inventory',async()=>{
 const provider=providerFake({inventoryError:new Error('provider unreachable')});
 const {result,db}=await runSweep(liveRecord(),provider);
 expect(result).toMatchObject({inspected:1,disposed:0,pending:1});
 expect(db.writes).toEqual([]);expect(db.current.phase).toBe('creating');expect(db.current.orphanRetired).toBeUndefined();
});
it('never takes the orphan path for a record that already holds a composeId',async()=>{
 const provider=providerFake({inventory:[]});
 const {db}=await runSweep(liveRecord({composeId:'owned-compose-1'}),provider);
 // The adoption block (and its inventory read) is skipped entirely; disposal
 // runs through the ordinary provider path and lands without orphan journaling.
 expect(provider.calls.inventory).toBe(0);
 expect(db.current).toMatchObject({phase:'disposed',disposed:true,cleanupEvidence:'provider_readback'});
 expect(db.current.orphanRetired).toBeUndefined();
});
it('keeps exactly-one-match adoption unchanged: the record adopts, then disposes through the provider',async()=>{
 const provider=providerFake({inventory:[{name:PLAN_NAME,composeId:'found-compose-1'}]});
 const {db}=await runSweep(liveRecord(),provider);
 expect(provider.calls.inventory).toBe(1);
 expect(provider.calls.inspect).toContain('found-compose-1');
 expect(db.current).toMatchObject({phase:'disposed',disposed:true,composeId:'found-compose-1',cleanupEvidence:'provider_readback'});
 expect(db.current.orphanRetired).toBeUndefined();
});
