import {generateKeyPairSync} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {devicePlan,createLocalRuntime} from '../../tools/playground-device/install.mjs';

const verifier=()=> 'ed25519:'+generateKeyPairSync('ed25519').publicKey.export({format:'der',type:'spki'}).toString('base64');
const args={deviceId:'a'.repeat(32),binding:'b'.repeat(64),image:'robinson-coding:test',
 controlPublicKey:verifier(),allowLocalImage:true};
const setup=()=>devicePlan(args);
function simulator({collision=false,networkInternal=true}={}){
 const objects={image:{},network:null,volume:null,container:null};
 const calls=[];
 const missing=type=>{const e=new Error('No such '+type);e.stderr='Error: No such '+type;throw e;};
 const docker=async argv=>{
  calls.push(argv);
  const [kind,action]=argv;
  if(action==='inspect'){
   const o=objects[kind==='container'?'container':kind==='network'?'network':kind==='volume'?'volume':'image'];
   if(!o)return missing(kind==='container'?'container':kind);
   if(kind==='image')return JSON.stringify([{Id:'image-1'}]);
   return JSON.stringify([o]);
  }
  const label=(arr)=>{
   const fields={};for(let i=0;i<arr.length-1;i++)if(arr[i]==='--label'){
    const [k,...val]=arr[i+1].split('=');fields[k]=val.join('=');
   }return fields;
  };
  if(kind==='network'&&action==='create'){
   objects.network={Labels:collision?{'robinson.playground.enrollment':'wrong'}:label(argv),
     Internal:networkInternal};
   return 'network-id';
  }
  if(kind==='volume'&&action==='create'){objects.volume={Labels:label(argv),Name:argv.at(-1)};return argv.at(-1);}
  if(kind==='container'&&action==='create'){
   objects.container={Config:{Labels:label(argv),Image:args.image,Env:[
    'CODING_WORKSPACE_BINDING='+args.binding,'CODING_CONTROL_PUBLIC_KEY='+args.controlPublicKey
   ]},HostConfig:{NetworkMode:setup().network,ReadonlyRootfs:true,Privileged:false,Binds:[]},
   Mounts:[{Name:setup().volume,Destination:'/workspace'}],
   NetworkSettings:{Networks:{[setup().network]:{}},Ports:{'3000/tcp':null}},
   State:{Running:false}};
   return 'container-id';
  }
  if(kind==='container'&&action==='start'){objects.container.State.Running=true;return 'started';}
  if(kind==='container'&&action==='stop'){objects.container.State.Running=false;return 'stopped';}
  if(kind==='container'&&action==='rm'){objects.container=null;return 'removed';}
  if(kind==='volume'&&action==='rm'){objects.volume=null;return 'removed';}
  if(kind==='network'&&action==='rm'){objects.network=null;return 'removed';}
  if(kind==='exec'){
   const v=argv.some(x=>String(x).includes('pg_isready'))?'postgres15-started-stopped':
     argv.some(x=>String(x).includes('chromium.launch'))?'chromium-ok':'node24-uid1000';
   return v;
  }
  throw new Error('Unknown command '+argv.join(' '));
 };
 return {docker,objects,calls};
}
describe('owner-operated Docker runtime contract',()=>{
 it('requires a reviewed immutable image, exact binding and actual Ed25519 public key',()=>{
  expect(()=>devicePlan({...args,allowLocalImage:false})).toThrow(/immutable/);
  expect(()=>devicePlan({...args,image:'hello:latest'})).toThrow(/immutable/);
  expect(()=>devicePlan({...args,binding:'nothex'})).toThrow(/binding/);
  expect(()=>devicePlan({...args,controlPublicKey:'ed25519:invalid'})).toThrow(/public key/);
  const official=devicePlan({...args,image:'ghcr.io/acme/coding@sha256:'+'c'.repeat(64),allowLocalImage:false});
  expect(official.image).toContain('@sha256:');
 });
 it('installs only its own labeled network, volume and container with no published port or socket',async()=>{
  const sim=simulator(),local=createLocalRuntime({docker:sim.docker}),plan=setup();
  expect(local.plan(plan)).toMatchObject({providerMutated:false,controllerAdmission:false,image:args.image});
  expect(sim.calls).toHaveLength(0);
  expect(await local.install(plan)).toMatchObject({alreadyInstalled:false,canaryPassed:false});
  expect(sim.calls.some(a=>a.includes('--internal'))).toBe(true);
  const create=sim.calls.find(a=>a[0]==='container'&&a[1]==='create');
  for(const flag of ['--read-only','--cap-drop','--network','--mount','--pids-limit'])expect(create).toContain(flag);
  expect(create).not.toContain('-p');expect(create).not.toContain('--privileged');
  expect(create).not.toContain('/var/run/docker.sock');
  expect((await local.install(plan)).alreadyInstalled).toBe(true);
  expect(await local.canary(plan)).toMatchObject({canaryPassed:true,controllerAdmission:false});
  expect((await local.remove(plan))).toEqual({
   disposed:true,containerAbsent:true,volumeAbsent:true,networkAbsent:true
  });
  expect(await local.evidence(plan)).toMatchObject({container:null,network:null,volume:null});
 });
 it('refuses foreign ownership, unsupported networks and ambiguous resource state before mutation',async()=>{
  const plan=setup(),foreign=simulator({collision:true}),wrong=createLocalRuntime({docker:foreign.docker});
  await expect(wrong.install(plan)).rejects.toThrow(/foreign Docker/);
  const noNet=simulator({networkInternal:false}),local=createLocalRuntime({docker:noNet.docker});
  await expect(local.install(plan)).rejects.toThrow(/not internal/);
  expect(noNet.objects.container).toBeNull();
 });
 it('does not accept a mutable tag or inaccurate, unsupported resource promises',()=>{
  expect(()=>devicePlan({...args,cpuCpus:9})).toThrow(/bounded/);
  expect(()=>devicePlan({...args,memoryMiB:256})).toThrow(/bounded/);
  expect(setup().verified).toBe(false);
 });
});
