// Locate the tenant that owns a dial-out device, from its opaque route row, and
// re-check that the person and their Full grant are still current. The same
// checks the pairing endpoint makes; nothing here grants new authority.
import {neon} from '@neondatabase/serverless';
import {createDb} from '../db.js';
import {createTenantDirectory,openAuthorizedTenantDb} from '../tenancy/directory.js';
import {deviceRouteKey} from '../playground/enrolled-hosts.js';
export async function openDeviceScope(env,deviceId){
 const root=createDb(neon(env.DATABASE_URL));
 const route=await root.getSetting(deviceRouteKey(deviceId));
 if(route?.kind!=='fleet-device-route'||route.deviceId!==deviceId||!route.tenantId||!route.identityId||!route.clientId)throw new TypeError('unknown');
 const directory=createTenantDirectory(neon(env.DATABASE_URL));
 const live=await directory.authorizedPilotIdentity(route.tenantId,route.identityId);
 if(!live||live.tenantId!==route.tenantId||live.identityId!==route.identityId)throw new TypeError('revoked');
 const tenant=await openAuthorizedTenantDb({directory,tenantId:route.tenantId,verifiedIdentityId:route.identityId,connectionString:env.DATABASE_URL,sqlFactory:neon});
 const grants=await tenant.db.listUpgradeableConnections();
 return {db:tenant.db,root,tenantId:route.tenantId,identityId:route.identityId,clientId:route.clientId,grantActive:grants.some(g=>g.client_id===route.clientId&&g.profile==='full')};
}
