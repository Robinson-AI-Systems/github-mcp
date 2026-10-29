import { isOwnerConnection } from '../core/authority.js';
// V-1: fail closed before touching GitHub. IN-06 requires an owner-managed scratch organization and all-repo GitHub App installation.
const denied=message=>Object.assign(new TypeError(message),{safeMessage:true,safeCode:'scratch_configuration_required',safeRetryable:false});
export async function requireScratchOrg(ctx,owner){
  if(!isOwnerConnection(ctx.connection)&&ctx.connection?.mode!=='preview')throw denied('Development tools never change production connections.');
  if(!ctx.connection?.accounts?.some(a=>a.toLowerCase()===String(owner).toLowerCase()))
    throw denied('The scratch organization is outside this connection.');
  const row=await ctx.db.getAccount(owner);
  if(!row?.is_scratch)throw denied('IN-06: This account is not marked as an owner-approved scratch organization in this service setup. No repository was created.');
  if(row.account_type!=='Organization')throw denied('IN-06: Scratch creation requires a separate organization, not a personal account.');
  if(row.credential_kind!=='app'||!row.app_id||!row.installation_id||row.installation_status!=='active'||row.repository_selection!=='all')
    throw denied('IN-06: Scratch creation requires an active all-repositories GitHub App installation for this organization.');
  if(!isOwnerConnection(ctx.connection)&&row.production_enabled)throw denied('This explicitly restricted developer connection requires production disabled for its scratch organization.');
  return row;
}
