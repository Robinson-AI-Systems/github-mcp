import { isOwnerConnection } from '../core/authority.js';
// V-2 guarded scratch teardown. Live calls require independently authorized connected OAuth.
import { defineGithubWrite } from './define-github-write.js';
import { ownerOf } from './github-write.js';
import { summarizeDevCleanup } from '../dev/cleanup-report.js';
import { readCleanupRun, executeCleanup, readCleanupAfter } from '../dev/cleanup-execute.js';

const RUN={type:'string',minLength:3,maxLength:43,pattern:'^[a-z][a-z0-9-]{2,42}$'};
const REPO={type:'string',minLength:1,maxLength:100,pattern:'^[A-Za-z0-9][A-Za-z0-9._-]*$'};
const OWNER={type:'string',maxLength:39};

const cleanup=defineGithubWrite({
  name:'github_dev_cleanup',area:'dev',audience:['B'],
  description:'Clean explicitly confirmed run-owned fixtures.',
  properties:{owner:OWNER,repo:REPO,runId:RUN},required:['repo','runId'],
  declarations:{production:'never',confirm:'always'},
  target:(args,ctx)=>{
    if(!isOwnerConnection(ctx.connection)&&ctx.connection?.mode!=='preview')throw new TypeError('Developer cleanup requires preview-only connection.');
    return {owner:ownerOf(args,ctx),repo:args.repo,scope:'repo'};
  },
  read:(args,ctx,target)=>readCleanupRun(ctx,target.owner,args.repo,args.runId),
  classify:()=>({}),
  summarize:({args,target,before})=>`${before.deleteRepository?'DELETE private scratch repository':'CLOSE recorded PRs and DELETE run-owned test branches in'} ${target.owner}/${args.repo} for run ${args.runId}; verify ${before.plan.count} recorded objects${before.deleteRepository?` and ${before.birth?.labels.length??0} unchanged first-create labels (creator unverified)`:''}. Irreversible.`,
  apply:async({args,ctx,target,before})=>({data:await executeCleanup(ctx,{owner:target.owner,repo:args.repo,runId:args.runId,before})}),
  readAfter:({args,ctx,target})=>readCleanupAfter(ctx,{owner:target.owner,repo:args.repo,runId:args.runId}),
  verify:({after,response,before})=>response.data.verified===true&&
    (before.deleteRepository?after.repo===null:after.repo!==null)&&
    after.run?.status==='cleaned'&&after.objects.length<50&&after.objects.every(o=>o.cleaned===true),
  inverse:()=>null,
  present:({args,response,after})=>({
    run_id:args.runId,
    cleanup:response.data,
    evidence:summarizeDevCleanup({run:after.run,objects:after.objects,intents:after.intents,limit:50}),
    verified_now:response.data.verified===true,
    note:'Remote readback and journal evidence apply only to the exact resources touched by this call.'
  })
});
export const tools=[cleanup.tool];
export const handlers={[cleanup.tool.name]:cleanup.handler};
