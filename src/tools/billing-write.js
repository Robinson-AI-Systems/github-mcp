// O-4: owner billing, Copilot and Codespaces writes. Never skip a spend,
// protected-resource, production or independent confirmation gate.
import {defineGithubWrite} from './define-github-write.js';
import {ownerOf,octo,missing,refusal} from './github-write.js';
import {githubFor} from '../github/client.js';
import {personalCred} from '../github/personal-cred.js';
import {copilotSeats,budgetInventory} from './billing-read.js';
import {PRICES,priceLine,codespacesComputeCents,
  codespacesStorageCents} from '../github/prices.js';
import {accessChange} from './people-guard.js';

const OWNER={type:'string',maxLength:39};
const ID={type:'string',minLength:8,maxLength:80};
const LOGIN={type:'string',minLength:1,maxLength:39};
const USERS={type:'array',minItems:1,maxItems:20,uniqueItems:true,items:LOGIN};
const INT={type:'integer',minimum:0,maximum:1000000};
const NAME={type:'string',minLength:1,maxLength:100};
const REPO={type:'string',minLength:1,maxLength:100};
const origin=(a,c)=>({owner:ownerOf(a,c),scope:'org',kind:'org-billing'});
const enrolled=async(c,t,cred='I')=>{
  const account=await c.db.getAccount(t.owner);
  if(account?.account_type!=='Organization')
    throw refusal('Billing owner actions require an enrolled organization.');
  return octo(c,t.owner,cred);
};
const call=async(c,t,route,args={},cred='I')=>
  (await(await enrolled(c,t,cred)).request(route,{org:t.owner,...args})).data;
const budgetRoute='/organizations/{org}/settings/billing/budgets';
const getBudget=(c,t,id)=>missing(()=>call(c,t,'GET '+budgetRoute+'/{budget_id}',
  {budget_id:id}));
const budgetType={type:'string',enum:['BundlePricing','ProductPricing','SkuPricing']};
const budgetScope={type:'string',enum:['organization','repository','multi_user_customer','user']};
const budgetParams={budgetAmount:INT,
  preventFurtherUsage:{type:'boolean'},budgetScope,budgetType,
  budgetProductSku:NAME,budgetEntityName:{type:'string',maxLength:150},
  budgetAlerting:{type:'object',properties:{
    will_alert:{type:'boolean'},
    alert_recipients:{type:'array',maxItems:20,uniqueItems:true,items:LOGIN}},
  required:['will_alert','alert_recipients'],additionalProperties:false},
  user:LOGIN};
const bodyBudget=a=>({
  ...(a.budgetAmount!==undefined?{budget_amount:a.budgetAmount}:{}),
  ...(a.preventFurtherUsage!==undefined?{prevent_further_usage:a.preventFurtherUsage}:{}),
  ...(a.budgetScope!==undefined?{budget_scope:a.budgetScope}:{}),
  ...(a.budgetType!==undefined?{budget_type:a.budgetType}:{}),
  ...(a.budgetProductSku!==undefined?{budget_product_sku:a.budgetProductSku}:{}),
  ...(a.budgetEntityName!==undefined?{budget_entity_name:a.budgetEntityName}:{}),
  ...(a.budgetAlerting!==undefined?{budget_alerting:a.budgetAlerting}:{}),
  ...(a.user!==undefined?{user:a.user}:{})});
const assertBudget=a=>{
  if(a.action==='create'){
    for(const p of ['budgetAmount','preventFurtherUsage','budgetScope','budgetType','budgetProductSku'])
      if(a[p]===undefined)throw refusal('Creation requires complete '+p+'.');
    if(a.budgetScope==='user'&&!a.user)
      throw refusal('User-scoped budgets require exact user login.');
    if(['user','multi_user_customer'].includes(a.budgetScope)&&
      !['ai_credits','premium_requests'].includes(a.budgetProductSku))
      throw refusal('User budgets are only supported for AI credits or premium requests.');
    if(['user','multi_user_customer'].includes(a.budgetScope)&&
      a.preventFurtherUsage!==true)
      throw refusal('User budgets must enforce the limit.');
  }
};
export const budgetSave=defineGithubWrite({
  name:'github_billing_save_budget',area:'billing',audience:['O'],
  description:'Create or surgically update an explicit dollar budget with conservative spend classification and exact readback.',
  properties:{owner:OWNER,action:{type:'string',enum:['create','update']},
    budgetId:ID,...budgetParams},required:['action'],
  declarations:{production:'always',confirm:'always',spend:true,profiles:['full']},target:origin,
  read:async(a,c,t)=>{
    assertBudget(a);
    if(a.action==='update'&&!a.budgetId)throw refusal('Update requires exact budget ID.');
    if(a.action==='create'&&a.budgetId)throw refusal('Creation cannot override existing budget ID.');
    const old=a.action==='update'?await getBudget(c,t,a.budgetId):null;
    if(a.action==='update'&&!old)throw refusal('Existing budget not found.');
    const listing=await budgetInventory(await enrolled(c,t),t.owner,500);
    if(!listing.complete)throw refusal('Complete budget inventory is required.');
    return {budget:old,ids:listing.budgets.map(x=>x.id)};
  },
  // An increased budget enables FUTURE spend, not a charge today.
  // The spend gate uses the authorized additional ceiling, never claiming
  // this equals GitHub's actual eventual bill.
  price:({args:a,before:b})=>{
    if(!b)throw refusal('Budget preflight was unreadable.');
    const old=b.budget?.budget_amount??0;
    const next=a.budgetAmount??old;
    if(!Number.isSafeInteger(next)||next<0||!Number.isSafeInteger(old)||old<0)
      throw refusal('Budget amount must be an exact number of whole dollars.');
    // GitHub accepts unenforced organization/repository budgets. Historically
    // the developing agent's $0 budget disabled these for every end user.
    // An unenforced control has potentially unlimited future exposure; route
    // that through the user-selected cap/service-pass gate as UNKNOWN, not an
    // invented $0 cost or a permanent product prohibition.
    const enforcing=a.preventFurtherUsage??b.budget?.prevent_further_usage;
    if(enforcing===false)return null;
    // Switching enforcement ON reduces exposure even if the displayed limit
    // increases. It is never itself a provider charge.
    if(b.budget?.prevent_further_usage===false&&enforcing===true)return 0;
    return Math.max(0,next-old)*100;
  },
  classify:({args:a})=>({
    production:'affects organization-wide spending controls',
    accessWidening:a.action==='create'&&a.budgetScope==='user'?
      'A new individual spending authorization may be created':null,
    notifies:a.budgetAlerting?.alert_recipients??[]}),
  summarize:({args:a,before:b,target:t})=>(a.action==='create'?'CREATE':'UPDATE')+
    ' budget '+(a.budgetId??'new')+' in '+t.owner+
    ' from $'+(b?.budget?.budget_amount??0)+' to $'+
    (a.budgetAmount??b?.budget?.budget_amount??'unknown')+
    ', enforced '+String(a.preventFurtherUsage??b?.budget?.prevent_further_usage)+
    '; '+((a.preventFurtherUsage??b?.budget?.prevent_further_usage)===false
      ? 'UNENFORCED: future GitHub charges have no guaranteed cap'
      : 'the configured limit may permit future spend; no actual provider charge is claimed'),
  apply:async({args:a,ctx,target:t,before:b})=>{
    if(!b)throw refusal('Verified budget baseline missing.');
    return (await enrolled(ctx,t)).request(
      (a.action==='create'?'POST ':'PATCH ')+budgetRoute+
      (a.action==='create'?'':'/{budget_id}'),
      {org:t.owner,...(a.action==='update'?{budget_id:a.budgetId}:{}),
        ...bodyBudget(a)});
  },
  readAfter:async({args:a,ctx,target:t,response:r})=>{
    const id=a.budgetId??r?.data?.budget?.id;
    if(!id)throw refusal('New budget ID was not returned.');
    return getBudget(ctx,t,id);
  },
  verify:({args:a,before:b,after:x})=>!!x&&
    (a.action==='create'?(!b.ids.includes(x.id)):x.id===a.budgetId)&&
    Object.entries(bodyBudget(a)).every(([k,v])=>
      ['budget_product_sku','budget_scope','budget_entity_name',
        'budget_type','budget_amount','prevent_further_usage','budget_alerting','user']
        .includes(k)?JSON.stringify(x[k])===JSON.stringify(v):true),
  inverse:()=>null,present:({after:x})=>({id:x?.id,amount_dollars:x?.budget_amount,
    prevent_further_usage:x?.prevent_further_usage})
});
const planPrice=plan=>plan==='business'?PRICES.copilot_business_seat.cents:
  plan==='enterprise'?PRICES.copilot_enterprise_seat.cents:null;
const seats=async(c,t)=>{
  const gh=await enrolled(c,t);
  const [bill,list]=await Promise.all([
    call(c,t,'GET /orgs/{org}/copilot/billing'),
    copilotSeats(gh,t.owner,500)]);
  if(!list.complete||typeof bill?.plan_type!=='string'||!bill.plan_type.trim()||
     bill.plan_type.length>100)
    throw refusal('Copilot plan identity or complete seat inventory is unreadable.');
  if(bill?.seat_management_setting!=='assign_selected')
    throw refusal('Copilot seats are not in selected-assignee mode.');
  return {bill,seats:list.seats.map(x=>x.assignee?.login?.toLowerCase()).filter(Boolean),
    seatDetails:list.seats};
};
const seatsParams={owner:OWNER,usernames:USERS};
const seatChanges=(a,b)=>a.usernames.filter(x=>!b.seats.includes(x.toLowerCase()));
const seatBeforeRemoval=(a,b)=>a.usernames.filter(x=>b.seats.includes(x.toLowerCase()));
function copilotWrite(action){
  const add=action==='add';
  return defineGithubWrite({
    name:'github_copilot_'+(add?'add':'remove')+'_seats',area:'copilot',
    audience:['O'],
    description:(add?'Purchase selected Copilot seats':'Schedule end-of-cycle cancellation of selected Copilot seats')+
      ' with exact readback and approval.',
    properties:seatsParams,required:['usernames'],
    declarations:{production:'always',confirm:'always',
      accessWidening:add,notifies:add,spend:add,...(add?{strictSpend:true}:{}),profiles:['full']},target:origin,
    read:(a,c,t)=>seats(c,t),
    price:add?({args:a,before:b})=>{
      if(!b?.bill||!Array.isArray(b.seats))return NaN;
      const additional=seatChanges(a,b).length;
      if(!additional)return 0;
      const cents=planPrice(b.bill.plan_type);
      // GitHub can report a billable plan before our published price table
      // includes it. Properly delegated end users may still assign seats,
      // with honest unknown metered exposure and no cap bypass.
      return Number.isSafeInteger(cents)?additional*cents:null;
    }:undefined,
    classify:({args:a,before:b,target:t})=>add?{
      production:'new Copilot licenses are billed monthly',
      ...accessChange({who:a.usernames.join(','),access:'Copilot seat',
        where:t.owner,before:b?.seats?.join(',')??'unreadable'}),
      notifies:a.usernames}:{
      production:'changes paid Copilot license assignments'},
    summarize:({args:a,before:b,target:t})=>(add?'PURCHASE':'CANCEL')+
      ' Copilot seats for '+a.usernames.join(',')+' in '+t.owner+
      '; '+(add
        ? (planPrice(b?.bill?.plan_type)===null
          ? 'GitHub plan '+b.bill.plan_type+' has no verified price in this MCP; billed seats may incur ongoing charges without a guaranteed maximum'
          : priceLine(seatChanges(a,b).length*planPrice(b.bill.plan_type),
            b.bill.plan_type==='enterprise'?'copilot_enterprise_seat':'copilot_business_seat'))
        : 'cancellation effective at end of GitHub billing cycle'),
    apply:async({args:a,ctx,target:t,before:b})=>{
      if(!b)throw refusal('Missing verified Copilot baseline.');
      const changed=(add?seatChanges:seatBeforeRemoval)(a,b);
      if(!changed.length)throw refusal('Requested assignees already in desired seat state.');
      if(add){
        for(const username of changed){
          const member=await call(ctx,t,'GET /orgs/{org}/memberships/{username}',{username});
          if(member?.state!=='active')
            throw refusal('Only verified active organization members may receive paid Copilot seats.');
        }
      }
      return (await enrolled(ctx,t)).request(
        (add?'POST ':'DELETE ')+
        '/orgs/{org}/copilot/billing/selected_users',
        {org:t.owner,selected_usernames:changed});
    },
    readAfter:({ctx,target:t})=>seats(ctx,t),
    verify:({args:a,after:x})=>!!x&&a.usernames.every(username=>{
      const match=x.seatDetails.find(s=>s.assignee?.login?.toLowerCase()===
        username.toLowerCase());
      return add?!!match:!match||!!match.pending_cancellation_date;
    }),
    inverse:()=>null,present:({args:a,after:x})=>({
      usernames:a.usernames,seat_count:x?.seats?.length,
      status:add?'assigned':'pending_cancellation_or_removed'})
  });
}
export const copilotAdd=copilotWrite('add'),copilotRemove=copilotWrite('remove');
const userCtx=async(c,t)=>{
  const gh=await githubFor(c,{owner:t.owner,cred:await personalCred(c,'codespace')});
  const user=(await gh.request('GET /user')).data;
  if(!user?.login)throw refusal('GitHub user credential required: authorize as user on setup page.');
  return {gh,login:user.login};
};
const codespace=(c,t,name)=>missing(async()=>{
  const {gh}=await userCtx(c,t);
  return (await gh.request('GET /user/codespaces/{codespace_name}',
    {codespace_name:name})).data;
});
const stateTarget=(a,c)=>({...origin(a,c),kind:'codespace',scope:'codespace'});
const codespaceName={type:'string',minLength:1,maxLength:250};
const cores={type:'integer',enum:[2,4,8,16,32]};
const HOURS={type:'number',minimum:0.25,maximum:24};
export const codespaceCreate=defineGithubWrite({
  name:'github_codespace_create',area:'codespace',audience:['O','B'],
  description:'Create a user-authorized exact repository Codespace with verified hourly machine estimate and spending guard.',
  properties:{owner:OWNER,repo:REPO,ref:NAME,machine:NAME,
    machineCores:cores,estimatedHours:HOURS,storageGb:{type:'integer',minimum:1,maximum:500}},
  required:['repo','ref','machine','machineCores','estimatedHours','storageGb'],
  declarations:{production:'always',confirm:'always',spend:true,cred:'U',profiles:['full']},
  target:(a,c)=>({...stateTarget(a,c),repo:a.repo,scope:'repo'}),
  read:async(a,c,t)=>{
    const {gh}=await userCtx(c,t);
    const repo=(await gh.request('GET /repos/{owner}/{repo}',
      {owner:t.owner,repo:a.repo})).data;
    if(repo?.full_name?.toLowerCase()!==(t.owner+'/'+a.repo).toLowerCase())
      throw refusal('Codespace repository was not verified within the enrolled account.');
    const machines=(await gh.request('GET /repos/{owner}/{repo}/codespaces/machines',
      {owner:t.owner,repo:a.repo,ref:a.ref})).data;
    if(!machines?.machines?.some(m=>m.name===a.machine&&m.cpus===a.machineCores))
      throw refusal('Machine name and core count are not independently verified.');
    return {repo_id:repo.id,ref:a.ref,cores:a.machineCores};
  },
  price:({args:a,before:b})=>{
    if(b?.cores!==a.machineCores)return NaN;
    return codespacesComputeCents(b.cores,a.estimatedHours)+
      codespacesStorageCents(a.storageGb);
  },
  classify:()=>({production:'Codespaces compute and storage are metered; estimate is not a hard provider ceiling'}),
  summarize:({args:a,target:t})=>'CREATE Codespace '+t.owner+'/'+a.repo+
    '@'+a.ref+' on '+a.machine+' for estimated '+a.estimatedHours+
    'h plus '+a.storageGb+' GB storage; GitHub can bill after the estimate',
  apply:async({args:a,ctx,target:t,before:b})=>{
    if(!b?.repo_id)throw refusal('Exact repository/machine preflight missing.');
    const {gh}=await userCtx(ctx,t);
    return gh.request('POST /repos/{owner}/{repo}/codespaces',
      {owner:t.owner,repo:a.repo,ref:a.ref,machine:a.machine});
  },
  readAfter:async({ctx,target:t,response:r})=>{
    const name=r?.data?.name;
    if(!name)throw refusal('Codespace name was not returned.');
    return codespace(ctx,t,name);
  },
  verify:({args:a,after:x,target:t})=>x?.name&&
    x.repository?.full_name?.toLowerCase()===(t.owner+'/'+a.repo).toLowerCase()&&
    x.machine?.name===a.machine,
  inverse:()=>null,present:({after:x})=>({name:x?.name,state:x?.state,
    billable_owner:x?.billable_owner?.login??null})
});
export const codespaceState=defineGithubWrite({
  name:'github_codespace_set_state',area:'codespace',audience:['O','B'],
  description:'Start or stop an authorized user Codespace with current state, optional hourly price and independent readback.',
  properties:{owner:OWNER,name:codespaceName,
    action:{type:'string',enum:['start','stop']},estimatedHours:HOURS},
  required:['name','action'],
  declarations:{production:'when-target',confirm:'always',spend:true,cred:'U',profiles:['full']},
  target:stateTarget,
  read:(a,c,t)=>codespace(c,t,a.name),
  price:({args:a,before:b})=>{
    if(a.action==='stop')return 0;
    if(!b?.machine?.cpus||!a.estimatedHours)return NaN;
    return codespacesComputeCents(b.machine.cpus,a.estimatedHours);
  },
  classify:({args:a})=>({production:a.action==='start'?
    'resumes metered Codespaces compute':'stops current compute spending'}),
  summarize:({args:a,before:b})=>(a.action==='start'?'START':'STOP')+
    ' Codespace '+a.name+' previously '+(b?.state??'unreadable')+
    (a.action==='start'?'; estimated runtime '+a.estimatedHours+' hours':''),
  apply:async({args:a,ctx,target:t,before:b})=>{
    if(!b?.name||b.name!==a.name)throw refusal('Codespace was not verified.');
    if(a.action==='start'&&['Available','Starting'].includes(b.state))
      throw refusal('Codespace is already running or starting.');
    if(a.action==='stop'&&['Shutdown','Stopping'].includes(b.state))
      throw refusal('Codespace is already stopped or stopping.');
    const {gh}=await userCtx(ctx,t);
    return gh.request('POST /user/codespaces/{codespace_name}/'+a.action,
      {codespace_name:a.name});
  },
  readAfter:({args:a,ctx,target:t})=>codespace(ctx,t,a.name),
  verify:({args:a,after:x})=>a.action==='start'?
    ['Available','Starting'].includes(x?.state):
    ['Shutdown','Stopping'].includes(x?.state),
  inverse:()=>null,present:({after:x})=>({name:x?.name,state:x?.state})
});
export const codespaceDelete=defineGithubWrite({
  name:'github_codespace_delete',area:'codespace',audience:['O','B'],
  description:'Delete an exact user Codespace after warning about unpushed and uncommitted work; confirm absence.',
  properties:{owner:OWNER,name:codespaceName},required:['name'],
  declarations:{production:'always',confirm:'always',cred:'U',profiles:['full']},
  target:stateTarget,read:(a,c,t)=>codespace(c,t,a.name),
  classify:()=>({production:'deletes an active development environment and its files'}),
  summarize:({args:a,before:b})=>'DELETE Codespace '+a.name+
    '; '+(b?.git_status?.has_unpushed_changes||b?.git_status?.has_uncommitted_changes?
      'WARNING: unpushed or uncommitted changes WILL BE LOST':
      'no unpushed changes were reported; recheck before deletion'),
  apply:async({args:a,ctx,target:t,before:b})=>{
    if(!b?.name)throw refusal('Exact Codespace baseline missing.');
    const {gh}=await userCtx(ctx,t);
    return gh.request('DELETE /user/codespaces/{codespace_name}',
      {codespace_name:a.name});
  },
  readAfter:({args:a,ctx,target:t})=>codespace(ctx,t,a.name),
  verify:({after:x})=>x===null,inverse:()=>null,
  present:({args:a})=>({name:a.name,deleted:true})
});
export const tools=[budgetSave.tool,copilotAdd.tool,copilotRemove.tool,
  codespaceCreate.tool,codespaceState.tool,codespaceDelete.tool];
export const handlers=Object.fromEntries([
  [budgetSave.tool,budgetSave.handler],
  [copilotAdd.tool,copilotAdd.handler],[copilotRemove.tool,copilotRemove.handler],
  [codespaceCreate.tool,codespaceCreate.handler],
  [codespaceState.tool,codespaceState.handler],
  [codespaceDelete.tool,codespaceDelete.handler]
].map(([t,h])=>[t.name,h]));
