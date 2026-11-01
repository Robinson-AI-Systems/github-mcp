// FLEET-7 gate: warm runtimes. Design choice (a) "warm image" (docs/pr-cards/FLEET-7.md):
// a warm runtime is a tiny, tenant-free "image holder" compose that keeps the exact
// digest-pinned runtime image present on a pool's host, so a NEW allocation's own
// containers start without an image pull. It is never a workspace runtime: it has no
// environment, no volumes, no network, no domain, no binding label and no credential,
// and no allocation ever adopts, binds to or reuses it. Every workspace still gets its
// own fresh, single-use, per-binding allocation exactly as before.
//
// The gate is code: warm holders exist only while measured demand (new allocations per
// hour over the last 24 h, from the stored allocation index) AND a fresh host
// observation (the same admission/telemetry feed allocations use) both exceed stored,
// plainly explained thresholds. Pool size (how many runtime images are kept warm) is
// computed from demand and capped by headroom; the cleanup sweep drains holders when
// demand falls or headroom shrinks. Defaults keep the feature dormant on today's single
// small shared host.
import {createHash} from 'node:crypto';
import {publicOrigin} from '../core/http.js';
import {refreshAdmission} from './admission.js';
import {resolvePrebuiltImage} from './prebuilt-image.js';
import {rootAllocationDb} from './index.js';
import {dokployPools,dokployConfig,dokployProvider,pinProviderIdentity,allocationProcessesStopped} from './dokploy.js';

const hash=x=>createHash('sha256').update(x).digest('hex');
const HOUR=3600000,DAY=24*HOUR,FRESH_MS=60000,CREATE_UNCERTAIN_MS=600000;
const DIGEST_IMAGE=/^[-a-zA-Z0-9./:]+@sha256:[a-f0-9]{64}$/;
export const WARM_STATE_KEY='playground_warm';
export const WARM_NAME_PREFIX='ras-pg-warm-';
const GiB=1024**3,GB=1000**3;
// [field, protected setting, default, valid, plain unit for messages]
const SETTINGS=[
 ['minAllocationsPerHour','PLAYGROUND_WARM_MIN_ALLOCATIONS_PER_HOUR',6,x=>Number.isFinite(x)&&x>0&&x<=100000],
 ['allocationsPerImage','PLAYGROUND_WARM_ALLOCATIONS_PER_IMAGE',6,x=>Number.isFinite(x)&&x>0&&x<=100000],
 ['maxImages','PLAYGROUND_WARM_MAX_IMAGES',2,x=>Number.isInteger(x)&&x>=0&&x<=3],
 ['minHostMemoryBytes','PLAYGROUND_WARM_MIN_HOST_MEMORY_BYTES',8*GiB,x=>Number.isSafeInteger(x)&&x>0],
 ['minHostDiskBytes','PLAYGROUND_WARM_MIN_HOST_DISK_BYTES',50*GB,x=>Number.isSafeInteger(x)&&x>0],
 ['maxHostPressure','PLAYGROUND_WARM_MAX_HOST_PRESSURE',0.5,x=>Number.isFinite(x)&&x>0&&x<=1],
 ['diskPerImageBytes','PLAYGROUND_WARM_DISK_PER_IMAGE_BYTES',6*GB,x=>Number.isSafeInteger(x)&&x>0]
];
export const WARM_DEFAULTS=Object.freeze(Object.fromEntries(SETTINGS.map(([k,,d])=>[k,d])));

/** The protected thresholds. Any invalid value turns the feature off (fail closed), never on. */
export function warmSettings(env={}){
 const mode=env.PLAYGROUND_WARM_RUNTIMES??'auto';
 if(!['auto','off'].includes(mode))return {ok:false,reason:'Warm runtimes are off: PLAYGROUND_WARM_RUNTIMES must be auto or off.'};
 const settings={mode};
 for(const [field,name,fallback,valid] of SETTINGS){
  const raw=env[name],value=raw===undefined||raw===''?fallback:Number(raw);
  if(!valid(value))return {ok:false,reason:`Warm runtimes are off: the protected setting ${name} is not a valid value.`};
  settings[field]=value;
 }
 return {ok:true,settings};
}

const gib=b=>(b/GiB).toFixed(1)+' GiB',gb=b=>Math.floor(b/GB)+' GB',rate=x=>(Math.round(x*10)/10).toString();
/** Fresh host headroom from the same observation allocation admission uses (≤ 60 s old, this pool's project). */
export function freshHeadroom(observation,project,now){
 const o=observation;
 if(!o||o.project!==project||!Number.isSafeInteger(o.observedAt)||o.observedAt>now||now-o.observedAt>FRESH_MS||!Number.isSafeInteger(o.availableMemoryBytes)||!Number.isSafeInteger(o.availableDiskBytes)||!Number.isFinite(o.pressure)||o.pressure<0)return null;
 return {availableMemoryBytes:o.availableMemoryBytes,availableDiskBytes:o.availableDiskBytes,pressure:o.pressure,observedAt:o.observedAt};
}
const demandOf=(rows,pool)=>{const variants={};let total=0;for(const r of rows??[]){if((r.pool??'default')!==pool)continue;const n=Number(r.count)||0;total+=n;variants[r.variant]=(variants[r.variant]??0)+n;}return {total,variants};};

/**
 * The gate itself (pure). `demand` = {total, variants} new allocations of this pool in the
 * last 24 h; `observation` the parsed admission observation (undefined = not measured);
 * `images` = {pinned, full, slim} digest-pinned images or null; `running` = warm holders
 * already present for this pool (their disk is already counted in the observation).
 */
export function warmDecision({env={},pool='default',project,demand={total:0,variants:{}},observation,images={},running=0,now=Date.now()}){
 const base={pool,enabled:false,target:0,images:[],demand_per_hour:Math.round(demand.total/24*10)/10,demand_last_24h:demand.total};
 const parsed=warmSettings(env);if(!parsed.ok)return {...base,reason:parsed.reason};
 const s=parsed.settings;
 if(s.mode==='off')return {...base,reason:'Warm runtimes are off: the operator setting PLAYGROUND_WARM_RUNTIMES is off.'};
 if(s.maxImages===0)return {...base,reason:'Warm runtimes are off: PLAYGROUND_WARM_MAX_IMAGES is 0.'};
 const perHour=demand.total/24;
 if(perHour<s.minAllocationsPerHour)return {...base,reason:`Warm runtimes are off: ${demand.total} new runtimes started in the last 24 hours (${rate(perHour)} per hour), below the ${rate(s.minAllocationsPerHour)} per hour needed. Every runtime starts cold, which costs nothing extra.`};
 const h=freshHeadroom(observation,project,now);
 if(!h)return {...base,reason:'Warm runtimes are off: there is no fresh host measurement (a signed capacity reading under 60 seconds old), so spare room on the host is unknown.'};
 const headroom={available_memory:gib(h.availableMemoryBytes),available_disk:gb(h.availableDiskBytes),pressure:h.pressure};
 const below=h.availableMemoryBytes<s.minHostMemoryBytes?`free memory ${gib(h.availableMemoryBytes)} is below ${gib(s.minHostMemoryBytes)}`:h.availableDiskBytes<s.minHostDiskBytes?`free disk ${gb(h.availableDiskBytes)} is below ${gb(s.minHostDiskBytes)}`:h.pressure>s.maxHostPressure?`host pressure ${h.pressure} is above ${s.maxHostPressure}`:null;
 if(below)return {...base,headroom,reason:`Warm runtimes are off: demand is high enough (${rate(perHour)} per hour) but the host is too busy: ${below}.`};
 // Candidates: an operator pin is the only image; otherwise the published variants new runtimes use, most used first.
 let candidates;
 if(images.pinned)candidates=[{variant:'operator_pinned',image:images.pinned}];
 else{const slim=demand.variants.slim??0,full=demand.total-slim;candidates=[['full',full,images.full],['slim',slim,images.slim]].filter(([,n,image])=>n>0&&image).sort((a,b)=>b[1]-a[1]).map(([variant,,image])=>({variant,image}));}
 if(!candidates.length)return {...base,headroom,reason:'Warm runtimes are off: no published, digest-pinned runtime image exists for this server version (runtimes are built from source), so there is nothing to keep ready.'};
 const wanted=Math.min(s.maxImages,Math.ceil(perHour/s.allocationsPerImage)),cap=running+Math.floor((h.availableDiskBytes-s.minHostDiskBytes)/s.diskPerImageBytes);
 const target=Math.max(0,Math.min(wanted,cap,candidates.length));
 if(target===0)return {...base,headroom,reason:`Warm runtimes are off: the host has no room for another ${gb(s.diskPerImageBytes)} runtime image above the ${gb(s.minHostDiskBytes)} free-disk minimum.`};
 const chosen=candidates.slice(0,target);
 return {...base,enabled:true,target,headroom,images:chosen,reason:`Warm runtimes are on: ${rate(perHour)} new runtimes per hour over the last 24 hours (needs ${rate(s.minAllocationsPerHour)}) and the host has ${gib(h.availableMemoryBytes)} memory and ${gb(h.availableDiskBytes)} disk free at pressure ${h.pressure}. Keeping ${target} runtime image${target===1?'':'s'} (${chosen.map(c=>c.variant).join(', ')}) ready so new runtimes skip the image download. Nothing is pre-bound to any workspace or credential.`};
}

/** The tenant-free image holder. Its plan contains no binding, worker, key, origin, credential, volume, network or port. */
export function warmHolderPlan({pool,image,variant,origin}){
 if(!DIGEST_IMAGE.test(image??''))throw Object.assign(new TypeError('A warm runtime keeps only a digest-pinned image.'),{safeMessage:true,safeCode:'playground_warm_plan'});
 const id=hash(JSON.stringify(['robinson-playground-warm/v1',origin,pool,image])).slice(0,16),name=WARM_NAME_PREFIX+id;
 const compose={name,services:{warm:{image,init:true,restart:'no',read_only:true,user:'1000:1000',cap_drop:['ALL'],security_opt:['no-new-privileges:true'],network_mode:'none',cpus:'0.05',mem_limit:'64m',memswap_limit:'64m',pids_limit:16,command:['node','-e','setInterval(()=>{},2147483647)'],healthcheck:{disable:true},labels:{'com.robinson.playground.owner':'github-mcp','com.robinson.playground.warm':'image-holder'}}}};
 const composeFile=JSON.stringify(compose);
 return {id,name,pool,variant,image,volumes:[],composeFile,planHash:hash(composeFile),description:'robinson-playground-warm/v1 image='+hash(image).slice(0,32)+' plan='+hash(composeFile)};
}

async function poolImages(env,fetch){
 if(env.PLAYGROUND_IMAGE)return {pinned:DIGEST_IMAGE.test(env.PLAYGROUND_IMAGE)?env.PLAYGROUND_IMAGE:null};
 return {full:await resolvePrebuiltImage(env,{fetch}),slim:await resolvePrebuiltImage(env,{fetch,variant:'slim'})};
}
const LIVE=['created','deploying','running'];
/** Decisions for every configured pool. Cheap when demand is low: no telemetry or registry call is made. */
export async function decideWarmRuntimes({root,env={},fetch=globalThis.fetch,now=Date.now(),state}){
 const pools=dokployPools(env);if(!pools.length)return [];
 const rows=await root.playgroundDemandSince(now-DAY),holders=Object.values(state?.holders??{}),out=[];
 for(const config of pools){
  const pool=config.pool??'default',demand=demandOf(rows,pool),parsed=warmSettings(env);
  const quick=warmDecision({env,pool,project:config.project,demand,observation:undefined,now});
  if(!parsed.ok||parsed.settings.mode==='off'||demand.total/24<parsed.settings.minAllocationsPerHour||parsed.settings.maxImages===0){out.push(quick);continue;}
  const refreshed=await refreshAdmission({env,fetch},config);let observation=null;try{observation=JSON.parse(refreshed.env.PLAYGROUND_ADMISSION??'null');}catch{observation=null;}
  out.push(warmDecision({env,pool,project:config.project,demand,observation,images:await poolImages(env,fetch),running:holders.filter(h=>h.pool===pool&&LIVE.includes(h.phase)).length,now}));
 }
 return out;
}

/** Plain-words gate state for github_playground_read (no provider call, no mutation). */
export async function warmRuntimeStatus(ctx){
 const never='A warm runtime only keeps a runtime image ready on the host. It holds no workspace, connection, tenant or credential; every workspace still gets its own fresh, single-use runtime.';
 try{
  const root=rootAllocationDb(ctx),state=await root.getSetting(WARM_STATE_KEY);
  const decisions=await decideWarmRuntimes({root,env:ctx.env??{},fetch:ctx.fetch,now:(ctx.now??Date.now)(),state});
  if(!decisions.length)return {enabled:false,reason:'Warm runtimes are off: no shared Playground pool is configured.',warm_images:[],never_bound:never};
  return {enabled:decisions.some(d=>d.enabled),reason:decisions.length===1?decisions[0].reason:decisions.map(d=>`${d.pool}: ${d.reason}`).join(' '),pools:decisions.map(d=>({pool:d.pool,enabled:d.enabled,target_images:d.target,demand_per_hour:d.demand_per_hour})),warm_images:Object.values(state?.holders??{}).map(h=>({pool:h.pool,variant:h.variant,phase:h.phase})),never_bound:never};
 }catch{return {enabled:false,reason:'Warm runtimes are off: their gate could not be evaluated right now.',warm_images:[],never_bound:never};}
}

/**
 * Called by the cleanup sweep. Creates at most one holder per round, advances holders
 * through deploy, and drains every holder the gate no longer wants with independent
 * stop → containers-exited → delete → absence readback. Every transition is a
 * compare-and-set on one root setting written BEFORE the provider call, so no provider
 * resource exists without a record the sweep can drain.
 */
export async function reconcileWarmRuntimes({root,env={},fetch=globalThis.fetch,now=Date.now,providerFactory=dokployProvider}={}){
 let state=await root.getSetting(WARM_STATE_KEY);const t=now();
 const decisions=await decideWarmRuntimes({root,env,fetch,now:t,state}),origin=publicOrigin(env);
 const save=async holders=>{const next=await root.compareAndSetSetting(WARM_STATE_KEY,state?.revision??0,{kind:'playground-warm',holders,revision:(state?.revision??0)+1});if(!next)throw new TypeError('Warm runtime reconcile conflicted; another sweep is handling it.');state=next;};
 const put=h=>save({...(state?.holders??{}),[h.id]:h}),drop=id=>{const rest={...(state?.holders??{})};delete rest[id];return save(rest);};
 const desired=new Map();for(const d of decisions)if(d.enabled)for(const c of d.images){const plan=warmHolderPlan({pool:d.pool,image:c.image,variant:c.variant,origin});desired.set(plan.id,plan);}
 const providers=new Map(),providerFor=pool=>{if(!providers.has(pool))providers.set(pool,providerFactory(dokployConfig(env,pool),{fetch}));return providers.get(pool);};
 let pending=0,drained=0,created=false;
 const recoverCreate=async(h,provider)=>{const matches=(await provider.inventory()).filter(a=>a.name===h.name||a.appName===h.name);if(matches.length===0){if(t-h.createdAt>CREATE_UNCERTAIN_MS){await drop(h.id);return null;}pending++;return undefined;}if(matches.length>1){pending++;return undefined;}const o=await provider.inspect(matches[0].composeId,h,{adoptAssignedName:true});const next={...h,phase:'created',composeId:o.composeId,providerAppName:pinProviderIdentity(h,o.appName).providerAppName};await put(next);return next;};
 for(const old of Object.values(state?.holders??{})){
  if(desired.has(old.id)&&old.phase!=='failed'&&old.phase!=='draining')continue;
  try{
   const provider=providerFor(old.pool);let h=old;
   if(!h.composeId){h=await recoverCreate(h,provider);if(!h)continue;}
   if(h.phase!=='draining'){h={...h,phase:'draining',drainingAt:t};await put(h);}
   if(await provider.inspect(h.composeId,h)!==null){await provider.stop(h.composeId,h);if(!allocationProcessesStopped(await provider.containers(h))){pending++;continue;}await provider.remove(h.composeId,h);}
   if(await provider.absent(h.composeId,h)){await drop(h.id);drained++;}else pending++;
  }catch{pending++;}
 }
 for(const plan of desired.values()){
  try{
   const provider=providerFor(plan.pool);let h=state?.holders?.[plan.id];
   if(!h){if(created)continue;h={...plan,phase:'creating',createdAt:t};await put(h);created=true;
    const c=await provider.create(plan);h={...h,phase:'created',composeId:c.composeId,providerAppName:pinProviderIdentity(plan,c.appName).providerAppName};await put(h);}
   else if(h.phase==='creating'){h=await recoverCreate(h,provider);if(!h)continue;}
   if(h.phase==='created'){h={...h,phase:'deploying'};await put(h);await provider.deploy(h.composeId,h);continue;}
   if(['deploying','running'].includes(h.phase)){const o=await provider.inspect(h.composeId,h);if(o===null){await drop(h.id);continue;}if(o.composeStatus==='error'){await put({...h,phase:'failed'});pending++;}else if(o.composeStatus==='done'&&h.phase!=='running')await put({...h,phase:'running',runningAt:t});}
  }catch{pending++;}
 }
 const holders=Object.values(state?.holders??{});
 return {enabled:decisions.some(d=>d.enabled),running:holders.filter(h=>h.phase==='running').length,holders:holders.length,drained,pending};
}
