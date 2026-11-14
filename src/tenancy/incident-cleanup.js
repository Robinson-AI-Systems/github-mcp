// PUB-3 owner emergency incident cleanup. This function is NOT a tool or
// public API. The protected owner setup has already authenticated the owner,
// selected its server-known tenant and disabled all private pilot access.
// Every deletion runs in that tenant's independently verified SQL namespace.
import { openAuthorizedTenantDb } from './directory.js';
import { storeFactory } from '../db-transport.js';

export async function purgeRevokedTenantArtifacts({
  directory, tenantId, ownerIdentityId,
  connectionString=process.env.DATABASE_URL, sqlFactory=storeFactory
}) {
  if (!directory || typeof directory.authorized !== 'function')
    throw new TypeError('Private tenant directory required for incident cleanup.');
  const owner=await directory.authorized(tenantId,ownerIdentityId);
  if (!owner || owner.role!=='owner' || owner.tenantId!==tenantId)
    throw new Error('Only an authenticated tenant owner can clear its stored sessions.');
  const {sql}=await openAuthorizedTenantDb({
    directory,tenantId,verifiedIdentityId:ownerIdentityId,
    connectionString,sqlFactory
  });
  // Single PostgreSQL statement: either all session/data cleanup succeeds
  // or none. Other tenants use different schemas and are never queried.
  const rows=await sql`WITH codes AS (
    DELETE FROM oauth_codes RETURNING client_id
  ), tokens AS (
    UPDATE oauth_tokens SET revoked_at=now() WHERE revoked_at IS NULL RETURNING client_id
  ), clients AS (
    DELETE FROM oauth_clients RETURNING client_id
  ), jobs AS (
    DELETE FROM gh_async_jobs RETURNING id
  ), results AS (
    DELETE FROM result_store RETURNING handle
  ), slots AS (
    DELETE FROM gh_tenant_storage_slots RETURNING resource_id
  )
  SELECT (SELECT count(*)::integer FROM codes) AS codes,
    (SELECT count(*)::integer FROM tokens) AS tokens,
    (SELECT count(*)::integer FROM clients) AS clients,
    (SELECT count(*)::integer FROM jobs) AS jobs,
    (SELECT count(*)::integer FROM results) AS results`;
  if(rows.length!==1)throw new Error('The tenant session cleanup was not verified.');
  const x=rows[0];
  return Object.freeze({
    codes:Number(x.codes),tokens:Number(x.tokens),clients:Number(x.clients),
    jobs:Number(x.jobs),results:Number(x.results)
  });
}
