// Y-9d provider-request contracts: no real GitHub credentials or billable calls.
// Same handler, dispatcher and github_call path for full production-class writes.
import {runWriteContract} from '../../test/helpers/write-contract.js';
import * as hosted from '../../src/tools/y9-hosted-runners.js';
import * as tasks from '../../src/tools/y9-agent-tasks.js';

const def=(module,name)=>({tool:module.tools.find(x=>x.name===name),handler:module.handlers[name]});
function hostedCreate(gh,result){
  gh.when('GET /orgs/{org}/actions/hosted-runners/machine-sizes')
    .reply(200,{machine_sizes:[{id:'4-core',cpu_cores:4}]});
  gh.when('GET /orgs/{org}/actions/runner-groups')
    .reply(200,{total_count:1,runner_groups:[{id:7,name:'Default'}]});
  gh.when('GET /orgs/{org}/actions/hosted-runners')
    .reply(200,{total_count:0,runners:[]});
  gh.when('POST /orgs/{org}/actions/hosted-runners')
    .reply(201,{id:41,name:'team-linux'});
  gh.when('GET /orgs/{org}/actions/hosted-runners/{hosted_runner_id}')
    .reply(200,{id:41,name:'team-linux',
      runner_group_id:result==='ok'?7:99,machine_size_details:{id:'4-core'},
      status:'Ready',maximum_runners:1,image:{id:'ubuntu-latest'}});
}
function agentStart(gh,result){
  gh.when('GET /user').reply(200,{id:10,login:'example-owner',type:'User'});
  gh.when('GET /repos/{owner}/{repo}').reply(200,{id:100,
    full_name:'example-org/test-repo',default_branch:'main',
    archived:false,disabled:false});
  gh.when('GET /repos/{owner}/{repo}/branches/{branch}')
    .reply(200,{name:'main',commit:{sha:'a'.repeat(40)}});
  gh.when('POST /agents/repos/{owner}/{repo}/tasks')
    .reply(201,{id:'a1b2c3d4-e5f6-7890-abcd-ef1234567890'});
  gh.when('GET /agents/repos/{owner}/{repo}/tasks/{task_id}')
    .reply(200,{id:'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      state:'queued',name:'Review test',
      creator:{id:10},repository:{id:result==='ok'?100:50}});
}
runWriteContract({
  label:'Y-9d github_hosted_runner_create',
  definition:def(hosted,'github_hosted_runner_create'),
  args:{name:'team-linux',runnerGroupId:7,imageId:'ubuntu-latest',
    imageSource:'github',size:'4-core',maximumRunners:1},
  arrange:hostedCreate,profile:'full',production:true,needsConfirm:true,strictSpend:true,
  expectedWrites:1
});
runWriteContract({
  label:'Y-9d github_copilot_agent_task_start',
  definition:def(tasks,'github_copilot_agent_task_start'),
  args:{repo:'test-repo',prompt:'Review the pull request and add a test',
    baseRef:'main',createPullRequest:false},
  arrange:agentStart,profile:'full',production:true,needsConfirm:true,strictSpend:true,
  expectedWrites:1
});
