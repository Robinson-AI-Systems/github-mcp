// Y-9d hosted runners. Builder spending is $0; end-user authorized metered capacity
// is executable through the normal user-controlled risk and approval guards.
import { defineRead } from './define-read.js';
import { defineGithubWrite } from './define-github-write.js';
import { plain } from './github-read.js';
import { octo, ownerOf, missing, refusal } from './github-write.js';

const OWNER={type:'string',minLength:1,maxLength:39};
const ID={type:'integer',minimum:1};
const NAME={type:'string',minLength:1,maxLength:64,pattern:'^[A-Za-z0-9._-]+$'};
const target=(a,c)=>({owner:ownerOf(a,c),scope:'org',kind:'hosted-runner'});
const ROUTE='/orgs/{org}/actions/hosted-runners';
async function gh(c,t){
  const account=await c.db.getAccount(t.owner);
  if(account?.account_type!=='Organization')throw refusal('Hosted runners require an enrolled organization.');
  return octo(c,t.owner,'I');
}
const one=async(c,t,id)=>missing(async()=>(
  await (await gh(c,t)).request('GET '+ROUTE+'/{hosted_runner_id}',{org:t.owner,hosted_runner_id:id})).data);
const shape=x=>x?({id:x.id,name:x.name,group:x.runner_group_id,status:x.status,
  size:x.machine_size_details?.id??null,maximum_runners:x.maximum_runners,
  image:x.image?.id??null,static_ips_enabled:!!x.public_ip_enabled}):null;

const hostedList=defineRead({
  name:'github_hosted_runner_list',area:'actions',audience:['O','Op'],
  description:'Read organization GitHub-hosted runner pools, sizes and maximum concurrency; no runners are created.',
  properties:{owner:OWNER},
  handler:(a,c)=>plain(async()=>{
    const t=target(a,c),client=await gh(c,t),items=[];
    for(let page=1;page<=5;page++){
      const d=(await client.request('GET '+ROUTE,{org:t.owner,per_page:100,page})).data;
      if(!Array.isArray(d?.runners))throw refusal('Runner inventory was unreadable.');
      items.push(...d.runners);
      if(d.runners.length<100&&(!Number.isInteger(d.total_count)||d.total_count===items.length))
        return {owner:t.owner,runners:items.map(shape),complete:true,source:'GitHub'};
    }
    return {owner:t.owner,runners:items.map(shape),complete:false,
      note:'List capped; cannot assume all pools were seen.'};
  })
});
const hostedManage=defineGithubWrite({
  name:'github_hosted_runner_manage',area:'actions',audience:['O'],
  description:'Rename, reduce concurrency or remove a verified hosted runner; price-increasing configuration is refused.',
  properties:{owner:OWNER,runnerId:ID,action:{type:'string',enum:['update','delete']},
    name:NAME,maximumRunners:{type:'integer',minimum:1,maximum:1000}},
  required:['runnerId','action'],
  declarations:{production:'always',confirm:'always',profiles:['full']},
  target,
  read:async(a,c,t)=>{
    const current=await one(c,t,a.runnerId);
    if(!current)throw refusal('Hosted runner not found; nothing to change.');
    return current;
  },
  classify:()=>({production:'changes GitHub-hosted runner organization configuration'}),
  summarize:({args:a,before:b,target:t})=>(a.action==='delete'?'DELETE':'UPDATE')+
    ' hosted runner '+b.name+' ('+a.runnerId+') in '+t.owner+
    '; current maximum '+b.maximum_runners+' runners, requested '+(a.maximumRunners??b.maximum_runners),
  apply:async({args:a,ctx,target:t,before:b})=>{
    if(a.action==='update'){
      if(a.name===undefined&&a.maximumRunners===undefined)throw refusal('Choose a name or a concurrency reduction.');
      if(a.maximumRunners!==undefined&&(!Number.isInteger(b.maximum_runners)||a.maximumRunners>b.maximum_runners))
        throw refusal('Expanding hosted-runner capacity can incur unknown GitHub charges and is not priced safely.');
      if((a.name??b.name)===b.name&&(a.maximumRunners??b.maximum_runners)===b.maximum_runners)
        throw refusal('Runner already has the desired values.');
      return (await gh(ctx,t)).request('PATCH '+ROUTE+'/{hosted_runner_id}',
        {org:t.owner,hosted_runner_id:a.runnerId,...(a.name?{name:a.name}:{}),
          ...(a.maximumRunners!==undefined?{maximum_runners:a.maximumRunners}:{})});
    }
    // Provider deletion is asynchronous (202), so never infer success from the response.
    return (await gh(ctx,t)).request('DELETE '+ROUTE+'/{hosted_runner_id}',
      {org:t.owner,hosted_runner_id:a.runnerId});
  },
  readAfter:({args:a,ctx,target:t})=>one(ctx,t,a.runnerId),
  verify:({args:a,after:x})=>a.action==='delete'?
    x===null:!!x&&(a.name===undefined||x.name===a.name)
      &&(a.maximumRunners===undefined||x.maximum_runners===a.maximumRunners),
  inverse:()=>null,
  present:({args:a,after:x})=>({id:a.runnerId,action:a.action,observed:shape(x),
    note:a.action==='delete'?'Deletion is not confirmed until GitHub returns 404 on readback':null})
});
const hostedCreate=defineGithubWrite({
  name:'github_hosted_runner_create',area:'actions',audience:['O'],
  description:'Create a real billed GitHub-hosted runner with confirmed exposure to metered compute, verified image, size and group.',
  properties:{owner:OWNER,name:NAME,runnerGroupId:ID,
    imageId:{type:'string',minLength:1,maxLength:120},
    imageSource:{type:'string',enum:['github','partner','custom']},
    imageVersion:{type:'string',minLength:1,maxLength:120},
    size:{type:'string',minLength:1,maxLength:120},
    maximumRunners:{type:'integer',minimum:1,maximum:1000},
    enableStaticIp:{type:'boolean'}},
  required:['name','runnerGroupId','imageId','imageSource','size'],
  declarations:{production:'always',confirm:'always',spend:true,strictSpend:true,profiles:['full']},
  target,
  read:async(a,c,t)=>{
    const client=await gh(c,t);
    const [sizes,groups,existing]=await Promise.all([
      client.request('GET /orgs/{org}/actions/hosted-runners/machine-sizes',{org:t.owner}),
      client.request('GET /orgs/{org}/actions/runner-groups',{org:t.owner,per_page:100}),
      client.request('GET '+ROUTE,{org:t.owner,per_page:100})]);
    if(!Array.isArray(sizes.data?.machine_sizes)||!sizes.data.machine_sizes.some(x=>x.id===a.size))
      throw refusal('GitHub did not verify the requested hosted-runner machine size.');
    if(!Array.isArray(groups.data?.runner_groups)||groups.data.runner_groups.length>=100||
       !groups.data.runner_groups.some(x=>x.id===a.runnerGroupId))
      throw refusal('GitHub did not verify the complete authorized runner-group inventory.');
    if(!Array.isArray(existing.data?.runners)||existing.data.runners.length>=100||
       existing.data.runners.some(x=>x.name?.toLowerCase()===a.name.toLowerCase()))
      throw refusal('Runner name conflicts or hosted-runner inventory is incomplete.');
    return {name:a.name,group:a.runnerGroupId,size:a.size,verified:true};
  },
  price:()=>null, // Explicitly unknown FUTURE metered bill, never interpreted as $0
  classify:()=>({production:'creates billable GitHub-hosted runner compute'}),
  summarize:({args:a,target:t})=>'Create billed hosted runner '+a.name+' in '+t.owner+
    ', group '+a.runnerGroupId+', machine '+a.size+', scale ceiling '+(a.maximumRunners??'GitHub default')+
    '. Metered GitHub costs have no guaranteed total dollar maximum',
  apply:async({args:a,ctx,target:t})=>(await gh(ctx,t)).request('POST '+ROUTE,{
    org:t.owner,name:a.name,runner_group_id:a.runnerGroupId,
    image:{id:a.imageId,source:a.imageSource,...(a.imageVersion?{version:a.imageVersion}:{})},
    size:a.size,maximum_runners:a.maximumRunners??1,
    enable_static_ip:a.enableStaticIp??false}),
  readAfter:async({ctx,target:t,response})=>{
    const id=response?.data?.id;
    if(!Number.isSafeInteger(id)||id<1)throw refusal('GitHub returned no hosted-runner identity; inspect the organization runner inventory.');
    return one(ctx,t,id);
  },
  verify:({args:a,after:x})=>!!x&&x.name===a.name&&x.runner_group_id===a.runnerGroupId&&
    x.machine_size_details?.id===a.size,
  inverse:()=>null,
  present:({after:x})=>({runner:shape(x),billing:'Metered charges depend on use; no maximum is guaranteed'})
});

const hostedScaleUp=defineGithubWrite({
  name:'github_hosted_runner_scale_up',area:'actions',audience:['O'],
  description:'Increase GitHub-hosted runner capacity after disclosure of unbounded metered usage and user-authorized confirmation.',
  properties:{owner:OWNER,runnerId:ID,maximumRunners:{type:'integer',minimum:1,maximum:1000}},
  required:['runnerId','maximumRunners'],
  declarations:{production:'always',confirm:'always',spend:true,strictSpend:true,profiles:['full']},
  target,
  read:async(a,c,t)=>{const row=await one(c,t,a.runnerId);if(!row)throw refusal('Runner not found.');
    if(!Number.isInteger(row.maximum_runners))throw refusal('Runner capacity unreadable.');
    return row;},
  price:()=>null,
  classify:()=>({production:'increases potentially billable hosted runner concurrency'}),
  summarize:({args:a,before:b,target:t})=>'Increase billed runner '+b.name+' in '+t.owner+
    ' from '+b.maximum_runners+' to '+a.maximumRunners+' possible concurrent runners; no maximum future bill is guaranteed',
  apply:async({args:a,ctx,target:t,before:b})=>{
    if(a.maximumRunners<=b.maximum_runners)throw refusal('Use the non-spending manage tool for decreases.');
    return (await gh(ctx,t)).request('PATCH '+ROUTE+'/{hosted_runner_id}',{
      org:t.owner,hosted_runner_id:a.runnerId,maximum_runners:a.maximumRunners});
  },
  readAfter:({args:a,ctx,target:t})=>one(ctx,t,a.runnerId),
  verify:({args:a,after:x})=>x?.maximum_runners===a.maximumRunners,
  inverse:()=>null,present:({after:x})=>({runner:shape(x),billing:'Metered usage warning; the charge is not capped by MCP'})
});
export const tools=[hostedList.tool,hostedManage.tool,hostedCreate.tool,hostedScaleUp.tool];
export const handlers=Object.fromEntries([
  [hostedList.tool,hostedList.handler],[hostedManage.tool,hostedManage.handler],
  [hostedCreate.tool,hostedCreate.handler],[hostedScaleUp.tool,hostedScaleUp.handler]
].map(([tool,handler])=>[tool.name,handler]));
