import {it,expect,afterEach} from 'vitest';
import {createServer} from 'node:http';
import {readPreview,previewPorts} from '../../workers/coding-workspace/preview.js';
import {makeWorld,parse,doorsFor} from '../../test/helpers/write-contract.js';
import {preparePlaygroundWorld} from '../../test/helpers/playground-world.js';
import * as playground from '../../src/tools/playground.js';
import {createDispatch} from '../../src/tools/dispatch.js';
import {registry} from '../../src/tools/index.js';
const cleanups=[];afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();});
const decode=x=>x.content?parse(x):x;
const base={owner:'example-org',repo:'hello',workspace_id:'job_0123456789abcdef',operation:'preview'};
async function app(handler){const s=createServer(handler);await new Promise(r=>s.listen(0,'127.0.0.1',r));cleanups.push(()=>new Promise(r=>{s.closeAllConnections();s.close(r);}));return s.address().port;}
async function world(port){const w=await makeWorld({profile:'full',mode:'production',gates:[]});w.gh.when('GET /repos/{owner}/{repo}').reply(200,{full_name:'example-org/hello'});cleanups.push(await preparePlaygroundWorld(w,{ports:[port]}));return w;}
it('enforces explicit development ports and origin-relative paths before making any request',async()=>{
 expect(previewPorts()).toEqual([3001,4173,5173,8000,8080]);expect(previewPorts('3001,3001')).toEqual([3001]);
 for(const value of ['', '80','5432','3000','abc','65536','1.5'])expect(()=>previewPorts(value)).toThrow();expect(()=>previewPorts('8000',8000)).toThrow();
 for(const port of [80,5432,3000,12345,'8000'])await expect(readPreview({port},{ports:[8000,3000,5432]})).rejects.toMatchObject({code:'preview_port_denied'});
 const port=await app(()=>{throw Error('invalid request was sent');});
 for(const path of ['https://private.test/','//private.test/','/\\evil','/\r\nHeader:secret','/a b','/#fragment'])await expect(readPreview({port,path},{ports:[port]})).rejects.toMatchObject({code:'invalid_preview_path'});
 await expect(readPreview({port,offset:1},{ports:[port]})).rejects.toMatchObject({code:'preview_changed'});
});
it('authenticates preview through handler, dispatcher and github_call with fixed loopback and no forwarded credentials',async()=>{
 let requests=0;
 const port=await app((req,res)=>{requests++;expect(req.method).toBe('GET');expect(req.url).toBe('/hello?q=1');expect(req.headers.host).toBe('127.0.0.1:'+port);for(const key of ['authorization','cookie','x-robinson-signature','x-api-key'])expect(req.headers).not.toHaveProperty(key);res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Set-Cookie','private=withheld');res.end('<h1>Private development app</h1>');});
 const definition={tool:playground.tools.find(t=>t.name==='github_playground_read'),handler:playground.handlers.github_playground_read};
 for(const door of doorsFor(definition)){
  const w=await world(port);w.advanceClock(1000);const answer=decode(await door.call(w,{...base,port,path:'/hello?q=1'}));
  expect(answer).toMatchObject({status:200,complete:true,untrusted:true,browserSession:false,transport:'authenticated-control-loopback'});expect(Buffer.from(answer.base64,'base64').toString()).toBe('<h1>Private development app</h1>');expect(JSON.stringify(answer)).not.toContain('private=withheld');expect(answer.last_activity_at).toBe(w.ctx.now());
 }
 expect(requests).toBe(3);
});
it('denies foreign workspace/repository/area before a runtime request and preserves explicit read-only exclusion',async()=>{
 let requests=0;const port=await app((_req,res)=>{requests++;res.setHeader('Content-Type','text/plain');res.end('ok');});const w=await world(port);
 const dispatch=createDispatch({env:w.ctx.env,credentials:w.ctx.credentials,fetch:w.ctx.fetch,now:w.ctx.now});
 for(const [args,connection] of [[{...base,repo:'foreign'},w.ctx.connection],[base,{...w.ctx.connection,client_id:'foreign'}],[base,{...w.ctx.connection,profile:'read_only'}],[base,{...w.ctx.connection,pass:true,areas:['git'],repos:['example-org/hello']}],[base,{...w.ctx.connection,pass:true,areas:['playground'],repos:['example-org/foreign']}]]){
  const before=w.playgroundRequests.length;const answer=await dispatch({registry,name:'github_playground_read',args:{...args,port},connection,db:w.db});expect(answer.isError).toBe(true);expect(w.playgroundRequests.length).toBe(before);
 }
 expect(requests).toBe(0);
});
it('protects the entire text before hash-pinned pagination and rejects changing content',async()=>{
 let body='x'.repeat(40000)+'\n'+ 'ghp_'+'A'.repeat(36);const port=await app((_req,res)=>{res.setHeader('Content-Type','application/json');res.end(body);});
 const options={ports:[port]},first=await readPreview({port,length:32768},options);expect(first.complete).toBe(false);expect(first.redacted).toBe(true);
 const second=await readPreview({port,offset:first.nextOffset,length:32768,expectedBodyHash:first.bodyHash},options);const text=Buffer.from(first.base64,'base64').toString()+Buffer.from(second.base64,'base64').toString();expect(text).not.toContain('A'.repeat(36));expect(second.complete).toBe(true);
 body='changed\n'+body;await expect(readPreview({port,offset:first.nextOffset,expectedBodyHash:first.bodyHash},options)).rejects.toMatchObject({code:'preview_changed'});
});
it('does not follow redirects, leak headers, accept encoded/binary data or report oversized/incomplete bodies as success',async()=>{
 let hits=0;const target=await app(()=>{hits++;});
 for(const [mode,code] of [['redirect','preview_redirect'],['encoded','preview_encoding'],['binary','preview_content_type'],['large','preview_too_large'],['abort','preview_unavailable']]){
  const port=await app((_req,res)=>{res.setHeader('Content-Type','text/plain');if(mode==='redirect'){res.writeHead(302,{Location:'http://127.0.0.1:'+target+'/private?credential=withheld'});res.end();}if(mode==='encoded'){res.setHeader('Content-Encoding','gzip');res.end('encoded');}if(mode==='binary'){res.setHeader('Content-Type','image/png');res.end('binary');}if(mode==='large')res.end('x'.repeat(2097153));if(mode==='abort'){res.write('partial');res.destroy();}});
  await expect(readPreview({port},{ports:[port]})).rejects.toMatchObject({code});
 }
 expect(hits).toBe(0);
});
it('bounds slow responses with an absolute watchdog and preserves HTTP application error status',async()=>{
 const slow=await app((_req,res)=>{res.writeHead(200,{'Content-Type':'text/plain'});res.write('partial');});await expect(readPreview({port:slow},{ports:[slow],timeoutMs:40})).rejects.toMatchObject({code:'preview_timeout'});
 const missing=await app((_req,res)=>{res.writeHead(404,{'Content-Type':'text/plain'});res.end('page missing');});expect(await readPreview({port:missing},{ports:[missing]})).toMatchObject({status:404,complete:true});
});
