// FLEET-3 relay: a request the control plane would have sent over HTTPS to a
// runtime or broker is instead left in the host's mailbox; the dial-out agent
// forwards it unchanged to its own loopback and posts the answer back. The
// request keeps its control-plane signature, so the runtime still verifies it.
import {enqueue,awaitResult} from './mailbox.js';
export const FLEET_SUFFIX='.fleet.invalid';
const ORIGIN=/^d([a-f0-9]{32})-([a-f0-9]{24})\.fleet\.invalid$/;
const PATHS=['/v1/coding','/v1/workspace'];
const fail=message=>Object.assign(new TypeError(message),{safeCode:'fleet_relay'});
// ".invalid" can never resolve, so a missed code path fails closed instead of leaking.
export const deviceOrigin=(deviceId,binding)=>`https://d${deviceId}-${binding.slice(0,24)}${FLEET_SUFFIX}/`;
export function parseDeviceOrigin(url){
 let u;try{u=new URL(url);}catch{return null;}
 const m=ORIGIN.exec(u.hostname);return m&&u.protocol==='https:'?{deviceId:m[1],bindingPrefix:m[2],path:u.pathname}:null;
}
export const HOST_FRESH_MS=90000;
export function hostIsLive(host,now){return host?.transport==='dial-out'&&host.status==='ready'&&Number.isSafeInteger(host.lastLeaseAt)&&host.lastLeaseAt>=now-HOST_FRESH_MS;}
export function transportFetch(ctx){
 const base=ctx.fetch??globalThis.fetch;
 return async(url,init={})=>{const d=parseDeviceOrigin(url);return d?relayFetch(ctx,d,init):base(url,init);};
}
async function relayFetch(ctx,{deviceId,bindingPrefix,path},init){
 const now=(ctx.now??Date.now)();
 if(!PATHS.includes(path)||init.method!=='POST'||typeof init.body!=='string'||Buffer.byteLength(init.body)>3*1024*1024)throw fail('Unsupported host relay request.');
 // The host record lives in the caller's own tenant database: another tenant's device is simply not found.
 const host=await ctx.db.getSetting('pg_host.'+deviceId);
 if(!hostIsLive(host,now))throw fail('Your computer or server is offline or not ready. Nothing was sent; inspect the original intent when it is back.');
 const headers=init.headers??{},signature=headers['x-robinson-signature'];
 if(typeof signature!=='string')throw fail('Relay requests must carry the control-plane signature.');
 const order=await enqueue(ctx.db,{deviceId,generation:host.generation,kind:'relay',payload:{bindingPrefix,path,signature,body:init.body},ttlMs:60000,now:ctx.now??Date.now});
 const done=await awaitResult(ctx.db,order.id,{timeoutMs:ctx.relayWaitMs??20000,clock:ctx.now??Date.now,...(ctx.relaySleep?{sleep:ctx.relaySleep}:{})});
 if(done?.state!=='done'||!Number.isSafeInteger(done.result?.status)||typeof done.result.body!=='string')throw fail('Your computer did not confirm the result in time. Inspect the original intent; nothing is retried automatically.');
 return new Response(done.result.body,{status:done.result.status,headers:{'Content-Type':'application/json'}});
}
