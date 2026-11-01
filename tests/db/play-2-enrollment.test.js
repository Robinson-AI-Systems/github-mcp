// Real disposable PostgreSQL tests: tenant schemas must not leak enrollment keys,
// and compare-and-set is the authority for one-use pairing and revocation.
import {randomBytes,generateKeyPairSync,sign} from 'node:crypto';
import pg from 'pg';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {createDb} from '../../src/db.js';
import {createEnrolledHostStore,pairingIndexKey,pairingMessage} from '../../src/playground/enrolled-hosts.js';

const clients=[],schemas=[];
async function dbFor(url){
 const client=new pg.Client({connectionString:url});await client.connect();clients.push(client);
 const schema='play2_'+randomBytes(7).toString('hex');
 schemas.push(schema);
 await client.query('CREATE SCHEMA "'+schema+'"');
 await client.query('SET search_path TO "'+schema+'"');
 const sql=async(strings,...params)=>{
  let text=strings[0];for(let i=0;i<params.length;i++)text+='$'+(i+1)+strings[i+1];
  return (await client.query(text,params)).rows;
 };
 const db=createDb(sql);await db.initSchema();return db;
}
function device(start){
 const {publicKey,privateKey}=generateKeyPairSync('ed25519');
 const key='ed25519:'+publicKey.export({format:'der',type:'spki'}).toString('base64url');
 const origin='https://device1.example.test';
 return {code:start.code,deviceId:start.deviceId,publicKey:key,origin,
   signature:sign(null,Buffer.from(pairingMessage({deviceId:start.deviceId,code:start.code,origin})),privateKey).toString('base64url')};
}
let root,alice,bob;
beforeAll(async()=>{
 const url=process.env.TEST_DATABASE_URL;
 if(!url||!['localhost','127.0.0.1','::1','[::1]'].includes(new URL(url).hostname))
  throw new Error('PLAY-2 database test refuses non-local or absent TEST_DATABASE_URL');
 root=await dbFor(url);alice=await dbFor(url);bob=await dbFor(url);
});
afterAll(async()=>{
 for(const client of clients){
  for(const schema of schemas)await client.query('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE').catch(()=>{});
  await client.end();
 }
});
describe('PLAY-2 real Postgres tenant enrollment',()=>{
 it('keeps the opaque pairing locator in root while user data stays inside the owner tenant',async()=>{
  const one=createEnrolledHostStore({db:alice,root,tenantId:'tenant-1',identityId:'person-1',clientId:'client-1'});
  const other=createEnrolledHostStore({db:bob,root,tenantId:'tenant-2',identityId:'person-2',clientId:'client-2'});
  const start=await one.begin(),proof=device(start);
  expect((await root.getSetting(pairingIndexKey(start.code)))).toMatchObject({tenantId:'tenant-1',identityId:'person-1',clientId:'client-1'});
  expect(await other.list()).toEqual([]);
  await expect(other.claim(proof)).rejects.toThrow(/another person/);
  const claimed=await one.claim(proof);
  expect(claimed.status).toBe('pending_confirm');
  await one.approve(start.deviceId);
  expect((await one.list())[0].status).toBe('pending_canary');
  expect(await bob.getSetting('pg_host.'+start.deviceId)).toBeNull();
  await expect(one.claim(proof)).rejects.toThrow(/already used/);
 });
 it('preserves a revoked-generation tombstone and prevents an old proof from reentering',async()=>{
  const one=createEnrolledHostStore({db:alice,root,tenantId:'tenant-1',identityId:'person-1',clientId:'client-1'});
  const start=await one.begin(),proof=device(start);
  expect(await one.revoke(start.deviceId)).toMatchObject({status:'revoked'});
  await expect(one.claim(proof)).rejects.toThrow();
  expect((await one.list()).find(h=>h.deviceId===start.deviceId)).toMatchObject({status:'revoked',generation:2});
 });
 it('CAS lets exactly one concurrent device claim win',async()=>{
  const one=createEnrolledHostStore({db:alice,root,tenantId:'tenant-1',identityId:'person-1',clientId:'client-1'});
  const start=await one.begin(),proof=device(start);
  const results=await Promise.allSettled([one.claim(proof),one.claim(proof)]);
  expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);
  expect(results.filter(x=>x.status==='rejected')).toHaveLength(1);
 });
 it('binds signed reachability to current tenant, exact connection and revoked generation, without runtime admission',async()=>{
  const now=()=>1800000000000,proof=async({record})=>({
   deviceId:record.deviceId,generation:record.generation,origin:record.origin,
   fingerprint:record.fingerprint,observedAt:now(),transportVerified:true,executionReady:false
  });
  const ours=createEnrolledHostStore({db:alice,root,tenantId:'tenant-1',identityId:'person-1',
   clientId:'client-1',now,probeClient:proof});
  const foreign=createEnrolledHostStore({db:bob,root,tenantId:'tenant-2',identityId:'person-2',
   clientId:'client-2',now,probeClient:proof});
  const start=await ours.begin();
  await ours.claim(device(start));await ours.approve(start.deviceId);
  await expect(foreign.probe(start.deviceId)).rejects.toThrow(/approved/);
  const result=await ours.probe(start.deviceId);
  expect(result).toEqual({deviceId:start.deviceId,status:'pending_canary',
   transportVerifiedAt:now(),executionReady:false});
  expect((await ours.list()).find(x=>x.deviceId===start.deviceId)).toMatchObject({
   status:'pending_canary',transportVerifiedAt:now()
  });
  const revoked=await ours.revoke(start.deviceId);
  expect(revoked).toMatchObject({status:'revoked'});
  await expect(ours.probe(start.deviceId)).rejects.toThrow(/approved/);
  expect((await ours.list()).find(x=>x.deviceId===start.deviceId)).toMatchObject({status:'revoked',generation:2});
 });
 it('loses the CAS race if revocation arrives before the signed response is committed',async()=>{
  const now=()=>1800000001000;
  let original;
  const ours=createEnrolledHostStore({db:alice,root,tenantId:'tenant-1',identityId:'person-1',
   clientId:'client-1',now,probeClient:async({record})=>{
    await original.revoke(record.deviceId);
    return {deviceId:record.deviceId,generation:record.generation,origin:record.origin,
     fingerprint:record.fingerprint,observedAt:now(),transportVerified:true,executionReady:false};
   }});
  original=ours;
  const started=await ours.begin();await ours.claim(device(started));await ours.approve(started.deviceId);
  await expect(ours.probe(started.deviceId)).rejects.toThrow(/changed during probe/);
  expect((await ours.list()).find(x=>x.deviceId===started.deviceId)).toMatchObject({
   status:'revoked',generation:2,transportVerifiedAt:null
  });
 });

 it('CAS-records a real-tenant signed local canary as pending and denies foreign/revoked generations',async()=>{
  const now=()=>1800000001000,image='ghcr.io/robinson/coding@sha256:'+'c'.repeat(64),binding='d'.repeat(64);
  const probeClient=async({record})=>({deviceId:record.deviceId,generation:record.generation,
   origin:record.origin,fingerprint:record.fingerprint,observedAt:now(),
   transportVerified:true,executionReady:false});
  const canaryClient=async({record})=>({deviceId:record.deviceId,generation:record.generation,
   origin:record.origin,localCanaryAt:now(),image,binding,receiptHash:'e'.repeat(64),
   repositoryAttached:false,executionReady:false});
  const options={db:alice,root,tenantId:'tenant-1',identityId:'person-1',
   clientId:'client-1',now,probeClient,canaryClient};
  const ours=createEnrolledHostStore(options);
  const other=createEnrolledHostStore({...options,db:bob,tenantId:'tenant-2',
   identityId:'person-2',clientId:'client-2'});
  const start=await ours.begin(),d=device(start);
  await ours.claim(d);await ours.approve(start.deviceId);
  await expect(ours.canary(start.deviceId)).rejects.toThrow(/fresh pinned/);
  await ours.probe(start.deviceId);
  await expect(other.canary(start.deviceId)).rejects.toThrow(/fresh pinned/);
  expect(await ours.canary(start.deviceId)).toMatchObject({
   deviceId:start.deviceId,status:'pending_canary',
   localCanaryAt:now(),localCanaryImage:image,executionReady:false
  });
  expect((await ours.list()).find(x=>x.deviceId===start.deviceId)).toMatchObject({
   localCanaryAt:now(),localCanaryImage:image,
   localCanaryBinding:binding,status:'pending_canary'
  });
  await ours.revoke(start.deviceId);
  await expect(ours.canary(start.deviceId)).rejects.toThrow();
  expect((await ours.list()).find(x=>x.deviceId===start.deviceId)).toMatchObject({status:'revoked',generation:2});
 });
 it('requires a same-revision CAS so a revoked device cannot publish delayed local canary evidence',async()=>{
  const now=()=>1800000002000,image='ghcr.io/robinson/coding@sha256:'+'b'.repeat(64);
  let store;
  store=createEnrolledHostStore({db:alice,root,tenantId:'tenant-1',identityId:'person-1',
   clientId:'client-1',now,
   probeClient:async({record})=>({deviceId:record.deviceId,generation:record.generation,
    origin:record.origin,fingerprint:record.fingerprint,observedAt:now(),
    transportVerified:true,executionReady:false}),
   canaryClient:async({record})=>{
    await store.revoke(record.deviceId);
    return {deviceId:record.deviceId,generation:record.generation,origin:record.origin,
     localCanaryAt:now(),image,binding:'c'.repeat(64),receiptHash:'e'.repeat(64),
     repositoryAttached:false,executionReady:false};
   }
  });
  const started=await store.begin();
  await store.claim(device(started));await store.approve(started.deviceId);
  await store.probe(started.deviceId);
  await expect(store.canary(started.deviceId)).rejects.toThrow(/Enrollment changed/);
  const rec=(await store.list()).find(x=>x.deviceId===started.deviceId);
  expect(rec).toMatchObject({status:'revoked',localCanaryAt:null,generation:2});
 });

});
