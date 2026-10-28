import { isOwnerConnection } from '../core/authority.js';
// V-1: fail closed before touching GitHub. IN-06 requires an owner-managed scratch organization and all-repo GitHub App installation.
export async function requireScratchOrg(ctx,owner){
  if(!isOwnerConnection(ctx.connection)&&ctx.connection?.mode!=='preview')throw new TypeError('Development tools never change production connections.');
  if(!ctx.connection?.accounts?.some(a=>a.toLowerCase()===String(owner).toLowerCase()))
    throw new TypeError('The scratch organization is outside this connection.');
  const row=await ctx.db.getAccount(owner);
  if(!row?.is_scratch||row.account_type!=='Organization'||row.credential_kind!=='app'||
    !row.app_id||!row.installation_id||row.installation_status!=='active'||
    row.repository_selection!=='all'||!isOwnerConnection(ctx.connection)&&row.production_enabled)
    throw new TypeError('IN-06: the owner must verify a separate scratch organization with an active all-repositories GitHub App installation and production disabled.');
  return row;
}
