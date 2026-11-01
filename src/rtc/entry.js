// One composition root for RTC HTTPS routes, independent of the existing OAuth MCP door.
import {getSecretsRuntime} from '../runtime.js';
import {registry} from '../tools/index.js';
import {createDispatch} from '../tools/dispatch.js';
import {createGates} from '../tools/gates.js';
import {loadZone,withTimeZone} from '../core/time-zone.js';
import {createRtcHttpHandler,rtcError} from './http.js';
import {offeredTools} from '../github/feature-gates.js';

export async function serveRtc(req,res,route){
  if(route==='contract'||route==='openapi')
    return createRtcHttpHandler({db:{},registry,dispatch:async()=>{throw new Error('No public dispatch');}})(req,res,route);
  try{
    const {db,credentials}=await getSecretsRuntime();
    const dispatch=createDispatch({credentials,gates:createGates({db}),featureGates:true});
    const offered=async(tools,connection)=>(await offeredTools({connection,db,credentials},tools)).tools;
    const zone=await loadZone(db);
    return await withTimeZone(zone,()=>createRtcHttpHandler({db,registry,dispatch,offered})(req,res,route));
  }catch{
    res.setHeader('Cache-Control','no-store');
    return res.status(503).json(rtcError('service_error'));
  }
}
