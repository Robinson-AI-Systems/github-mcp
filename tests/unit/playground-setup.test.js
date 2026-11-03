import {describe,it,expect} from 'vitest';
import {setupAllocation,setupNext} from '../../src/playground/setup.js';

// One setup call decides provision, replace, attach or resume itself. Fakes record which existing
// step ran; nothing here talks to a provider.
function world(stored,{recovered={reason:null,pending:false,stored},provisioned,attached,availability}={}){
 const calls=[];
 let current=stored;
 const deps={
  allocationRecord:async()=>current,
  provisionAllocation:async(c,r,o)=>{calls.push(['provision',o?.size]);current=provisioned??{phase:'requested'};return current;},
  recoverAllocation:async()=>{calls.push(['recover']);return recovered;},
  attachRepository:async()=>{calls.push(['attach']);current=attached??{phase:'attached',repositoryAttached:true};return current;},
  resumeAllocation:async()=>{calls.push(['resume']);return current;}
 };
 return {calls,deps,availability:availability===undefined?null:async()=>availability,ctx:{env:{}}};
}
const run=async(w,o={})=>setupAllocation(w.ctx,{},{size:o.size,availability:w.availability,deps:w.deps});
const names=w=>w.calls.map(x=>x[0]);

describe('github_playground_workspace operation setup',()=>{
 it('provisions when nothing exists and stops there while the runtime deploys',async()=>{
  const w=world(null,{provisioned:{phase:'deploying'}});
  const r=await run(w,{size:'medium'});
  expect(r.steps).toEqual(['provision']);
  expect(w.calls).toEqual([['provision','medium']]);
  expect(r.stored.phase).toBe('deploying');
 });
 it('goes on to attach in the same call when provisioning already finished',async()=>{
  const w=world(null,{provisioned:{phase:'allocated'}});
  expect((await run(w)).steps).toEqual(['provision','attach']);
  expect(names(w)).toEqual(['provision','recover','attach']);
 });
 it('keeps provisioning while the runtime is still starting, for every starting phase',async()=>{
  for(const phase of ['requested','waiting_resources','creating','created','exposing','exposed','deploying']){
   const w=world({phase},{provisioned:{phase}});
   expect((await run(w)).steps).toEqual(['provision']);
  }
 });
 it('attaches a deployed runtime and never provisions again',async()=>{
  for(const phase of ['allocated','attaching']){
   const w=world({phase});
   expect((await run(w)).steps).toEqual(['attach']);
   expect(names(w)).toEqual(['recover','attach']);
  }
 });
 it('replaces a runtime that stalled instead of attaching to it',async()=>{
  const w=world({phase:'allocated'},{recovered:{reason:'runtime_failed_to_start',pending:false,stored:{phase:'disposed'}},provisioned:{phase:'requested'}});
  const r=await run(w);
  expect(r.steps).toEqual(['replace']);
  expect(names(w)).toEqual(['recover','provision']);
 });
 it('says a replacement is still being removed (retryable) rather than starting a second one',async()=>{
  const w=world({phase:'allocated'},{recovered:{reason:'runtime_failed_to_start',pending:true,stored:{phase:'cleanup_requested'}}});
  await expect(run(w)).rejects.toMatchObject({safeRetryable:true,safeCode:'playground_runtime_replacing'});
  expect(names(w)).toEqual(['recover']);
 });
 it('replaces a runtime that was already marked failed, and leaves a user dispose alone',async()=>{
  const failed=world({phase:'cleanup_requested',cleanupRequested:true,runtimeOnly:true});
  expect((await run(failed)).steps).toEqual(['provision']);
  for(const phase of ['cleanup_requested','stopped','deleting']){
   const disposing=world({phase,cleanupRequested:true});
   const r=await run(disposing);
   expect(r.steps).toEqual([]);expect(disposing.calls).toEqual([]);
  }
 });
 it('re-provisions after a dispose finished',async()=>{
  const w=world({phase:'disposed'},{provisioned:{phase:'requested'}});
  expect((await run(w)).steps).toEqual(['provision']);
 });
 it('does nothing to an attached runtime that can run commands',async()=>{
  const w=world({phase:'attached',repositoryAttached:true},{availability:{execution_available:true}});
  expect((await run(w)).steps).toEqual([]);expect(w.calls).toEqual([]);
 });
 it('resumes an attached runtime that stopped, but not one that is still starting',async()=>{
  const stopped=world({phase:'attached',repositoryAttached:true},{availability:{execution_available:false,retryable:false,reason:'runtime_unreachable'}});
  expect((await run(stopped)).steps).toEqual(['resume']);
  const starting=world({phase:'attached',repositoryAttached:true},{availability:{execution_available:false,retryable:true,reason:'enforcement_unverified'}});
  expect((await run(starting)).steps).toEqual([]);expect(starting.calls).toEqual([]);
 });
 it('reads back in plain words what to do next',()=>{
  expect(setupNext({phase:'attached',repositoryAttached:true},[])).toMatch(/availability/);
  expect(setupNext({phase:'deploying'},['provision'])).toMatch(/operation setup again with the same requestKey/);
  expect(setupNext({phase:'stopped'},[])).toMatch(/being removed/);
  expect(setupNext(null,[])).toMatch(/not started/);
 });
});
