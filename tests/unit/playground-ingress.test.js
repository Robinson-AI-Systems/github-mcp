import {it,expect} from 'vitest';
import {createServer,request} from 'node:http';
import {connect} from 'node:net';
import {ingressServer} from '../../workers/coding-workspace/ingress.js';
const listen=s=>new Promise(r=>s.listen(0,'127.0.0.1',()=>r({hostname:'127.0.0.1',port:s.address().port})));
const close=s=>{s.closeAllConnections?.();return new Promise(r=>s.close(r));};
it('routes only fixed coding/broker targets, preserves private auth and refuses forward-proxy/control WebSocket requests',async()=>{
 const seen=[],coding=createServer((req,res)=>{seen.push(['coding',req.url,req.headers.cookie]);res.statusCode=req.headers.cookie?200:401;res.end('private');}),broker=createServer((req,res)=>{seen.push(['broker',req.url,req.headers['x-robinson-signature']]);res.end('broker');});
 coding.on('upgrade',(req,socket,head)=>{seen.push(['upgrade',req.url,req.headers.cookie]);socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');socket.end(head.length?head:'frame');});
 const c=await listen(coding),b=await listen(broker),gateway=ingressServer({coding:c,broker:b}),g=await listen(gateway),url='http://127.0.0.1:'+g.port;
 try{
  expect((await fetch(url+'/')).status).toBe(401);expect(await(await fetch(url+'/asset',{headers:{Cookie:'FAKE_SESSION'}})).text()).toBe('private');
  expect(await(await fetch(url+'/v1/workspace',{method:'POST',headers:{'x-robinson-signature':'FAKE_SIGNATURE'},body:'{}'})).text()).toBe('broker');
  expect(seen).toContainEqual(['coding','/asset','FAKE_SESSION']);expect(seen).toContainEqual(['broker','/v1/workspace','FAKE_SIGNATURE']);
  const code=await new Promise((r,j)=>{const req=request({...g,path:'http://untrusted.example.test/',method:'GET'},res=>{res.resume();r(res.statusCode);});req.on('error',j);req.end();});expect(code).toBe(400);
  const raw=async text=>new Promise((r,j)=>{const s=connect(g.port,g.hostname,()=>s.write(text));let data='';s.on('data',v=>{data+=v;});s.on('end',()=>r(data));s.on('error',j);});
  expect(await raw('CONNECT untrusted.example.test:443 HTTP/1.1\r\nHost: example.test\r\n\r\n')).toContain('405');
  expect(await raw('GET /v1/workspace HTTP/1.1\r\nHost: example.test\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')).toContain('404');
  expect(await raw('GET /ws HTTP/1.1\r\nHost: example.test\r\nCookie: FAKE_SESSION\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')).toContain('101 Switching');expect(seen).toContainEqual(['upgrade','/ws','FAKE_SESSION']);
 }finally{await close(gateway);await close(coding);await close(broker);}
});

it('SINGLE-DOMAIN-1: one-time download/upload paths reach the broker; everything else under /v1/ still does not, and the probe answers',async()=>{
 const seen=[],coding=createServer((req,res)=>{seen.push(['coding',req.url]);res.end('coding');}),broker=createServer((req,res)=>{seen.push(['broker',req.url,req.headers.cookie]);let n=0;req.on('data',c=>{n+=c.length;});req.on('end',()=>res.end('broker '+n));});
 const c=await listen(coding),b=await listen(broker),gateway=ingressServer({coding:c,broker:b}),g=await listen(gateway),url='http://127.0.0.1:'+g.port,cap='eyJh.c2ln';
 try{
  expect(await(await fetch(url+'/v1/ingress')).json()).toEqual({service:'robinson-playground-ingress',transfer:'broker-v1'});
  expect(await(await fetch(url+'/v1/download/'+cap)).text()).toBe('broker 0');
  expect(await(await fetch(url+'/v1/download/'+cap+'/info/refs?service=git-upload-pack')).text()).toBe('broker 0');
  expect(await(await fetch(url+'/v1/upload/'+cap+'/git-receive-pack',{method:'POST',body:Buffer.alloc(3*1024*1024)})).text()).toBe('broker '+3*1024*1024);
  expect(await(await fetch(url+'/v1/upload/'+cap,{method:'PUT',body:'abc'})).text()).toBe('broker 3');
  for(const path of ['/v1/download/'+cap+'?x=1','/v1/coding','/v1/download/'+cap+'/extra/path','/v1/uploadx/'+cap])expect(await(await fetch(url+path)).text(),path).toBe('coding');
  expect(seen.filter(s=>s[0]==='broker').map(s=>s[1])).toEqual(['/v1/download/'+cap,'/v1/download/'+cap+'/info/refs?service=git-upload-pack','/v1/upload/'+cap+'/git-receive-pack','/v1/upload/'+cap]);
 }finally{await close(gateway);await close(coding);await close(broker);}
});
