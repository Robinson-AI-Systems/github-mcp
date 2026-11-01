import {generateKeyPairSync} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {playgroundBinding} from '../../src/playground/client.js';
import {nativeConnection} from '../../src/native-git/client.js';
import {prepareEnrolledPlacement,inspectEnrolledPlacement,enrolledPlacementKey}
 from '../../src/playground/enrolled-placement.js';
import {tools} from '../../src/tools/playground.js';

const now=()=>1800000000000,deviceId='1'.repeat(32);
const image='ghcr.io/robinson/playground@sha256:'+'d'.repeat(64);
const key='ed25519:'+generateKeyPairSync('ed25519').publicKey.export({format:'der',type:'spki'}).toString('base64');
function memory(){
 const map=new Map();
 return {
  getSetting:async k=>structuredClone(map.get(k)??null),
  setSetting:async(k,v)=>map.set(k,structuredClone(v)),
  compareAndSetSetting:async(k,expected,value)=>{
   if((map.get(k)?.revision??0)!==expected)return null;
   map.set(k,structuredClone(value));return structuredClone(value);
  }
 };
}
function fixture(){
 const db=memory(),connection={client_id:'client-1',profile:'full',default_account:'sample-owner'},
  scope={tenantId:'tenant-a',identityId:'identity-a',membershipRevision:1},
  ctx={db,connection,now};
 db.playgroundScope=scope;
 const record={row:{id:'job_'+'a'.repeat(16),owner:'sample-owner',repo:'web-app',state:'pending'},
  worker:'git_'+'b'.repeat(32),
  binding:{authority:'c'.repeat(32),connection:nativeConnection(ctx),owner:'sample-owner',repo:'web-app'}};
 const binding=playgroundBinding(record);
 const host={kind:'playground-enrolled-host',tenantId:scope.tenantId,identityId:scope.identityId,
  clientId:'client-1',deviceId,generation:1,status:'pending_canary',
  fingerprint:'e'.repeat(64),publicKey:key,origin:'https://owner-owned-tunnel.example.test',
  pairedAt:now()-10000,transportVerifiedAt:now()-1000,localCanaryAt:now()-1000,
  localCanaryBinding:binding,localCanaryImage:image,localCanaryReceiptHash:'f'.repeat(64)};
 return {db,ctx,record,binding,host};
}
async function withHost(){const f=fixture();await f.db.setSetting('pg_host.'+deviceId,f.host);return f;}
describe('PLAY-2 tenant-scoped non-executable enrolled allocation pin',()=>{
 it('creates one exact owner/connection/source/device intent, never a runnable allocation',async()=>{
  const f=await withHost();
  const p=await prepareEnrolledPlacement(f.ctx,f.record,deviceId);
  expect(p).toMatchObject({placement:'enrolled',workspace_id:f.record.row.id,
   device_id:deviceId,generation:1,phase:'awaiting_source',
   repository_attached:false,execution_available:false,command_started:false});
  expect(await prepareEnrolledPlacement(f.ctx,f.record,deviceId)).toEqual(p);
  expect(await inspectEnrolledPlacement(f.ctx,f.record)).toEqual(p);
  const raw=await f.db.getSetting(enrolledPlacementKey(f.binding));
  expect(raw).toMatchObject({kind:'playground-enrolled-allocation/v1',tenantId:'tenant-a',
   identityId:'identity-a',clientId:'client-1',deviceId,
   binding:f.binding,workspace:f.record.row.id,worker:f.record.worker,
   sourceAttached:false,executionReady:false,image,phase:'awaiting_source'});
  expect(raw).not.toHaveProperty('credential');
  expect(raw).not.toHaveProperty('privateKey');
  expect(raw.origin).toBe(f.host.origin);
 });
 it('refuses the wrong identity, connection, delegated pass, non-full grant and misbound repo',async()=>{
  for(const patch of [
   {scope:{tenantId:'tenant-a',identityId:'identity-b',membershipRevision:1}},
   {connection:{client_id:'client-b',profile:'full',default_account:'sample-owner'}},
   {connection:{client_id:'client-1',profile:'read_only',default_account:'sample-owner'}},
   {connection:{client_id:'client-1',profile:'full',pass:true}},
   {connection:{client_id:'client-1',profile:'full',pass_id:'opaque-pass'}}
  ]){
   const f=await withHost(),ctx={...f.ctx,...patch};
   if(patch.scope)ctx.db.playgroundScope=patch.scope;
   await expect(prepareEnrolledPlacement(ctx,f.record,deviceId)).rejects.toThrow();
  }
  const f=await withHost();
  await expect(prepareEnrolledPlacement(f.ctx,{...f.record,worker:'git_'+'f'.repeat(32)},deviceId))
   .rejects.toThrow(/exact workspace/);
 });
 it('refuses stale canary, another binding, a competing device or an existing operator allocation',async()=>{
  const f=await withHost();
  await f.db.setSetting('pg_host.'+deviceId,{...f.host,localCanaryAt:now()-300001});
  await expect(prepareEnrolledPlacement(f.ctx,f.record,deviceId)).rejects.toThrow(/signed/);
  await f.db.setSetting('pg_host.'+deviceId,{...f.host,localCanaryBinding:'a'.repeat(64)});
  await expect(prepareEnrolledPlacement(f.ctx,f.record,deviceId)).rejects.toThrow(/signed/);
  await f.db.setSetting('pg_host.'+deviceId,f.host);
  await f.db.setSetting('playground.'+f.binding.slice(0,40),{binding:f.binding,phase:'attached'});
  await expect(prepareEnrolledPlacement(f.ctx,f.record,deviceId)).rejects.toThrow(/operator allocation/);
 });
 it('pins generation/fingerprint/HTTPS origin and refuses an implicit transfer after revocation',async()=>{
  const f=await withHost();
  await prepareEnrolledPlacement(f.ctx,f.record,deviceId);
  const changed={...f.host,generation:2,status:'revoked'};
  await f.db.setSetting('pg_host.'+deviceId,changed);
  expect(await inspectEnrolledPlacement(f.ctx,f.record)).toMatchObject({
   phase:'enrollment_revoked',execution_available:false});
  await expect(prepareEnrolledPlacement(f.ctx,f.record,deviceId)).rejects.toThrow(/existing/);
 });
 it('two concurrent identical requests resolve to exactly one tenant row, not two physical allocations',async()=>{
  const f=await withHost();
  const attempts=await Promise.allSettled([
   prepareEnrolledPlacement(f.ctx,f.record,deviceId),
   prepareEnrolledPlacement(f.ctx,f.record,deviceId)
  ]);
  expect(attempts.some(x=>x.status==='fulfilled')).toBe(true);
  expect((await f.db.getSetting(enrolledPlacementKey(f.binding))).revision).toBe(1);
 });
 it('retains existing execute/read/cancel tool names and only augments the existing workspace tool',()=>{
  expect(tools.filter(t=>t.name.startsWith('github_playground_')).map(t=>t.name)).toEqual([
   'github_playground_execute','github_playground_read','github_playground_cancel','github_playground_workspace'
  ]);
  const workspace=tools.find(t=>t.name==='github_playground_workspace');
  expect(workspace.inputSchema.properties.placement.enum).toEqual(['operator','enrolled']);
  expect(workspace.inputSchema.properties.device_id.pattern).toBe('^[a-f0-9]{32}$');
  for(const operation of ['github_playground_execute','github_playground_read','github_playground_cancel'])
   expect(tools.find(t=>t.name===operation).inputSchema.properties).not.toHaveProperty('device_id');
 });
});
