// Trusted, credential-free fixed-destination ingress. No user volume or shell.
import {createServer,request} from 'node:http';
import {connect} from 'node:net';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {egressServer} from './egress.js';
const valid=path=>typeof path==='string'&&path.startsWith('/')&&!path.startsWith('//')&&path.length<=8192&&!/[\x00-\x20\x7f]/.test(path);
export function ingressServer({coding={hostname:'coding',port:3000},broker={hostname:'broker',port:3000}}={}){
 const server=createServer({requestTimeout:60000,headersTimeout:10000,maxHeaderSize:16384},(req,res)=>{
  if(!valid(req.url)||req.method==='CONNECT'){res.writeHead(400);return res.end();}
  const target=req.url==='/v1/workspace'?broker:coding;
  const upstream=request({...target,path:req.url,method:req.method,headers:req.headers,timeout:55000},answer=>{res.writeHead(answer.statusCode,answer.headers);answer.pipe(res);});
  upstream.on('timeout',()=>upstream.destroy());upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});req.on('aborted',()=>upstream.destroy());res.on('close',()=>upstream.destroy());req.pipe(upstream);
 });
 server.on('connect',(_req,socket)=>socket.end('HTTP/1.1 405 Method Not Allowed\r\nConnection: close\r\n\r\n'));
 server.on('upgrade',(req,socket,head)=>{
  if(!valid(req.url)||req.url.startsWith('/v1/'))return socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
  const target=connect(coding.port,coding.hostname,()=>{target.write(req.method+' '+req.url+' HTTP/1.1\r\n'+Object.entries(req.headers).map(([k,v])=>k+': '+v).join('\r\n')+'\r\n\r\n');if(head.length)target.write(head);socket.pipe(target);target.pipe(socket);});
  target.on('error',()=>socket.destroy());socket.on('error',()=>target.destroy());socket.on('close',()=>target.destroy());target.on('close',()=>socket.end());
 });
 return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const server=ingressServer(),proxy=egressServer({blockedHosts:JSON.parse(process.env.EGRESS_BLOCKED_HOSTS??'[]'),blockedAddresses:JSON.parse(process.env.EGRESS_BLOCKED_ADDRESSES??'[]')});server.listen(Number(process.env.PORT??3000),'0.0.0.0');proxy.listen(3128,'0.0.0.0');for(const s of ['SIGTERM','SIGINT'])process.once(s,()=>{proxy.close();server.close(()=>process.exit(0));});}
