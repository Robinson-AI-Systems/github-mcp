import {composeDocument} from './compose-document.js';
import {createHash} from 'node:crypto';
import {dokployConfig,dokployProvider} from './dokploy.js';

// Protected deployment policy, never a caller-supplied permission or assertion.
// Preserve existing verified deployments unless the operator explicitly opts in.
export function resourceMode(env={}){
 const mode=env.PLAYGROUND_RESOURCE_MODE??'verified';
 if(!['verified','best_effort'].includes(mode))throw new TypeError('Invalid protected Playground resource mode.');
 return mode;
}

// Best effort removes resource guarantees, not the managed allocation boundary.
// Legacy URL-only attachments cannot acquire authority by changing this setting.
export function managedResourceBaseline(env,s,{workspace,binding}={}){
 if(resourceMode(env)!=='best_effort'||env.PLAYGROUND_TELEMETRY_URL||!s||s.phase!=='attached'||s.workspace!==workspace||s.binding!==binding||s.repositoryAttached!==true||!s.composeId||!s.providerOrigin||!s.providerProject||!s.providerEnvironment||s.providerOrigin!==env.PLAYGROUND_DOKPLOY_ORIGIN||s.providerProject!==env.PLAYGROUND_DOKPLOY_PROJECT_ID||s.providerEnvironment!==env.PLAYGROUND_DOKPLOY_ENVIRONMENT_ID)return null;
 const p=s.plan,m=s.attachment?.mounts;
 if(!['dedicated-internal-v1','dedicated-ingress-v2'].includes(p?.isolationProfile)||typeof p.composeFile!=='string'||!p.enforcement||p.planHash!==s.planHash||p.planHash!==createHash('sha256').update(JSON.stringify(p.composeFile)).digest('hex')||s.origin!==p.origin||s.brokerOrigin!==p.origin||!/^ed25519:[A-Za-z0-9+/=]+$/.test(s.runtimePublicKey??'')||!m?.worktree||!m.git||m.gitReadOnly!==true)return null;
 return {mode:'best_effort',runtimePublicKey:s.runtimePublicKey,mounts:m,configured:{cpuCpus:p.enforcement.cpuConfigured,memoryBytes:p.enforcement.memoryConfiguredBytes,storageQuotaBytes:null}};
}

// Providers may rewrite raw Compose to add shared ingress networks. The raw
// plan is therefore insufficient execution authority. Unsupported readback
// formats fail closed; never parse YAML with a permissive regex or infer safety.
export async function managedNetworkVerified(ctx,s){
 try{
  const config=dokployConfig(ctx.env);
  if(s.providerOrigin!==config.origin||s.providerProject!==config.project||s.providerEnvironment!==config.environment)return false;
  const provider=dokployProvider(config,{fetch:ctx.fetch});let converted=await provider.converted(s.composeId,s.plan);
  converted=composeDocument(converted);
  const service=converted?.services?.coding,network=converted?.networks?.workspace,names=Array.isArray(service?.networks)?service.networks:service?.networks&&typeof service.networks==='object'?Object.keys(service.networks):[];
  const noPorts=v=>v===undefined||Array.isArray(v)&&v.length===0;
  const gateway=converted?.services?.ingress;
  if(s.plan.ingressService){const ns=Array.isArray(gateway?.networks)?gateway.networks:Object.keys(gateway?.networks??{}),planned=JSON.parse(s.plan.composeFile).services.ingress,expected=planned.environment??{},actual=gateway?.environment??{};if(s.plan.ingressService!=='ingress'||!gateway||gateway.user!=='1000:1000'||gateway.read_only!==true||gateway.image!==planned.image||JSON.stringify(gateway.command)!==JSON.stringify(planned.command)||!Array.isArray(gateway.cap_drop)||!gateway.cap_drop.includes('ALL')||!noPorts(gateway.cap_add)||!noPorts(gateway.devices)||!Array.isArray(gateway.security_opt)||!gateway.security_opt.includes('no-new-privileges:true')||gateway.privileged===true||gateway.pid==='host'||gateway.ipc==='host'||gateway.network_mode||!noPorts(gateway.volumes)||!noPorts(gateway.ports)||!noPorts(gateway.env_file)||Object.keys(actual).length!==Object.keys(expected).length||Object.keys(expected).some(k=>actual[k]!==expected[k])||!ns.includes('workspace')||ns.some(n=>!['workspace','control','default','dokploy-network'].includes(n)))return false;}
  return names.length===1&&names[0]==='workspace'&&network?.internal===true&&network.name===s.plan.network&&network.external!==true&&(!network.driver||network.driver==='bridge')&&!service.network_mode&&noPorts(service.ports)&&service.privileged!==true&&service.pid!=='host'&&service.ipc!=='host';
 }catch{return false;}
}
