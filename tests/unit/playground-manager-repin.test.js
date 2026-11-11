// SWEEP-REPIN-1: the Playground sweep manager's bearer is derived from the
// server signing key, so a TOKEN_ENCRYPTION_KEY rotation used to strand it
// forever (provisioning returned early on a 'running' manager). These tests
// pin the repair: drift is detected from the recorded fingerprint, proven
// against the provider's stored compose, and re-pinned through the provider's
// own update path — while a matching key changes nothing at all.
import {it,expect,afterEach} from 'vitest';
import {createHash,randomBytes} from 'node:crypto';
import {makeWorld} from '../../test/helpers/write-contract.js';
import {prepareNativeWorld} from '../../test/helpers/native-git-world.js';
import {ensureProjectManager,sweepKey,managerKeyDrift,sweep,sweepAllocations} from '../../src/playground/manager.js';
const hash=x=>createHash('sha256').update(x).digest('hex');
const config={origin:'https://dokploy.example.test',key:'FAKE_PROVIDER_KEY',project:'fixture',environment:'fixture-env',image:'fixture-image',worker:'git_'+'a'.repeat(32),nativeBinding:'b'.repeat(64),ingress:'107.90.116.157'};
const closes=[];afterEach(async()=>{for(const close of closes.splice(0))await close();});
async function world(){const w=await makeWorld({profile:'full',mode:'production',gates:[]});closes.push(await prepareNativeWorld(w,{existing:true}));const env={...w.ctx.env,PUBLIC_BASE_URL:'https://mcp.example.test'};delete env.NATIVE_GIT_WORKER_KEY;w.ctx={...w.ctx,env};return w;}
// (No NATIVE_GIT_WORKER_KEY above: production derives the signing key from
// TOKEN_ENCRYPTION_KEY, which is exactly the derivation a rotation changes.)
// A provider stand-in that holds the manager compose exactly as Dokploy would:
// create stores the file, inspect byte-compares it, update replaces it.
function managerProvider(){
 const calls=[];let row=null;
 return {calls,get row(){return row;},
  inventory:async()=>row?[row]:[],
  create:async p=>{calls.push('create');row={composeId:'owned-manager',name:p.name,appName:p.name+'-d5ggar',composeFile:p.composeFile,composeStatus:'idle'};return row;},
  inspect:async(id,p)=>{if(!row||row.composeId!==id)return null;if(p.composeFile!==row.composeFile)throw new Error('Allocation ownership, source or project changed; no mutation was sent.');return {...row,composeStatus:'done'};},
  deployments:async()=>[],
  deploy:async(id,p)=>{calls.push('deploy');if(p.composeFile!==row.composeFile)throw new Error('Allocation ownership, source or project changed; no mutation was sent.');row.composeStatus='done';},
  stored:async(id)=>{if(!row||row.composeId!==id)return null;return {...row};},
  update:async(id,p)=>{calls.push('update');row={...row,composeFile:p.composeFile};}};
}
const sweepCall=async(w,key)=>{
 const req={method:'POST',headers:{authorization:'Bearer '+key}};
 const res={code:0,body:null,setHeader(){},status(c){this.code=c;return this;},json(b){this.body=b;return this;}};
 await sweep(req,res,{env:w.ctx.env,root:w.db,run:opts=>sweepAllocations({...opts,warm:async()=>({enabled:false,running:0,pending:false})})});
 return res;
};
it('classifies sweep-key drift exactly: only the key slot may differ',()=>{
 const file=key=>JSON.stringify({name:'ras-pg-manager-x',services:{manager:{image:'fixture-image',environment:{PLAYGROUND_SWEEP_URL:'https://mcp.example.test/api/playground/sweep',PLAYGROUND_SWEEP_KEY:key}}}});
 expect(managerKeyDrift(file('a'.repeat(64)),file('a'.repeat(64)))).toBe('current');
 expect(managerKeyDrift(file('a'.repeat(64)),file('b'.repeat(64)))).toBe('stale');
 const other=JSON.parse(file('a'.repeat(64)));other.services.manager.mem_limit='256m';
 expect(managerKeyDrift(JSON.stringify(other),file('a'.repeat(64)))).toBe('other');
 expect(managerKeyDrift('not json',file('a'.repeat(64)))).toBe('other');
});
it('tolerates exactly one provider normalization: the live stored compose has no healthcheck where the expected carries {disable: true}',()=>{
 // Fixture modeled on the LIVE stored manager compose (read back from the
 // provider 2026-11-11): every field of the expected compose is present
 // except the healthcheck, which the provider's read-back drops entirely.
 const expected=key=>JSON.stringify({name:'ras-pg-manager-x',services:{manager:{image:'fixture-image',user:'1000:1000',init:true,restart:'unless-stopped',read_only:true,cap_drop:['ALL'],security_opt:['no-new-privileges:true'],mem_limit:'128m',cpus:'0.1',command:['node','workers/coding-workspace/manager.js'],healthcheck:{disable:true},environment:{PLAYGROUND_SWEEP_URL:'https://mcp.example.test/api/playground/sweep',PLAYGROUND_SWEEP_KEY:key},tmpfs:['/tmp:rw,noexec,nosuid,nodev,size=16m,mode=1777']}}});
 const storedLive=key=>{const doc=JSON.parse(expected(key));delete doc.services.manager.healthcheck;return JSON.stringify(doc);};
 // Same key, only the normalization: still the re-pin path, so the update
 // writes the expected compose (healthcheck included) back.
 expect(managerKeyDrift(storedLive('a'.repeat(64)),expected('a'.repeat(64)))).toBe('stale');
 // Rotated key plus the normalization: still 'stale', never a refusal.
 expect(managerKeyDrift(storedLive('a'.repeat(64)),expected('b'.repeat(64)))).toBe('stale');
 // A healthcheck of any other shape is NOT the proven normalization.
 const disabledFalse=JSON.parse(expected('a'.repeat(64)));disabledFalse.services.manager.healthcheck={disable:false};
 expect(managerKeyDrift(JSON.stringify(disabledFalse),expected('a'.repeat(64)))).toBe('other');
 const realCheck=JSON.parse(expected('a'.repeat(64)));realCheck.services.manager.healthcheck={test:['CMD','true'],interval:'30s'};
 expect(managerKeyDrift(JSON.stringify(realCheck),expected('a'.repeat(64)))).toBe('other');
 // The normalization buys no cover for a second difference beside it.
 const plusForeign=JSON.parse(storedLive('a'.repeat(64)));plusForeign.services.manager.mem_limit='256m';
 expect(managerKeyDrift(JSON.stringify(plusForeign),expected('a'.repeat(64)))).toBe('other');
});
it('re-pins the manager after a signing-key rotation and the sweep authenticates with the new key only',async()=>{
 const w=await world(),provider=managerProvider();
 await ensureProjectManager(w.ctx,config,provider);
 const before=await w.db.getSetting('playground_manager');
 const oldKey=sweepKey(w.ctx.env);
 expect(before).toMatchObject({phase:'running',keyFingerprint:hash(oldKey)});
 expect(JSON.stringify(before)).not.toContain(oldKey);
 // A matching key is a no-op: not one provider call on the running path.
 provider.calls.length=0;await ensureProjectManager(w.ctx,config,provider);
 expect(provider.calls).toEqual([]);
 // The sweep answers the current key and advances its cursor.
 const okBefore=await sweepCall(w,oldKey);expect(okBefore.code).toBe(200);
 const cursorBefore=await w.db.getSetting('playground_sweep_cursor');expect(cursorBefore.revision).toBeGreaterThan(0);
 // Rotate the encryption key: the derivation changes underneath the manager.
 w.ctx.env={...w.ctx.env,TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64url')};
 const newKey=sweepKey(w.ctx.env);expect(newKey).not.toBe(oldKey);
 await ensureProjectManager(w.ctx,config,provider);
 expect(provider.calls).toEqual(['update','deploy']);
 const after=await w.db.getSetting('playground_manager');
 expect(after).toMatchObject({phase:'running',keyFingerprint:hash(newKey)});
 expect(JSON.parse(provider.row.composeFile).services.manager.environment.PLAYGROUND_SWEEP_KEY).toBe(newKey);
 // The old key is refused; the new key runs the sweep and the cursor advances.
 expect((await sweepCall(w,oldKey)).code).toBe(401);
 const okAfter=await sweepCall(w,newKey);expect(okAfter.code).toBe(200);
 expect((await w.db.getSetting('playground_sweep_cursor')).revision).toBeGreaterThan(cursorBefore.revision);
 // Steady again: a further ensure with the rotated key touches nothing.
 provider.calls.length=0;await ensureProjectManager(w.ctx,config,provider);expect(provider.calls).toEqual([]);
});
it('backfills a legacy running record without churn when its key still matches, and re-pins it after a later rotation',async()=>{
 const w=await world(),provider=managerProvider();
 await ensureProjectManager(w.ctx,config,provider);
 const current=await w.db.getSetting('playground_manager');
 const legacy={...current};delete legacy.keyFingerprint;
 await w.db.setSetting('playground_manager',legacy);
 provider.calls.length=0;await ensureProjectManager(w.ctx,config,provider);
 expect(provider.calls).toEqual([]);
 expect((await w.db.getSetting('playground_manager')).keyFingerprint).toBe(hash(sweepKey(w.ctx.env)));
 const legacyAgain={...(await w.db.getSetting('playground_manager'))};delete legacyAgain.keyFingerprint;
 await w.db.setSetting('playground_manager',legacyAgain);
 w.ctx.env={...w.ctx.env,TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64url')};
 await ensureProjectManager(w.ctx,config,provider);
 expect(provider.calls).toEqual(['update','deploy']);
 expect(JSON.parse(provider.row.composeFile).services.manager.environment.PLAYGROUND_SWEEP_KEY).toBe(sweepKey(w.ctx.env));
});
it('re-pins a legacy running manager whose stored compose carries the provider normalization (the live 2026-11-11 fire shape)',async()=>{
 const w=await world(),provider=managerProvider();
 await ensureProjectManager(w.ctx,config,provider);
 // The live record predates fingerprints and the provider's stored compose
 // has no healthcheck: exactly the shape the deliberate fire hit, which the
 // pre-fix classifier refused as 'other' and stranded every pool ensure.
 const current=await w.db.getSetting('playground_manager');
 const legacy={...current};delete legacy.keyFingerprint;
 await w.db.setSetting('playground_manager',legacy);
 const normalized=JSON.parse(provider.row.composeFile);delete normalized.services.manager.healthcheck;
 provider.row.composeFile=JSON.stringify(normalized);
 provider.calls.length=0;
 await ensureProjectManager(w.ctx,config,provider);
 expect(provider.calls).toEqual(['update','deploy']);
 const after=await w.db.getSetting('playground_manager');
 expect(after).toMatchObject({phase:'running',keyFingerprint:hash(sweepKey(w.ctx.env))});
 // The update wrote the expected compose back, healthcheck included.
 expect(JSON.parse(provider.row.composeFile).services.manager.healthcheck).toEqual({disable:true});
});
it('still refuses when the provider normalization arrives with a foreign change beside it',async()=>{
 const w=await world(),provider=managerProvider();
 await ensureProjectManager(w.ctx,config,provider);
 const tampered=JSON.parse(provider.row.composeFile);delete tampered.services.manager.healthcheck;tampered.services.manager.mem_limit='512m';
 provider.row.composeFile=JSON.stringify(tampered);
 w.ctx.env={...w.ctx.env,TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64url')};
 provider.calls.length=0;
 await expect(ensureProjectManager(w.ctx,config,provider)).rejects.toThrow(/outside its sweep key/);
 expect(provider.calls).toEqual([]);
});
it('refuses to mutate a running manager whose compose changed outside the sweep key',async()=>{
 const w=await world(),provider=managerProvider();
 await ensureProjectManager(w.ctx,config,provider);
 const tampered=JSON.parse(provider.row.composeFile);tampered.services.manager.mem_limit='512m';
 provider.row.composeFile=JSON.stringify(tampered);
 w.ctx.env={...w.ctx.env,TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64url')};
 provider.calls.length=0;
 await expect(ensureProjectManager(w.ctx,config,provider)).rejects.toThrow(/outside its sweep key/);
 expect(provider.calls).toEqual([]);
});
