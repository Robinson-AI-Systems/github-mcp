// Read-only Git access inside an attached Playground runtime. The service mints a short-lived key for this
// one repository (read only, at most 4 hours, revocable on My connection), exchanges it itself and hands it to
// the runtime over the signed channel. The key is written only where the command user can read it and is
// never returned, logged or stored in a result. If the runtime does not take it, the key is revoked.
import {GIT_USERNAME,newExchangeCode,newSessionKey,indexKey,remotePath,sha256} from '../git-remote/keys.js';

export const GIT_ACCESS_DEFAULT_HOURS=2,GIT_ACCESS_MAX_HOURS=4;
const refuse=(message,safeCode)=>Object.assign(new TypeError(message),{safeMessage:true,safeCode});

/**
 * @param {object} deps {callRuntime(ctx,record,action,options), rootDb, origin, now}
 * @returns {{key_id,remote_url,expires_at,access}} - never the key itself
 */
export async function grantGitAccess(ctx,record,{hours=GIT_ACCESS_DEFAULT_HOURS,deps}){
 const {callRuntime,rootDb,origin,now=Date.now}=deps;
 if(!Number.isInteger(hours)||hours<1||hours>GIT_ACCESS_MAX_HOURS)throw refuse(`Git access inside Playground lasts 1 to ${GIT_ACCESS_MAX_HOURS} hours.`,'git_access_hours');
 if(ctx.connection?.pass===true||ctx.connection?.kind==='pass'||!ctx.connection?.client_id)throw refuse('Git access inside Playground needs a connector sign-in, not a service pass.','git_access_pass');
 const owner=record.row.owner,repo=record.row.repo,at=now(),expiresAt=at+hours*3600000;
 const {id,code}=newExchangeCode();
 await rootDb.setSetting(indexKey(id),{kind:'git-remote-index',id,scope:ctx.db.playgroundScope??{legacy:true}});
 await ctx.db.createGitRemoteKey({id,connection:ctx.connection.client_id,owner,repo,access:'read',codeHash:sha256(code),codeExpiresAt:new Date(at+60000),expiresAt:new Date(expiresAt)});
 const key=newSessionKey(id);
 const done=await ctx.db.exchangeGitRemoteCode({id,codeHash:sha256(code),keyHash:sha256(key)});
 if(!done)throw refuse('The Git key could not be created. Nothing was sent to the runtime.','git_access_unavailable');
 const url=`${origin}/${remotePath(owner,repo)}`;
 try{await callRuntime(ctx,record,'git_credential',{url,username:GIT_USERNAME,key,expiresAt});}
 catch{await ctx.db.revokeGitRemoteKey(id,{connection:ctx.connection.client_id}).catch(()=>{});
  throw refuse('The runtime did not accept the Git key (it may need updating). The key was cancelled; Git work in the workspace is unaffected.','git_access_runtime_refused');}
 return {key_id:id,remote_url:url,expires_at:new Date(expiresAt).toISOString(),access:'read'};
}
