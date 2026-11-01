// A device can claim only a one-use code the verified user saw at My connection.
// Claiming proves device key possession but NEVER enables commands or a trusted origin.
import {neon} from '@neondatabase/serverless';
import {createDb} from '../../src/db.js';
import {createTenantDirectory,openAuthorizedTenantDb} from '../../src/tenancy/directory.js';
import {publicConnectEnabled} from '../../src/tenancy/public-connect.js';
import {pairingIndexKey,createEnrolledHostStore} from '../../src/playground/enrolled-hosts.js';
import {send} from '../../src/core/http.js';

export function createEnrollmentClaimHandler({env=process.env,scopeFactory=null}={}){
 return async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(!publicConnectEnabled(env)||env.GITHUB_PRIVATE_TENANT_PILOT!=='enabled'||
      env.VERCEL_ENV!=='production'||!env.DATABASE_URL)
    return send(res,404,{error:'not_found'});
  if(req.method!=='POST'){res.setHeader('Allow','POST');return send(res,405,{error:'method_not_allowed'});}
  // This route is for the owner's device installer, not a form and not an agent
  // tool. A forged/reflected browser request cannot enroll an executable host.
  try{
   const body=req.body;
   if(!body||typeof body!=='object'||Array.isArray(body)||
      Buffer.byteLength(JSON.stringify(body))>8192||
      Object.keys(body).some(k=>!['code','deviceId','publicKey','origin','signature'].includes(k)))
     throw new TypeError('invalid');
   const scope=scopeFactory?await scopeFactory(body):await (async()=>{
     const root=createDb(neon(env.DATABASE_URL));
     const index=await root.getSetting(pairingIndexKey(body.code));
     if(index?.kind!=='playground-pair-selector'||!index.tenantId||!index.identityId||!index.clientId)
       throw new TypeError('unknown');
     const directory=createTenantDirectory(neon(env.DATABASE_URL));
     const live=await directory.authorizedPilotIdentity(index.tenantId,index.identityId);
     if(!live||live.tenantId!==index.tenantId||live.identityId!==index.identityId)
       throw new TypeError('revoked');
     const tenant=await openAuthorizedTenantDb({
       directory,tenantId:index.tenantId,verifiedIdentityId:index.identityId,
       connectionString:env.DATABASE_URL,sqlFactory:neon
     });
     const grants=await tenant.db.listUpgradeableConnections();
     if(!grants.some(g=>g.client_id===index.clientId&&g.profile==='full'))
       throw new TypeError('grant revoked');
     return {db:tenant.db,root,tenantId:index.tenantId,identityId:index.identityId,clientId:index.clientId};
   })();
   const result=await createEnrolledHostStore(scope).claim(body);
   return send(res,200,result);
  }catch{
   return send(res,403,{error:'pairing_denied',description:'This one-time code, device proof or connection is unavailable. Start again from My connection.'});
  }
 };
}
export default createEnrollmentClaimHandler();
