// A fresh protected host observation controls starting new resource-consuming
// allocations. Unknown headroom queues work; it never invents a reservation.
export function allocationAdmission(env,config,now=Date.now()){
 let observed;try{observed=JSON.parse(env.PLAYGROUND_ADMISSION??'null');}catch{return {allowed:false,reason:'capacity_unverified'};}
 if(!observed||observed.project!==config.project||!Number.isSafeInteger(observed.observedAt)||observed.observedAt>now||now-observed.observedAt>60000||!Number.isSafeInteger(observed.availableMemoryBytes)||!Number.isSafeInteger(observed.availableDiskBytes)||!Number.isFinite(observed.pressure)||observed.pressure<0||(observed.availableCpuCpus!==undefined&&(!Number.isFinite(observed.availableCpuCpus)||observed.availableCpuCpus<0.2)))return {allowed:false,reason:'capacity_unverified'};
 const memory=Number(env.PLAYGROUND_MIN_HOST_MEMORY_BYTES??536870912),disk=Number(env.PLAYGROUND_MIN_HOST_DISK_BYTES??1073741824),pressure=Number(env.PLAYGROUND_MAX_HOST_PRESSURE??0.9);
 if(!Number.isSafeInteger(memory)||memory<=0||!Number.isSafeInteger(disk)||disk<=0||!Number.isFinite(pressure)||pressure<=0||pressure>1)throw new TypeError('Invalid protected allocation admission thresholds.');
 return {allowed:observed.availableMemoryBytes>=memory&&observed.availableDiskBytes>=disk&&observed.pressure<=pressure,reason:observed.availableMemoryBytes<memory?'memory_pressure':observed.availableDiskBytes<disk?'storage_pressure':observed.pressure>pressure?'host_pressure':'observed_headroom',observedAt:observed.observedAt,reservation:false};
}

// Optional operator telemetry contract: an HTTPS endpoint returns a signed
// observation. Its origin and public verifier are protected configuration, never
// caller arguments. Missing/unavailable telemetry leaves admission closed.
export async function refreshAdmission(ctx,config){
 if(!ctx.env.PLAYGROUND_TELEMETRY_URL)return ctx;
 const env={...ctx.env,PLAYGROUND_ADMISSION:undefined,PLAYGROUND_ENFORCEMENT:undefined};
 try{
  const url=new URL(ctx.env.PLAYGROUND_TELEMETRY_URL);
  if(url.protocol!=='https:'||url.username||url.password||url.hash||url.search)throw new TypeError('Invalid telemetry endpoint.');
  const response=await (ctx.fetch??fetch)(url.href,{method:'GET',redirect:'error',signal:AbortSignal.timeout(5000),headers:{Accept:'application/json'}});
  if(!response.ok)throw new TypeError('Telemetry unavailable.');
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>16384){await reader.cancel();throw new TypeError('Telemetry exceeds bound.');}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}
  const body=Buffer.concat(chunks),signature=response.headers.get('x-robinson-telemetry-signature');
  const {createPublicKey,verify}=await import('node:crypto'),encoded=ctx.env.PLAYGROUND_TELEMETRY_PUBLIC_KEY;
  if(!/^ed25519:[A-Za-z0-9+/=]+$/.test(encoded??'')||!/^ed25519:[A-Za-z0-9_-]{86}$/.test(signature??''))throw new TypeError('Invalid telemetry proof.');
  const key=createPublicKey({key:Buffer.from(encoded.slice(8),'base64'),format:'der',type:'spki'});
  if(key.asymmetricKeyType!=='ed25519'||!verify(null,body,key,Buffer.from(signature.slice(8),'base64url')))throw new TypeError('Invalid telemetry proof.');
  const observation=JSON.parse(body);if(observation.purpose!=='robinson-playground-capacity/v1'||observation.project!==config.project)throw new TypeError('Telemetry scope differs.');
  env.PLAYGROUND_ADMISSION=JSON.stringify(observation);
  if(Array.isArray(observation.allocations))env.PLAYGROUND_ENFORCEMENT=JSON.stringify(observation.allocations);
 }catch{/* No stale fallback after an authoritative feed fails. */}
 return {...ctx,env};
}
