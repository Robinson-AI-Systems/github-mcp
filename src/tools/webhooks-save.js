// H-2: create/update webhooks and independently rotate signing secrets.
// The service alone generates each 32-byte signing key. Raw provider objects,
// callback URLs and generated values must never enter the change journal.
import {randomBytes} from 'node:crypto';
import {ownerOneTimeStore} from './one-time-root.js';
import {publicHttpsUrl} from '../github/public-url.js';
import {defineGithubWrite} from './define-github-write.js';
import {octo,ownerOf,missing,refusal,slug} from './github-write.js';

const OWNER={type:'string',maxLength:39},REPO={type:'string',minLength:1,maxLength:100};
const ID={type:'integer',minimum:1};
const URL={type:'string',minLength:12,maxLength:2048};
const EVENTS={type:'array',minItems:1,maxItems:50,uniqueItems:true,
  items:{type:'string',minLength:1,maxLength:100,pattern:'^[a-zA-Z_*][a-zA-Z0-9_*-]*$'}};
const BASE={owner:OWNER,repo:REPO,scope:{type:'string',enum:['repo','org']}};
const PARAMS=(t)=>t.scope==='org'?{org:t.owner}:{owner:t.owner,repo:t.repo};
const ROUTE=(t,suffix='')=>(t.scope==='org'?'/orgs/{org}/hooks':'/repos/{owner}/{repo}/hooks')+suffix;
const target=(a,c)=>{
  if(a.scope==='org'&&a.repo)throw new TypeError('An organization webhook does not target a repository.');
  if(a.scope!=='org'&&!a.repo)throw new TypeError('A repository webhook needs its repository.');
  return {owner:ownerOf(a,c),scope:a.scope==='org'?'org':'repo',
    ...(a.scope==='org'?{}:{repo:a.repo}),kind:'repo-settings'};
};
const label=t=>t.scope==='org'?t.owner:slug(t.owner,t.repo);
const destination=url=>{
  try{return publicHttpsUrl(url).hostname;}
  catch{throw refusal('Webhook target must be public HTTPS without credentials, IP literals or private hostnames.');}
};
const secretStore=ctx=>ownerOneTimeStore(ctx); // ONE-TIME-ROOT-1: the root store, where the setup page reveals
const safeHook=(raw,expectedId=null,desired={})=>{
  if(!raw||!Number.isSafeInteger(raw.id)||raw.id<1||
    expectedId!==null&&raw.id!==expectedId)
    throw refusal('GitHub webhook identity could not be independently confirmed.');
  const x=raw.config??{},host=typeof x.url==='string'?destination(x.url):null;
  return {id:raw.id,name:raw.name??null,host,active:raw.active===true,
    events:Array.isArray(raw.events)?raw.events.slice(0,100):[],
    content_type:x.content_type??null,
    secure_tls:String(x.insecure_ssl??'0')!=='1',
    updated_at:raw.updated_at??null,
    ...(desired.url!==undefined?{url_matches:x.url===desired.url}:{}),
    ...(desired.contentType!==undefined?{content_type_matches:x.content_type===desired.contentType}:{})};
};
const fetchHook=async(ctx,t,id,desired={})=>{
  const gh=await octo(ctx,t.owner);
  const raw=await missing(async()=>(await gh.request('GET '+ROUTE(t,'/{hook_id}'),
    {...PARAMS(t),hook_id:id})).data);
  return raw?safeHook(raw,id,desired):null;
};
const safeExisting=before=>{
  if(!before?.hook)throw refusal('The named existing webhook does not exist.');
  if(!before.hook.host||!before.hook.secure_tls)
    throw refusal('An existing webhook with an unsafe or unverifiable HTTPS destination cannot be changed.');
};
const oneTime=async(ctx,value,owner)=>{
  const one=await secretStore(ctx).issue({account:owner,kind:'github-webhook-signing-secret',secret:value});
  return one.setupPath;
};
const makeKey=()=>randomBytes(32).toString('hex');
const saveProps={...BASE,hookId:ID,url:URL,events:EVENTS,active:{type:'boolean'},
  contentType:{type:'string',enum:['json','form']}};
const save=defineGithubWrite({
  name:'github_webhook_save',area:'webhook',audience:['B','O'],
  description:'Create or update one webhook with a server-generated signing secret, revealed only on the private setup page.',
  properties:saveProps,
  declarations:{production:'always',confirm:'always',profiles:['full']},
  target,
  read:async(a,ctx,t)=>{
    secretStore(ctx); // Missing encryption never reaches an outbound provider mutation.
    if(a.hookId)return {hook:await fetchHook(ctx,t,a.hookId)};
    if(!a.url||!a.events?.length)
      throw refusal('New webhook needs a public HTTPS URL and at least one event.');
    return {hook:null};
  },
  classify:()=>({production:'creates or changes a GitHub event delivery subscription and rotates its signing secret'}),
  summarize:({args:a,target:t,before:b})=>{
    if(a.url)destination(a.url);
    if(a.hookId)safeExisting(b);
    const host=a.url?destination(a.url):b?.hook?.host;
    if(!host)throw refusal('Webhook callback destination cannot be verified.');
    if(a.hookId&&!a.url&&b.hook.host===null)
      throw refusal('Existing webhook destination is not public HTTPS.');
    if(!a.hookId&&(!a.events||!a.events.length))
      throw refusal('New webhook needs events.');
    return (a.hookId?'UPDATE webhook #'+a.hookId:'CREATE webhook')+
      ' for '+label(t)+' at '+host+'; '+(a.events?.join(', ')??'retain subscribed events')+
      '; generate a NEW signing secret. Receiver configuration must be updated using the private one-time reveal.';
  },
  apply:async({args:a,ctx,target:t,before:b})=>{
    if(a.url)destination(a.url);
    if(a.hookId)safeExisting(b);
    else if(!a.url||!a.events?.length)throw refusal('New webhook requires URL and events.');
    const gh=await octo(ctx,t.owner);
    const value=makeKey();
    // On updates re-read full configuration transiently: GitHub may require
    // complete callback fields even in a PATCH. Never journal the raw URL.
    let originalUrl=null,originalType=null;
    if(a.hookId){
      const current=(await gh.request('GET '+ROUTE(t,'/{hook_id}'),
        {...PARAMS(t),hook_id:a.hookId})).data;
      if(current?.id!==a.hookId)throw refusal('Webhook changed before the update; refusing.');
      originalUrl=current.config?.url;
      originalType=current.config?.content_type;
      if(!originalUrl||destination(originalUrl)!==b.hook.host||
        !['json','form'].includes(originalType)||
        String(current.config?.insecure_ssl??'0')==='1')
        throw refusal('Existing callback configuration is incomplete or unsafe; no update was sent.');
    }
    const config={secret:value,insecure_ssl:'0',
      url:a.url??originalUrl,content_type:a.contentType??originalType};
    const fields={config,...(a.events?{events:a.events}:{}),
      ...(a.active!==undefined?{active:a.active}:{})};
    const response=await gh.request((a.hookId?'PATCH ':'POST ')+ROUTE(t,a.hookId?'/{hook_id}':''),
      {...PARAMS(t),...(a.hookId?{hook_id:a.hookId}:{name:'web'}),
        ...(!a.hookId?{active:a.active??true,events:a.events,
          config:{...config,content_type:a.contentType??'json'}}:fields)});
    const id=a.hookId??response.data?.id;
    if(!Number.isSafeInteger(id)||id<1)
      throw refusal('GitHub accepted the webhook but returned no exact ID; do not retry before reconciling.');
    // Only the owner passphrase + CSRF can consume this time-limited encrypted record.
    // Never return the generated value or raw Octokit response to the write layer.
    const reveal=await oneTime(ctx,value,t.owner);
    return {id,reveal};
  },
  readAfter:({args:a,ctx,target:t,response:r})=>
    fetchHook(ctx,t,r.id,{...(a.url?{url:a.url}:{}),
      ...(a.contentType?{contentType:a.contentType}:{})}),
  verify:({args:a,after:x})=>!!x&&
    x.secure_tls===true&&x.host!==null&&
    (a.url===undefined||x.url_matches===true)&&
    (a.contentType===undefined||x.content_type_matches===true)&&
    (a.active===undefined||x.active===a.active)&&
    (a.events===undefined||
      x.events.length===a.events.length&&a.events.every(e=>x.events.includes(e))),
  inverse:()=>null,
  present:({response:r,after:x})=>({
    webhook_id:r.id,hostname:x?.host??null,signing_secret_reveal:r.reveal,
    secret_expires_in_minutes:10,
    warning:'A receiver must be configured with the new secret. GitHub never returns its actual signing key for independent comparison.'})
});
const rotate=defineGithubWrite({
  name:'github_webhook_rotate_secret',area:'webhook',audience:['O'],
  description:'Replace one existing webhook signing secret; reveal the server-generated key once on the private setup page.',
  properties:{...BASE,hookId:ID},required:['hookId'],
  declarations:{production:'always',confirm:'always',profiles:['full']},
  target,
  read:async(a,ctx,t)=>{
    secretStore(ctx);
    return {hook:await fetchHook(ctx,t,a.hookId)};
  },
  classify:()=>({production:'rotates the signing secret of an existing GitHub webhook'}),
  summarize:({args:a,target:t,before:b})=>{
    safeExisting(b);
    return 'ROTATE the webhook signing secret of #'+a.hookId+' for '+label(t)+
      ' at '+b.hook.host+'; previous receiver signature verification stops working until updated.';
  },
  apply:async({args:a,ctx,target:t,before:b})=>{
    safeExisting(b);
    const value=makeKey(),gh=await octo(ctx,t.owner);
    await gh.request('PATCH '+ROUTE(t,'/{hook_id}/config'),
      {...PARAMS(t),hook_id:a.hookId,secret:value});
    return {id:a.hookId,reveal:await oneTime(ctx,value,t.owner)};
  },
  readAfter:({args:a,ctx,target:t})=>fetchHook(ctx,t,a.hookId),
  // GitHub masks signing secrets. Report changed configuration metadata only;
  // absence of independent timestamp change is honestly unconfirmed.
  verify:({before:b,after:x})=>!!x&&x.secure_tls&&x.host===b.hook.host&&
    x.updated_at!==null&&b.hook.updated_at!==null&&x.updated_at!==b.hook.updated_at,
  inverse:()=>null,
  present:({args:a,response:r})=>({webhook_id:a.hookId,
    signing_secret_reveal:r.reveal,secret_expires_in_minutes:10,
    warning:'GitHub does not expose stored signing keys. Verify webhook receiver signatures after applying the new key.'})
});
export const tools=[save.tool,rotate.tool];
export const handlers=Object.fromEntries([[save.tool,save.handler],
  [rotate.tool,rotate.handler]].map(([t,h])=>[t.name,h]));
