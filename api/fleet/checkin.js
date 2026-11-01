// FLEET-3: a host agent's signed check-in (long-poll, at most ~20 s). Only the
// device key confirmed by its owner on My connection can call this.
import {publicConnectEnabled} from '../../src/tenancy/public-connect.js';
import {openDeviceScope} from '../../src/fleet/scope.js';
import {peekDevice} from '../../src/fleet/protocol.js';
import {checkIn,report} from '../../src/fleet/host.js';
import {send} from '../../src/core/http.js';
export function createFleetHandler(kind,{env=process.env,scopeFactory=null,options={}}={}){
 return async function handler(req,res){
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  if(!publicConnectEnabled(env)||env.GITHUB_PRIVATE_TENANT_PILOT!=='enabled'||env.VERCEL_ENV!=='production'||!env.DATABASE_URL)
   if(!scopeFactory)return send(res,404,{error:'not_found'});
  if(req.method!=='POST'){res.setHeader('Allow','POST');return send(res,405,{error:'method_not_allowed'});}
  try{
   const b=req.body;
   if(!b||typeof b!=='object'||Array.isArray(b)||typeof b.request!=='string'||typeof b.signature!=='string'||Object.keys(b).some(k=>!['request','signature'].includes(k)))throw new TypeError('invalid');
   const deviceId=peekDevice(b.request),scope=scopeFactory?await scopeFactory(deviceId):await openDeviceScope(env,deviceId);
   const result=kind==='checkin'?await checkIn(scope,{body:b.request,signature:b.signature,env,...options}):await report(scope,{body:b.request,signature:b.signature,...options});
   return send(res,200,result);
  }catch(error){
   const revoked=error?.reason==='revoked'||error?.message==='revoked';
   return send(res,revoked?410:403,{error:revoked?'device_revoked':'host_denied',description:revoked?'This computer was removed from your connection. Run the agent leave command.':'This computer is not paired, not approved, or its request was invalid. Re-pair it from My connection.'});
  }
 };
}
export default createFleetHandler('checkin');
