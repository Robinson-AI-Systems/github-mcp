import { isOwnerConnection } from '../core/authority.js';
// U-1: universal REST is intentionally narrower than raw octokit: every request is
// pinned-schema validated, scoped, curated-first, and sent through the normal client.
import { defineRead } from './define-read.js';
import { defineGithubWrite } from './define-github-write.js';
import { githubFor } from '../github/client.js';
import { plain } from './github-read.js';
import { refusal } from './github-write.js';
import { restOperations,restOperation,validateRest,describeRest } from '../github/openapi-index.js';
import { classifyUniversal,assertUniversalAuthority,universalPrice } from '../github/operation-classes.js';
import { curatedTool } from '../github/hand-built-map.js';
import { requireEnterprise } from '../github/enterprise-access.js';

const OP={type:'string',minLength:2,maxLength:240,description:'Pinned operationId or METHOD /path'};
const PARAMS={type:'object',additionalProperties:true,maxProperties:60,description:'Only OpenAPI-defined path and query parameters'};
const BODY={type:'object',additionalProperties:true,description:'JSON request body, validated against the pinned GitHub schema'};
const OWNER={type:'string',minLength:1,maxLength:39};
const CRED={type:'string',enum:['I','U','P','M'],description:'I installation; U user; P enrolled package-only classic token; M your enrolled master token (only when the App cannot do it)'};
const queryProperties={operation:OP,params:PARAMS,body:BODY,owner:OWNER,cred:CRED};
const enterpriseRoute=(op)=>/^\/enterprises\/\{enterprise\}(?:\/|$)/.test(op.path);

function ownerFor(a,c,p) {
  const names=[a.owner,p.owner,p.org,p.username,p.account].filter(v=>typeof v==='string'&&v.length);
  const owner=String(names[0]??c.connection.default_account);
  if(names.some(n=>n.toLowerCase()!==owner.toLowerCase()))
    throw new TypeError('Universal operation account and path must belong to the same connected account.');
  if(!(c.connection.accounts??[]).some(n=>n.toLowerCase()===owner.toLowerCase()))
    throw new TypeError('Requested account is not enrolled in this connection.');
  return owner;
}
function scopeFor(a,c,p,op) {
  if (enterpriseRoute(op)) {
    const owner=c.connection.default_account;
    if (!owner || !(c.connection.accounts??[]).some(n=>n.toLowerCase()===owner.toLowerCase()) ||
        (a.owner && a.owner.toLowerCase()!==owner.toLowerCase()))
      throw new TypeError('Enterprise API calls use this connection\'s exact enrolled default account.');
    if (typeof p.enterprise!=='string' || !/^[a-z0-9][a-z0-9-]{0,59}$/.test(p.enterprise))
      throw new TypeError('The enterprise slug must be an exact, valid GitHub enterprise identifier.');
    return { owner, enterprise:p.enterprise,scope:'org',kind:'universal-enterprise' };
  }
  const owner=ownerFor(a,c,p);
  const repo=p.repo;
  if(repo!==undefined && (typeof repo!=='string'||!repo.trim()))
    throw new TypeError('A named repository must not be blank.');
  if(/\/repos\/\{owner\}\/\{repo\}/.test(op.path) && !repo)
    throw new TypeError('A repository operation needs an explicit repository.');
  return {owner, ...(repo?{repo}:{}),scope:repo?'repo':'org',
    kind:repo?'universal-repo':'universal-account'};
}
function credentials(a,op) {
  if(typeof a.cred!=='undefined' && !['I','U','P','M'].includes(a.cred))
    throw new TypeError('Only enrolled I, U, M and package-only P credentials are supported.');
  if (enterpriseRoute(op)) {
    if (a.cred!=='M') throw new TypeError('Enterprise REST operations require explicit cred: "M" (your enrolled master token).');
    return 'M';
  }
  const packages=/^\/(?:orgs\/\{org\}|users\/\{username\}|user)\/packages(?:\/|$)/.test(op.path);
  // M (master token) may reach package routes too; P stays package-only.
  if ((packages && a.cred !== 'P' && a.cred !== 'M') || (a.cred === 'P' && !packages))
    throw new TypeError('Package routes require explicitly enrolled P or M authorization; P cannot be used for other operations.');
  const userOnly=/^\/user(?:\/|$)/.test(op.path);
  if(userOnly && !packages && a.cred!=='U' && a.cred!=='M')
    throw new TypeError('This operation requires explicitly selected U or M authorization.');
  return a.cred??'I';
}
function resolve(a,c,methods,writing=false) {
  const op=restOperation(a.operation,methods);
  const params=a.params??{};
  // Validate and classify BEFORE any credential or provider request.
  validateRest(op,params,a.body);
  assertUniversalAuthority(op,params,a.body,{ownerDirected:isOwnerConnection(c.connection)});
  if(writing) {
    const curated=curatedTool(op);
    if(curated) throw new TypeError('The specialized '+curated+' tool must be used for this operation; universal access cannot bypass its checks.');
  }
  const target=scopeFor(a,c,params,op);
  const body=a.body??{};
  const reserved=new Set(['headers','request','mediaType','url','method','baseUrl']);
  for(const name of [...Object.keys(params),...Object.keys(body)]) {
    if(reserved.has(name))throw new TypeError('Transport override is not permitted: '+name);
    if(Object.hasOwn(params,name)&&Object.hasOwn(body,name))throw new TypeError('Body overrides a path/query value: '+name);
  }
  if(JSON.stringify({params,body}).length>32768)throw new TypeError('REST arguments exceed the safe request size.');
  const cred=credentials(a,op);
  if(writing && op.deprecated) throw new TypeError('Deprecated provider writes are refused until reviewed.');
  return {op,params,target,cred,request:{...params,...(a.body??{})}};
}
async function accountClient(ctx,target,cred) {
  // Fine-grained and U credentials cannot be narrowed per request.
  // An enrolled GitHub App can mint a scoped installation credential.
  const account=await ctx.db.getAccount(target.owner);
  return githubFor(ctx,{owner:target.owner,cred,
    ...(cred==='I'&&account?.credential_kind==='app'&&target.repo?
      {scope:{repositories:[target.repo]}}:{})});
}
async function requestFor(ctx,{target,cred,op,request}) {
  // A trusted master token does not by itself authorize an arbitrary enterprise.
  // Verify current GitHub ADMIN membership and the exact scope for every call.
  const gh=target.enterprise
    ? await requireEnterprise(ctx,target.enterprise,{scope:op.method==='GET'?'read:enterprise':'admin:enterprise'})
    : await accountClient(ctx,target,cred);
  return gh.request(op.route,request);
}
function safeDescription(op) {
  const mark=classifyUniversal(op);
  return {operationId:op.operationId,method:op.method,path:op.path,summary:op.summary,
    category:op.category,kind:op.method==='GET'?'read':'write',
    production:mark.production,accessWidening:mark.accessWidening,
    notifies:mark.notifies,spendRisk:mark.spendRisk,
    curated:curatedTool(op),deprecated:op.deprecated};
}
const apiSearch=defineRead({
  name:'github_api_search',area:'universal',audience:['B','O','Op'],
  description:'Find pinned GitHub REST operations by method, path, summary or category, with conservative safety labels.',
  properties:{query:{type:'string',minLength:1,maxLength:160},
    method:{type:'string',enum:['GET','POST','PUT','PATCH','DELETE']},
    max:{type:'integer',minimum:1,maximum:40}},required:['query'],
  handler:async a=>{
    const words=a.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let matches=0,items=[];
    for(const op of restOperations()) {
      if(a.method && op.method!==a.method)continue;
      const hay=(op.route+' '+op.summary+' '+op.operationId+' '+op.category).toLowerCase();
      if(!words.every(word=>hay.includes(word)))continue;
      matches++;
      if(items.length<(a.max??20))items.push(safeDescription(op));
    }
    return {pinnedVersion:'2026-03-10',count:matches,shown:items.length,more:matches>items.length,items};
  }
});
const apiDescribe=defineRead({
  name:'github_api_describe',area:'universal',audience:['B','O','Op'],
  description:'Describe one pinned REST operation, allowed inputs and its guarded or curated route.',
  properties:{operation:OP},required:['operation'],
  handler:async a=>{
    const op=restOperation(a.operation);
    return {...describeRest(op),safety:safeDescription(op)};
  }
});
const apiRead=defineRead({
  name:'github_api_read',area:'universal',audience:['B','O','Op'],
  description:'Run a validated pinned GitHub GET operation with scoped credentials and bounded retained results.',
  properties:{operation:OP,params:PARAMS,owner:OWNER,cred:CRED},required:['operation'],
  handler:(a,c)=>plain(async()=>{
    const result=resolve(a,c,['GET']);
    const response=await requestFor(c,result);
    return {operationId:result.op.operationId,route:result.op.route,status:response.status,
      data:response.data,scope:result.target.owner+(result.target.repo?'/'+result.target.repo:'')};
  })
});
function readRouteFor(op) {
  try{return restOperation('GET '+op.path,'GET');}catch{return null;}
}
// Baseline is obtained BEFORE the write and always scoped to the same account.
async function baseline(ctx,chosen) {
  const {op,params,target,cred}=chosen;
  // A no-GET enterprise mutation must never fall back to GET /orgs/{org}
  // (the enterprise is not an installed organization). Prove admin access
  // against the provider before proceeding, then report unconfirmed if no
  // exact independent readback exists.
  if (target.enterprise) await requireEnterprise(ctx,target.enterprise,{scope:'admin:enterprise'});
  const same=readRouteFor(op);
  if(same) {
    try {
      return {kind:'exact',state:(await requestFor(ctx,{...chosen,op:same,request:params})).data};
    } catch(error) {
      if(error?.status!==404)throw error;
      // A missing target is not a valid positive baseline for generic writes.
      return {kind:'absent',state:null};
    }
  }
  if(target.enterprise) return {kind:'enterprise-admin',state:{enterprise:target.enterprise}};
  if(target.repo) {
    const data=(await (await accountClient(ctx,target,cred))
      .request('GET /repos/{owner}/{repo}',{owner:target.owner,repo:target.repo})).data;
    if(data?.full_name && data.full_name.toLowerCase()!==(target.owner+'/'+target.repo).toLowerCase())
      throw refusal('The repository identity returned by GitHub did not match the requested target.');
    return {kind:'parent',state:{full_name:data.full_name,default_branch:data.default_branch}};
  }
  const org=(await (await accountClient(ctx,target,cred))
    .request('GET /orgs/{org}',{org:target.owner})).data;
  if(String(org?.login??'').toLowerCase()!==target.owner.toLowerCase())
    throw refusal('The account identity returned by GitHub did not match.');
  return {kind:'parent',state:{login:org.login}};
}
function beforeFingerprint(value){return JSON.stringify(value??null);}
const apiWrite=defineGithubWrite({
  name:'github_api_write',area:'universal',audience:['B','O','Op'],
  description:'PRODUCTION: Execute validated non-curated REST writes with delegated billing warnings, scoped guards and confirmation.',
  properties:queryProperties,required:['operation'],
  declarations:{production:'when-target',accessWidening:true,notifies:true,spend:true,confirm:'always',cred:'I,U,P,M',profiles:['full']},
  target:(a,c)=>resolve(a,c,['POST','PUT','PATCH','DELETE'],true).target,
  read:async(a,c)=>baseline(c,resolve(a,c,['POST','PUT','PATCH','DELETE'],true)),
  price:({args:a,ctx:c})=>universalPrice(resolve(a,c,['POST','PUT','PATCH','DELETE'],true).op),
  classify:({args:a,ctx:c,target:t,before})=>{
    const {op}=resolve(a,c,['POST','PUT','PATCH','DELETE'],true);
    const classed=classifyUniversal(op);
    return {production:classed.production?'universal '+op.method+' operation on '+t.owner:null,
      accessWidening:classed.accessWidening?'unclassified privilege implications require independent approval':null,
      notifies:classed.notifies?[t.owner+' (GitHub notification recipients must be verified)']:[],
      ...(before?.kind==='absent'?{production:'the existing object was not readable'}:{})};
  },
  summarize:({args:a,ctx:c,target:t,before})=>{
    const {op}=resolve(a,c,['POST','PUT','PATCH','DELETE'],true);
    return op.method+' '+op.path+' ('+String(op.summary).slice(0,120)+') on '+t.owner+
      (t.repo?'/'+t.repo:'')+'; existing baseline: '+(before?.kind??'unreadable')+
      '; intended JSON fields: '+Object.keys(a.body??{}).join(',').slice(0,180);
  },
  apply:async({args:a,ctx:c})=>{
    const chosen=resolve(a,c,['POST','PUT','PATCH','DELETE'],true);
    return requestFor(c,chosen);
  },
  readAfter:async({args:a,ctx:c,response})=>{
    const chosen=resolve(a,c,['POST','PUT','PATCH','DELETE'],true);
    const same=readRouteFor(chosen.op);
    if(!same)return {independentlyRead:false,receipt:{status:response?.status,
      identifier:response?.data?.id??response?.data?.node_id??response?.data?.number??null}};
    if(chosen.op.method==='DELETE'){
      // A delete is confirmed by the same object no longer being readable (HTTP 404); anything still readable is not confirmed.
      try{
        const still=await requestFor(c,{...chosen,op:same,request:chosen.params});
        // A single setting (for example interaction limits) answers an empty object once removed, not 404 (seen live 2026-10-23).
        const emptied=still.data!==null&&typeof still.data==='object'&&!Array.isArray(still.data)&&Object.keys(still.data).length===0;
        return {independentlyRead:true,deleted:emptied,emptied,data:still.data};
      }catch(error){
        if(error?.status===404)return {independentlyRead:true,deleted:true,data:null};
        throw error;
      }
    }
    const after=await requestFor(c,{...chosen,op:same,request:chosen.params});
    return {independentlyRead:true,data:after.data};
  },
  verify:({args:a,before,after,response})=>{
    if(!after?.independentlyRead)return false;
    if(after.deleted!==undefined){
      if(after.emptied)return before?.kind==='exact'&&before.state!==null&&typeof before.state==='object'&&Object.keys(before.state).length>0;
      return after.deleted===true&&before?.kind==='exact';
    }
    if(before?.kind==='exact' && beforeFingerprint(before.state)===beforeFingerprint(after.data))
      return false;
    const changes=Object.entries(a.body??{});
    const holds=(item)=>item!==null&&typeof item==='object'&&changes.every(([key,value])=>
      Object.prototype.hasOwnProperty.call(item,key)&&beforeFingerprint(item[key])===beforeFingerprint(value));
    // An accepted write without a matching independent read is NEVER claimed as confirmed.
    if(changes.length===0)return false;
    if(holds(after.data))return true;
    // A create is read back from its collection (for example {total_count, runner_groups:[...]}); the created item
    // must be in that list with every field we sent, and it must be the very item GitHub answered with when it gave an id.
    const id=response?.data?.id;
    const lists=Object.values(after.data??{}).filter(Array.isArray);
    if(Array.isArray(after.data))lists.push(after.data);
    return lists.some(list=>list.some(item=>holds(item)&&(id===undefined||id===null||item.id===id)));
  },
  present:({after,response})=>({status:response?.status??null,
    independentRead:after?.independentlyRead===true,
    state:after?.independentlyRead===true?after.data:null,
    receiptId:response?.data?.id??response?.data?.node_id??response?.data?.number??null}),
  inverse:()=>null
});
export const tools=[apiSearch.tool,apiDescribe.tool,apiRead.tool,apiWrite.tool];
export const handlers=Object.fromEntries([apiSearch,apiDescribe,apiRead,apiWrite].map(x=>[x.tool.name,x.handler]));
