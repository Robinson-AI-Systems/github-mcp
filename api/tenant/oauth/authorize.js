// The PRIVATE pilot authorization page. Standard MCP OAuth clients send
// redirect+PKCE+resource, not custom account/mode/profile fields. Show a short
// mobile-friendly consent form; no tenant account names or provider data appear
// until GitHub has independently verified the user and installation.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createPrivateGitHubConsent } from '../../../src/tenancy/github-consent.js';
import { verifyTenantCredential } from '../../../src/tenancy/routed-credential.js';
import { escapeHtml, paramsOf, publicOrigin, send } from '../../../src/core/http.js';
import { disclaimerHtml } from '../../../src/brand/brand.js';

const cookieName='gh_tenant_pilot_form';
const formCookie=req => /(?:^|;\s*)gh_tenant_pilot_form=([A-Za-z0-9_-]{43})(?:;|$)/
  .exec(String(req.headers?.cookie||''))?.[1]||null;
const fresh=()=>randomBytes(32).toString('base64url');
const hidden=['client_id','redirect_uri','response_type','code_challenge',
  'code_challenge_method','state','resource','scope'];
const refuse=(res)=>send(res,403,{error:'authorization_unavailable',
  error_description:'This GitHub tenant authorization is not available.'});
const clear='gh_tenant_pilot_form=; Max-Age=0; Path=/api/tenant/oauth; HttpOnly; Secure; SameSite=Strict';
const choices=(name,items)=>'<label>'+escapeHtml(name)+
  '<select name="'+name+'">'+items.map(v=>'<option value="'+v+'">'+escapeHtml(v)+'</option>').join('')+'</select></label>';

export default async function privateTenantAuthorize(req,res,{env=process.env,
  consentFactory=createPrivateGitHubConsent}={}){
  res.setHeader('Cache-Control','no-store');
  if(!['GET','POST'].includes(req.method)){
    res.setHeader('Allow','GET, POST');
    return send(res,405,{error:'method_not_allowed'});
  }
  if(env.GITHUB_PRIVATE_TENANT_PILOT!=='enabled') return refuse(res);
  try{
    const origin=publicOrigin(env);
    const p=paramsOf(req);
    // Even rendering a generic form requires a server-signed private pilot
    // client. This does not grant access; registration and provider proof do.
    if(!verifyTenantCredential(p.client_id,'tcl',env)) return refuse(res);
    if(req.method==='GET'){
      // A signed, but revoked or unregistered client may NOT display a plausible
      // GitHub sign-in screen. Verify live tenant membership, client redirect
      // and the exact GitHub App account before displaying consent choices.
      const inspected=await consentFactory({env}).inspect(p);
      const csrf=fresh();
      res.setHeader('Set-Cookie',cookieName+'='+csrf+
        '; Max-Age=600; Path=/api/tenant/oauth; HttpOnly; Secure; SameSite=Strict');
      res.setHeader('Content-Type','text/html; charset=utf-8');
      res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
      res.setHeader('Referrer-Policy','same-origin');
      const fields=hidden.map(k=>'<input type="hidden" name="'+k+'" value="'+escapeHtml(p[k]??'')+'">').join('');
      const modes=env.VERCEL_ENV==='production' && inspected.productionAllowed?['preview','production']:['preview'];
      const html='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
        '<title>Connect GitHub Unleashed</title><style>body{font:16px system-ui,sans-serif;max-width:430px;margin:6vh auto;padding:20px}form{display:grid;gap:14px}input,select,button{font:inherit;padding:10px}p{line-height:1.5}</style></head><body>'+
        '<h1>Connect GitHub Unleashed by Robinson AI Systems</h1>'+
        '<p>This is a private pilot connection. You will sign in through GitHub. Only your approved installation can be used.</p>'+
        '<form method="post" action="/api/tenant/oauth/authorize">'+fields+
        '<input type="hidden" name="form_csrf" value="'+csrf+'">'+
        choices('mode',modes)+choices('profile',['read_only','everyday','full'])+
        choices('listing',['compact','catalog'])+
        '<button type="submit">Continue to GitHub</button></form>'+disclaimerHtml()+'</body></html>';
      return res.status(200).send(html);
    }
    const cookie=formCookie(req);
    res.setHeader('Set-Cookie',clear);
    if(String(req.headers?.origin||'')!==origin || !cookie ||
        typeof p.form_csrf!=='string' || p.form_csrf.length!==cookie.length ||
        !timingSafeEqual(Buffer.from(cookie),Buffer.from(p.form_csrf))) return refuse(res);
    const {url,csrfState}=await consentFactory({env}).start(p);
    res.setHeader('Set-Cookie',[clear,
      'gh_tenant_pilot_state='+csrfState+
        '; Max-Age=600; Path=/api/github/user-callback; HttpOnly; Secure; SameSite=Lax']);
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Location',url);
    return res.status(302).end();
  }catch{
    return refuse(res);
  }
}
