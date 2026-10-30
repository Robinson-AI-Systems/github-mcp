// Public IPv4 HTTP/HTTPS only, DNS pinned per connection. No credentials, host
// sockets or user files. The private executor address is the only accepted peer.
import {createServer,request} from 'node:http';
import {lookup} from 'node:dns/promises';
import {BlockList,isIP,connect} from 'node:net';
const denied=new BlockList();
for(const [address,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]])denied.addSubnet(address,prefix,'ipv4');
export const publicAddress=address=>isIP(address)===4&&!denied.check(address,'ipv4');
const ipv4=address=>address?.replace(/^::ffff:/,'');
export function egressServer({resolve=lookup,dial=connect,blockedHosts=[],blockedAddresses=[],peerHost='coding'}={}){
 const records=async host=>{const rows=await resolve(host,{all:true,verbatim:true});if(!Array.isArray(rows)||rows.length>128)throw Error();return rows.filter(x=>x.family===4).map(x=>x.address);};
 const destination=async(req,secure)=>{
  if(!(await records(peerHost)).includes(ipv4(req.socket.remoteAddress)))throw Error();
  if(secure&&!/^[A-Za-z0-9.-]{1,253}:443$/.test(req.url))throw Error();
  const url=new URL(secure?'https://'+req.url:req.url),host=url.hostname.toLowerCase().replace(/\.$/,'');
  if(url.username||url.password||url.hash||url.protocol!==(secure?'https:':'http:')||Number(url.port||(secure?443:80))!==(secure?443:80)||host.length>253||blockedHosts.includes(host))throw Error();
  const addresses=isIP(host)?[host]:await records(host);
  const blocked=new Set(blockedAddresses);
  for(const name of blockedHosts)for(const ip of await records(name))blocked.add(ip);
  if(!addresses.length||addresses.some(ip=>!publicAddress(ip)||blocked.has(ip)))throw Error();
  return {url,address:addresses[0],port:secure?443:80};
 };
 const bounded=async(req,secure)=>{let timer;try{return await Promise.race([destination(req,secure),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error()),5000);timer.unref();})]);}finally{clearTimeout(timer);}};
 const server=createServer({requestTimeout:60000,headersTimeout:10000,maxHeaderSize:16384},async(req,res)=>{
  let d;try{d=await bounded(req,false);}catch{res.writeHead(403);return res.end('Destination unavailable.');}
  const headers={...req.headers,host:d.url.host,connection:'close'};delete headers['proxy-authorization'];delete headers['proxy-connection'];
  const upstream=request({hostname:d.address,port:d.port,createConnection:()=>dial({host:d.address,port:d.port}),path:d.url.pathname+d.url.search,method:req.method,headers,timeout:60000},answer=>{res.writeHead(answer.statusCode,answer.headers);answer.pipe(res);});
  upstream.on('timeout',()=>upstream.destroy());upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});req.on('aborted',()=>upstream.destroy());res.on('close',()=>upstream.destroy());req.pipe(upstream);
 });
 server.on('connect',async(req,socket,head)=>{
  let d;try{d=await bounded(req,true);}catch{return socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');}
  if(socket.destroyed)return;
  const remote=dial({host:d.address,port:d.port}),timer=setTimeout(()=>{remote.destroy();socket.destroy();},120000);timer.unref();
  remote.once('connect',()=>{socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)remote.write(head);socket.pipe(remote);remote.pipe(socket);});
  const stop=()=>{clearTimeout(timer);remote.destroy();socket.destroy();};remote.on('error',stop);socket.on('error',stop);remote.on('close',()=>{clearTimeout(timer);socket.end();});socket.on('close',()=>{clearTimeout(timer);remote.destroy();});
 });
 return server;
}
