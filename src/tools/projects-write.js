import { redact } from './util.js';
// F-3: guarded Projects v2 item membership and field editing, scoped to enrolled organizations.
import {listAll} from '../github/client.js';
import {defineGithubWrite} from './define-github-write.js';
import {missing,octo,ownerOf,refusal} from './github-write.js';

const OWNER={type:'string',maxLength:39},REPO={type:'string',minLength:1,maxLength:100};
const NUMBER={type:'integer',minimum:1};
const FIELD={type:'object',properties:{id:NUMBER,value:{type:['string','number','null']}},
  required:['id','value'],additionalProperties:false};
const target=(a,c)=>{
  if(a.action==='add'){
    if(!a.repo||!a.issueNumber||!a.contentType||a.itemId!==undefined||a.fields!==undefined)
      throw new TypeError('Add requires repo, issueNumber and contentType without itemId or fields.');
  }else if(a.action==='set_fields'){
    if(!a.itemId||!Array.isArray(a.fields)||!a.fields.length||a.fields.length>20||
      a.issueNumber!==undefined||a.contentType!==undefined||a.repo!==undefined)
      throw new TypeError('Set fields requires itemId and 1–20 fields, without repository content arguments.');
    if(new Set(a.fields.map(f=>f.id)).size!==a.fields.length)
      throw new TypeError('Each project field ID must occur only once.');
  }else throw new TypeError('Choose add or set_fields.');
  return {owner:ownerOf(a,c),...(a.repo?{repo:a.repo}:{}),scope:a.repo?'repo':'org'};
};
const p=(t,a)=>({org:t.owner,project_number:a.number});
const getProject=async(ctx,t,a)=>{
  const row=await ctx.db.getAccount(t.owner);
  if(row?.account_type!=='Organization')
    throw refusal('Only connected organization Projects v2 are supported with App credentials.');
  const gh=await octo(ctx,t.owner);
  const d=(await gh.request('GET /orgs/{org}/projectsV2/{project_number}',p(t,a))).data;
  if(!d||d.number!==a.number||!d.node_id)
    throw refusal('Exact organization project identity was not verified.');
  return d;
};
const getItem=(ctx,t,a,itemId)=>missing(async()=>
  (await(await octo(ctx,t.owner)).request(
    'GET /orgs/{org}/projectsV2/{project_number}/items/{item_id}',
    {...p(t,a),item_id:itemId,...(a.action==='set_fields'?{fields:a.fields.map(f=>f.id)}:{})})).data);
const readFull=(ctx,t,route,params,max)=>{
  return octo(ctx,t.owner).then(gh=>listAll(gh,route,{...params,per_page:100},{max}));
};
const containsContent=(item,src)=>item?.content?.id===src.id;
// GitHub returns a text value as {raw, html} and a single-select value as an object with an id (found by the first live test of the
// bulk edit); the tool sends plain text, numbers, dates and option ids. Compare, and build undo values, from the plain form.
const plainValue=(v)=>(v&&typeof v==='object'?(Object.hasOwn(v,'raw')?v.raw:Object.hasOwn(v,'id')?v.id:v):v);
const wantedValue=(row,v)=>Object.hasOwn(row,'value')&&plainValue(row.value)===v;
export const projectSetItem=defineGithubWrite({
  name:'github_project_set_item',area:'project',audience:['Op'],
  description:'Add a verified own-repository issue/PR to an organization project, or edit verified project item fields.',
  properties:{owner:OWNER,number:NUMBER,action:{type:'string',enum:['add','set_fields']},
    repo:REPO,issueNumber:NUMBER,contentType:{type:'string',enum:['Issue','PullRequest']},
    itemId:NUMBER,fields:{type:'array',minItems:1,maxItems:20,items:FIELD}},
  required:['number','action'],
  declarations:{production:'never',confirm:'always'},target,
  read:async(a,ctx,t)=>{
    const project=await getProject(ctx,t,a);
    if(a.action==='add'){
      const gh=await octo(ctx,t.owner);
      const route=a.contentType==='PullRequest'
        ?'GET /repos/{owner}/{repo}/pulls/{pull_number}'
        :'GET /repos/{owner}/{repo}/issues/{issue_number}';
      const params={owner:t.owner,repo:a.repo,
        ...(a.contentType==='PullRequest'?{pull_number:a.issueNumber}:{issue_number:a.issueNumber})};
      const source=(await gh.request(route,params)).data;
      if(!Number.isSafeInteger(source?.id)||source.id<1||
        (a.contentType==='Issue'&&source.pull_request))
        throw refusal('The requested issue/PR content identity is not verified.');
      const {items,capped}=await readFull(ctx,t,
        'GET /orgs/{org}/projectsV2/{project_number}/items',p(t,a),500);
      if(capped)throw refusal('Cannot rule out duplicate project membership in a truncated inventory.');
      if(items.some(item=>containsContent(item,source)))
        throw refusal('That issue or pull request is already in the project.');
      return {projectId:project.node_id,source};
    }
    const current=await getItem(ctx,t,a,a.itemId);
    if(!current||current.id!==a.itemId)throw refusal('The exact project item was not verified.');
    const {items:fields,capped}=await readFull(ctx,t,
      'GET /orgs/{org}/projectsV2/{project_number}/fields',p(t,a),200);
    if(capped)throw refusal('Project fields are truncated, so field IDs cannot be verified.');
    for(const f of a.fields)if(!fields.some(v=>v.id===f.id))
      throw refusal('Requested project field ID is not in this project.');
    return {projectId:project.node_id,current};
  },
  classify:()=>({}),
  summarize:({args:a,target:t})=>a.action==='add'
    ?`Add verified ${a.contentType} #${a.issueNumber} from ${t.owner}/${a.repo} to project #${a.number} (approval required)`
    :`Update ${a.fields.length} field(s) of project #${a.number} item #${a.itemId} in ${t.owner} (approval required)`,
  apply:async({args:a,ctx,target:t,before:b})=>{
    const gh=await octo(ctx,t.owner);
    if(a.action==='add')return gh.request('POST /orgs/{org}/projectsV2/{project_number}/items',
      {...p(t,a),type:a.contentType,id:b.source.id});
    return gh.request('PATCH /orgs/{org}/projectsV2/{project_number}/items/{item_id}',
      {...p(t,a),item_id:a.itemId,fields:a.fields});
  },
  readAfter:({args:a,ctx,target:t,response:r})=>
    getItem(ctx,t,a,a.action==='add'?r?.data?.value?.id:a.itemId),
  verify:({args:a,before:b,after:item,response:r})=>{
    if(!item||!Number.isSafeInteger(item.id))return false;
    if(a.action==='add')return item.id===r?.data?.value?.id&&
      containsContent(item,b.source)&&item.node_id===r?.data?.value?.node_id;
    return item.id===a.itemId&&a.fields.every(f=>
      (item.fields??[]).some(v=>v.id===f.id&&wantedValue(v,f.value)));
  },
  inverse:()=>null,
  present:({after:item})=>({id:item.id,node_id:item.node_id,content_id:item.content?.id??null,
    fields:(item.fields??[]).slice(0,20)})
});
export const projectRemoveItem=defineGithubWrite({
  name:'github_project_remove_item',area:'project',audience:['Op'],
  description:'Remove a verified organization project item, confirmed and independently read back as absent.',
  properties:{owner:OWNER,number:NUMBER,itemId:NUMBER},
  required:['number','itemId'],declarations:{production:'never',confirm:'always'},
  target:(a,c)=>({owner:ownerOf(a,c),scope:'org'}),
  read:async(a,ctx,t)=>{
    const project=await getProject(ctx,t,a);
    const current=await getItem(ctx,t,a,a.itemId);
    if(current&&current.id!==a.itemId)throw refusal('Project item identity mismatch.');
    return {projectId:project.node_id,current};
  },
  classify:()=>({}),
  summarize:({args:a,target:t})=>`REMOVE organization project #${a.number} item #${a.itemId} from ${t.owner}; stored field values may be lost`,
  apply:({args:a,ctx,target:t,before:b})=>{
    if(!b.current)throw refusal('Project item no longer exists. No deletion was sent.');
    return octo(ctx,t.owner).then(gh=>gh.request(
      'DELETE /orgs/{org}/projectsV2/{project_number}/items/{item_id}',
      {...p(t,a),item_id:a.itemId}));
  },
  readAfter:({args:a,ctx,target:t})=>getItem(ctx,t,a,a.itemId),
  verify:({after})=>after===null,inverse:()=>null,
  present:({args:a})=>({removed_item_id:a.itemId,field_values_lost:true})
});

// ---- PAR-1: edit many project items in one call ---------------------------------------------------------------------------------------
// 40 items at most (the official server allows 50): writes are spaced one per second per installation and a function may run 60
// seconds, so 40 updates plus the reads fit with room to spare. Every id is verified before the first change; the first failure
// stops the run (nothing is retried) and the result says which items were done and which were not tried.
const MAX_BULK_ITEMS=40;
const BULK_ITEM={type:'object',properties:{itemId:NUMBER,fields:{type:'array',minItems:1,maxItems:20,items:FIELD}},
  required:['itemId','fields'],additionalProperties:false};
const getItemFields=(ctx,t,a,itemId,fieldIds)=>missing(async()=>
  (await(await octo(ctx,t.owner)).request(
    'GET /orgs/{org}/projectsV2/{project_number}/items/{item_id}',
    {...p(t,a),item_id:itemId,fields:fieldIds})).data);
const bulkFieldIds=item=>item.fields.map(f=>f.id);
export const projectSetItems=defineGithubWrite({
  name:'github_project_set_items',area:'project',audience:['Op'],
  description:'Edit field values on up to 40 items of an organization project in one approved call; stops at the first failure.',
  properties:{owner:OWNER,number:NUMBER,items:{type:'array',minItems:1,maxItems:MAX_BULK_ITEMS,items:BULK_ITEM}},
  required:['number','items'],
  declarations:{production:'never',confirm:'always'},
  target:(a,c)=>{
    if(new Set(a.items.map(i=>i.itemId)).size!==a.items.length)
      throw new TypeError('Each project item ID must occur only once.');
    for(const item of a.items)if(new Set(bulkFieldIds(item)).size!==item.fields.length)
      throw new TypeError('Each project field ID must occur only once per item.');
    return {owner:ownerOf(a,c),scope:'org'};
  },
  read:async(a,ctx,t)=>{
    const project=await getProject(ctx,t,a);
    const {items:fields,capped}=await readFull(ctx,t,
      'GET /orgs/{org}/projectsV2/{project_number}/fields',p(t,a),200);
    if(capped)throw refusal('Project fields are truncated, so field IDs cannot be verified.');
    for(const item of a.items)for(const f of item.fields)if(!fields.some(v=>v.id===f.id))
      throw refusal(`Field ${f.id} (item ${item.itemId}) is not in this project; nothing was changed.`);
    const current={};
    for(const item of a.items){
      const row=await getItemFields(ctx,t,a,item.itemId,bulkFieldIds(item));
      if(!row||row.id!==item.itemId)
        throw refusal(`Project item ${item.itemId} was not verified; nothing was changed.`);
      current[item.itemId]=row;
    }
    return {projectId:project.node_id,current};
  },
  classify:()=>({}),
  summarize:({args:a,target:t})=>`Update ${a.items.length} item(s) (${a.items.reduce((n,i)=>n+i.fields.length,0)} field values) in project #${a.number} of ${t.owner} (approval required)`,
  apply:async({args:a,ctx,target:t})=>{
    const gh=await octo(ctx,t.owner);
    const done=[];let failed=null;
    for(const item of a.items){
      try{
        await gh.request('PATCH /orgs/{org}/projectsV2/{project_number}/items/{item_id}',
          {...p(t,a),item_id:item.itemId,fields:item.fields});
        done.push(item.itemId);
      }catch(error){
        failed={itemId:item.itemId,reason:redact(String(error?.message??error)).slice(0,200)};
        break; // never retry (A8)
      }
    }
    return {done,failed,notTried:a.items.map(i=>i.itemId).filter(id=>!done.includes(id)&&id!==failed?.itemId)};
  },
  readAfter:async({args:a,ctx,target:t,response:r})=>{
    const rows={};
    for(const item of a.items)if(r.done.includes(item.itemId))
      rows[item.itemId]=await getItemFields(ctx,t,a,item.itemId,bulkFieldIds(item));
    return {rows,done:r.done,failed:r.failed,notTried:r.notTried};
  },
  verify:({args:a,after})=>after.failed===null&&after.done.length===a.items.length&&
    a.items.every(item=>{
      const row=after.rows[item.itemId];
      return row?.id===item.itemId&&item.fields.every(f=>(row.fields??[]).some(v=>v.id===f.id&&wantedValue(v,f.value)));
    }),
  inverse:({args:a,before:b,after})=>{
    const items=a.items.filter(i=>after.done.includes(i.itemId)).map(i=>({itemId:i.itemId,
      fields:i.fields.map(f=>({id:f.id,value:plainValue((b.current[i.itemId].fields??[]).find(v=>v.id===f.id)?.value)??null}))}));
    return items.length?{tool:'github_project_set_items',args:{number:a.number,items}}:null;
  },
  present:({args:a,after})=>({
    updated:after.done.length,of:a.items.length,done:after.done,failed:after.failed,not_tried:after.notTried,
    ...(after.failed?{note:`Updated ${after.done.length} of ${a.items.length} items; stopped at item ${after.failed.itemId} (${after.failed.reason}); ${after.notTried.length} not tried. Nothing was retried.`}:{})})
});
export const tools=[projectSetItem.tool,projectSetItems.tool,projectRemoveItem.tool];
export const handlers={
  [projectSetItem.tool.name]:projectSetItem.handler,
  [projectSetItems.tool.name]:projectSetItems.handler,
  [projectRemoveItem.tool.name]:projectRemoveItem.handler
};
