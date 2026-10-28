import { isOwnerConnection } from '../core/authority.js';
// V-1 scratch creation only: GitHub writes are blocked until IN-06 is verified in server-owned account state.
import { defineGithubWrite } from './define-github-write.js';
import { missing, octo, ownerOf, refusal } from './github-write.js';
import { requireScratchOrg } from '../dev/scratch.js';
import { matchesRunDescription } from '../dev/run-marker.js';
import { runDevMutationOnce } from '../dev/execute.js';
import { captureScratchOrigin, captureScratchBirthLabels, verifySeedResumeOrigin } from '../dev/scratch-origin.js';

const RUN={type:'string',minLength:3,maxLength:43,pattern:'^[a-z][a-z0-9-]{2,42}$'};
const NAME={type:'string',minLength:1,maxLength:100,pattern:'^[A-Za-z0-9][A-Za-z0-9._-]*$'};
const OWNER={type:'string',maxLength:39};
const tag=id=>`rtc_run=${id}`;
const repoGet=(ctx,owner,repo)=>missing(async()=>(await (await octo(ctx,owner)).request('GET /repos/{owner}/{repo}',{owner,repo})).data);

// Exact durable provenance plus fresh GitHub commit readback is required for
// both safe duplicate calls and first-create post-operation confirmation.
async function proveRecordedScratch(ctx,target,args,existing){
  const intent=await ctx.db.getDevIntent({
    runId:args.runId,account:target.owner,connection:ctx.connection.client_id,
    stepId:'create-scratch-repo'
  });
  await verifySeedResumeOrigin(await octo(ctx,target.owner),{
    owner:target.owner,repo:args.name,runId:args.runId,
    existing,repoIntent:intent
  });
}

const scratchCreate=defineGithubWrite({
  name:'github_dev_create_scratch_repo',area:'dev',audience:['B'],
  description:'Create a verified private scratch repository.',
  properties:{owner:OWNER,runId:RUN,name:NAME},required:['runId','name'],
  declarations:{production:'never'},
  target:(args,ctx)=>{
    if(!isOwnerConnection(ctx.connection)&&ctx.connection?.mode!=='preview')throw new TypeError('Developer writes are unavailable in production mode.');
    return {owner:ownerOf(args,ctx),repo:args.name,scope:'repo'};
  },
  read:async(args,ctx,target)=>{
    await requireScratchOrg(ctx,target.owner);
    const [existing,run]=await Promise.all([
      repoGet(ctx,target.owner,args.name),
      ctx.db.getDevRun({id:args.runId,account:target.owner,
        connection:ctx.connection.client_id})
    ]);
    if(existing){
      if(run?.status!=='active'||run.scenarios?.length!==1||
        run.scenarios[0]!=='repo-basic')
        throw refusal('Existing scratch repository is not bound to this active run.');
      await proveRecordedScratch(ctx,target,args,existing);
    }
    return {existing,run};
  },
  classify:()=>({}),
  summarize:({args,before,target})=>before?.existing
    ? `Verify and replay the exact recorded scratch repository ${target.owner}/${args.name}; no new GitHub creation`
    : `Create PRIVATE scratch repository ${target.owner}/${args.name} marked ${tag(args.runId)}; it is added to this connection's durable run`,
  apply:async({args,ctx,target})=>{
    const created=await runDevMutationOnce(ctx,{
      runId:args.runId,account:target.owner,connection:ctx.connection.client_id,
      stepId:'create-scratch-repo',type:'repo',owner:target.owner,repo:args.name,objectName:args.name,
      scenarios:['repo-basic'],create:async()=>{
        const data=(await (await octo(ctx,target.owner)).request('POST /orgs/{org}/repos',{
          org:target.owner,name:args.name,private:true,auto_init:true,
          description:`Scratch fixture for ${tag(args.runId)}`
        })).data;
        if(data?.full_name?.toLowerCase()!==`${target.owner}/${args.name}`.toLowerCase()||data.private!==true)
          throw refusal('GitHub did not return the private repository at the requested exact location.');
        const github=await octo(ctx,target.owner);
        const createdSha=await captureScratchOrigin(github,{
          owner:target.owner,repo:args.name,runId:args.runId,created:data});
        const birthLabels=await captureScratchBirthLabels(github,{owner:target.owner,repo:args.name,sleep:ctx.sleep});
        return {objectId:data.full_name,createdSha,birthLabels};
      }});
    return {data:created};
  },
  readAfter:async({args,ctx,target})=>{
    const existing=await repoGet(ctx,target.owner,args.name);
    // Includes the first create: no success without durable exact origin and
    // independent unchanged-default GitHub readback.
    await proveRecordedScratch(ctx,target,args,existing);
    return existing;
  },
  verify:({args,target,after,response})=>!!after&&after.full_name?.toLowerCase()===`${target.owner}/${args.name}`.toLowerCase()&&
    after.private===true&&matchesRunDescription(after.description,args.runId)&&
    response.data.objectId.toLowerCase()===after.full_name.toLowerCase(),
  inverse:()=>null,
  present:({args,after,response})=>({run_id:args.runId,full_name:after?.full_name,private:after?.private,
    recorded_object_id:response.data.objectId,replayed:response.data.replayed,marker:tag(args.runId)})
});
export const tools=[scratchCreate.tool];
export const handlers={[scratchCreate.tool.name]:scratchCreate.handler};
