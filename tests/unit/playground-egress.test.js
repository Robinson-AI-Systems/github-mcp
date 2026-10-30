import {it,expect} from 'vitest';
import {createServer,request} from 'node:http';
import {connect,createServer as tcpServer} from 'node:net';
import {egressServer,publicAddress} from '../../workers/coding-workspace/egress.js';
const listen=s=>new Promise(r=>s.listen(0,'127.0.0.1',()=>r(s.address().port)));
const close=s=>{s.closeAllConnections?.();return new Promise(r=>s.close(r));};
it('refuses private, metadata, loopback, documentation, multicast and IPv6 destinations',()=>{
 for(const a of ['0.0.0.0','10.77.10.200','100.100.100.200','127.0.0.1','169.254.169.254','172.16.0.1','192.168.0.1','192.0.2.1','198.18.0.1','198.51.100.2','203.0.113.1','224.0.0.1','255.255.255.255','::1','::ffff:127.0.0.1'])expect(publicAddress(a),a).toBe(false);expect(publicAddress('93.184.216.34')).toBe(true);
});
it('allows only the private executor peer, pins public DNS for HTTP/CONNECT and denies mixed/private/admin targets',async()=>{
 const received=[],site=createServer((req,res)=>{received.push(req.headers);res.end('package');}),sitePort=await listen(site),tunnel=tcpServer(s=>s.on('data',b=>s.end(b))),tunnelPort=await listen(tunnel),dials=[];
 let peer='127.0.0.1',answers=['93.184.216.34'];const proxy=egressServer({blockedHosts:['admin.example.test'],blockedAddresses:['107.90.116.157'],resolve:async h=>(h==='coding'?[peer]:h==='admin.example.test'?['8.8.8.8']:answers).map(address=>({address,family:4})),dial:o=>{dials.push(o);return connect(o.port===443?tunnelPort:sitePort,'127.0.0.1');}}),port=await listen(proxy);
 const get=path=>new Promise((r,j)=>{const req=request({host:'127.0.0.1',port,path,headers:{'proxy-authorization':'FAKE_PROXY_SECRET'}},res=>{let body='';res.on('data',b=>body+=b);res.on('end',()=>r({status:res.statusCode,body}));});req.on('error',j);req.end();});
 const secure=target=>new Promise((r,j)=>{const s=connect(port,'127.0.0.1',()=>s.write('CONNECT '+target+' HTTP/1.1\r\nHost: '+target+'\r\n\r\n'));let data='',sent=false;s.on('data',b=>{data+=b;if(data.includes('200 Connection')&&!sent){sent=true;s.write('echo');}});s.on('end',()=>r(data));s.on('error',j);});
 try{
  expect(await get('http://packages.example.test/package')).toEqual({status:200,body:'package'});expect(dials[0]).toEqual({host:'93.184.216.34',port:80});expect(received[0].host).toBe('packages.example.test');expect(received[0]['proxy-authorization']).toBeUndefined();
  expect(await secure('packages.example.test:443')).toContain('echo');expect(dials[1]).toEqual({host:'93.184.216.34',port:443});
  const sent=dials.length;
  for(const target of ['http://127.0.0.1/','http://169.254.169.254/','http://107.90.116.157/','http://admin.example.test/','http://user:password@packages.example.test/','http://packages.example.test:8080/'])expect((await get(target)).status).toBe(403);
  expect(await secure('packages.example.test:22')).toContain('403');answers=['93.184.216.34','10.0.0.1'];expect((await get('http://rebind.example.test/')).status).toBe(403);answers=['8.8.8.8'];expect((await get('http://alias-of-admin.example.test/')).status).toBe(403);
  peer='10.0.0.3';expect((await get('http://packages.example.test/')).status).toBe(403);expect(dials).toHaveLength(sent);
 }finally{await close(proxy);await close(site);await close(tunnel);}
});
