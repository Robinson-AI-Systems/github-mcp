import {generateKeyPairSync,sign} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {createEnrolledHostStore,pairingMessage,pairingIndexKey,deviceFingerprint} from '../../src/playground/enrolled-hosts.js';

const memory=()=>{
  const map=new Map();
  return {
    getSetting:async key=>structuredClone(map.get(key)??null),
    setSetting:async(key,value)=>{map.set(key,structuredClone(value));},
    compareAndSetSetting:async(key,expected,value)=>{
      const previous=map.get(key),old=previous?.revision??0;
      if(old!==expected)return null;
      map.set(key,structuredClone(value));return structuredClone(value);
    }
  };
};
const keys=()=>{
 const {privateKey,publicKey}=generateKeyPairSync('ed25519');
 const value='ed25519:'+publicKey.export({format:'der',type:'spki'}).toString('base64url');
 return {privateKey,publicKey:value};
};
const claimArgs=(start,device,origin='https://device-tunnel.example.test')=>({
 code:start.code,deviceId:start.deviceId,origin,publicKey:device.publicKey,
 signature:sign(null,Buffer.from(pairingMessage({deviceId:start.deviceId,code:start.code,origin})),device.privateKey).toString('base64url')
});
const scope=(db,root,identityId='identity-1',now=()=>1000000)=>createEnrolledHostStore({
 db,root,tenantId:'tenant-1',identityId,clientId:'client-1',now
});
describe('PLAY-2 enrolled host pairing is a separate user-owned trust boundary',()=>{
 it('keeps a new device pending until signed possession and separate owner confirmation; canary not bypassed',async()=>{
  const db=memory(),root=memory(),store=scope(db,root),device=keys(),start=await store.begin();
  expect(start.code).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect((await store.list())[0]).toMatchObject({status:'pending_pair',deviceId:start.deviceId});
  expect(await root.getSetting(pairingIndexKey(start.code))).toMatchObject({deviceId:start.deviceId,identityId:'identity-1'});
  const claimed=await store.claim(claimArgs(start,device));
  expect(claimed).toMatchObject({status:'pending_confirm',fingerprint:deviceFingerprint(device.publicKey)});
  await expect(store.claim(claimArgs(start,device))).rejects.toThrow(/already used/);
  expect(await store.approve(start.deviceId)).toEqual({deviceId:start.deviceId,status:'pending_canary',fingerprint:claimed.fingerprint});
  expect((await store.list())[0].status).toBe('pending_canary');
  expect(await store.revoke(start.deviceId)).toEqual({deviceId:start.deviceId,status:'revoked',cleanupConfirmed:true});
  expect((await store.list())[0].status).toBe('revoked');
 });
 it('denies another identity/tenant even with the original one-time code and device key',async()=>{
  const root=memory(),alice=scope(memory(),root,'identity-1'),bob=scope(memory(),root,'identity-2'),device=keys(),start=await alice.begin();
  await expect(bob.claim(claimArgs(start,device))).rejects.toThrow(/another person/);
  await expect(bob.approve(start.deviceId)).rejects.toThrow(/device must first/);
  await expect(bob.revoke(start.deviceId)).rejects.toThrow(/not enrolled/);
  expect(await bob.list()).toEqual([]);
 });
 it('verifies key possession, never trusts a substituted URL, and rejects direct/local origins',async()=>{
  const store=scope(memory(),memory()),a=await store.begin(),real=keys(),rogue=keys();
  const invalid=claimArgs(a,real);
  invalid.signature=claimArgs(a,rogue).signature;
  await expect(store.claim(invalid)).rejects.toThrow(/prove its signing key/);
  await expect(store.claim(claimArgs(a,real,'https://localhost'))).rejects.toThrow(/public HTTPS/);
  await expect(store.claim(claimArgs(a,real,'https://192.168.0.4'))).rejects.toThrow(/public HTTPS/);
  await expect(store.claim({...claimArgs(a,real),origin:'http://host.example.test'})).rejects.toThrow(/public HTTPS/);
  await expect(store.approve(a.deviceId)).rejects.toThrow(/device must first/);
 });
 it('expires unclaimed pairing and uses CAS to prevent a replayed claim or approval',async()=>{
  let clock=1000;
  const db=memory(),root=memory(),store=scope(db,root,'identity-1',()=>clock);
  const start=await store.begin(),device=keys();
  clock=1000+600001;
  await expect(store.claim(claimArgs(start,device))).rejects.toThrow(/expired/);
  await expect(store.approve(start.deviceId)).rejects.toThrow();
 });
 it('lists only its own current identities and preserves the revocation tombstone generation',async()=>{
  const db=memory(),root=memory(),one=scope(db,root),two=scope(db,root,'identity-2');
  const first=await one.begin(),second=await two.begin();
  expect((await one.list()).map(x=>x.deviceId)).toEqual([first.deviceId]);
  expect((await two.list()).map(x=>x.deviceId)).toEqual([second.deviceId]);
  await one.revoke(first.deviceId);
  expect((await one.list())[0]).toMatchObject({generation:2,status:'revoked'});
 });
 it('a second claim racing the first sees the consumed state, not a second enrollment',async()=>{
  const db=memory(),root=memory(),store=scope(db,root),device=keys(),start=await store.begin();
  const results=await Promise.allSettled([store.claim(claimArgs(start,device)),store.claim(claimArgs(start,device))]);
  expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);
  expect(results.filter(x=>x.status==='rejected')).toHaveLength(1);
 });
});
