import {refreshAdmission} from './admission.js';
import {indexKey,orphanAllocationContext} from './index.js';
import {enforcementObservation} from './availability.js';
import {managedResourceBaseline} from './resource-policy.js';
import {createPublicKey,verify} from 'node:crypto';
import {createDb,productionSql} from '../db.js';
import {createTenantDirectory,createTenantSql,assertTenantSearchPath,tenantSchemaName} from '../tenancy/directory.js';
import {createCredentials} from '../github/credentials.js';
import {createTenantScopedCredentials} from '../tenancy/user-authorization.js';
import {getSecretsRuntime} from '../runtime.js';
import {authorizeNativeRepo} from '../native-git/client.js';
import {signCodingWorkerBody} from '../native-git/signing.js';
export async function allocationScope(query,{env=process.env}={}){
 if(!/^[a-f0-9]{64}$/.test(query.binding??''))throw new TypeError('Invalid allocation identity.');
 const rootSql=productionSql(),root=createDb(rootSql),index=await root.getSetting(indexKey(query.binding)),indexed=index?.allocation;
 if(indexed?.binding!==query.binding)throw new TypeError('Unknown allocation.');
 if(indexed.scope?.tenantId){
  if(query.tenant!==indexed.scope.tenantId||query.identity!==indexed.scope.identityId)throw new TypeError('Allocation namespace differs.');
  const namespace=tenantSchemaName(query.tenant),present=await rootSql`SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=${namespace}) AS present`;
  if(present[0]?.present===false)return orphanAllocationContext(root,index,env);
  const directory=createTenantDirectory(rootSql),authorized=await directory.authorizedPilotIdentity(query.tenant,query.identity);
  const sql=createTenantSql(env.DATABASE_URL,query.tenant);await assertTenantSearchPath(sql,query.tenant);const db=createDb(sql);db.playgroundScope=indexed.scope;
  const base=createCredentials({db,env,rootApps:root});const credentials=authorized?createTenantScopedCredentials({base,directory,tenant:authorized,db,env,fetchImpl:fetch}):null;
  const stored=await db.getSetting('playground.'+query.binding.slice(0,40));if(stored?.binding!==query.binding||stored.scope?.tenantId!==query.tenant||stored.scope?.identityId!==query.identity)throw new TypeError('Allocation scope changed.');
  return {db,publicDb:root,credentials,env,stored,membershipValid:!!authorized&&stored.scope.membershipRevision===authorized.membershipRevision&&(stored.scope.pilotRevision===undefined||stored.scope.pilotRevision===authorized.pilotRevision)};
 }
 if(query.tenant!==undefined||indexed.scope?.legacy!==true)throw new TypeError('Allocation namespace differs.');
 const runtime=await getSecretsRuntime();const stored=await runtime.db.getSetting('playground.'+query.binding.slice(0,40));if(stored?.binding!==query.binding||stored.scope?.legacy!==true)throw new TypeError('Allocation is unavailable.');return {...runtime,publicDb:root,env,stored};
}

export async function allocationAuthority(ctx){
 ctx=await refreshAdmission(ctx,{project:ctx.env?.PLAYGROUND_DOKPLOY_PROJECT_ID});
 const {stored:s,db}=ctx;
 if(ctx.namespaceMissing)return {allowed:false,cleanup:true,reason:'namespace_removed'};
 if(ctx.membershipValid===false)return {allowed:false,cleanup:true,reason:'membership_revoked'};
 const job=await db.getJob(s.workspace,s.connection);if(!job||job.kind!=='native-git-workspace'||job.state!=='pending')return {allowed:false,cleanup:true,reason:'workspace_expired_or_closed'};
 const rows=(s.delegated?await db.listConnections():await db.listUpgradeableConnections()).filter(r=>r.client_id===s.clientId);
 if(!rows.length)return {allowed:false,cleanup:true,reason:'grant_expired_or_revoked'};
 const permits=r=>r.profile==='full'&&r.accounts.some(a=>a.toLowerCase()===s.owner.toLowerCase())&&(!s.delegated||r.pass?.allow_writes===true&&(!r.pass.areas?.length||r.pass.areas.includes('playground')&&r.pass.areas.includes('git'))&&(!r.pass.repos||r.pass.repos.some(x=>x.toLowerCase()===`${s.owner}/${s.repo}`.toLowerCase())));
 if(!rows.every(permits))return {allowed:false,cleanup:true,reason:'grant_restricted'};

 const connection={client_id:s.clientId,default_account:s.owner,accounts:[s.owner],profile:'full',mode:rows[0].mode,listing:'compact',...(s.delegated?{pass:true,allow_writes:true,areas:rows[0].pass.areas,repos:rows[0].pass.repos}:{})};
 if(s.phase==='attached'&&!enforcementObservation(ctx,{row:{id:s.workspace},allocation:{binding:s.binding}})&&!managedResourceBaseline(ctx.env,s,{workspace:s.workspace,binding:s.binding}))return {allowed:false,cleanup:false,reason:'enforcement_unverified'};
 try{await authorizeNativeRepo({...ctx,connection},s.owner,s.repo);}catch{return {allowed:false,cleanup:false,reason:'repository_authority_unavailable'};}
 if(s.phase!=='attached')return {allowed:false,bootstrap:!s.runtimePublicKey&&['requested','waiting_resources','creating','created','exposing','exposed','allocated','attaching','deploying'].includes(s.phase),cleanup:['cleanup_requested','stopped','deleting','disposed'].includes(s.phase),reason:'allocation_not_active',connection,job};
 return {allowed:true,cleanup:false,reason:'current_grant',connection,job};
}
export function verifyRuntimeProof(body,signature,stored,now=Date.now()){
 if(typeof body!=='string'||Buffer.byteLength(body)>16384||!stored.runtimePublicKey?.startsWith('ed25519:')||typeof signature!=='string'||!/^ed25519:[A-Za-z0-9_-]{86}$/.test(signature))throw new TypeError('Invalid runtime proof.');
 const key=createPublicKey({key:Buffer.from(stored.runtimePublicKey.slice(8),'base64'),format:'der',type:'spki'});if(!verify(null,Buffer.from(body),key,Buffer.from(signature.slice(8),'base64url')))throw new TypeError('Invalid runtime proof.');
 const p=JSON.parse(body);if(p.purpose!=='robinson-playground-heartbeat/v1'||p.binding!==stored.binding||!/^[a-f0-9]{32}$/.test(p.nonce??'')||!Number.isSafeInteger(p.expiresAt)||p.expiresAt<=now||p.expiresAt>now+30000||Object.keys(p).some(k=>!['purpose','binding','expiresAt','nonce'].includes(k)))throw new TypeError('Invalid runtime proof.');return p;
}
export async function heartbeat(req,res,{load=allocationScope,now=Date.now,env=process.env}={}){
 res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');
 if(req.method!=='POST')return res.status(405).json({error:'method_not_allowed'});
 try{
  const ctx=await load(req.query??{},{env}),s=ctx.stored,body=typeof req.body==='string'?req.body:JSON.stringify(req.body);
  if(typeof body!=='string'||Buffer.byteLength(body)>16384)throw new TypeError('Invalid runtime proof size.');
  // A fresh root can await attachment without receiving execution authority.
  const proof=s.runtimePublicKey?verifyRuntimeProof(body,req.headers?.['x-robinson-runtime-signature'],s,now()):JSON.parse(body);
  if(proof.binding!==s.binding||!/^[a-f0-9]{32}$/.test(proof.nonce??''))throw new TypeError('Invalid bootstrap binding.');
  const authority=s.runtimePublicKey?await allocationAuthority(ctx):{allowed:false,bootstrap:true,cleanup:false,reason:'attachment_pending'};
  if(authority.cleanup){const current=await ctx.db.getSetting('playground.'+s.binding.slice(0,40));if(current?.binding===s.binding&&current.phase!=='disposed')await ctx.db.compareAndSetSetting('playground.'+s.binding.slice(0,40),current.revision,{...current,cleanupRequested:true,cleanupReason:authority.reason,revision:current.revision+1});}
  const answer=JSON.stringify({purpose:'robinson-coding/v1',action:'authority',binding:s.binding,requestNonce:proof.nonce,allowed:authority.allowed,bootstrap:authority.bootstrap===true,reason:authority.reason,...(authority.allowed?{activityAt:new Date(authority.job.expires_at).getTime()-s.native.job.idleTimeoutMs}:{}),expiresAt:now()+60000});res.setHeader('x-robinson-signature',signCodingWorkerBody(answer,env));return res.status(200).send(answer);
 }catch{return res.status(401).json({error:'allocation_authority_unavailable'});}
}
