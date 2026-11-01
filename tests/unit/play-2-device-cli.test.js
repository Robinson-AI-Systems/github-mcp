import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,createPublicKey,verify} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {loadOrCreateDeviceKey,pairOwnedDevice} from '../../tools/playground-device/pair.mjs';
import {pairingMessage} from '../../src/playground/enrolled-hosts.js';

describe('owner-operated PLAY-2 pairing client',()=>{
 it('keeps the private signing key only on the device and proves the exact origin, code and device ID',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'play2-key-')),deviceId='a'.repeat(32),code='B'.repeat(43);
  try{
   const first=await loadOrCreateDeviceKey(dir),again=await loadOrCreateDeviceKey(dir);
   expect(first.privateKey.export({format:'der',type:'pkcs8'}).equals(again.privateKey.export({format:'der',type:'pkcs8'}))).toBe(true);
   const mode=(await stat(join(dir,'device-ed25519.pk8'))).mode&0o777;
   expect(mode).toBe(0o600);
   let request;
   const result=await pairOwnedDevice({deviceId,code,origin:'https://my-tunnel.example.test',keyDir:dir,
     fetchImpl:async(url,opts)=>{
      request={url,opts,data:JSON.parse(opts.body)};
      const pk=createPublicKey({key:Buffer.from(request.data.publicKey.slice(8),'base64url'),format:'der',type:'spki'});
      expect(verify(null,Buffer.from(pairingMessage({deviceId,code,origin:'https://my-tunnel.example.test'})),pk,Buffer.from(request.data.signature,'base64url'))).toBe(true);
      return Response.json({deviceId,status:'pending_confirm',fingerprint:createHash('sha256').update(Buffer.from(request.data.publicKey.slice(8),'base64url')).digest('hex')});
     }});
   expect(result).toMatchObject({status:'pending_confirm',deviceId});
   expect(request.url).toBe('https://github.robinsonaisystems.com/api/playground/enroll');
   expect(request.opts.redirect).toBe('error');
   expect(Object.keys(request.data).sort()).toEqual(['code','deviceId','origin','publicKey','signature']);
   expect(JSON.stringify(request.data)).not.toContain('PRIVATE KEY');
   expect((await readFile(join(dir,'device-ed25519.pk8'))).length).toBeGreaterThan(40);
  }finally{await rm(dir,{recursive:true,force:true});}
 });
 it('refuses non-HTTPS, password-bearing, or unrelated route origins before reading a private key',async()=>{
  const id='c'.repeat(32),code='D'.repeat(43);
  for(const origin of ['http://example.test','https://user:pass@example.test','https://example.test/private','https://example.test/?token=foo']){
   await expect(pairOwnedDevice({deviceId:id,code,origin,keyDir:'/invalid/test/root'})).rejects.toThrow(/HTTPS origins/);
  }
 });
});
