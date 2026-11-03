import {describe,it,expect} from 'vitest';
import {readinessReport} from '../../src/playground/ready.js';
import {grantGitAccess,GIT_ACCESS_MAX_HOURS} from '../../src/playground/git-access.js';
import {allOperationOptions,nativeOperationHelp} from '../../src/native-git/commands.js';

const cap={protocol:1,execution:'dedicated-container',arbitraryCommands:true,preview:{ports:[4173],textBodyLimitBytes:2097152},repository:{gitReadOnly:true}};
const okSeen={mode:'ready',execution_available:true,limits:{cpuCpus:2,memoryBytes:2147483648,storageQuotaBytes:null},capabilities:cap};

describe('setup readiness report',()=>{
 it('reports ready, the branch, limits and runtime facts, and says no command was run',async()=>{
  const r=await readinessReport({},{}, {availability:async()=>okSeen,inspect:async()=>({branch:'ai/claude/topic'})});
  expect(r).toMatchObject({execution_ready:true,mode:'ready',active_branch:'ai/claude/topic',command_run:false,verified_by:'runtime_signed_capabilities'});
  expect(r.limits.cpuCpus).toBe(2);
  expect(r.runtime).toMatchObject({protocol:1,arbitraryCommands:true,repository:{git_read_only:true}});
  expect(r.note).toMatch(/No command was run/);
 });
 it('says not ready, with the reason and a retry hint, when the runtime is in recovery',async()=>{
  const r=await readinessReport({},{}, {availability:async()=>({mode:'recovery',reason:'runtime_unavailable',execution_available:false,retryable:true,next:'Retry later.'}),inspect:async()=>({branch:'main'})});
  expect(r).toMatchObject({execution_ready:false,reason:'runtime_unavailable',retryable:true,runtime:null,active_branch:'main'});
  expect(r.note).toMatch(/not available yet/);
 });
 it('never fails the report when the branch or the probe cannot be read',async()=>{
  const r=await readinessReport({},{}, {availability:async()=>{throw new Error('boom');},inspect:async()=>{throw new Error('boom');}});
  expect(r).toMatchObject({execution_ready:false,active_branch:null,mode:'unknown'});
 });
 it('drops a branch value that is not a plain short string',async()=>{
  const r=await readinessReport({},{}, {availability:async()=>okSeen,inspect:async()=>({branch:{x:1}})});
  expect(r.active_branch).toBeNull();
 });
});

function access({runtimeFails=false,exchangeFails=false}={}){
 const log={settings:[],keys:[],exchanged:[],revoked:[],runtime:[]};
 const ctx={connection:{client_id:'client-1'},db:{
  createGitRemoteKey:async k=>{log.keys.push(k);},
  exchangeGitRemoteCode:async k=>{log.exchanged.push(k);return exchangeFails?null:{owner:'o',repo:'r'};},
  revokeGitRemoteKey:async(id,o)=>{log.revoked.push([id,o]);}}};
 const deps={rootDb:{setSetting:async(k,v)=>{log.settings.push([k,v]);}},origin:'https://svc.example',now:()=>1000000,
  callRuntime:async(c,r,action,options)=>{log.runtime.push([action,options]);if(runtimeFails)throw new Error('runtime says no');return {configured:true};}};
 return {ctx,deps,log,record:{row:{owner:'o',repo:'r'}}};
}
describe('git access inside a Playground runtime',()=>{
 it('mints a read-only key for this one repository, hands it to the runtime and never returns it',async()=>{
  const {ctx,deps,log,record}=access();
  const out=await grantGitAccess(ctx,record,{hours:2,deps});
  expect(log.keys).toHaveLength(1);
  expect(log.keys[0]).toMatchObject({connection:'client-1',owner:'o',repo:'r',access:'read'});
  expect(new Date(log.keys[0].expiresAt).getTime()).toBe(1000000+2*3600000);
  const [action,options]=log.runtime[0];
  expect(action).toBe('git_credential');
  expect(options.url).toBe('https://svc.example/git/o/r.git');
  expect(options.key).toMatch(/^rgk_[0-9a-f]{32}_/);
  expect(options.expiresAt).toBe(1000000+2*3600000);
  expect(out).toEqual({key_id:log.keys[0].id,remote_url:'https://svc.example/git/o/r.git',expires_at:new Date(1000000+2*3600000).toISOString(),access:'read'});
  expect(JSON.stringify(out)).not.toContain(options.key);
  expect(log.revoked).toHaveLength(0);
 });
 it('cancels the key and says so plainly when the runtime refuses it, without leaking the key',async()=>{
  const {ctx,deps,log,record}=access({runtimeFails:true});
  const error=await grantGitAccess(ctx,record,{hours:1,deps}).catch(e=>e);
  expect(error.safeCode).toBe('git_access_runtime_refused');
  expect(error.message).toMatch(/cancelled/);
  expect(error.message).not.toContain(log.runtime[0][1].key);
  expect(log.revoked).toEqual([[log.keys[0].id,{connection:'client-1'}]]);
 });
 it('sends nothing to the runtime when the key cannot be created',async()=>{
  const {ctx,deps,log,record}=access({exchangeFails:true});
  await expect(grantGitAccess(ctx,record,{deps})).rejects.toMatchObject({safeCode:'git_access_unavailable'});
  expect(log.runtime).toHaveLength(0);
 });
 it('refuses lifetimes beyond the limit and service passes',async()=>{
  const {ctx,deps,record}=access();
  await expect(grantGitAccess(ctx,record,{hours:GIT_ACCESS_MAX_HOURS+1,deps})).rejects.toMatchObject({safeCode:'git_access_hours'});
  await expect(grantGitAccess(ctx,record,{hours:0,deps})).rejects.toMatchObject({safeCode:'git_access_hours'});
  await expect(grantGitAccess({...ctx,connection:{pass:true,client_id:'x'}},record,{deps})).rejects.toMatchObject({safeCode:'git_access_pass'});
 });
});

describe('native Git operation options table',()=>{
 it('lists every operation with exactly the options its detailed help allows',()=>{
  const all=allOperationOptions();
  expect(Object.keys(all).length).toBeGreaterThan(40);
  for(const [name,options] of Object.entries(all))expect(options).toEqual(nativeOperationHelp(name).allowed_options);
  expect(all.branch_create).toEqual(['name','branch','ref','worktree']);
  expect(all.commit).toContain('message');
 });
});
