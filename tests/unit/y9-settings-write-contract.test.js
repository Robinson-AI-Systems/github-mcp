// Y-9d: protected real write lifecycle through handler, dispatcher and github_call.
// All provider actions use synthetic responses; no provider funds or live resources.
import {runWriteContract} from '../../test/helpers/write-contract.js';
import * as copilot from '../../src/tools/y9-copilot.js';
import * as hosted from '../../src/tools/y9-hosted-runners.js';

const d=(module,name)=>({tool:module.tools.find(x=>x.name===name),handler:module.handlers[name]});
const STATUS='GET /orgs/{org}/copilot/coding-agent/permissions';
function policy(gh,kind){
  gh.when(STATUS).replySequence([{status:200,body:{enabled_repositories:'none'}},
    {status:200,body:{enabled_repositories:kind==='ok'?'selected':'none'}}]);
  gh.when('PUT /orgs/{org}/copilot/coding-agent/permissions')
    .reply(200,{enabled_repositories:'selected'});
}
const EX='GET /orgs/{org}/copilot/content_exclusion';
function exclusion(gh,kind){
  gh.when(EX).replySequence([
    {status:200,body:{hello:['/test']}},
    {status:200,body:{hello:kind==='ok'?['/test','/private']:['/test']}}
  ]);
  gh.when('PUT /orgs/{org}/copilot/content_exclusion')
    .reply(200,{message:'Content exclusion rules updated successfully.'});
}
const HG='GET /orgs/{org}/actions/hosted-runners/{hosted_runner_id}';
function runner(gh,kind){
  gh.when(HG).replySequence([{status:200,body:{id:42,name:'linux',maximum_runners:2,runner_group_id:7}},
    {status:200,body:{id:42,name:kind==='ok'?'linux-updated':'linux',maximum_runners:2,runner_group_id:7}}]);
  gh.when('PATCH /orgs/{org}/actions/hosted-runners/{hosted_runner_id}')
    .reply(200,{id:42});
}
function scale(gh,kind){
  gh.when(HG).replySequence([{status:200,body:{id:42,name:'linux',maximum_runners:2,runner_group_id:7}},
    {status:200,body:{id:42,name:'linux',maximum_runners:kind==='ok'?4:2,runner_group_id:7}}]);
  gh.when('PATCH /orgs/{org}/actions/hosted-runners/{hosted_runner_id}')
    .reply(200,{id:42});
}
const cases=[
  {name:'github_copilot_agent_policy_set',module:copilot,args:{enabledRepositories:'selected'},
    arrange:policy,accessWidening:true},
  {name:'github_copilot_content_exclusions_set',module:copilot,
    args:{rules:{hello:['/test','/private']}},arrange:exclusion},
  {name:'github_hosted_runner_manage',module:hosted,
    args:{runnerId:42,action:'update',name:'linux-updated'},arrange:runner},
  {name:'github_hosted_runner_scale_up',module:hosted,
    args:{runnerId:42,maximumRunners:4},arrange:scale,strictSpend:true}
];
for(const c of cases){
  runWriteContract({label:'Y-9d '+c.name,definition:d(c.module,c.name),
    args:c.args,arrange:c.arrange,profile:'full',production:true,needsConfirm:true,
    accessWidening:c.accessWidening??false,strictSpend:c.strictSpend??false,expectedWrites:1});
}
