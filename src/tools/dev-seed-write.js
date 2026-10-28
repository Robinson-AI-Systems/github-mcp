import { isOwnerConnection } from '../core/authority.js';
// V-1: real scratch-only scenarios, with shared run-owned branch/file mutation helpers.
import { defineGithubWrite } from './define-github-write.js';
import { missing, octo, ownerOf, refusal } from './github-write.js';
import { requireScratchOrg } from '../dev/scratch.js';
import { runDevMutationOnce } from '../dev/execute.js';
import { createOwnedFixtureBranch, commitOwnedFixtureFile } from '../dev/fixtures.js';
import { planScenario, EXECUTABLE_SCENARIOS } from '../dev/scenarios.js';
import { seedStack, readStack, verifyStack } from '../dev/stack.js';
import { seedReviewScenario, readReviewScenario, verifyReviewScenario } from '../dev/review-scenario.js';
import { matchesRunDescription } from '../dev/run-marker.js';
import { forwarderUrl } from '../dev/forward-sender.js';
import { forwarderSecret, forwarderView, registerForwarder } from '../dev/forwarders.js';
import { resolvePublicIpv4 } from '../github/public-url.js';
import { captureScratchOrigin, captureScratchBirthLabels, verifySeedResumeOrigin } from '../dev/scratch-origin.js';

export const SEEDABLE=EXECUTABLE_SCENARIOS;
const HOOK_EVENTS=Object.freeze(['push','pull_request']);
const RELEASE_TAGS=Object.freeze(['v0.1.0','v0.2.0','v0.3.0']);
const RUN={type:'string',minLength:3,maxLength:43,pattern:'^[a-z][a-z0-9-]{2,42}$'};
const OWNER={type:'string',maxLength:39};
const REPO={type:'string',minLength:1,maxLength:100,pattern:'^[A-Za-z0-9][A-Za-z0-9._-]*$'};
const marker=id=>`rtc_run=${id}`;
const filePath=id=>`.github/workflows/rtc-${id}.yml`;
const branchName=id=>`rtc/${id}/failure-ref`;
const topic=id=>`rtc-run-${id}`;
const repoGet=(ctx,owner,repo)=>missing(async()=>(await (await octo(ctx,owner)).request('GET /repos/{owner}/{repo}',{owner,repo})).data);
const workflowSource=(id,failing)=>`name: RTC ${id}
on:
  workflow_dispatch:
jobs:
  fixture:
    runs-on: ubuntu-latest
    steps:
      - name: ${failing?'Fail':'Pass'} controlled scenario
        run: ${failing?'exit 1':'echo "RTC fixture passed"'}
`;
const same=(a,b)=>String(a??'').toLowerCase()===String(b??'').toLowerCase();

export const seed=defineGithubWrite({
  name:'github_dev_seed',area:'dev',audience:['B'],
  description:'Seed private scratch CI, releases, rules, PR stacks and reviews.',
  properties:{owner:OWNER,repo:REPO,runId:RUN,scenario:{type:'string',enum:[...SEEDABLE]},
    url:{type:'string',minLength:12,maxLength:2048,description:'webhook-target only: public HTTPS address of the app that will receive the test webhook'}},
  required:['repo','runId','scenario'],declarations:{production:'never'},
  target:(args,ctx)=>{
    if(!isOwnerConnection(ctx.connection)&&ctx.connection?.mode!=='preview')throw new TypeError('Developer scenarios cannot run in production mode.');
    if((args.scenario==='webhook-target')!==(args.url!==undefined))
      throw new TypeError('Give url for the webhook-target scenario, and only for it.');
    return {owner:ownerOf(args,ctx),repo:args.repo,scope:'repo'};
  },
  read:async(args,ctx,target)=>{
    await requireScratchOrg(ctx,target.owner); // before any outbound GitHub read
    const plan=planScenario(args.scenario,{runId:args.runId,owner:target.owner,repo:args.repo,scratch:true});
    let host=null;
    if(args.scenario==='webhook-target'){
      host=forwarderUrl(args.url).hostname;
      try{await resolvePublicIpv4(host);}catch{throw refusal('That address resolves to a private, reserved or unknown network address, so it was refused.');}
    }
    const run=await ctx.db.getDevRun({id:args.runId,account:target.owner,connection:ctx.connection.client_id});
    if(run&&(run.scenarios?.length!==1||run.scenarios[0]!==args.scenario))
      throw new TypeError('A run is bound to its original scenario and cannot be retargeted.');
    const existing=await repoGet(ctx,target.owner,args.repo);
    if(existing){
      const prior=await ctx.db.getDevIntent({runId:args.runId,account:target.owner,
        connection:ctx.connection.client_id,stepId:'seed-repo'});
      const workflow=await ctx.db.getDevIntent({runId:args.runId,account:target.owner,
        connection:ctx.connection.client_id,stepId:'seed-workflow'});
      await verifySeedResumeOrigin(await octo(ctx,target.owner),{
        owner:target.owner,repo:args.repo,runId:args.runId,existing,
        repoIntent:prior,workflowIntent:workflow
      });
    }
    return {existing,plan,host};
  },
  classify:()=>({}),
  summarize:({args,target,before})=>`Seed ${args.scenario} in private scratch ${target.owner}/${args.repo} (${marker(args.runId)}): ${before.plan.objects.map(x=>x.type).join(', ')}.`+(before.host?` The test webhook will send ${HOOK_EVENTS.join(' and ')} events to ${before.host}, signed with a new secret shown once on the setup page.`:'')+' No automatic workflow dispatch, PR merge or release publication.',
  apply:async({args,ctx,target})=>{
    const run={runId:args.runId,account:target.owner,connection:ctx.connection.client_id,
      owner:target.owner,repo:args.repo,scenarios:[args.scenario]};
    const github=await octo(ctx,target.owner);
    const repo=await runDevMutationOnce(ctx,{...run,stepId:'seed-repo',type:'repo',objectName:args.repo,
      create:async()=>{
        const result=(await github.request('POST /orgs/{org}/repos',{org:target.owner,name:args.repo,private:true,auto_init:true,
          description:`Developer fixture for ${marker(args.runId)} (${args.scenario})`})).data;
        if(!same(result?.full_name,`${target.owner}/${args.repo}`)||result.private!==true)
          throw refusal('GitHub did not create the expected private scratch repository.');
        const createdSha=await captureScratchOrigin(github,{
          owner:target.owner,repo:args.repo,runId:args.runId,created:result});
        const birthLabels=await captureScratchBirthLabels(github,{owner:target.owner,repo:args.repo,sleep:ctx.sleep});
        return {objectId:result.full_name,createdSha,birthLabels};
      }});
    if(args.scenario==='pr-with-threads'){
      const objects=await seedReviewScenario(ctx,{github,run});
      return {data:{run_id:args.runId,scenario:args.scenario,objects:[repo,...objects]}};
    }
    if(args.scenario==='stack-of-three'){
      const objects=await seedStack(ctx,{github,run});
      return {data:{run_id:args.runId,scenario:args.scenario,objects:[repo,...objects]}};
    }
    if(args.scenario==='webhook-target'){
      const scope={account:target.owner,connection:ctx.connection.client_id};
      let reveal=null;
      const forwarder=await runDevMutationOnce(ctx,{...run,stepId:'seed-forwarder',type:'forwarder',objectName:'target',
        create:async()=>{
          const made=await registerForwarder(ctx,{...scope,url:args.url,events:[...HOOK_EVENTS],runId:args.runId,repo:args.repo});
          reveal=made.reveal;
          return {objectId:made.id};
        }});
      const row=await ctx.db.getDevForwarder({id:forwarder.objectId,...scope});
      if(!row||row.run_id!==args.runId||!same(row.repo,args.repo))
        throw refusal('The recorded forwarder is missing or belongs to another run; reconcile before continuing.');
      const hook=await runDevMutationOnce(ctx,{...run,stepId:'seed-test-hook',type:'webhook',objectName:'test-hook',
        create:async()=>{
          const result=(await github.request('POST /repos/{owner}/{repo}/hooks',{owner:target.owner,repo:args.repo,name:'web',active:true,
            events:[...HOOK_EVENTS],config:{url:row.url,content_type:'json',secret:forwarderSecret(ctx,row),insecure_ssl:'0'}})).data;
          if(!Number.isSafeInteger(result?.id)||result.id<1)throw refusal('GitHub accepted the webhook but returned no exact ID; check the repository before retrying.');
          return {objectId:String(result.id)};
        }});
      return {data:{run_id:args.runId,scenario:args.scenario,objects:[repo,forwarder,hook],reveal}};
    }
    if(args.scenario==='protected-main'){
      const name=topic(args.runId);
      const ruleset=await runDevMutationOnce(ctx,{...run,stepId:'seed-required-ci-ruleset',
        type:'ruleset',objectName:name,create:async()=>{
          const result=(await github.request('POST /repos/{owner}/{repo}/rulesets',{
            owner:target.owner,repo:args.repo,name,target:'branch',enforcement:'active',
            conditions:{ref_name:{include:['~DEFAULT_BRANCH'],exclude:[]}},
            bypass_actors:[],rules:[{type:'required_status_checks',parameters:{
              required_status_checks:[{context:'ci'}],
              strict_required_status_checks_policy:true
            }}]
          })).data;
          if(!Number.isSafeInteger(result?.id)||result.id<=0||result.name!==name||
            result.enforcement!=='active'||result.target!=='branch')
            throw refusal('GitHub did not confirm the exact active branch ruleset.');
          return {objectId:String(result.id)};
        }});
      return {data:{run_id:args.runId,scenario:args.scenario,objects:[repo,ruleset]}};
    }
    if(args.scenario==='release-train'){
      const scratchRepo=await repoGet(ctx,target.owner,args.repo);
      const defaultBranch=scratchRepo?.default_branch;
      if(typeof defaultBranch!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(defaultBranch))
        throw refusal('GitHub did not report a usable scratch default branch.');
      const head=(await github.request('GET /repos/{owner}/{repo}/git/ref/{ref}',{
        owner:target.owner,repo:args.repo,ref:`heads/${defaultBranch}`
      })).data;
      const sha=head?.object?.sha;
      if(head?.ref!==`refs/heads/${defaultBranch}`||!/^[a-f0-9]{40}$/.test(sha??''))
        throw refusal('GitHub did not confirm the scratch main commit for test release tags.');
      const tags=[];
      for(const tag of RELEASE_TAGS){
        const created=await runDevMutationOnce(ctx,{...run,stepId:`seed-tag-${tag.replaceAll('.','-')}`,
          type:'tag',objectName:tag,create:async()=>{
            const result=(await github.request('POST /repos/{owner}/{repo}/git/refs',{
              owner:target.owner,repo:args.repo,ref:`refs/tags/${tag}`,sha
            })).data;
            if(result?.ref!==`refs/tags/${tag}`||result.object?.sha!==sha)
              throw refusal('GitHub did not confirm the exact test tag and commit.');
            return {objectId:tag,createdSha:sha};
          }});
        if(created.createdSha!==sha)throw refusal('An existing recorded tag has a different SHA.');
        tags.push(created);
      }
      const published=await runDevMutationOnce(ctx,{...run,stepId:'seed-draft-release',
        type:'release',objectName:'draft-v0.3.0',create:async()=>{
          const result=(await github.request('POST /repos/{owner}/{repo}/releases',{
            owner:target.owner,repo:args.repo,tag_name:'v0.3.0',name:'RTC draft v0.3.0',
            body:`Draft-only release fixture ${marker(args.runId)}`,draft:true,
            target_commitish:defaultBranch
          })).data;
          if(!Number.isSafeInteger(result?.id)||result.id<=0||result.draft!==true||
            result.tag_name!=='v0.3.0')throw refusal('GitHub did not confirm the draft release.');
          return {objectId:String(result.id)};
        }});
      return {data:{run_id:args.runId,scenario:args.scenario,objects:[repo,...tags,published]}};
    }
    const path=filePath(args.runId);
    const workflow=await commitOwnedFixtureFile(ctx,{github,run,stepId:'seed-workflow',
      path,content:workflowSource(args.runId,args.scenario==='failing-ci')});
    let third;
    if(args.scenario==='repo-basic'){
      const name=topic(args.runId);
      third=await runDevMutationOnce(ctx,{...run,stepId:'seed-label',type:'label',objectName:name,
        create:async()=>{
          const result=(await github.request('POST /repos/{owner}/{repo}/labels',{
            owner:target.owner,repo:args.repo,name,color:'0969da',description:marker(args.runId)
          })).data;
          if(result?.name!==name)throw refusal('GitHub did not return the created run label.');
          return {objectId:result.name};
        }});
    }else{
      const name=branchName(args.runId);
      if(!workflow.createdSha)throw refusal('Cannot create test branch without the recorded workflow commit SHA.');
      third=await createOwnedFixtureBranch(ctx,{github,run,stepId:'seed-failure-ref',
        name,sha:workflow.createdSha});
    }
    return {data:{run_id:args.runId,scenario:args.scenario,objects:[repo,workflow,third]}};
  },
  readAfter:async({args,ctx,target,response})=>{
    const github=await octo(ctx,target.owner);
    const base={owner:target.owner,repo:args.repo};
    if(args.scenario==='pr-with-threads')return readReviewScenario({github,id:args.runId,
      owner:target.owner,repo:args.repo,response});
    if(args.scenario==='stack-of-three')return readStack({github,id:args.runId,
      owner:target.owner,repo:args.repo,response});
    if(args.scenario==='webhook-target'){
      const row=await ctx.db.getDevForwarder({id:response.data.objects[1].objectId,account:target.owner,connection:ctx.connection.client_id});
      const [repository,hook]=await Promise.all([
        repoGet(ctx,target.owner,args.repo),
        github.request('GET /repos/{owner}/{repo}/hooks/{hook_id}',{...base,hook_id:Number(response.data.objects[2].objectId)}).then(x=>x.data)
      ]);
      let host=null;
      try{host=forwarderUrl(hook?.config?.url).hostname;}catch{/* unsafe or unreadable: fails verification */}
      return {repository,forwarder:row?forwarderView(row):null,
        hook:{id:hook?.id,active:hook?.active===true,events:hook?.events??[],host,secure_tls:String(hook?.config?.insecure_ssl??'0')!=='1'}};
    }
    if(args.scenario==='protected-main'){
      const [repository,ruleset]=await Promise.all([
        repoGet(ctx,target.owner,args.repo),
        github.request('GET /repos/{owner}/{repo}/rulesets/{ruleset_id}',{
          ...base,ruleset_id:Number(response.data.objects[1].objectId)
        }).then(x=>x.data)
      ]);
      return {repository,ruleset};
    }
    if(args.scenario==='release-train'){
      const [repository,tags,release]=await Promise.all([
        repoGet(ctx,target.owner,args.repo),
        Promise.all(RELEASE_TAGS.map(tag=>github.request('GET /repos/{owner}/{repo}/git/ref/{ref}',{
          ...base,ref:`tags/${tag}`
        }).then(x=>x.data))),
        github.request('GET /repos/{owner}/{repo}/releases/{release_id}',{
          ...base,release_id:Number(response.data.objects[4].objectId)
        }).then(x=>x.data)
      ]);
      return {repository,tags,release};
    }
    const [repository,workflow,extra]=await Promise.all([
      repoGet(ctx,target.owner,args.repo),
      github.request('GET /repos/{owner}/{repo}/contents/{path}',{...base,path:filePath(args.runId)}).then(x=>x.data),
      args.scenario==='repo-basic'
        ? github.request('GET /repos/{owner}/{repo}/labels/{name}',{...base,name:topic(args.runId)}).then(x=>x.data)
        : github.request('GET /repos/{owner}/{repo}/git/ref/{ref}',{...base,ref:`heads/${branchName(args.runId)}`}).then(x=>x.data)
    ]);
    return {repository,workflow,extra};
  },
  verify:async({args,ctx,target,after,response})=>{
    if(!after?.repository||after.repository.private!==true||
      !same(after.repository.full_name,`${target.owner}/${args.repo}`)||
      !matchesRunDescription(after.repository.description,args.runId))return false;
    if(args.scenario==='pr-with-threads'){
      if(!verifyReviewScenario({id:args.runId,after,response}))return false;
    }else if(args.scenario==='stack-of-three'){
      if(!verifyStack({id:args.runId,after,response}))return false;
    }else if(args.scenario==='webhook-target'){
      const f=after.forwarder,h=after.hook;
      if(response.data.objects.length!==3||!f||f.id!==response.data.objects[1].objectId||f.run_id!==args.runId||!same(f.repo,args.repo)||
        !h||String(h.id)!==response.data.objects[2].objectId||h.active!==true||h.secure_tls!==true||h.host!==f.host||
        h.events.length!==HOOK_EVENTS.length||!HOOK_EVENTS.every(e=>h.events.includes(e)))return false;
    }else if(args.scenario==='protected-main'){
      const rule=after.ruleset;
      const required=rule?.rules?.find(x=>x.type==='required_status_checks');
      if(response.data.objects.length!==2||!rule||
        String(rule.id)!==response.data.objects[1].objectId||rule.name!==topic(args.runId)||
        rule.target!=='branch'||rule.enforcement!=='active'||
        !rule.conditions?.ref_name?.include?.includes('~DEFAULT_BRANCH')||
        !required?.parameters?.required_status_checks?.some(x=>x.context==='ci')||
        required.parameters.strict_required_status_checks_policy!==true)return false;
    }else if(args.scenario==='release-train'){
      if(response.data.objects.length!==5||after.tags?.length!==3||
        after.release?.draft!==true||after.release?.tag_name!=='v0.3.0'||
        String(after.release.id)!==response.data.objects[4].objectId||
        !matchesRunDescription(after.release.body,args.runId))return false;
      for(let i=0;i<3;i++){
        if(after.tags[i]?.ref!==`refs/tags/${RELEASE_TAGS[i]}`||
          after.tags[i]?.object?.sha!==response.data.objects[i+1].createdSha)return false;
      }
    }else{
      if(after.workflow?.path!==filePath(args.runId)||typeof after.workflow.content!=='string')return false;
      const content=Buffer.from(after.workflow.content.replace(/\s/g,''),'base64').toString('utf8');
      if(content!==workflowSource(args.runId,args.scenario==='failing-ci'))return false;
    }
    if(args.scenario==='repo-basic'&&after.extra?.name!==topic(args.runId))return false;
    if(args.scenario==='failing-ci'&&(after.extra?.ref!==`refs/heads/${branchName(args.runId)}`||
      after.extra?.object?.sha!==response.data.objects[2].createdSha))return false;
    if(response.data.objects.length!==(args.scenario==='pr-with-threads'?13:args.scenario==='stack-of-three'?14:args.scenario==='protected-main'?2:args.scenario==='release-train'?5:args.scenario==='webhook-target'?3:3))return false;
    const stored=await ctx.db.listDevObjects({runId:args.runId,account:target.owner,
      connection:ctx.connection.client_id,limit:50});
    return response.data.objects.every(o=>stored.some(r=>r.object_id===o.objectId&&r.owner===target.owner&&r.repo===args.repo));
  },
  inverse:()=>null,
  present:({args,response})=>({run_id:args.runId,scenario:args.scenario,created:response.data.objects,
    ...(response.data.reveal?{signing_secret_reveal:response.data.reveal,secret_expires_in_minutes:10}:{}),
    manual_dispatch_only:['repo-basic','failing-ci'].includes(args.scenario),
    note:args.scenario==='release-train'
      ? 'Draft release and tags only; nothing was published, dispatched, or live-tested without IN-06.'
      : args.scenario==='pr-with-threads'
        ? 'Three actual run-owned review threads, one outdated after a separate recorded commit; draft only.'
      : args.scenario==='stack-of-three'
        ? 'Three linked run-owned draft PRs; no merge or workflow dispatch occurred.'
      : args.scenario==='webhook-target'
        ? 'Private scratch repository, a forwarder bound to this run and a test webhook signed with its secret. Open signing_secret_reveal once to copy the secret into your app; nothing was sent to your app yet.'
      : args.scenario==='protected-main'
        ? 'Scratch-only active required-ci ruleset; no production branch or non-scratch repository was changed.'
        : 'Workflow files are real, but no Actions run was dispatched; IN-06 is required for live scratch usage.'})
});
export const tools=[seed.tool];
export const handlers={[seed.tool.name]:seed.handler};
