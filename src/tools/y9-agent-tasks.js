// Y-9d Copilot cloud-agent tasks. They require a GitHub App user token (not I)
// and present an unbounded metered-usage warning to the properly delegated user.
import { defineRead } from './define-read.js';
import { defineGithubWrite } from './define-github-write.js';
import { plain } from './github-read.js';
import { githubFor } from '../github/client.js';
import { ownerOf, refusal } from './github-write.js';

const OWNER={type:'string',minLength:1,maxLength:39};
const REPO={type:'string',minLength:1,maxLength:100,pattern:'^[A-Za-z0-9_.-]+$'};
const TASK={type:'string',minLength:8,maxLength:100};
const PROMPT={type:'string',minLength:1,maxLength:4000};
async function actor(a,c){
  const owner=ownerOf(a,c);
  const gh=await githubFor(c,{owner,cred:'U',scope:{repositories:[a.repo]}});
  const me=(await gh.request('GET /user')).data;
  if(!me?.id||!me?.login)throw refusal('GitHub Copilot agent tasks require an enrolled user credential.');
  const repo=(await gh.request('GET /repos/{owner}/{repo}',{owner,repo:a.repo})).data;
  if(!repo||repo.full_name?.toLowerCase()!==(owner+'/'+a.repo).toLowerCase())
    throw refusal('Repository not proved to be in the selected enrolled account.');
  return {gh,owner,repository:repo.full_name};
}
const safe=x=>({id:x?.id,state:x?.state,name:x?.name,
  created_at:x?.created_at,updated_at:x?.updated_at,
  html_url:x?.html_url??null,session_count:x?.session_count??null});
const agentTasks=defineRead({
  name:'github_copilot_agent_tasks',area:'copilot',audience:['O','B','Op'],
  description:'List or inspect GitHub Copilot cloud-agent tasks using the authorized user credential; no task starts.',
  properties:{owner:OWNER,repo:REPO,taskId:TASK},
  required:['repo'],
  handler:(a,c)=>plain(async()=>{
    const {gh,owner,repository}=await actor(a,c);
    if(a.taskId){
      const data=(await gh.request('GET /agents/repos/{owner}/{repo}/tasks/{task_id}',
        {owner,repo:a.repo,task_id:a.taskId})).data;
      if(data?.id!==a.taskId)throw refusal('GitHub task identity did not match.');
      return {repository,task:safe(data)};
    }
    const response=(await gh.request('GET /agents/repos/{owner}/{repo}/tasks',
      {owner,repo:a.repo,per_page:100,page:1})).data;
    const items=Array.isArray(response)?response:response?.tasks;
    if(!Array.isArray(items))throw refusal('Task inventory unreadable.');
    return {repository,tasks:items.slice(0,100).map(safe),complete:items.length<100,
      note:items.length>=100?'Additional pages not included; do not infer a complete task inventory.':null};
  })
});
const agentTaskStart=defineGithubWrite({
  name:'github_copilot_agent_task_start',area:'copilot',audience:['O','B'],
  description:'Start a real Copilot cloud-agent task with a verified user token and a warning about potentially unbounded AI usage.',
  properties:{owner:OWNER,repo:REPO,prompt:PROMPT,baseRef:REPO,headRef:REPO,
    model:{type:'string',minLength:1,maxLength:100},customAgent:{type:'string',minLength:1,maxLength:100},
    createPullRequest:{type:'boolean'}},
  required:['repo','prompt'],
  declarations:{production:'always',confirm:'always',spend:true,strictSpend:true,cred:'U',profiles:['full']},
  target:(a,c)=>({owner:ownerOf(a,c),repo:a.repo,scope:'repo',kind:'copilot-agent-task'}),
  read:async(a,c)=>{
    const {gh,owner,repository}=await actor(a,c);
    const row=(await gh.request('GET /repos/{owner}/{repo}',{owner,repo:a.repo})).data;
    if(row.archived||row.disabled)throw refusal('Cannot start a task in an archived or disabled repository.');
    const branch=a.baseRef??row.default_branch;
    if(!branch)throw refusal('A repository base branch must be verified.');
    const check=(await gh.request('GET /repos/{owner}/{repo}/branches/{branch}',
      {owner,repo:a.repo,branch})).data;
    if(!check?.commit?.sha)throw refusal('The Copilot task base branch was not verified.');
    if(a.headRef){
      const head=(await gh.request('GET /repos/{owner}/{repo}/branches/{branch}',{
        owner,repo:a.repo,branch:a.headRef})).data;
      if(!head?.commit?.sha)throw refusal('Requested existing Copilot task branch was not verified.');
    }
    const me=(await gh.request('GET /user')).data;
    if(!Number.isSafeInteger(me?.id))throw refusal('The actual task creator identity could not be verified.');
    return {repository,id:row.id,actor_id:me.id,base_ref:branch};
  },
  price:()=>null, // Usage duration and premium requests cannot be bounded from task creation.
  classify:()=>({production:'creates a Copilot agent coding task and potentially a pull request'}),
  summarize:({args:a,before:b})=>'Start paid Copilot cloud-agent task as GitHub user ID '+
    b.actor_id+' in '+b.repository+' from '+b.base_ref+(a.createPullRequest===true?' and create a PR':'')+
    '; premium requests and usage can incur charges with no guaranteed maximum',
  apply:async({args:a,ctx,before:b})=>{
    const {gh,repository}=await actor(a,ctx);
    if(repository!==b.repository)throw refusal('Repository changed after preview.');
    return gh.request('POST /agents/repos/{owner}/{repo}/tasks',{
      owner:b.repository.split('/')[0],repo:a.repo,prompt:a.prompt,base_ref:b.base_ref,
      ...(a.headRef?{head_ref:a.headRef}:{}),
      ...(a.model?{model:a.model}:{}),...(a.customAgent?{custom_agent:a.customAgent}:{}),
      create_pull_request:a.createPullRequest??false});
  },
  readAfter:async({args:a,ctx,before:b,response})=>{
    const id=response?.data?.id;
    if(typeof id!=='string'||id.length<8)throw refusal('GitHub returned no task ID.');
    const {gh}=await actor(a,ctx);
    return (await gh.request('GET /agents/repos/{owner}/{repo}/tasks/{task_id}',{
      owner:b.repository.split('/')[0],repo:a.repo,task_id:id})).data;
  },
  verify:({before:b,after:x,response})=>!!x&&x.id===response?.data?.id&&
    x.repository?.id===b.id&&x.creator?.id===b.actor_id,
  inverse:()=>null,
  present:({after:x})=>({task:safe(x),billing:'Premium agent usage may be metered with no total charge guarantee'})
});
export const tools=[agentTasks.tool,agentTaskStart.tool];
export const handlers={
  [agentTasks.tool.name]:agentTasks.handler,[agentTaskStart.tool.name]:agentTaskStart.handler
};
