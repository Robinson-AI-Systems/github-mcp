import {it,expect} from 'vitest';
import {createServer} from 'node:http';
import {generateKeyPairSync,sign} from 'node:crypto';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {browserPreview,previewGrant} from '../../workers/coding-workspace/browser-preview.js';
it('redeems a signed single-use preview and proxies private application traffic without control credentials',async()=>{
 const root=await mkdtemp(join(tmpdir(),'preview-browser-'));await mkdir(join(root,'control'));
 const now=Date.now(),binding='a'.repeat(64),{privateKey,publicKey}=generateKeyPairSync('ed25519'),key='ed25519:'+publicKey.export({type:'spki',format:'der'}).toString('base64');
 let origin;const controlOrigin='https://mcp.example.test';let requests=0;
 const app=createServer((req,res)=>{requests++;expect(req.headers.authorization).toBeUndefined();expect(req.headers['x-api-key']).toBeUndefined();expect(req.headers['x-robinson-signature']).toBeUndefined();expect(req.headers.cookie).toBe('app=ok');res.setHeader('Set-Cookie',['__Host-robinson-preview=attack; Secure; Path=/','app=next']);res.end('private app');});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));const port=app.address().port;
 const runtime={root,binding,lastActivity:now,idleMs:14400000,authorityRequired:true,authorityLease:{allowed:true,expiresAt:now+60000}};
 let proxy;const server=createServer((req,res)=>proxy.handler(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));const endpoint='http://127.0.0.1:'+server.address().port;origin=endpoint;proxy=browserPreview({runtime,key,ports:[port],origin,controlOrigin,now:()=>now});
 const body=Buffer.from(JSON.stringify({purpose:'robinson-playground-preview/v1',binding,origin,port,nonce:'b'.repeat(32),expiresAt:now+300000}));const grant=body.toString('base64url')+'.'+sign(null,body,privateKey).toString('base64url');
 try{
  expect((await fetch(endpoint,{headers:{Host:new URL(origin).host}})).status).toBe(401);expect(requests).toBe(0);
  const redeem=()=>fetch(endpoint+'/__playground/redeem',{method:'POST',headers:{Host:new URL(origin).host,Origin:controlOrigin},body:new URLSearchParams({grant})});
  const entered=await redeem();expect(entered.status).toBe(200);const cookie=entered.headers.get('set-cookie');expect(cookie).toContain('Secure; HttpOnly; SameSite=Strict');expect((await redeem()).status).toBe(401);
  const response=await fetch(endpoint+'/app',{headers:{Host:new URL(origin).host,cookie:cookie.split(';')[0]+'; app=ok',Authorization:'withheld','x-api-key':'withheld','x-robinson-signature':'withheld'}});
  expect(await response.text()).toBe('private app');expect(response.headers.get('set-cookie')).toBe('app=next');expect(response.headers.get('cache-control')).toContain('no-store');expect(runtime.lastActivity).toBe(now);
  runtime.authorityLease.allowed=false;expect((await fetch(endpoint,{headers:{Host:new URL(origin).host,cookie:cookie.split(';')[0]}})).status).toBe(401);expect(requests).toBe(1);
  for(const change of [{binding:'c'.repeat(64)},{origin:'https://foreign.example.test'},{port:port+1},{now:now+300001}])expect(()=>previewGrant(grant,key,change.binding??binding,{ports:[change.port??port],origin:change.origin??origin,now:change.now??now})).toThrow();
 }finally{server.closeAllConnections();app.closeAllConnections();await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>app.close(r))]);await rm(root,{recursive:true,force:true});}
});
