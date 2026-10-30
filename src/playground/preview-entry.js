import {randomBytes,createHash} from 'node:crypto';
import {publicOrigin,escapeHtml,paramsOf} from '../core/http.js';
import {signPreviewBody} from '../native-git/signing.js';
import {allocationScope,allocationAuthority} from './lifecycle.js';
import {playgroundBinding,callPlayground} from './client.js';
const hash=x=>createHash('sha256').update(x).digest('hex');
const html=(res,action,fields)=>{
 const script='document.forms[0].submit()';res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Content-Security-Policy',`default-src 'none'; script-src 'sha256-${createHash('sha256').update(script).digest('base64')}'; form-action ${new URL(action).origin}; frame-ancestors 'none'; base-uri 'none'`);
 return res.status(200).send('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Opening private development preview</title><form method="post" action="'+escapeHtml(action)+'">'+Object.entries(fields).map(([name,value])=>'<input type="hidden" name="'+escapeHtml(name)+'" value="'+escapeHtml(value)+'">').join('')+'</form><script>'+script+'</script>');
};
export async function createPreviewEntry(ctx,record,port){
 const binding=playgroundBinding(record),stored=await ctx.db.getSetting('playground.'+binding.slice(0,40));
 if(stored?.phase!=='attached'||stored.binding!==binding||!Number.isSafeInteger(port)||port<1024||port>65535)throw new TypeError('An attached allocation and enabled development port are required.');
 const capabilities=await callPlayground(ctx,record,'capabilities');if(!capabilities.preview?.ports?.includes(port)||capabilities.authority?.required===true&&capabilities.authority.allowed!==true)throw new TypeError('Development port or current runtime authority is unavailable.');
 const authority=await allocationAuthority({...ctx,stored});if(!authority.allowed)throw new TypeError('Current allocation authorization/enforcement is unavailable.');
 const entry=randomBytes(24).toString('base64url'),digest=hash(entry),expiresAt=(ctx.now??Date.now)()+60000;
 const saved=await ctx.db.compareAndSetSetting('preview.'+digest.slice(0,40),0,{revision:1,kind:'playground-preview-entry',binding,connection:stored.connection,digest,port,expiresAt,consumed:false});if(!saved)throw new TypeError('Private preview entry could not be reserved.');
 const url=new URL('/api/playground/preview',publicOrigin(ctx.env));url.searchParams.set('entry',entry);url.searchParams.set('binding',binding);if(stored.scope?.tenantId){url.searchParams.set('tenant',stored.scope.tenantId);url.searchParams.set('identity',stored.scope.identityId);}
 return {entry_url:url.href,private:true,one_time:true,entry_expires_at:expiresAt,session_seconds:300,port,next:'Open this private one-time page in the browser. Provider credentials and the preview cookie never appear in tool results. Do not publish the entry URL.'};
}
export async function previewEntry(req,res,{load=allocationScope,now=Date.now,env=process.env}={}){
 res.setHeader('Cache-Control','private, no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
 if(!['GET','POST'].includes(req.method))return res.status(405).send('Method not allowed.');
 try{
  const args=req.method==='GET'?req.query:paramsOf(req);if(!/^[A-Za-z0-9_-]{32}$/.test(args.entry??''))throw new TypeError('Invalid entry.');
  const ctx=await load(args,{env}),s=ctx.stored,digest=hash(args.entry),key='preview.'+digest.slice(0,40),entry=await ctx.db.getSetting(key);
  if(entry?.digest!==digest||entry.binding!==s.binding||entry.connection!==s.connection||entry.consumed||entry.expiresAt<=now())throw new TypeError('Entry expired.');
  if(!(await allocationAuthority(ctx)).allowed)throw new TypeError('Preview authorization is unavailable.');
  if(req.method==='GET')return html(res,new URL('/api/playground/preview',publicOrigin(env)).href,Object.fromEntries(Object.entries(args).filter(([k])=>['entry','binding','tenant','identity'].includes(k))));
  if(req.headers.origin!==publicOrigin(env))throw new TypeError('Invalid preview entry origin.');
  if(!await ctx.db.compareAndSetSetting(key,entry.revision,{...entry,consumed:true,revision:entry.revision+1}))throw new TypeError('Entry already used.');
  const body=JSON.stringify({purpose:'robinson-playground-preview/v1',binding:s.binding,origin:s.plan.origin,port:entry.port,nonce:randomBytes(16).toString('hex'),expiresAt:now()+300000});
  const grant=Buffer.from(body).toString('base64url')+'.'+signPreviewBody(body,env);
  return html(res,new URL('/__playground/redeem',s.plan.origin).href,{grant});
 }catch{return res.status(401).send('Private preview entry expired or authorization is unavailable. Request a new preview through the authenticated MCP.');}
}
