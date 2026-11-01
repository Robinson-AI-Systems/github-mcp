import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPersistentProbeNonceStore} from '../../tools/playground-device/probe-nonces.mjs';
import {describe,it,expect} from 'vitest';
import {createDeviceProbeServer} from '../../tools/playground-device/probe-server.mjs';
import {deviceProbeClaim,deviceProbeResponse,verifyDeviceProbeClaim,verifyDeviceProbeResponse,
  pinnedDeviceRequest,publicDeviceIPv4,probeEnrolledDevice} from '../../src/playground/device-probe.js';

const id='a'.repeat(32),origin='https://owned-tunnel.example.test',generation=2,clock=1800000000000;
const keys=()=>{
 const {privateKey,publicKey}=generateKeyPairSync('ed25519');
 return {privateKey,publicKey:'ed25519:'+publicKey.export({format:'der',type:'spki'}).toString('base64'),
  fingerprint:createHash('sha256').update(publicKey.export({format:'der',type:'spki'})).digest('hex')};
};
const signature=(body,key)=>'ed25519:'+sign(null,Buffer.from(body),key.privateKey).toString('base64url');
const claim=()=>deviceProbeClaim({deviceId:id,origin,generation,nonce:'f'.repeat(32),now:()=>clock});

describe('PLAY-2 remote device probe does not issue execution authority',()=>{
 it('verifies the controller claim and the exact device key, origin, nonce, generation and deadline',()=>{
  const controller=keys(),device=keys(),body=JSON.stringify(claim()),sig=signature(body,controller);
  const c=verifyDeviceProbeClaim(body,sig,controller.publicKey,{deviceId:id,origin,generation,now:()=>clock});
  const proof=JSON.stringify(deviceProbeResponse(c,{now:()=>clock}));
  expect(verifyDeviceProbeResponse(proof,signature(proof,device),device.publicKey,c,{now:()=>clock}).nonce).toBe('f'.repeat(32));
  expect(()=>verifyDeviceProbeClaim(body,signature(body,device),controller.publicKey,{deviceId:id,origin,generation,now:()=>clock})).toThrow();
  expect(()=>verifyDeviceProbeClaim(body,sig,controller.publicKey,{deviceId:id,origin,generation:3,now:()=>clock})).toThrow();
  expect(()=>verifyDeviceProbeClaim(body,sig,controller.publicKey,{deviceId:id,origin,generation,now:()=>clock+61000})).toThrow();
  expect(()=>verifyDeviceProbeResponse(proof,signature(proof,controller),device.publicKey,c,{now:()=>clock})).toThrow();
  expect(()=>verifyDeviceProbeResponse(proof,signature(proof,device),device.publicKey,{...c,nonce:'0'.repeat(32)},{now:()=>clock})).toThrow();
 });
 it('refuses private, metadata, benchmarking, localhost and non-public DNS before any outbound request',async()=>{
  for(const ip of ['0.0.0.0','10.0.0.1','127.0.0.1','169.254.169.254','172.16.0.4',
    '192.168.1.8','192.0.0.8','100.64.0.1','198.18.0.1','224.0.0.1','255.255.255.255'])
    expect(publicDeviceIPv4(ip)).toBe(false);
  for(const ip of ['1.1.1.1','8.8.8.8','104.21.1.2'])expect(publicDeviceIPv4(ip)).toBe(true);
  const body=JSON.stringify(claim()),controller=keys(),sig=signature(body,controller);
  let attempted=false;
  await expect(pinnedDeviceRequest({origin,body,signature:sig,dnsResolve:async()=>['104.21.1.2','127.0.0.1'],
   requestImpl:()=>{attempted=true;throw Error();}})).rejects.toThrow();
  expect(attempted).toBe(false);
  await expect(pinnedDeviceRequest({origin:'https://localhost',body,signature:sig})).rejects.toThrow();
 });
 it('uses one publicly resolved IP through a pinned TLS hostname and refuses unverified redirects',async()=>{
  const controller=keys(),device=keys(),c=claim(),body=JSON.stringify(c),sig=signature(body,controller);
  const proof=JSON.stringify(deviceProbeResponse(c,{now:()=>clock})),responseSig=signature(proof,device);
  let network;
  const result=await pinnedDeviceRequest({origin,body,signature:sig,dnsResolve:async()=>['104.21.1.2'],
   requestImpl:(options,onResponse)=>{
    network=options;const req=new EventEmitter();req.setTimeout=()=>{};
    req.end=()=>{
     const res=new EventEmitter();res.statusCode=200;res.headers={'x-robinson-device-signature':responseSig};
     queueMicrotask(()=>{onResponse(res);res.emit('data',Buffer.from(proof));res.emit('end');});
    };return req;
   }});
  expect(result).toEqual({body:proof,signature:responseSig});
  expect(network.hostname).toBe('owned-tunnel.example.test');
  expect(network.servername).toBe('owned-tunnel.example.test');
  expect(network.rejectUnauthorized).toBe(true);
  expect(network.path).toBe('/v1/enrollment/probe');
  expect(network.lookup('owned-tunnel.example.test',{},(_,ip,family)=>{expect(ip).toBe('104.21.1.2');expect(family).toBe(4);})).toBeUndefined();
 });
 it('the owner-run loopback device signs only freshly authorized probes and rejects replay/foreign keys',async()=>{
  const controller=keys(),device=keys(),server=createDeviceProbeServer({
   deviceId:id,origin,generation,controlPublicKey:controller.publicKey,devicePrivateKey:device.privateKey,now:()=>clock
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
   const port=server.address().port,c=claim(),body=JSON.stringify(c),sig=signature(body,controller);
   const send=(body,signature)=>fetch('http://127.0.0.1:'+port+'/v1/enrollment/probe',{
    method:'POST',headers:{'x-robinson-signature':signature,'Content-Type':'application/json'},body});
   const res=await send(body,sig);expect(res.status).toBe(200);
   const proof=await res.text();
   expect(verifyDeviceProbeResponse(proof,res.headers.get('x-robinson-device-signature'),device.publicKey,c,{now:()=>clock}).origin).toBe(origin);
   expect((await send(body,sig)).status).toBe(409);
   expect((await send(body,signature(body,device))).status).toBe(401);
   expect((await fetch('http://127.0.0.1:'+port+'/health')).status).toBe(404);
  }finally{await new Promise(resolve=>server.close(resolve));}
 });
 it('durably refuses a valid signed nonce after the device receiver restarts',async()=>{
  const root=await mkdtemp(join(tmpdir(),'play2-replay-'));
  const controller=keys(),device=keys(),c=claim(),body=JSON.stringify(c),sig=signature(body,controller);
  const once=async()=>{
   const consumeNonce=await createPersistentProbeNonceStore({root,now:()=>clock});
   const server=createDeviceProbeServer({
    deviceId:id,origin,generation,controlPublicKey:controller.publicKey,
    devicePrivateKey:device.privateKey,now:()=>clock,consumeNonce
   });
   await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
   try{
    return (await fetch('http://127.0.0.1:'+server.address().port+'/v1/enrollment/probe',{
     method:'POST',headers:{'x-robinson-signature':sig,'Content-Type':'application/json'},body
    })).status;
   }finally{await new Promise(resolve=>server.close(resolve));}
  };
  try{expect(await once()).toBe(200);expect(await once()).toBe(401);}
  finally{await rm(root,{recursive:true,force:true});}
 });
 it('transport validation retains the pending-canary state and returns no command authority',async()=>{
  const controller=keys(),device=keys();
  const result=await probeEnrolledDevice({record:{deviceId:id,origin,generation,
    status:'pending_canary',publicKey:device.publicKey,fingerprint:device.fingerprint},
   now:()=>clock,signClaim:body=>signature(body,controller),
   transport:async({body})=>{
    const c=verifyDeviceProbeClaim(body,signature(body,controller),controller.publicKey,{deviceId:id,origin,generation,now:()=>clock});
    const proof=JSON.stringify(deviceProbeResponse(c,{now:()=>clock}));
    return {body:proof,signature:signature(proof,device)};
   }});
  expect(result).toMatchObject({deviceId:id,transportVerified:true,executionReady:false,observedAt:clock});
 });
});
