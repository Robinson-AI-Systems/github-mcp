import {it,expect,afterEach} from 'vitest';
import {readFile} from 'node:fs/promises';
import {makeWorld} from '../../test/helpers/write-contract.js';
import {prepareNativeWorld} from '../../test/helpers/native-git-world.js';
import {allocationPlan,dokployProvider,pinProviderIdentity} from '../../src/playground/dokploy.js';
import {ensureProjectManager} from '../../src/playground/manager.js';
const config={origin:'https://dokploy.example.test',key:'FAKE_PROVIDER_KEY',project:'fixture',environment:'fixture-env',image:'fixture-image',worker:'git_'+'a'.repeat(32),nativeBinding:'b'.repeat(64),ingress:'107.90.116.157'};
const plan=()=>allocationPlan({binding:'a'.repeat(64),verificationKey:'ed25519:FAKE_PUBLIC',idleTimeoutMs:14400000},config);
const closes=[];afterEach(async()=>{for(const close of closes.splice(0))await close();});
it('pins only independently read-back exact assigned names and uses them for container inventory; any later suffix/source/scope change refuses mutation',async()=>{
 const p=plan(),calls=[];let patch={};
 const row=()=>({composeId:'owned',name:p.name,appName:p.name+'-d5ggar',description:p.description,composeFile:p.composeFile,sourceType:'raw',environmentId:config.environment,environment:{projectId:config.project},...patch});
 const provider=dokployProvider(config,{fetch:async(url)=>{const u=new URL(url),op=u.pathname.split('/').pop();calls.push(op);if(op==='project.one')return Response.json({projectId:config.project,environments:[{environmentId:config.environment}]});if(op==='compose.create')return Response.json({composeId:'owned',appName:'untrusted-create-name'});if(op==='compose.one')return Response.json(row());if(op==='docker.getContainersByAppNameMatch'){expect(u.searchParams.get('appName')).toBe(p.name+'-d5ggar');return Response.json([]);}if(op==='compose.deploy')return Response.json({});throw Error('Unexpected mutation '+op);}});
 const created=await provider.create(p);expect(created.appName).toBe(p.name+'-d5ggar');const pinned=pinProviderIdentity(p,created.appName);await provider.containers(pinned);await provider.deploy('owned',pinned);const deployed=calls.filter(c=>c==='compose.deploy').length;
 for(const change of [{appName:p.name+'-abcdef'},{name:'foreign',appName:p.name+'-abcdef'},{environmentId:'foreign'},{environment:{projectId:'foreign'}},{description:'foreign'},{composeFile:'{}'},{sourceType:'git'}]){patch=change;await expect(provider.deploy('owned',pinned)).rejects.toThrow(/ownership/);}
 expect(calls.filter(c=>c==='compose.deploy')).toHaveLength(deployed);
 expect(()=>pinProviderIdentity(p,'foreign-d5ggar')).toThrow();expect(()=>pinProviderIdentity(p,p.name+'-d5ggar-extra')).toThrow();expect(()=>pinProviderIdentity(pinned,p.name+'-abcdef')).toThrow();
});
it('never accepts foreign bootstrap source just because its assigned name has a plausible suffix',async()=>{
 const p=plan();const provider=dokployProvider(config,{fetch:async(url)=>{const op=new URL(url).pathname.split('/').pop();if(op==='project.one')return Response.json({projectId:config.project,environments:[{environmentId:config.environment}]});if(op==='compose.create')return Response.json({composeId:'owned'});return Response.json({composeId:'owned',name:p.name,appName:p.name+'-d5ggar',environmentId:config.environment,environment:{projectId:config.project},description:p.description,composeFile:'{}',sourceType:'raw'});}});
 await expect(provider.create(p)).rejects.toThrow(/ownership/);
});
it('recovers the same suffixed manager after an uncertain create and keeps its original source across controller releases',async()=>{
 const w=await makeWorld({profile:'full',mode:'production',gates:[]});closes.push(await prepareNativeWorld(w,{existing:true}));w.ctx.env.PUBLIC_BASE_URL='https://mcp.example.test';
 let creates=0,lost=true,row,observedPlan;const provider={inventory:async()=>row?[row]:[],create:async p=>{creates++;observedPlan=p;row={composeId:'owned-manager',name:p.name,appName:p.name+'-d5ggar'};if(lost){lost=false;throw Error('lost create response');}return row;},inspect:async(id,p)=>{expect(id).toBe(row.composeId);expect(p.composeFile).toBe(observedPlan.composeFile);return {...row,composeStatus:'done'};},deploy:async(id,p)=>{expect(id).toBe(row.composeId);expect(p.providerAppName).toBe(row.appName);}};
 await expect(ensureProjectManager(w.ctx,config,provider)).rejects.toThrow('lost create response');
 await ensureProjectManager(w.ctx,{...config,image:'later-controller-image'},provider);
 expect(creates).toBe(1);const stored=await w.db.getSetting('playground_manager');expect(stored).toMatchObject({phase:'running',providerAppName:row.appName,source:{image:'fixture-image'}});expect(JSON.stringify(stored)).not.toContain('PLAYGROUND_SWEEP_KEY');
});
it('recovers only a legacy proven-undispatched manager and never repeats an uncertain versioned dispatch',async()=>{
 const w=await makeWorld({profile:'full',mode:'production',gates:[]});closes.push(await prepareNativeWorld(w,{existing:true}));w.ctx.env.PUBLIC_BASE_URL='https://mcp.example.test';
 let dispatches=0,history=[],status='idle';
 const provider={create:async p=>({composeId:'owned',appName:p.name+'-d5ggar'}),inspect:async()=>({composeStatus:status}),deployments:async()=>history,deploy:async()=>{dispatches++;throw Error('uncertain dispatch');}};
 await expect(ensureProjectManager(w.ctx,config,provider)).rejects.toThrow('uncertain dispatch');
 await ensureProjectManager(w.ctx,config,provider);expect(dispatches).toBe(1);
 const current=await w.db.getSetting('playground_manager');await w.db.setSetting('playground_manager',{...current,dispatchVersion:undefined});
 history=[{status:'error'}];await ensureProjectManager(w.ctx,config,provider);expect(dispatches).toBe(1);
 history=[];status='running';await ensureProjectManager(w.ctx,config,provider);expect(dispatches).toBe(1);
 status='idle';await expect(ensureProjectManager(w.ctx,config,provider)).rejects.toThrow('uncertain dispatch');expect(dispatches).toBe(2);
 await ensureProjectManager(w.ctx,config,provider);expect(dispatches).toBe(2);
});
it('selects best-effort policy and derives new execution builds from the immutable serving source without a stale manifest pin',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../../vercel.json',import.meta.url),'utf8'));
 expect(manifest.env).toEqual({PLAYGROUND_RESOURCE_MODE:'best_effort'});expect(manifest.git.deploymentEnabled).toEqual({'**':false,live:true});
});
