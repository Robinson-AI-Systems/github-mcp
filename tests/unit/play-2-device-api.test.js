import {generateKeyPairSync,sign} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {createEnrollmentClaimHandler} from '../../api/playground/enroll.js';
import {createEnrolledHostStore,pairingMessage} from '../../src/playground/enrolled-hosts.js';

const memory=()=>{
 const map=new Map();
 return {
  getSetting:async key=>structuredClone(map.get(key)??null),
  setSetting:async(key,value)=>{map.set(key,structuredClone(value));},
  compareAndSetSetting:async(key,expected,value)=>{
   const current=map.get(key);if((current?.revision??0)!==expected)return null;
   map.set(key,structuredClone(value));return structuredClone(value);
  }
 };
};
const response=()=>({headers:{},setHeader(key,value){this.headers[key]=value;},
 status(code){this.code=code;return this;},send(v){this.body=JSON.parse(v);return this;}});
const env={GITHUB_PUBLIC_CONNECT:'enabled',GITHUB_PRIVATE_TENANT_PILOT:'enabled',
 VERCEL_ENV:'production',DATABASE_URL:'postgresql://localhost/fake'};
const claimBody=(start)=>{
 const {privateKey,publicKey}=generateKeyPairSync('ed25519');
 const origin='https://owner-tunnel.example.test';
 return {deviceId:start.deviceId,code:start.code,origin,
  publicKey:'ed25519:'+publicKey.export({format:'der',type:'spki'}).toString('base64url'),
  signature:sign(null,Buffer.from(pairingMessage({deviceId:start.deviceId,code:start.code,origin})),privateKey).toString('base64url')};
};
describe('PLAY-2 public device claim route is never an enrollment authority',()=>{
 it('allows the exact signed proof only through its owner-verified tenant scope',async()=>{
  const db=memory(),root=memory(),store=createEnrolledHostStore({db,root,tenantId:'tenant-a',identityId:'person-a',clientId:'client-a'});
  const started=await store.begin(),body=claimBody(started),handler=createEnrollmentClaimHandler({
   env,scopeFactory:async()=>({db,root,tenantId:'tenant-a',identityId:'person-a',clientId:'client-a'})
  });
  const first=response();await handler({method:'POST',body},first);
  expect(first.code).toBe(200);expect(first.body).toMatchObject({deviceId:started.deviceId,status:'pending_confirm'});
  expect(first.headers['Cache-Control']).toBe('no-store');
  const again=response();await handler({method:'POST',body},again);
  expect(again.code).toBe(403);
  expect((await store.list())[0].status).toBe('pending_confirm');
  expect((await store.list())[0].status).not.toBe('ready');
 });
 it('does not permit a foreign tenant to claim even when the code is known',async()=>{
  const root=memory(),db=memory(),store=createEnrolledHostStore({db,root,tenantId:'tenant-a',identityId:'person-a',clientId:'client-a'});
  const body=claimBody(await store.begin());
  const handler=createEnrollmentClaimHandler({env,scopeFactory:async()=>({
   db:memory(),root,tenantId:'tenant-b',identityId:'person-b',clientId:'client-b'
  })});
  const res=response();await handler({method:'POST',body},res);expect(res.code).toBe(403);
 });
 it('refuses unconfigured, non-POST, oversized and unknown-field requests',async()=>{
  const handler=createEnrollmentClaimHandler({env,scopeFactory:async()=>{throw new Error('never');}});
  const get=response();await handler({method:'GET'},get);expect(get.code).toBe(405);
  const size=response();await handler({method:'POST',body:{extra:'x'.repeat(8192)}},size);expect(size.code).toBe(403);
  const disabled=createEnrollmentClaimHandler({env:{...env,GITHUB_PUBLIC_CONNECT:'disabled'}});
  const notAvailable=response();await disabled({method:'POST',body:{}},notAvailable);expect(notAvailable.code).toBe(404);
 });
});
