import {randomBytes,generateKeyPairSync} from 'node:crypto';
import pg from 'pg';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {createDb} from '../../src/db.js';
import {nativeConnection} from '../../src/native-git/client.js';
import {playgroundBinding} from '../../src/playground/client.js';
import {prepareEnrolledPlacement,inspectEnrolledPlacement,enrolledPlacementKey}
 from '../../src/playground/enrolled-placement.js';

const clients=[],schemas=[];
async function createTestDb(url){
 const client=new pg.Client({connectionString:url});await client.connect();clients.push(client);
 const schema='play2_place_'+randomBytes(6).toString('hex');
 schemas.push(schema);await client.query('CREATE SCHEMA "'+schema+'"');
 await client.query('SET search_path TO "'+schema+'"');
 const sql=async(strings,...values)=>{
  let statement=strings[0];for(let i=0;i<values.length;i++)statement+='$'+(i+1)+strings[i+1];
  return (await client.query(statement,values)).rows;
 };
 const db=createDb(sql);await db.initSchema();return db;
}
const now=()=>1800000000000;
const key='ed25519:'+generateKeyPairSync('ed25519').publicKey.export({format:'der',type:'spki'}).toString('base64');
const deviceId='d'.repeat(32),image='ghcr.io/robinson/playground@sha256:'+'e'.repeat(64);
const context=(db,tenantId,identityId='person-a',clientId='client-a')=>{
 db.playgroundScope={tenantId,identityId,membershipRevision:1};
 const connection={client_id:clientId,profile:'full',default_account:'owner'};
 const ctx={db,connection,now};
 const record={row:{id:'job_'+'1'.repeat(16),owner:'owner',repo:'app',state:'pending'},
  worker:'git_'+'2'.repeat(32),
  binding:{authority:'3'.repeat(32),connection:nativeConnection(ctx),owner:'owner',repo:'app'}};
 return {ctx,record,binding:playgroundBinding(record)};
};
const setHost=async(db,binding,tenantId,identityId='person-a',clientId='client-a')=>
 db.setSetting('pg_host.'+deviceId,{
  kind:'playground-enrolled-host',tenantId,identityId,clientId,deviceId,
  generation:1,status:'pending_canary',fingerprint:'f'.repeat(64),
  publicKey:key,origin:'https://owned-public-tunnel.example.test',pairedAt:now()-10000,
  transportVerifiedAt:now()-1000,localCanaryAt:now()-1000,
  localCanaryBinding:binding,localCanaryImage:image,localCanaryReceiptHash:'a'.repeat(64)
 });
let alice,bob;
beforeAll(async()=>{
 const url=process.env.TEST_DATABASE_URL;
 if(!url||!['localhost','127.0.0.1','::1','[::1]'].includes(new URL(url).hostname))
  throw new Error('PLAY-2 placement test refuses non-local or absent TEST_DATABASE_URL.');
 alice=await createTestDb(url);bob=await createTestDb(url);
});
afterAll(async()=>{
 for(const client of clients){
  for(const schema of schemas)await client.query('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE').catch(()=>{});
  await client.end();
 }
});
describe('PLAY-2 placement intent in real independent PostgreSQL namespaces',()=>{
 it('pins the authenticated tenant, client, repository, workspace, device and image once',async()=>{
  const a=context(alice,'tenant-a');
  await setHost(alice,a.binding,'tenant-a');
  const first=await prepareEnrolledPlacement(a.ctx,a.record,deviceId);
  expect(first).toMatchObject({phase:'awaiting_source',execution_available:false,repository_attached:false});
  expect(await prepareEnrolledPlacement(a.ctx,a.record,deviceId)).toEqual(first);
  const row=await alice.getSetting(enrolledPlacementKey(a.binding));
  expect(row).toMatchObject({tenantId:'tenant-a',identityId:'person-a',clientId:'client-a',
   workspace:a.record.row.id,worker:a.record.worker,image,binding:a.binding,revision:1,
   sourceAttached:false,executionReady:false});
  expect(await bob.getSetting(enrolledPlacementKey(a.binding))).toBeNull();
 });
 it('refuses foreign tenant, foreign user and client even if they know the same device ID',async()=>{
  const b=context(bob,'tenant-b');await expect(prepareEnrolledPlacement(b.ctx,b.record,deviceId)).rejects.toThrow();
  const b2=context(alice,'tenant-a','person-b');
  await expect(prepareEnrolledPlacement(b2.ctx,b2.record,deviceId)).rejects.toThrow();
  const b3=context(alice,'tenant-a','person-a','client-b');
  await expect(prepareEnrolledPlacement(b3.ctx,b3.record,deviceId)).rejects.toThrow();
 });
 it('simultaneous attempts cannot create duplicate durable tenant allocation rows',async()=>{
  const a=context(alice,'tenant-a');
  const attempts=await Promise.allSettled([
   prepareEnrolledPlacement(a.ctx,a.record,deviceId),
   prepareEnrolledPlacement(a.ctx,a.record,deviceId)
  ]);
  expect(attempts.some(x=>x.status==='fulfilled')).toBe(true);
  expect((await alice.getSetting(enrolledPlacementKey(a.binding))).revision).toBe(1);
 });
 it('revoked device pin keeps source and process execution false',async()=>{
  const a=context(alice,'tenant-a'),host=await alice.getSetting('pg_host.'+deviceId);
  await alice.setSetting('pg_host.'+deviceId,{...host,status:'revoked',generation:2});
  expect(await inspectEnrolledPlacement(a.ctx,a.record)).toMatchObject({
   phase:'enrollment_revoked',repository_attached:false,execution_available:false});
  await expect(prepareEnrolledPlacement(a.ctx,a.record,deviceId)).rejects.toThrow();
 });
});
