import {createHash} from 'node:crypto';
const fail=(code,message)=>Object.assign(new TypeError(message),{safeMessage:true,safeCode:code});
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
// Dokploy assigns a suffix even when appName was supplied. Pin its exact
// independently read-back identity once; never use a wildcard for mutations.
export function pinProviderIdentity(plan,appName){
 if(typeof appName!=='string'||!(appName===plan.name||appName.startsWith(plan.name+'-')&&/^[a-z0-9]{6}$/.test(appName.slice(plan.name.length+1))))throw fail('playground_allocation_ownership','Provider-assigned allocation name differs from its exact requested identity.');
 if(plan.providerAppName&&plan.providerAppName!==appName)throw fail('playground_allocation_ownership','Pinned provider allocation name changed; no mutation was sent.');
 return {...plan,providerAppName:appName};
}
export function allocationProcessesStopped(rows){return Array.isArray(rows)&&rows.every(row=>['created','exited','dead'].includes(typeof row.State==='string'?row.State:typeof row.state==='string'?row.state:row.State?.Status));}
function operatorDriver(env,prefix){
 const name=env[prefix+'_DRIVER'];if(!name)return null;
 if(!/^[a-zA-Z][a-zA-Z0-9_.:-]{1,127}$/.test(name)||['local','bridge','host','none','overlay'].includes(name))throw fail('playground_provider_setup','Use an operator-supported isolated network or quota volume driver, never a host mount/socket.');
 let options;try{options=JSON.parse(env[prefix+'_OPTIONS']??'{}');}catch{throw fail('playground_provider_setup','Invalid protected driver options.');}
 if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).length>20||Object.entries(options).some(([k,v])=>!/^[a-zA-Z0-9_.-]{1,80}$/.test(k)||/secret|password|token|credential|private.key/i.test(k)||typeof v!=='string'||v.length>1024))throw fail('playground_provider_setup','Invalid protected driver options.');
 return {name,options};
}
const driverOptions=(driver,binding,volume)=>Object.fromEntries(Object.entries(driver.options).map(([k,v])=>[k,v.replaceAll('{binding}',binding).replaceAll('{volume}',volume)]));
// FLEET-4: several operator pools (Dokploy instances, projects or servers).
// PLAYGROUND_POOLS is a protected JSON list; secrets stay in their own variables:
//  [{"id":"east","origin":"https://…","keyEnv":"PLAYGROUND_DOKPLOY_API_KEY_EAST","project":"…","environment":"…",
//    "ingress":"203.0.113.10","serverId":"optional Dokploy server id","weight":1}]
// Without it, the legacy PLAYGROUND_DOKPLOY_* settings form one pool called "default".
const POOL_ID=/^[a-z0-9][a-z0-9-]{0,31}$/;
export function dokployPools(env){
 if(!env?.PLAYGROUND_POOLS)return env?.PLAYGROUND_DOKPLOY_ORIGIN?[{...legacyConfig(env),pool:'default',weight:1}]:[];
 let rows;try{rows=JSON.parse(env.PLAYGROUND_POOLS);}catch{throw fail('playground_provider_setup','PLAYGROUND_POOLS is not valid JSON.');}
 if(!Array.isArray(rows)||!rows.length||rows.length>32)throw fail('playground_provider_setup','PLAYGROUND_POOLS must list 1–32 pools.');
 const ids=new Set();
 return rows.map(r=>{
  if(!r||typeof r!=='object'||!POOL_ID.test(r.id??'')||ids.has(r.id)||!/^PLAYGROUND_[A-Z0-9_]{1,80}$/.test(r.keyEnv??'')||Object.keys(r).some(k=>!['id','origin','keyEnv','project','environment','ingress','serverId','weight'].includes(k)))throw fail('playground_provider_setup','Invalid PLAYGROUND_POOLS entry; secrets belong in their own setting named by keyEnv.');
  ids.add(r.id);
  if(r.serverId!==undefined&&!/^[A-Za-z0-9_-]{1,64}$/.test(r.serverId))throw fail('playground_provider_setup','Invalid pool serverId.');
  const weight=r.weight===undefined?1:r.weight;if(!Number.isInteger(weight)||weight<0||weight>100)throw fail('playground_provider_setup','Pool weight must be 0–100.');
  return {...legacyConfig({...env,PLAYGROUND_DOKPLOY_ORIGIN:r.origin,PLAYGROUND_DOKPLOY_API_KEY:env[r.keyEnv],PLAYGROUND_DOKPLOY_PROJECT_ID:r.project,PLAYGROUND_DOKPLOY_ENVIRONMENT_ID:r.environment,PLAYGROUND_INGRESS_IPV4:r.ingress}),pool:r.id,weight,...(r.serverId?{serverId:r.serverId}:{})};
 });
}
// Rendezvous hashing: each new allocation picks a pool deterministically, spread by
// weight, without counting allocations; a pool with weight 0 takes no new work.
export function choosePool(env,binding){
 const pools=dokployPools(env).filter(p=>p.weight>0);if(!pools.length)return null;
 const score=p=>{const h=parseInt(createHash('sha256').update(binding+'|'+p.pool).digest('hex').slice(0,13),16)/2**52;return -Math.log(h||Number.MIN_VALUE)/p.weight;};
 return pools.reduce((a,b)=>score(b)<score(a)?b:a);
}
export function dokployConfig(env,pool){
 if(!env?.PLAYGROUND_POOLS)return legacyConfig(env);
 const id=pool??'default',found=dokployPools(env).find(p=>p.pool===id);
 // Rows created before pools existed keep using the legacy settings unless a "default" pool is listed.
 if(!found&&id==='default'&&env.PLAYGROUND_DOKPLOY_ORIGIN)return legacyConfig(env);
 if(!found)throw fail('playground_provider_setup','This allocation\'s pool "'+String(pool).slice(0,32)+'" is no longer configured; its resources are preserved.');
 return found;
}
function legacyConfig(env){
 let origin;try{origin=new URL(env.PLAYGROUND_DOKPLOY_ORIGIN);}catch{throw fail('playground_provider_setup','Configure the project-scoped Playground Dokploy provider in protected settings.');}
 if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash||!env.PLAYGROUND_DOKPLOY_API_KEY||!env.PLAYGROUND_DOKPLOY_PROJECT_ID||!env.PLAYGROUND_DOKPLOY_ENVIRONMENT_ID||(!/^[-a-zA-Z0-9./:]+@sha256:[a-f0-9]{64}$/.test(env.PLAYGROUND_IMAGE??'')&&!/^[a-f0-9]{40}$/.test(env.PLAYGROUND_BUILD_SOURCE_SHA??env.VERCEL_GIT_COMMIT_SHA??''))||!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(env.PLAYGROUND_INGRESS_IPV4??'')||env.PLAYGROUND_INGRESS_IPV4.split('.').some(x=>Number(x)>255))throw fail('playground_provider_setup','The protected Playground project, immutable image or ingress configuration is invalid.');
 return {cpuCpus:Number(env.PLAYGROUND_CPU_CPUS??8),memoryBytes:Number(env.PLAYGROUND_MEMORY_BYTES??8*1024**3),storageDriver:operatorDriver(env,'PLAYGROUND_STORAGE'),networkDriver:operatorDriver(env,'PLAYGROUND_NETWORK'),origin:origin.origin,key:env.PLAYGROUND_DOKPLOY_API_KEY,project:env.PLAYGROUND_DOKPLOY_PROJECT_ID,environment:env.PLAYGROUND_DOKPLOY_ENVIRONMENT_ID,image:env.PLAYGROUND_IMAGE,sourceSha:env.PLAYGROUND_BUILD_SOURCE_SHA??env.VERCEL_GIT_COMMIT_SHA,controlOrigin:env.PUBLIC_BASE_URL,ingress:env.PLAYGROUND_INGRESS_IPV4};
}
export function allocationPlan({binding,verificationKey,idleTimeoutMs},config){
 if(!/^[a-f0-9]{64}$/.test(binding)||!verificationKey?.startsWith('ed25519:')||!Number.isSafeInteger(idleTimeoutMs)||idleTimeoutMs<60000||idleTimeoutMs>86400000)throw fail('playground_plan','Invalid immutable allocation binding.');
 const cpu=config.cpuCpus??8,memory=Math.floor((config.memoryBytes??8*1024**3)/1024**2);if(!Number.isFinite(cpu)||cpu<0.2||cpu>8||!Number.isSafeInteger(memory)||memory<512||memory>8192)throw fail('playground_plan','Protected allocation ceilings must fit0.2–8CPU and512MiB–8GiB memory.');
 const brokerCpu=Math.min(0.5,cpu/4),brokerMemory=Math.min(1536,Math.floor(memory/4)),ingressCpu=Math.min(0.1,cpu/8),ingressMemory=Math.min(128,Math.floor(memory/8)),runtimeMemory=memory-brokerMemory-ingressMemory;
 const name='ras-pg-'+binding.slice(0,32),volume=name+'-data',network=name+'-private';
 const labels={'com.robinson.playground.binding':binding,'com.robinson.playground.owner':'github-mcp'};
 const worker=config.worker;
 if(!/^git_[a-f0-9]{32}$/.test(worker??'')||!config.nativeBinding)throw fail('playground_plan','The exact native repository binding is required.');
 const service={...(config.image?{image:config.image}:{image:'ras-playground:'+config.sourceSha,build:{context:'https://github.com/Robinson-AI-Systems/github-mcp.git#'+config.sourceSha,dockerfile:'workers/coding-workspace/Dockerfile',target:'production'}}),init:true,restart:'no',read_only:true,security_opt:['no-new-privileges:true'],stop_grace_period:'30s',labels};
 const callback=new URL('/api/playground/lifecycle',config.controlOrigin??'https://github.robinsonaisystems.com');callback.searchParams.set('binding',binding);if(config.scope?.tenantId){callback.searchParams.set('tenant',config.scope.tenantId);callback.searchParams.set('identity',config.scope.identityId);}
 const brokerMounts=['broker:/data','files:/data/'+worker+'/repo','git:/data/'+worker+'/repo/.git'];
 const compose={name,services:{
  initialize:{...service,cap_drop:['ALL'],cap_add:['CHOWN','DAC_OVERRIDE'],cpus:String(Math.min(0.5,cpu)),mem_limit:Math.min(512,memory)+'m',memswap_limit:Math.min(512,memory)+'m',command:['node','workers/coding-workspace/initialize.js'],environment:{NATIVE_GIT_SINGLE_WORKSPACE_ID:worker},volumes:[...brokerMounts,'execution:/workspace'],network_mode:'none'},
  broker:{...service,user:'1000:1000',cap_drop:['ALL'],cpus:String(brokerCpu),mem_limit:brokerMemory+'m',memswap_limit:brokerMemory+'m',command:['node','workers/native-git/server.js'],depends_on:{initialize:{condition:'service_completed_successfully'}},environment:{NATIVE_GIT_STORAGE_ROOT:'/data',NATIVE_GIT_CONTROL_PUBLIC_KEY:verificationKey,NATIVE_GIT_SINGLE_WORKSPACE_ID:worker,NATIVE_GIT_SINGLE_BINDING:config.nativeBinding,NATIVE_GIT_AUTHORITY_URL:callback.href},volumes:brokerMounts,tmpfs:['/tmp:rw,noexec,nosuid,nodev,size=128m,mode=1777'],expose:['3000'],networks:['workspace','control']},
  coding:{...service,cap_drop:['ALL'],cap_add:['SETUID','SETGID','KILL','CHOWN','DAC_OVERRIDE'],mem_limit:runtimeMemory+'m',memswap_limit:runtimeMemory+'m',cpus:String(cpu-brokerCpu-ingressCpu),depends_on:{initialize:{condition:'service_completed_successfully'}},environment:{CODING_WORKSPACE_BINDING:binding,CODING_CONTROL_PUBLIC_KEY:verificationKey,CODING_IDLE_TIMEOUT_MS:String(idleTimeoutMs),CODING_LIFECYCLE_URL:'http://broker:3000/v1/authority',CODING_EGRESS_PROXY:'http://ingress:3128',CODING_PUBLIC_ORIGIN:'https://'+name+'-'+config.ingress.replaceAll('.','-')+'.sslip.io',CODING_CONTROL_ORIGIN:new URL(config.controlOrigin??'https://github.robinsonaisystems.com').origin},volumes:['execution:/workspace','files:/workspace/repo','git:/workspace/repo/.git:ro'],tmpfs:['/tmp:rw,nosuid,nodev,size=1g,mode=1777'],expose:['3000'],networks:['workspace']},
  ingress:{...service,user:'1000:1000',cap_drop:['ALL'],cpus:String(ingressCpu),mem_limit:ingressMemory+'m',memswap_limit:ingressMemory+'m',command:['node','workers/coding-workspace/ingress.js'],environment:{EGRESS_BLOCKED_HOSTS:JSON.stringify([new URL(config.origin??'https://dokploy.example.invalid').hostname,new URL(config.controlOrigin??'https://github.robinsonaisystems.com').hostname]),EGRESS_BLOCKED_ADDRESSES:JSON.stringify([config.ingress])},depends_on:{coding:{condition:'service_started'},broker:{condition:'service_started'}},expose:['3000'],networks:['workspace','control']}
 },volumes:Object.fromEntries(['broker','files','git','execution'].map(v=>[v,{name:volume+'-'+v,labels,...(config.storageDriver?{driver:config.storageDriver.name,driver_opts:driverOptions(config.storageDriver,binding,v)}:{})}])),networks:{workspace:{name:network,internal:!config.networkDriver,labels,...(config.networkDriver?{driver:config.networkDriver.name,driver_opts:driverOptions(config.networkDriver,binding,'workspace')}:{})},control:{name:network+'-control',labels}}};

 const composeFile=JSON.stringify(compose),host=name+'-'+config.ingress.replaceAll('.','-')+'.sslip.io';
 return {name,ingressService:'ingress',volume,volumes:Object.values(compose.volumes).map(v=>v.name),network,host,origin:'https://'+host,composeFile,planHash:hash(composeFile),description:'robinson-playground/v1 binding='+binding+' plan='+hash(composeFile),...(!config.networkDriver?{isolationProfile:'dedicated-ingress-v2'}:{}),enforcement:{cpuConfigured:cpu,memoryConfiguredBytes:memory*1024**2,storageQuotaVerified:false,networkIsolationVerified:false,executionEnabled:false}};
}
export function dokployProvider(config,{fetch:fetchImpl=globalThis.fetch}={}){
 const allowed={ 'project.one':'GET','compose.create':'POST','compose.one':'GET','compose.getConvertedCompose':'GET','deployment.allByCompose':'GET','compose.deploy':'POST','compose.update':'POST','compose.stop':'POST','compose.start':'POST','compose.delete':'POST','domain.create':'POST','docker.getContainersByAppNameMatch':'GET','dockerVolume.getVolumeConfig':'GET'};
 const call=async(operation,input)=>{
  const method=allowed[operation];if(!method)throw fail('playground_provider_operation','Unsupported allocation operation.');
  const url=new URL('/api/'+operation,config.origin);if(method==='GET')for(const [key,value] of Object.entries(input))url.searchParams.set(key,String(value));
  let response;try{response=await fetchImpl(url,{method,redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json','x-api-key':config.key},...(method==='POST'?{body:JSON.stringify(input)}:{})});}catch{throw fail('playground_provider_uncertain','Dokploy transport did not confirm this operation. Inspect the recorded allocation before any retry.');}
  let text='';const reader=response.body.getReader();try{for(;;){const {done,value}=await reader.read();if(done)break;text+=Buffer.from(value).toString('utf8');if(Buffer.byteLength(text)>2*1024*1024){await reader.cancel();throw fail('playground_provider_response','Dokploy response exceeded its bounded allocation contract.');}}}finally{reader.releaseLock();}
  if(response.status===404)return null;
  if(!response.ok)throw Object.assign(fail('playground_provider_refused',`Dokploy refused allocation operation ${operation} (HTTP ${response.status}); no provider body or credential was exposed.`),{status:response.status});
  let data;try{data=JSON.parse(text);}catch{throw fail('playground_provider_response','Dokploy returned an invalid allocation response.');}return data;
 };
 const project=async()=>{const p=await call('project.one',{projectId:config.project});if(p?.projectId!==config.project||!p.environments?.some(e=>e.environmentId===config.environment))throw fail('playground_provider_scope','Dokploy did not confirm the configured exact project/environment.');return p;};
 const inventory=async()=>{const p=await project();return p.environments.find(e=>e.environmentId===config.environment).compose??[];};
 const storedRow=async(id,plan,{adoptAssignedName=false}={})=>{const a=await call('compose.one',{composeId:id});if(a===null)return null;const expected=adoptAssignedName?pinProviderIdentity(plan,a.appName).providerAppName:plan.providerAppName??plan.name;if(a.composeId!==id||a.environmentId!==config.environment||a.environment?.projectId!==config.project||a.appName!==expected||adoptAssignedName&&a.name!==plan.name||a.description!==plan.description||a.sourceType!=='raw')throw fail('playground_allocation_ownership','Allocation ownership, source or project changed; no mutation was sent.');return a;};
 const inspect=async(id,plan,options={})=>{const a=await storedRow(id,plan,options);if(a===null)return null;if(a.composeFile!==plan.composeFile)throw fail('playground_allocation_ownership','Allocation ownership, source or project changed; no mutation was sent.');return a;};
 return {project,inventory,inspect,
  // The stored compose row with every ownership field verified except the file
  // itself, so a caller can compare the file it carries (manager sweep-key drift).
  async stored(id,plan){return storedRow(id,plan);},
  // Replaces the stored compose file with the caller's plan after the same
  // ownership verification, then proves the replacement by a full inspect.
  async update(id,plan){if(!await storedRow(id,plan))throw fail('playground_allocation_missing','The owned allocation is missing.');await call('compose.update',{composeId:id,composeFile:plan.composeFile});if(!await inspect(id,plan))throw fail('playground_provider_response','Provider update was not confirmed.');},
  async deployments(id,plan){if(!await inspect(id,plan))throw fail('playground_allocation_missing','The owned allocation is missing.');const rows=await call('deployment.allByCompose',{composeId:id});if(!Array.isArray(rows))throw fail('playground_provider_response','Deployment inventory is unavailable.');return rows;},
  async converted(id,plan){if(!await inspect(id,plan))return null;return call('compose.getConvertedCompose',{composeId:id});},
  async create(plan){await project();const created=await call('compose.create',{name:plan.name,appName:plan.name,description:plan.description,environmentId:config.environment,composeType:'docker-compose',sourceType:'raw',composeFile:plan.composeFile,...(config.serverId?{serverId:config.serverId}:{})});if(!created?.composeId)throw fail('playground_provider_uncertain','Provider create was not confirmed; inspect this original allocation intent.');return inspect(created.composeId,plan,{adoptAssignedName:true});},
  async expose(id,plan){if(!await inspect(id,plan))throw fail('playground_allocation_missing','The owned allocation is missing.');const domains=[];for(const path of ['/','/v1/workspace'])domains.push(await call('domain.create',{host:plan.host,https:true,port:3000,path,composeId:id,serviceName:plan.ingressService??(path==='/'?'coding':'broker'),domainType:'compose',certificateType:'letsencrypt',internalPath:'/',stripPath:false}));return domains;},
  async deploy(id,plan){if(!await inspect(id,plan))throw fail('playground_allocation_missing','The owned allocation is missing.');return call('compose.deploy',{composeId:id,title:'Bound Robinson Playground allocation',description:plan.description,freshVolumes:false});},
  async start(id,plan){if(!await inspect(id,plan))throw fail('playground_allocation_missing','The owned allocation is missing.');await call('compose.start',{composeId:id});},
  async stop(id,plan){if(await inspect(id,plan)===null)return;await call('compose.stop',{composeId:id});},
  async containers(plan){const rows=await call('docker.getContainersByAppNameMatch',{appName:plan.providerAppName??plan.name,appType:'docker-compose'});if(!Array.isArray(rows))throw fail('playground_cleanup_unverified','Container inventory is unavailable; absence is not proven.');return rows;},
  async volume(plan){const rows=[];for(const volumeName of plan.volumes)rows.push(await call('dockerVolume.getVolumeConfig',{volumeName}));return rows.some(Boolean)?rows:null;},
  async remove(id,plan){if(await inspect(id,plan)===null)return;if(!allocationProcessesStopped(await this.containers(plan)))throw fail('playground_cleanup_pending','Allocation processes remain; its volume was preserved.');await call('compose.delete',{composeId:id,deleteVolumes:true});},
  async absent(id,plan){return await inspect(id,plan)===null&&(await this.containers(plan)).length===0&&await this.volume(plan)===null;}
 };
}
