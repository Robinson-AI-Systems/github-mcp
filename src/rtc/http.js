// RTC read-only HTTPS integration. Reuses the MCP dispatcher; never accepts OAuth tokens as RTC passes.
import {randomBytes} from 'node:crypto';
import {RULES,sizeOf} from '../core/result-rules.js';
import {containsCredential} from '../tools/util.js';
import {rtcBatchReply} from './batch.js';
import {rtcDiscoveryReply} from './discovery.js';
import { areaOf } from '../core/meta.js';
import {validateArgs} from '../core/validate.js';
import { rtcMetadata,rtcManifest,rtcOpenApi } from './contract.js';
import {RTC_HTTP_AREAS,rtcHttpTools,rtcIdentity} from './scope.js';
import {toolsForProfile} from '../core/registry.js';
import {connectionFromPass,passRefusal,passTools} from './pass-scope.js';

const MAX_REQUEST_BYTES=32768;
// MCP's public large replies can keep full JSON only in content to save agent
// context. The RTC adapter still needs the complete checked value to preserve
// its 8 KiB-or-handle contract; never return the slim metadata as full data.
export function completeDispatchResult(output) {
  const value = output?.structuredContent;
  if (value?.full_payload_location !== 'content[0].text') return value;
  if (value.full_payload_format !== 'json' || output.content?.length !== 1 ||
      output.content[0]?.type !== 'text') throw new Error('Incomplete canonical result');
  const parsed = JSON.parse(output.content[0].text);
  if (!parsed || typeof parsed !== 'object') throw new Error('Invalid canonical result');
  return parsed;
}
// JSON has already been parsed by the HTTP door. Bound the complete wire
// payload before allowing a tool dispatch, including multibyte strings.
function boundedRequest(value,headers={}) {
  // JSON parsing discards raw whitespace and escapes. Reject declared
  // oversized wire bodies even if the parsed object is tiny.
  const declared=headers?.['content-length'];
  if(declared!==undefined&&
    (typeof declared!=='string'||!/^(0|[1-9][0-9]*)$/.test(declared)||
      !Number.isSafeInteger(Number(declared))||Number(declared)>MAX_REQUEST_BYTES))
    return false;
  try {
    const json=JSON.stringify(value);
    return typeof json==='string'&&Buffer.byteLength(json,'utf8')<=MAX_REQUEST_BYTES;
  }catch{
    return false;
  }
}
const messages={
  permission:'Owner-issued RTC pass required.',pass_expired:'RTC pass expired.',
  pass_revoked:'RTC pass revoked.',refused_by_guard:'Operation outside read-only scratch permission.',
  rate_limited:'Rate limit reached.',invalid_args:'Invalid request.',
  not_found:'Tool or result not found.',service_error:'RTC service unavailable.'
};
export const rtcError=(code,what)=>({ok:false,error:{code,what:what??messages[code]??'Request refused.',
  cause:code,todo:code==='rate_limited'?'Retry after Retry-After.':'Check authorization and input.',technical:''}});
const send=(res,status,value)=>{
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  return res.status(status).json(value);
};
const name=(req,key)=>{
  const value=req.query?.[key];
  return typeof value==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(value)?value:null;
};
const deny=(res,status,body)=>{send(res,status,body);return null;};
function parseResultQuery(query={}) {
  const paging={};
  for(const [key,min,max] of [['page',1,100000],['pageSize',1,100],['offset',0,100000000]]){
    if(query[key]===undefined)continue;
    const value=query[key];
    if(typeof value!=='string'||!/^[0-9]+$/.test(value))return null;
    const num=Number(value);
    if(!Number.isSafeInteger(num)||num<min||num>max)return null;
    paging[key]=num;
  }
  if(query.fields!==undefined){
    const values=Array.isArray(query.fields)?query.fields:[query.fields];
    if(values.some(v=>typeof v!=='string'))return null;
    const fields=values.flatMap(v=>v.split(','));
    if(fields.length<1||fields.length>20||fields.some(v=>!v||v.length>64))return null;
    paging.fields=fields;
  }
  if(Object.keys(query).some(k=>!['handle','page','pageSize','offset','fields'].includes(k)))return null;
  return paging;
}
function parseToolsQuery(query={}) {
  if(!query||typeof query!=='object'||Array.isArray(query)||
    Object.keys(query).some(k=>!['limit','page','q','area','audience','listing'].includes(k)))
    return null;
  const numeric=(key,fallback,max)=>{
    const value=query[key];
    if(value===undefined)return fallback;
    if(typeof value!=='string'||!/^[0-9]+$/.test(value))return null;
    const n=Number(value);
    return Number.isSafeInteger(n)&&n>=1&&n<=max?n:null;
  };
  const limit=numeric('limit',20,100),page=numeric('page',1,1000);
  if(limit===null||page===null)return null;
  const bounded=(key,max)=>{
    const value=query[key]??'';
    return typeof value==='string'&&value.length<=max?value:null;
  };
  const q=bounded('q',200),area=bounded('area',64),audience=bounded('audience',64);
  const listing=query.listing??'compact';
  if(q===null||area===null||audience===null||
    !['catalog','compact'].includes(listing))return null;
  return {limit,page,q:q.toLowerCase(),area,audience,listing};
}
async function authenticate(req,res,db,{consumeRate=true,expectedAuthority=null}={}){
  const bearer=/^Bearer (rtc_pass_[A-Za-z0-9_-]{43})$/.exec(String(req.headers?.authorization??''));
  if(!bearer)return deny(res,401,rtcError('permission'));
  const row=await db.getRtcPass(bearer[1]);
  if(!row)return deny(res,401,rtcError('permission'));
  if(row.revoked_at)return deny(res,401,rtcError('pass_revoked'));
  if(!(Date.parse(row.expires_at)>Date.now()))return deny(res,401,rtcError('pass_expired'));
  if(row.grant){
    // A scoped pass: its own stored restrictions decide, and the account must still be able to carry them.
    if(!/^rtc-[a-f0-9]{24}$/.test(row.client_id??'')||!['preview','production'].includes(row.mode)||
      !['read_only','everyday','full'].includes(row.profile)||
      (row.profile==='read_only'&&row.grant.allow_writes===true))
      return deny(res,403,rtcError('refused_by_guard'));
    const owner=await db.getAccount(row.default_account);
    if(!owner||owner.login!==row.default_account||owner.installation_status!=='active'||
      (row.mode==='production'&&owner.production_enabled!==true))
      return deny(res,403,rtcError('refused_by_guard'));
    const scoped=connectionFromPass(row);
    if(expectedAuthority&&(scoped.client_id!==expectedAuthority.client_id||
      scoped.default_account!==expectedAuthority.default_account))
      return deny(res,403,rtcError('refused_by_guard'));
    if(consumeRate&&!await db.consumeRtcPassRate(bearer[1])){
      res.setHeader('Retry-After','60');
      return deny(res,429,rtcError('rate_limited'));
    }
    return scoped;
  }
  if(row.mode!=='preview'||row.profile!=='read_only'||row.listing!=='compact'||
    !/^rtc-[a-f0-9]{24}$/.test(row.client_id??'')||
    !Array.isArray(row.accounts)||row.accounts.length!==1||
    row.accounts[0]!==row.default_account||
    !Array.isArray(row.areas)||row.areas.length!==2||
    !RTC_HTTP_AREAS.every(area=>row.areas.includes(area))||
    row.allow_writes!==false||row.production_access!==false||
    Number(row.money_limit_cents)!==0)
    return deny(res,403,rtcError('refused_by_guard'));
  const account=await db.getAccount(row.default_account);
  if(!account||account.login!==row.default_account||account.is_scratch!==true||
    account.production_enabled!==false||account.account_type!=='Organization'||
    account.installation_status!=='active'||account.repository_selection!=='all')
    return deny(res,403,rtcError('refused_by_guard'));
  // A still-valid pass may be re-scoped while a read is in flight. Its
  // new authority must not release results fetched for the previous owner,
  // or mix two owners inside one batch, even if both are scratch accounts.
  // Refuse scope drift before consuming a rate unit for the next read.
  if(expectedAuthority&&(row.client_id!==expectedAuthority.client_id||
    row.default_account!==expectedAuthority.default_account))
    return deny(res,403,rtcError('refused_by_guard'));
  if(consumeRate&&!await db.consumeRtcPassRate(bearer[1])){
    res.setHeader('Retry-After','60');
    return deny(res,429,rtcError('rate_limited'));
  }
  return {client_id:row.client_id,default_account:row.default_account,
    accounts:[row.default_account],areas:[...row.areas],mode:'preview',profile:'read_only',listing:'compact'};
}
// The canonical MCP read is limited to 8 KiB, but the RTC wire envelope adds
// fields around it. Never send an oversized success or silently drop a result.
// Retain the already-shaped value under the current connection; a retained
// canonical handle is preferable to a second copy when one already exists.
async function readEnvelope({tool,args,value,connection,db}){
  const kept=value?.kept_result;
  const existing=kept?.handle && /^res_[A-Za-z0-9_-]{20,64}$/.test(kept.handle)
    ? kept.handle : null;
  // Canonical dispatch can return a shortened preview when its 24h result
  // store is down. That is an honest standalone MCP fallback but cannot
  // satisfy RTC's complete-result-or-handle HTTPS contract. Never send an
  // incomplete payload as HTTP 200, even if the small preview fits the wire.
  if(value&&typeof value==='object'&&Object.hasOwn(value,'kept_result')&&!existing)
    throw new Error('RTC canonical result has no retrievable handle');
  const body=existing
    ? {ok:true,result:(({kept_result: _kept,...rest})=>rest)(value),
      handle:existing,summary:String(kept.what??'Large result'),mode:connection.mode}
    : {ok:true,result:value,mode:connection.mode};
  // The canonical dispatcher screens its own reads, but the independent
  // HTTPS response boundary must not rely on that implicit guarantee.
  // Screen even small inline replies and reused-handle summaries, not only
  // oversized responses about to be written to retention.
  if(containsCredential(JSON.stringify(body)))
    throw new Error('Unsafe RTC read envelope');
  if(sizeOf(body)<=RULES.maxBytes)return body;
  // The canonical read has already retained its original complete value.
  // A second 8 KiB page would simply reproduce the same oversized wrapper.
  if(existing)return {ok:true,result:{note:'Read the retained handle in smaller pages or fields.'},
    handle:existing,summary:'Read result retained',mode:connection.mode};
  if(tool==='github_get_result'&&args?.handle)
    return {ok:true,result:{note:'Page exceeds the wire budget. Use a smaller pageSize or fewer fields.'},
      handle:args.handle,summary:'Use narrower result paging',mode:connection.mode};
  if(!connection?.client_id||typeof db?.putResult!=='function')
    throw new Error('RTC result retention unavailable');
  const handle='res_'+randomBytes(16).toString('base64url');
  // Store shaped, credential-screened data, not provider payloads.
  // On storage failure, the caller sends sanitized 503, never truncated success.
  await db.putResult({handle,connection:connection.client_id,
    summary:'RTC read result',body:value});
  return {ok:true,result:{},handle,summary:'Complete read retained for paging',
    mode:connection.mode};
}


// A change has already happened (or been previewed/refused) by the time we answer, so the reply is sent as it is: it must not be
// withheld because the pass was revoked a moment later. The canonical write layer has screened and shaped the body.
async function writeReply({output,connection}){
  const body=completeDispatchResult(output);
  if(!body||typeof body!=='object')return {status:503,body:rtcError('service_error'),final:true};
  const status=body.status;
  if(status==='refused'||status==='refused_by_guard'){
    const what=typeof body.error==='string'?body.error.slice(0,300):undefined;
    return {status:403,body:rtcError('refused_by_guard',what),final:true};
  }
  if(status==='rejected'||status==='uncertain'||output.isError===true)
    return {status:503,body:rtcError('service_error',status==='uncertain'?'The result of this change is not known. Check it before trying again.':undefined),final:true};
  const wire={ok:true,result:body,mode:connection.mode};
  if(containsCredential(JSON.stringify(wire))||sizeOf(wire)>RULES.maxBytes)
    return {status:503,body:rtcError('service_error'),final:true};
  return {status:200,body:wire,final:true};
}

export function createRtcHttpHandler({db,registry,dispatch}){
  if(!db||!registry||typeof dispatch!=='function')
    throw new TypeError('RTC HTTP needs the existing guarded dispatcher.');
  const allowed=connection=>connection?.pass===true
    ?passTools(toolsForProfile(registry,connection.profile),connection):rtcHttpTools(registry);
  const changes=tool=>tool?.writes===true||(Array.isArray(tool?.delegatedWrites)&&tool.delegatedWrites.length>0);
  const run=async(tool,args,connection)=>{
    const selected=allowed(connection).find(t=>t.name===tool);
    if(!selected)return {status:403,body:rtcError('refused_by_guard')};
    // The same validator as the canonical MCP dispatcher distinguishes a
    // caller's malformed arguments from an unavailable upstream service.
    // Never label a provider failure as a request-validation error.
    if(validateArgs(selected.inputSchema,args))
      return {status:400,body:rtcError('invalid_args')};
    const outside=passRefusal({tool:selected,args,connection});
    if(outside)return {status:403,body:rtcError('refused_by_guard',outside)};
    const output=await dispatch({registry,name:tool,args,connection,db});
    if(changes(selected))return await writeReply({output,connection});
    if(tool==='github_get_result' && output?.isError===true &&
      output.failureCode==='retained_result_not_found')
      return {status:404,body:rtcError('not_found')};
    if(!output||typeof output!=='object'||output.isError===true||
      !Object.hasOwn(output,'structuredContent')||
      output.structuredContent===undefined)
      return {status:503,body:rtcError('service_error')};
    return {status:200,body:await readEnvelope({
      tool,args,value:completeDispatchResult(output),connection,db})};
  };
  return async(req,res,route)=>{
    if(route==='contract'||route==='openapi'){
      return req.method==='GET'
        ?send(res,200,route==='contract'?rtcManifest(registry):rtcOpenApi())
        :send(res,405,rtcError('invalid_args'));
    }
    try{
      const connection=await authenticate(req,res,db);
      if(!connection)return;
      // Read-only authorization may be revoked, expire or lose scratch ownership
      // while a provider/DB read is in flight. Do not release stale data after
      // completion; no second rate unit is charged for the final check.
      const sendCurrent=async body=>{
        const fresh=await authenticate(req,res,db,{
          consumeRate:false,expectedAuthority:connection});
        if(!fresh)return;
        return send(res,200,body);
      };
      if(route==='whoami'&&req.method==='GET')
        return await sendCurrent({ok:true,result:{profile:connection.profile,mode:connection.mode,
          areas:connection.areas??null,accounts:connection.accounts,repositories:connection.repos??null,
          allow_writes:connection.allow_writes===true,allow_access_changes:connection.allow_access_changes===true,
          production_access:connection.mode==='production',money_limit_cents:connection.spend_limit_cents??0,
          service_identity:rtcIdentity()}});
      if(route==='tools'&&req.method==='GET'){
        const query=parseToolsQuery(req.query);
        if(!query)return send(res,400,rtcError('invalid_args'));
        const {limit,page,q,area,audience,listing}=query;
        let tools=allowed(connection).filter(t=>(!area||areaOf(t)===area)&&
          (!audience||rtcMetadata(t).audience.includes(audience))&&
          (!q||t.name.toLowerCase().includes(q)||t.description.toLowerCase().includes(q)));
        if(listing==='compact')tools=tools.filter(t=>t.compact===true);
        const start=(page-1)*limit;
        const reply=await rtcDiscoveryReply({
          tools:tools.slice(start,start+limit).map(rtcMetadata),count:tools.length,
          next:start+limit<tools.length?page+1:null,connection,db});
        return await sendCurrent(reply);
      }
      if(route==='tool'){
        const tool=name(req,'name');
        if(!tool||!allowed(connection).some(t=>t.name===tool)){
          // A scoped pass that asks for a real tool outside its scope is refused, not told the tool does not exist.
          if(tool&&connection.pass===true&&req.method==='POST'&&registry.tools.some(t=>t.name===tool))
            return send(res,403,rtcError('refused_by_guard','This pass is not allowed to use that tool.'));
          return send(res,404,rtcError('not_found'));
        }
        if(req.method==='GET'){
          const reply=await readEnvelope({tool:'rtc_describe_metadata',args:{},
            value:rtcMetadata(allowed(connection).find(t=>t.name===tool)),connection,db});
          return await sendCurrent(reply);
        }
        if(req.method!=='POST'||!req.body||typeof req.body!=='object'||
          Array.isArray(req.body)||!boundedRequest(req.body,req.headers))
          return send(res,400,rtcError('invalid_args'));
        const result=await run(tool,req.body,connection);
        return result.status===200&&!result.final?await sendCurrent(result.body)
          :send(res,result.status,result.body);
      }
      if(route==='batch'){
        const calls=req.body?.calls;
        if(req.method!=='POST'||!req.body||typeof req.body!=='object'||
          Array.isArray(req.body)||Object.keys(req.body).some(k=>k!=='calls')||
          !boundedRequest(req.body,req.headers)||!Array.isArray(calls)||calls.length===0||calls.length>10)
          return send(res,400,rtcError('invalid_args'));
        // Reject the whole batch before dispatching any read. A malformed later item
        // must not cause earlier reads to be executed under ambiguous arguments.
        if(calls.some(c=>!c||typeof c!=='object'||Array.isArray(c)||
          typeof c.name!=='string'||
          (c.args!==undefined&&(!c.args||typeof c.args!=='object'||Array.isArray(c.args)))||
          Object.keys(c).some(key=>key!=='name'&&key!=='args')))
          return send(res,400,rtcError('invalid_args'));
        const tools=allowed(connection);
        if(calls.some(c=>!tools.some(t=>t.name===c.name)||changes(tools.find(t=>t.name===c.name))))
          return send(res,403,rtcError('refused_by_guard','A batch runs reads only; call a change on its own.'));
        // Schema-check every item before the first read or additional rate unit.
        if(calls.some(c=>validateArgs(tools.find(t=>t.name===c.name).inputSchema,c.args??{})))
          return send(res,400,rtcError('invalid_args'));
        const results=[];
        let current=connection;
        for(let i=0;i<calls.length;i++){
          // A pass can be revoked, expire, or lose its verified scratch owner
          // between the individual reads. Recheck the current DB authority and
          // consume another shared rate unit before every subsequent dispatch.
          // Never continue with the original, potentially stale connection.
          if(i>0){
            current=await authenticate(req,res,db,{expectedAuthority:connection});
            if(!current)return;
          }
          const item=calls[i];
          const result=await run(item.name,item.args??{},current);
          if(result.status!==200)return send(res,result.status,result.body);
          // A retained result must remain retrievable after a batch call.
          // Its original connection-owned handle is never expanded here.
          results.push({name:item.name,ok:true,result:result.body.result,
            ...(result.body.handle?{handle:result.body.handle,summary:result.body.summary}:{})});
        }
        const reply=await rtcBatchReply({results,connection:current,db});
        return await sendCurrent(reply);
      }
      if(route==='results'){
        const handle=name(req,'handle');
        if(req.method!=='GET'||!handle||!/^res_[A-Za-z0-9_-]{20,64}$/.test(handle))
          return send(res,404,rtcError('not_found'));
        const paging=parseResultQuery(req.query);
        if(!paging)return send(res,400,rtcError('invalid_args'));
        // The canonical result handler performs the only owner-scoped lookup.
        // Its trusted typed absence signal becomes 404; all other dispatcher
        // or storage failures remain sanitized 503 without parsing error text.
        const result=await run('github_get_result',{handle,...paging},connection);
        return result.status===200?await sendCurrent(result.body)
          :send(res,result.status,result.body);
      }
      return send(res,404,rtcError('not_found'));
    }catch{
      return send(res,503,rtcError('service_error'));
    }
  };
}
