// User-operated Docker baseline, never an agent tool or a control-plane installer.
// One isolated, immutable image per owner/workspace; no Docker socket/host mounts.
// Local checks NEVER promote an enrolled device beyond pending_canary.
import {execFileSync} from 'node:child_process';
import {createHash,createPublicKey} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {writeLocalCanaryReceipt} from './canary-receipt.mjs';

const HEX64=/^[a-f0-9]{64}$/;
const HEX32=/^[a-f0-9]{32}$/;
const IMAGE=/^[a-z0-9][a-z0-9._/-]*(?::[a-z0-9._-]+)?@sha256:[a-f0-9]{64}$/;
const ownerLabel='robinson.playground.enrollment';
const purposeLabel='robinson.playground.purpose';
const fail=(reason)=>Object.assign(new Error(reason),{code:'local_device_refused'});
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const observedLabels=(record)=>record?.Config?.Labels??record?.Labels??null;
const hasLabels=(record,labels)=>Object.entries(labels).every(([k,v])=>observedLabels(record)?.[k]===v);
const isMissing=(error,type,name)=>{const message=String(error?.stderr??error?.message??'');return /No such (?:object|container|network|volume|image)/i.test(message)||message.includes(type+' '+name+' not found');};
export const dockerRun=(args)=>execFileSync('docker',args,{encoding:'utf8',maxBuffer:2*1024*1024,timeout:60000,stdio:['ignore','pipe','pipe']}).trim();
const inspect=async(docker,type,name)=>{try{const rows=JSON.parse(await docker([type,'inspect',name]));return Array.isArray(rows)?rows[0]??null:rows;}catch(error){if(isMissing(error,type,name))return null;throw error;}};
const exactOutput=(s,label)=>{if(typeof s!=='string'||s.length>2*1024*1024)throw fail('Unbounded Docker '+label+' response.');return s;};
export function devicePlan({deviceId,binding,image,controlPublicKey,cpuCpus=2,memoryMiB=2048,allowLocalImage=false}={}){
 if(!HEX32.test(deviceId??'')||!HEX64.test(binding??''))throw fail('Use a verified device ID and exact workspace binding.');
 if(!(IMAGE.test(image??'')||(allowLocalImage&&image==='robinson-coding:test')))throw fail('Use an immutable reviewed image@sha256 digest.');
 let key;try{if(typeof controlPublicKey!=='string'||!controlPublicKey.startsWith('ed25519:'))throw Error();
  key=createPublicKey({key:Buffer.from(controlPublicKey.slice(8),'base64'),format:'der',type:'spki'});
 }catch{throw fail('A valid pinned Ed25519 control-plane public key is required.');}
 if(key.asymmetricKeyType!=='ed25519')throw fail('Control verifier is not an Ed25519 public key.');
 if(!Number.isInteger(cpuCpus)||cpuCpus<1||cpuCpus>8||!Number.isInteger(memoryMiB)||memoryMiB<1024||memoryMiB>8192)throw fail('Choose a bounded device CPU/memory budget.');
 const prefix='raspg-'+deviceId.slice(0,12)+'-'+binding.slice(0,12),scope=hash([deviceId,binding]);
 const labels={[ownerLabel]:scope,[purposeLabel]:'enrolled-device-runtime-v1'};
 return Object.freeze({prefix,container:prefix+'-runtime',network:prefix+'-private',volume:prefix+'-data',
  labels,image,binding,deviceId,cpuCpus,memoryMiB,controlPublicKey,verified:false});
}
export function createLocalRuntime({docker=dockerRun}={}){
 const argsOf=(labels)=>Object.entries(labels).flatMap(([k,v])=>['--label',k+'='+v]);
 const evidence=async plan=>{
  const [container,network,volume]=await Promise.all([
   inspect(docker,'container',plan.container),inspect(docker,'network',plan.network),inspect(docker,'volume',plan.volume)
  ]);
  for(const value of [container,network,volume])if(value&&!hasLabels(value,plan.labels))throw fail('Name collision or foreign Docker resource; nothing was altered.');
  if(network&&network.Internal!==true)throw fail('Workspace network is not internal.');
  if(container){
   const names=Object.keys(container.NetworkSettings?.Networks??{});
   const mounts=container.Mounts??[];
   const env=container.Config?.Env??[];
   if(container.Config?.Image!==plan.image||container.HostConfig?.NetworkMode!==plan.network||
      names.length!==1||names[0]!==plan.network||
      mounts.length!==1||mounts[0].Name!==plan.volume||mounts[0].Destination!=='/workspace'||
      Object.keys(container.NetworkSettings?.Ports??{}).some(k=>!!container.NetworkSettings.Ports[k])||
      !env.includes('CODING_WORKSPACE_BINDING='+plan.binding)||
      !env.includes('CODING_CONTROL_PUBLIC_KEY='+plan.controlPublicKey)||
      container.HostConfig?.Privileged!==false||container.HostConfig?.ReadonlyRootfs!==true||
      (container.HostConfig?.Binds??[]).length!==0)
     throw fail('Existing container differs from the enrolled isolated runtime plan.');
  }
  return {container,network,volume};
 };
 function planOnly(plan){return {image:plan.image,container:plan.container,network:plan.network,volume:plan.volume,cpuCpus:plan.cpuCpus,memoryMiB:plan.memoryMiB,providerMutated:false,canaryPassed:false,controllerAdmission:false,warning:'Requires device-owner review and real canary before host admission.'};}
 async function install(plan){
  let current=await evidence(plan);
  if(current.container&&current.container.State?.Running===true)return {alreadyInstalled:true,container:plan.container,canaryPassed:false};
  if(current.container)throw fail('A stopped or uncertain container is retained; inspect or explicitly clean up it first.');
  // Install never downloads or upgrades an unreviewed image. Operator must
  // independently supply exact digest, then Docker must already know that image.
  if(!await inspect(docker,'image',plan.image))throw fail('Pull and independently verify the pinned image digest before installation.');
  if(!current.network)await docker(['network','create','--driver','bridge','--internal',...argsOf(plan.labels),plan.network]);
  current=await evidence(plan);
  if(!current.volume)await docker(['volume','create',...argsOf(plan.labels),plan.volume]);
  current=await evidence(plan);
  if(current.container)throw fail('Concurrent container creation was observed.');
  await docker(['container','create','--name',plan.container,...argsOf(plan.labels),
   '--init','--user','0:0','--network',plan.network,'--read-only','--cap-drop','ALL',
   '--cap-add','SETUID','--cap-add','SETGID','--cap-add','CHOWN','--cap-add','DAC_OVERRIDE',
   '--cap-add','KILL','--security-opt','no-new-privileges','--pids-limit','256',
   '--cpus',String(plan.cpuCpus),'--memory',String(plan.memoryMiB)+'m',
   '--tmpfs','/tmp:rw,nosuid,nodev,size=512m,mode=1777',
   '--mount','type=volume,source='+plan.volume+',target=/workspace',
   '--env','CODING_WORKSPACE_BINDING='+plan.binding,
   '--env','CODING_CONTROL_PUBLIC_KEY='+plan.controlPublicKey,
   '--env','CODING_IDLE_TIMEOUT_MS=14400000',plan.image]);
  await evidence(plan);
  await docker(['container','start',plan.container]);
  const ready=await evidence(plan);
  if(ready.container?.State?.Running!==true)throw fail('Container did not independently start.');
  return {alreadyInstalled:false,container:plan.container,canaryPassed:false};
 }
 async function canary(plan){
  const before=await evidence(plan);
  if(before.container?.State?.Running!==true)throw fail('No verified running isolated runtime.');
  // Never invoke an agent-supplied argv here. These are fixed local image probes.
  const node=exactOutput(await docker(['exec','--user','1000:1000','-w','/app',plan.container,
   'node','-e',"if(!process.version.startsWith('v24.'))process.exit(2);if(process.getuid()!==1000)process.exit(3);console.log('node24-uid1000')"]), 'Node');
  const postgres=exactOutput(await docker(['exec','--user','1000:1000','--env','HOME=/workspace/home',
    '-w','/app',plan.container,'node','--input-type=module','-e',
    "import {spawn,spawnSync} from 'node:child_process';import {setTimeout as delay} from 'node:timers/promises';const child=spawn('/bin/sh',['/app/workers/coding-workspace/test-database'],{detached:true,stdio:'ignore',env:{...process.env,HOME:'/workspace/home'}});let passed=false;try{for(let i=0;i<80;i++){if(spawnSync('pg_isready',['-h','127.0.0.1','-p','5432'],{stdio:'ignore'}).status===0){passed=true;break;}await delay(100);}if(!passed)process.exitCode=2;}finally{try{process.kill(-child.pid,'SIGTERM')}catch(e){if(e.code!=='ESRCH')throw e}let stopped=false;for(let i=0;i<80;i++){if(spawnSync('pg_isready',['-h','127.0.0.1','-p','5432'],{stdio:'ignore'}).status!==0){stopped=true;break;}await delay(100);}if(!stopped)process.exitCode=5;}if(passed&&process.exitCode!==5)console.log('postgres15-started-stopped');"
  ]), 'PostgreSQL');
  const chromium=exactOutput(await docker(['exec','--user','1000:1000','--env','PLAYWRIGHT_BROWSERS_PATH=/opt/playwright','-w','/app',plan.container,
   'node','--input-type=module','-e',"import {chromium} from 'playwright';const b=await chromium.launch({headless:true});const p=await b.newPage();await p.goto('data:text/html,<title>Device Canary</title>');if(await p.title()!=='Device Canary')process.exit(4);await b.close();console.log('chromium-ok');"]), 'Chromium');
  if(!node.includes('node24-uid1000')||!postgres.includes('postgres15-started-stopped')||!chromium.includes('chromium-ok'))throw fail('The local image did not pass its runtime canary.');
  const after=await evidence(plan);
  if(after.container?.State?.Running!==true)throw fail('Runtime exited during canary.');
  return {canaryPassed:true,deviceId:plan.deviceId,binding:plan.binding,
   verifiedLocalOnly:true,controllerAdmission:false,node:'24',postgres:'15',chromium:true,
   limits:{cpus:plan.cpuCpus,memoryMiB:plan.memoryMiB,storageQuotaBytes:null},
   warning:'Local image proof is not signed remote canary, actual workspace mount, or execution enrollment.'};
 }
 async function remove(plan){
  let current=await evidence(plan);
  if(current.container){
   if(current.container.State?.Running===true)await docker(['container','stop','--time','5',plan.container]);
   // Recheck original labels and stop state before a destructive remove.
   current=await evidence(plan);
   if(current.container?.State?.Running===true)throw fail('Runtime did not stop; preserve it for manual recovery.');
   await docker(['container','rm',plan.container]);
  }
  current=await evidence(plan);
  if(current.container)throw fail('Container removal could not be independently confirmed.');
  if(current.volume)await docker(['volume','rm',plan.volume]);
  current=await evidence(plan);
  if(current.volume)throw fail('Exact owned volume cleanup unconfirmed.');
  if(current.network)await docker(['network','rm',plan.network]);
  current=await evidence(plan);
  if(current.container||current.volume||current.network)throw fail('Whole owned allocation cleanup unconfirmed.');
  return {disposed:true,containerAbsent:true,volumeAbsent:true,networkAbsent:true};
 }
 return {plan:planOnly,install,canary,remove,evidence};
}
function options(argv){
 const data={};
 for(let i=0;i<argv.length;i+=2){const key=argv[i],value=argv[i+1];
  if(!['--device','--binding','--image','--control-key','--action','--origin','--generation'].includes(key)||typeof value!=='string'||data[key])throw fail('Unknown or repeated installer argument.');
  data[key]=value;
 }
 if(!['plan','install','canary','remove'].includes(data['--action']))throw fail('Choose --action plan, install, canary, or remove.');
 if((data['--origin']||data['--generation'])&&
    (data['--action']!=='canary'||!data['--origin']||!data['--generation']||
     !/^[1-9][0-9]*$/.test(data['--generation'])||!Number.isSafeInteger(Number(data['--generation']))))
    throw fail('Both enrolled origin and generation are required for a signed canary receipt.');
 return data;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 try{
  const args=options(process.argv.slice(2)),plan=devicePlan({deviceId:args['--device'],binding:args['--binding'],
   image:args['--image'],controlPublicKey:args['--control-key']});
  const local=createLocalRuntime();
  const result=await local[args['--action']](plan);
  const receipt=args['--action']==='canary'&&args['--origin']
    ?await writeLocalCanaryReceipt({plan,origin:args['--origin'],generation:Number(args['--generation']),proof:result})
    :null;
  process.stdout.write(JSON.stringify(receipt?{...result,localReceipt:receipt}:result,null,2)+'\n');
 }catch(error){process.stderr.write('Local device operation refused: '+error.message+'\n');process.exitCode=1;}
}
