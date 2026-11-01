import {generateKeyPairSync,sign} from 'node:crypto';
import {mkdtemp,writeFile,stat,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe,it,expect} from 'vitest';
import {localCanaryRecord,writeLocalCanaryReceipt,readLocalCanaryReceipt,verifyLocalCanaryReceipt}
 from '../../tools/playground-device/canary-receipt.mjs';
import {localRuntimeCanaryClaim,verifyLocalRuntimeCanaryClaim,localRuntimeCanaryReply,
 verifyLocalRuntimeCanaryReply,readEnrolledLocalCanary} from '../../src/playground/device-canary.js';
import {createDeviceProbeServer} from '../../tools/playground-device/probe-server.mjs';
import {pinnedDeviceRequest} from '../../src/playground/device-probe.js';

const clock=1800000000000,origin='https://owned-tunnel.example.test',deviceId='a'.repeat(32),
 generation=7,binding='b'.repeat(64),image='ghcr.io/robinson/coding@sha256:'+'c'.repeat(64);
const plan={deviceId,binding,image};
const proof={deviceId,binding,canaryPassed:true,controllerAdmission:false,node:'24',postgres:'15',
 chromium:true,verifiedLocalOnly:true,limits:{cpuCpus:2,memoryMiB:2048,storageQuotaBytes:null}};
const keypair=()=>{
 const {privateKey,publicKey}=generateKeyPairSync('ed25519');
 return {privateKey,publicKey:'ed25519:'+publicKey.export({format:'der',type:'spki'}).toString('base64')};
};
const signed=(body,key)=>'ed25519:'+sign(null,Buffer.from(body),key.privateKey).toString('base64url');
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'play2-canary-'));
 const device=keypair(),keyPath=join(root,'device.pk8'),receipts=join(root,'receipts');
 await writeFile(keyPath,device.privateKey.export({format:'der',type:'pkcs8'}),{mode:0o600});
 const out=await writeLocalCanaryReceipt({plan,origin,generation,proof,root:receipts,keyPath,now:()=>clock});
 const read=()=>readLocalCanaryReceipt({deviceId,generation,origin,binding,image,
  now:()=>clock,publicKey:device.publicKey,root:receipts});
 return {root,device,keyPath,receipts,out,read};
}
describe('PLAY-2 device-signed fixed local runtime evidence',()=>{
 it('requires the exact completed local canary and never falsely claims repository attachment',()=>{
  const row=localCanaryRecord({plan,origin,generation,proof,now:()=>clock});
  expect(row).toMatchObject({deviceId,workspaceBinding:binding,image,observedAt:clock,
   node24Uid1000:true,postgres15StartStop:true,chromium:true,localDockerIsolation:true,
   repositoryAttached:false,controllerAdmission:false,storageQuotaBytes:null});
  expect(()=>localCanaryRecord({plan,origin,generation,
   proof:{...proof,chromium:false},now:()=>clock})).toThrow();
  expect(()=>localCanaryRecord({plan,origin,generation,
   proof:{...proof,limits:{storageQuotaBytes:150000000000}},now:()=>clock})).toThrow();
 });
 it('persists a 0600 receipt signed by the original owner device key and rejects changed image, key and stale time',async()=>{
  const f=await fixture();
  try{
   expect(f.out).toMatchObject({deviceId,image,workspaceBinding:binding,signatureStoredLocally:true,executionReady:false});
   const receipt=await f.read();
   expect(receipt.row).toMatchObject({workspaceBinding:binding,image,observedAt:clock});
   expect(receipt.digest).toMatch(/^[a-f0-9]{64}$/);
   const bytes=await readFile(join(f.receipts,deviceId+'.json'),'utf8');
   expect(bytes).not.toContain('PRIVATE KEY');
   expect((await stat(join(f.receipts,deviceId+'.json'))).mode&0o777).toBe(0o600);
   expect((await stat(f.receipts)).mode&0o777).toBe(0o700);
   const rogue=keypair();
   await expect(readLocalCanaryReceipt({deviceId,generation,origin,binding,image,
    root:f.receipts,now:()=>clock,publicKey:rogue.publicKey})).rejects.toThrow();
   await expect(readLocalCanaryReceipt({deviceId,generation,origin,binding,
    image:'ghcr.io/robinson/coding@sha256:'+'d'.repeat(64),
    root:f.receipts,now:()=>clock,publicKey:f.device.publicKey})).rejects.toThrow();
   await expect(readLocalCanaryReceipt({deviceId,generation,origin,binding,image,
    root:f.receipts,now:()=>clock+300001,publicKey:f.device.publicKey})).rejects.toThrow();
   expect(()=>verifyLocalCanaryReceipt({body:'{}',signature:'bad'},
    {deviceId,generation,origin,binding,image,publicKey:f.device.publicKey,now:()=>clock})).toThrow();
  }finally{await rm(f.root,{recursive:true,force:true});}
 });
 it('uses a different signed claim purpose and verifies exact nonce, local receipt hash, and no execution-ready flag',async()=>{
  const f=await fixture(),controller=keypair();
  try{
   const c=localRuntimeCanaryClaim({deviceId,generation,origin,now:()=>clock,nonce:'f'.repeat(32)});
   const body=JSON.stringify(c),signature=signed(body,controller);
   expect(verifyLocalRuntimeCanaryClaim(body,signature,controller.publicKey,
    {deviceId,generation,origin,now:()=>clock})).toEqual(c);
   expect(()=>verifyLocalRuntimeCanaryClaim(body,signature,controller.publicKey,
    {deviceId,generation:generation+1,origin,now:()=>clock})).toThrow();
   expect(()=>verifyLocalRuntimeCanaryClaim(body,signature,controller.publicKey,
    {deviceId,generation,origin,now:()=>clock+61000})).toThrow();
   const reply=localRuntimeCanaryReply(c,await f.read(),{now:()=>clock});
   const proofBody=JSON.stringify(reply),deviceSignature=signed(proofBody,f.device);
   expect(verifyLocalRuntimeCanaryReply(proofBody,deviceSignature,f.device.publicKey,c,
    {now:()=>clock})).toMatchObject({image,workspaceBinding:binding,
    localCanaryAt:clock,storageQuotaBytes:null,repositoryAttached:false,executionReady:false});
   expect(()=>verifyLocalRuntimeCanaryReply(proofBody,signed(proofBody,controller),
    f.device.publicKey,c,{now:()=>clock})).toThrow();
   expect(()=>verifyLocalRuntimeCanaryReply(proofBody,deviceSignature,
    f.device.publicKey,{...c,nonce:'e'.repeat(32)},{now:()=>clock})).toThrow();
  }finally{await rm(f.root,{recursive:true,force:true});}
 });
 it('the local loopback receiver requires the fresh controller signature and refuses duplicate canary readback',async()=>{
  const f=await fixture(),controller=keypair(),c=localRuntimeCanaryClaim({
   deviceId,generation,origin,now:()=>clock,nonce:'a'.repeat(32)
  });
  const server=createDeviceProbeServer({deviceId,generation,origin,
   controlPublicKey:controller.publicKey,devicePrivateKey:f.device.privateKey,
   now:()=>clock,canarySource:{binding,image},
   canaryReceiptReader:options=>readLocalCanaryReceipt({...options,root:f.receipts})
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+server.address().port+'/v1/enrollment/canary';
  const body=JSON.stringify(c),sig=signed(body,controller);
  try{
   const res=await fetch(url,{method:'POST',body,headers:{'Content-Type':'application/json','x-robinson-signature':sig}});
   expect(res.status).toBe(200);
   const text=await res.text();
   expect(verifyLocalRuntimeCanaryReply(text,res.headers.get('x-robinson-device-signature'),
    f.device.publicKey,c,{now:()=>clock}).image).toBe(image);
   const retry=await fetch(url,{method:'POST',body,headers:{'x-robinson-signature':sig}});
   expect(retry.status).toBe(409);await retry.text();
   const denied=await fetch(url,{method:'POST',body,headers:{'x-robinson-signature':signed(body,f.device)}});
   expect(denied.status).toBe(401);await denied.text();
  }finally{await new Promise(resolve=>server.close(resolve));await rm(f.root,{recursive:true,force:true});}
 });
 it('controller readback rejects unprobed devices, wrong proof and cannot create runnable authority',async()=>{
  const f=await fixture(),controller=keypair();
  try{
   const record={deviceId,generation,origin,publicKey:f.device.publicKey,status:'pending_canary',transportVerifiedAt:clock};
   const observed=await readEnrolledLocalCanary({record,now:()=>clock,
    signClaim:body=>signed(body,controller),
    transport:async({body,path})=>{
     expect(path).toBe('/v1/enrollment/canary');
     const c=verifyLocalRuntimeCanaryClaim(body,signed(body,controller),controller.publicKey,
      {deviceId,generation,origin,now:()=>clock});
     const reply=JSON.stringify(localRuntimeCanaryReply(c,await f.read(),{now:()=>clock}));
     return {body:reply,signature:signed(reply,f.device)};
    }});
   expect(observed).toMatchObject({deviceId,generation,image,binding,
    localCanaryAt:clock,repositoryAttached:false,executionReady:false});
   await expect(readEnrolledLocalCanary({record:{...record,transportVerifiedAt:clock-300001},
    now:()=>clock,signClaim:()=>''})).rejects.toThrow();
   await expect(pinnedDeviceRequest({origin,body:'{}',signature:'bad',
    path:'/user/tool/execute'})).rejects.toThrow();
  }finally{await rm(f.root,{recursive:true,force:true});}
 });
});
