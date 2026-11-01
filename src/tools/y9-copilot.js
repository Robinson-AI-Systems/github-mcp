// Y-9d: Copilot administration. Unknown metered exposure never becomes a fake $0 quote.
// Changes use the shared guarded/journalled write lifecycle; no direct or silent purchases.
import { defineRead } from './define-read.js';
import { defineGithubWrite } from './define-github-write.js';
import { plain } from './github-read.js';
import { octo, ownerOf, refusal } from './github-write.js';
import { copilotSeats } from './billing-read.js';
import { PRICES, priceLine } from '../github/prices.js';
import { accessChange } from './people-guard.js';

const OWNER = { type: 'string', minLength: 1, maxLength: 39 };
const SLUG = { type: 'string', minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9][A-Za-z0-9_-]*$' };
const org = (a, c) => ({ owner: ownerOf(a, c), scope: 'org', kind: 'copilot' });
const at = (c, t) => octo(c, t.owner, 'I');
const request = async (c, t, method, extra = {}) =>
  (await (await at(c, t)).request(method, { org: t.owner, ...extra })).data;
const enrolled = async (c, t) => {
  const row = await c.db.getAccount(t.owner);
  if (row?.account_type !== 'Organization') throw refusal('Copilot administration needs an enrolled organization.');
};
const POLICY = 'GET /orgs/{org}/copilot/coding-agent/permissions';
const EXCLUSION = 'GET /orgs/{org}/copilot/content_exclusion';
const policyValue = (x) => x?.enabled_repositories ?? null;
const ruleKeys = (x) => x && typeof x === 'object' && !Array.isArray(x)
  && Object.values(x).every(v => Array.isArray(v) && v.every(s => typeof s === 'string'))
  && Object.keys(x).every(k => /^[A-Za-z0-9._-]{1,100}$/.test(k));

const agentPolicyGet = defineRead({
  name: 'github_copilot_agent_policy_get', area: 'copilot', audience: ['O','Op'],
  description: 'Read the actual Copilot cloud-agent repository policy; unavailable plan/permission is not interpreted as disabled.',
  properties: { owner: OWNER },
  handler: (a,c) => plain(async () => {
    const t = org(a,c); await enrolled(c,t);
    const state = await request(c,t,POLICY);
    if (!['all','selected','none'].includes(policyValue(state))) throw refusal('GitHub did not return a readable cloud-agent policy.');
    return { owner:t.owner, enabled_repositories:policyValue(state), provider:'GitHub' };
  })
});
const agentPolicySet = defineGithubWrite({
  name: 'github_copilot_agent_policy_set', area: 'copilot', audience: ['O'],
  description: 'Set Copilot cloud-agent repository access; expansions disclose metered exposure and require delegated consent plus readback.',
  properties: { owner: OWNER, enabledRepositories: { type:'string', enum:['none','selected','all'] } },
  required: ['enabledRepositories'],
  declarations: { production:'always', confirm:'always', accessWidening:true, profiles:['full'] },
  target: org,
  read: async (a,c,t) => { await enrolled(c,t); const x=await request(c,t,POLICY); if(!['none','selected','all'].includes(policyValue(x))) throw refusal('Policy baseline unreadable.'); return x; },
  classify: ({args:a,before:b}) => ({ ...((policyValue(b)==='none' && a.enabledRepositories!=='none') || (a.enabledRepositories==='all' && policyValue(b)!=='all') ? { accessWidening:'allows cloud agents in more repositories',spendUnknown:true } : {}), production:'changes organization Copilot agent permissions' }),
  summarize: ({args:a,before:b,target:t}) => 'Set cloud-agent repository policy for '+t.owner+' from '+policyValue(b)+' to '+a.enabledRepositories,
  apply: async ({args:a,ctx,target:t,before:b}) => {
    if(policyValue(b)===a.enabledRepositories) throw refusal('Cloud-agent policy already matches.');
    return (await at(ctx,t)).request('PUT /orgs/{org}/copilot/coding-agent/permissions',{org:t.owner,enabled_repositories:a.enabledRepositories});
  },
  readAfter: ({ctx,target:t}) => request(ctx,t,POLICY),
  verify: ({args:a,after:x}) => policyValue(x)===a.enabledRepositories,
  inverse: () => null,
  present: ({after:x}) => ({enabled_repositories:policyValue(x)})
});
const exclusionsGet = defineRead({
  name:'github_copilot_content_exclusions_get',area:'copilot',audience:['O','Op'],
  description:'Read current organization Copilot content exclusion paths, without claiming GitHub preserves rule comments.',
  properties:{owner:OWNER},
  handler:(a,c)=>plain(async()=>{const t=org(a,c);await enrolled(c,t);
    const rules=await request(c,t,EXCLUSION);
    if(!ruleKeys(rules))throw refusal('GitHub exclusion rules were unreadable.');
    return {owner:t.owner,rules,api_limitation:'GitHub omits YAML comments and duplicate keys'};
  })
});
const exclusionsSet=defineGithubWrite({
  name:'github_copilot_content_exclusions_set',area:'copilot',audience:['O'],
  description:'Replace explicitly approved Copilot exclusion paths with a verified readback; removing exclusions can expose code.',
  properties:{owner:OWNER,rules:{type:'object',maxProperties:100,description:'Complete replacement map of repository names to exclusion paths',additionalProperties:{type:'array',maxItems:200,uniqueItems:true,items:{type:'string',minLength:1,maxLength:500}}}},
  required:['rules'],
  declarations:{production:'always',confirm:'always',accessWidening:true,profiles:['full']},
  target:org,
  read:async(a,c,t)=>{await enrolled(c,t);const x=await request(c,t,EXCLUSION);
    if(!ruleKeys(x))throw refusal('Existing exclusions are unreadable.');return x;},
  classify:({args:a,before:b})=>({
    production:'replaces GitHub Copilot content exclusion rules',
    ...(Object.entries(b??{}).some(([repo,paths])=>paths.some(p=>!a.rules?.[repo]?.includes(p)))
      ?{accessWidening:'removes an existing Copilot content exclusion'}:{})
  }),
  summarize:({args:a,before:b})=>'Replace '+Object.keys(b).length+' current Copilot exclusion repository entries with '+Object.keys(a.rules).length+' entries; GitHub will discard rule comments',
  apply:async({args:a,ctx,target:t,before})=>{
    if(!ruleKeys(a.rules)||Object.keys(a.rules).length>100)throw refusal('Rules must be a bounded map of repository names to string paths.');
    if(JSON.stringify(before)===JSON.stringify(a.rules))throw refusal('Exclusions already match.');
    // GitHub's replacement endpoint has no ability to preserve existing comments.
    // A separate explicit owner confirmation is required for any unknown comment loss.
    return (await at(ctx,t)).request('PUT /orgs/{org}/copilot/content_exclusion',{org:t.owner,...a.rules});
  },
  readAfter:({ctx,target:t})=>request(ctx,t,EXCLUSION),
  verify:({args:a,after:x})=>ruleKeys(x)&&JSON.stringify(x)===JSON.stringify(a.rules),
  inverse:()=>null,present:({after:x})=>({rules:x,warning:'GitHub does not round-trip comments'})
});

// Team seat pricing counts every verified member not already assigned; never accepts an estimated count.
const TEAM='GET /orgs/{org}/teams/{team_slug}/members';
async function teamMembers(c,t,teamSlug){
  const gh=await at(c,t),members=[];
  for(let page=1;page<=6;page++){
    const response=await gh.request(TEAM,{org:t.owner,team_slug:teamSlug,per_page:100,page});
    if(!Array.isArray(response.data))throw refusal('Team membership unreadable.');
    members.push(...response.data.map(x=>x.login?.toLowerCase()));
    if(members.some(x=>!x))throw refusal('Team membership contains an unreadable member.');
    if(response.data.length<100)return [...new Set(members)];
    if(page===6)throw refusal('Team membership exceeds the safe complete-list limit.');
  }
}
async function seatState(c,t,slug){
  const [bill,members]=await Promise.all([
    request(c,t,'GET /orgs/{org}/copilot/billing'),
    teamMembers(c,t,slug)
  ]);
  const gh=await at(c,t),list=await copilotSeats(gh,t.owner,500);
  if(!list.complete||typeof bill?.plan_type!=='string'||!bill.plan_type.trim()||
     bill.plan_type.length>100||bill?.seat_management_setting!=='assign_selected')
    throw refusal('Complete seat inventory, verifiable plan identity and selected-assignee billing required.');
  const assigned=new Set(list.seats.map(s=>s.assignee?.login?.toLowerCase()).filter(Boolean));
  return {plan:bill.plan_type,members,assigned:[...assigned],
    seats:list.seats,setting:bill.seat_management_setting};
}
const makeTeamSeats=(adding)=>defineGithubWrite({
  name:adding?'github_copilot_team_seats':'github_copilot_team_seats_remove',area:'copilot',audience:['O'],
  description:'Assign or remove a Copilot team with exact membership and existing-seat pricing, spending ceiling and confirmation.',
  properties:{owner:OWNER,teamSlug:SLUG,action:{type:'string',enum:adding?['add']:['remove']}},
  required:['teamSlug','action'],
  declarations:{production:'always',confirm:'always',accessWidening:adding,spend:adding,...(adding?{strictSpend:true}:{}),profiles:['full']},
  target:org,
  read:async(a,c,t)=>{await enrolled(c,t);return seatState(c,t,a.teamSlug);},
  ...(adding?{price:({before:b})=>{
    if(!b||!Number.isInteger(b.members?.length))return NaN;
    const seatsNeeded=b.members.filter(login=>!b.assigned.includes(login)).length;
    if(!seatsNeeded)return 0;
    const key=b.plan==='business'?'copilot_business_seat':
      b.plan==='enterprise'?'copilot_enterprise_seat':null;
    const cents=key?PRICES[key]?.cents:null;
    // A valid GitHub plan can predate our known-price reference. Do not
    // substitute $0 or deny a legitimately delegated team just for that.
    return Number.isSafeInteger(cents)?seatsNeeded*cents:null;
  }}:{}),
  classify:({args:a,target:t})=>a.action==='add'?
    {production:'may add paid Copilot team seats',...accessChange({who:'team '+a.teamSlug,access:'Copilot subscription',where:t.owner,before:'verified membership'})}:
    {production:'removes team assignment; member seats may remain through other assignments'},
  summarize:({args:a,before:b,target:t})=>(a.action==='add'?'Assign':'Remove')+' Copilot team '+a.teamSlug+' in '+t.owner+
    '; '+b.members.length+' verified members, '+b.members.filter(x=>!b.assigned.includes(x)).length+
    ' without seats; '+(a.action==='add'
      ? (b.plan==='business'||b.plan==='enterprise'
        ? priceLine(b.members.filter(x=>!b.assigned.includes(x)).length*
          PRICES[b.plan==='business'?'copilot_business_seat':'copilot_enterprise_seat'].cents,
          b.plan==='business'?'copilot_business_seat':'copilot_enterprise_seat')
        : 'GitHub plan '+b.plan+' price is not verified; future billed seats may incur unbounded charges')
      : 'no new seat spend'),
  apply:async({args:a,ctx,target:t,before:b})=>{
    if(!b.members.length)throw refusal('No members verified for selected team.');
    const current=await teamMembers(ctx,t,a.teamSlug);
    if(JSON.stringify([...current].sort())!==JSON.stringify([...b.members].sort()))
      throw refusal('Team membership changed after pricing preflight; start a new request.');
    return (await at(ctx,t)).request((a.action==='add'?'POST ':'DELETE ')+
      '/orgs/{org}/copilot/billing/selected_teams',{org:t.owner,selected_teams:[a.teamSlug]});
  },
  readAfter:({args:a,ctx,target:t})=>seatState(ctx,t,a.teamSlug),
  verify:({args:a,before:b,after:x})=>a.action==='add'?
    b.members.every(login=>x.assigned.includes(login)) :
    x.members.every(login=>{
      const s=x.seats.find(v=>v.assignee?.login?.toLowerCase()===login);
      return !s||!!s.pending_cancellation_date||!!s.assigning_team&&s.assigning_team.slug!==a.teamSlug;
    }),
  inverse:()=>null,
  present:({args:a,after:x})=>({team:a.teamSlug,action:a.action,seat_count:x?.assigned?.length,
    note:a.action==='remove'?'GitHub may retain shared/other-team seats until their cycle ends':null})
});

const teamSeats=makeTeamSeats(true);
const teamSeatsRemove=makeTeamSeats(false);
export const tools=[agentPolicyGet.tool,agentPolicySet.tool,exclusionsGet.tool,exclusionsSet.tool,teamSeats.tool,teamSeatsRemove.tool];
export const handlers=Object.fromEntries([
  [agentPolicyGet.tool,agentPolicyGet.handler],[agentPolicySet.tool,agentPolicySet.handler],
  [exclusionsGet.tool,exclusionsGet.handler],[exclusionsSet.tool,exclusionsSet.handler],
  [teamSeats.tool,teamSeats.handler],[teamSeatsRemove.tool,teamSeatsRemove.handler]
].map(([tool,handler])=>[tool.name,handler]));