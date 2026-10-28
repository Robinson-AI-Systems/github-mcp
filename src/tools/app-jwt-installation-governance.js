import { redact } from './util.js';
// CAP-4: GitHub App JWT-only installation grants and installation requests.
// Distinct from user U / organization I installation visibility. The enrolled
// App OWNER is re-verified against GET /app before either JWT request. All
// returned records are strictly projected, never an App-global raw response.
import {defineRead} from './define-read.js';
import {plain} from './github-read.js';
import {appFor} from './app-jwt-read.js';

const OWNER={type:'string',minLength:1,maxLength:39};
const LIMIT={type:'integer',minimum:1,maximum:100};
const PAGE={type:'integer',minimum:1,maximum:10000};
const ROUTES={
  installation:'GET /app/installations/{installation_id}',
  requests:'GET /app/installation-requests'
};
const safe=(v,label,max=80)=>{
  if(typeof v!=='string'||!v||v.length>max||/[\x00-\x1F]/.test(v))
    throw new TypeError('GitHub returned invalid App '+label+'.');
  return v;
};
const grants=d=>{
  if(!d||typeof d!=='object'||Array.isArray(d)||
    Object.keys(d).length>64)
    throw new TypeError('GitHub returned unbounded App installation grants.');
  return Object.fromEntries(Object.entries(d).map(([key,value])=>{
    if(!/^[a-z][a-z0-9_]{0,69}$/.test(key)||
      !['read','write','admin'].includes(value))
      throw new TypeError('GitHub returned invalid App permission '+redact(key).slice(0,50));
    return [key,value];
  }).sort(([a],[b])=>a.localeCompare(b)));
};
const eventNames=d=>{
  if(!Array.isArray(d)||d.length>100)
    throw new TypeError('GitHub returned unbounded App event subscriptions.');
  const out=d.map(value=>safe(value,'event',80));
  if(new Set(out).size!==out.length)
    throw new TypeError('GitHub returned duplicate App event subscription.');
  return out;
};
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&
  a.toLowerCase()===b.toLowerCase();

export const appOwnerGrants=defineRead({
  name:'github_app_owner_installation_grants',area:'app',audience:['O'],
  description:'Read exact enrolled App JWT installation grants, events and suspension without exposing other installations or tokens.',
  properties:{owner:OWNER},
  handler:(args,ctx)=>plain(async()=>{
    const app=await appFor(args,ctx);
    const row=await ctx.db.getAccount(app.owner);
    const id=app.installationId;
    if(!Number.isSafeInteger(id)||id<1||row?.installation_id!==id||
      row.installation_status!=='active')
      throw new TypeError('An active exact enrolled App installation is required.');
    const d=(await app.gh.request(ROUTES.installation,{installation_id:id})).data;
    if(!d||d.id!==id||d.app_id!==app.appId||
      d.account?.id!==app.identity.owner_id||
      !same(d.account?.login,app.owner)||
      d.target_id!==app.identity.owner_id||
      d.target_type!==row.account_type)
      throw new TypeError('Provider App installation belongs to another principal.');
    if(!['all','selected'].includes(d.repository_selection))
      throw new TypeError('GitHub returned invalid repository selection.');
    const perms=grants(d.permissions);
    const events=eventNames(d.events);
    let suspended=null;
    if(d.suspended_at!==undefined&&d.suspended_at!==null){
      suspended=safe(d.suspended_at,'suspension date',64);
      if(!Number.isFinite(Date.parse(suspended)))
        throw new TypeError('GitHub returned invalid App suspension timestamp.');
    }
    const cached=row.installation_permissions &&
      typeof row.installation_permissions==='object'&&!Array.isArray(row.installation_permissions)
      ?row.installation_permissions:null;
    const cachedMatches=cached===null?null:
      JSON.stringify(grants(cached))===JSON.stringify(perms);
    return {org:app.owner,app_id:app.appId,installation_id:id,
      permissions:perms,events,repository_selection:d.repository_selection,
      suspended_at:suspended,cached_permissions_match:cachedMatches,
      source:'current GitHub App JWT installation read',
      note:'These are the provider-granted permissions for this exact installation; they are not proof of the consumer token scope.'};
  })
});

export const appOwnerRequests=defineRead({
  name:'github_app_owner_installation_requests',area:'app',audience:['O'],
  description:'View only the current enrolled account’s pending App installation requests within one bounded global JWT page.',
  properties:{owner:OWNER,max:LIMIT,page:PAGE},
  handler:(args,ctx)=>plain(async()=>{
    const app=await appFor(args,ctx);
    const max=args.max??30,page=args.page??1;
    const data=(await app.gh.request(ROUTES.requests,{per_page:max,page})).data;
    if(!Array.isArray(data)||data.length>max)
      throw new TypeError('GitHub returned an invalid App installation request page.');
    const matches=data.filter(x=>x&&typeof x==='object'&&!Array.isArray(x)&&
      x.account?.id===app.identity.owner_id&&same(x.account?.login,app.owner));
    const seen=new Set();
    const requests=matches.map(x=>{
      if(!Number.isSafeInteger(x.id)||x.id<1||seen.has(x.id)||
        !Number.isSafeInteger(x.requester?.id)||x.requester.id<1)
        throw new TypeError('GitHub returned invalid matching App request identity.');
      seen.add(x.id);
      const created=safe(x.created_at,'request timestamp',64);
      if(!Number.isFinite(Date.parse(created)))
        throw new TypeError('GitHub returned invalid App request timestamp.');
      return {id:x.id,requester_login:safe(x.requester.login,'requester login',39),
        created_at:created};
    });
    return {org:app.owner,app_id:app.appId,page,requests,shown:requests.length,
      complete:data.length<max,
      ...(data.length===max?{next_page_possible:page+1}:{}),
      note:'The GitHub App request feed is global; only requests for the exact enrolled account are shown. An empty page does not prove no further requests.'};
  })
});
export const tools=[appOwnerGrants.tool,appOwnerRequests.tool];
export const handlers={
  [appOwnerGrants.tool.name]:appOwnerGrants.handler,
  [appOwnerRequests.tool.name]:appOwnerRequests.handler
};
