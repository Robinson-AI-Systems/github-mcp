import {request} from 'node:http';
import {connect} from 'node:net';
import {createPublicKey,verify} from 'node:crypto';
import {open} from 'node:fs/promises';
import {join} from 'node:path';
const COOKIE='__Host-robinson-preview';
export function previewGrant(value,key,binding,{now=Date.now(),ports,origin}={}){
 if(typeof value!=='string'||value.length>4096)throw new TypeError('Invalid preview grant.');const [payload,signature,...extra]=value.split('.');if(extra.length||!payload||!signature)throw new TypeError('Invalid preview grant.');
 const body=Buffer.from(payload,'base64url'),pub=createPublicKey({key:Buffer.from(key.slice(8),'base64'),format:'der',type:'spki'});
 if(!verify(null,body,pub,Buffer.from(signature,'base64url')))throw new TypeError('Invalid preview grant.');const c=JSON.parse(body);
 if(c.purpose!=='robinson-playground-preview/v1'||c.binding!==binding||c.origin!==origin||!Number.isSafeInteger(c.expiresAt)||c.expiresAt<=now||c.expiresAt>now+300000||!Number.isSafeInteger(c.port)||!ports.includes(c.port)||!/^[a-f0-9]{32}$/.test(c.nonce??''))throw new TypeError('Preview grant is expired or belongs to another allocation.');return c;
}
const cookie=req=>String(req.headers.cookie??'').split(';').map(s=>s.trim()).find(s=>s.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
const omitted=new Set(['authorization','proxy-authorization','x-api-key','connection','upgrade','keep-alive','proxy-authenticate','te','trailer','transfer-encoding']);
function upstreamHeaders(req){const headers={};for(const [k,v] of Object.entries(req.headers)){if(!omitted.has(k)&&!k.startsWith('x-robinson-'))headers[k]=v;}headers.cookie=String(req.headers.cookie??'').split(';').map(s=>s.trim()).filter(s=>!s.startsWith(COOKIE+'=')).join('; ');return headers;}
export function browserPreview({runtime,key,ports,origin,controlOrigin,now=Date.now,requestTimeoutMs=300000,maxRequestBytes=32*1024*1024}={}){
 const parse=value=>previewGrant(value,key,runtime.binding,{ports,origin,now:now()});
 const current=()=>!runtime.expired&&!runtime.stopping&&runtime.lastActivity+runtime.idleMs>now()&&(!runtime.authorityRequired||runtime.authorityLease?.allowed===true&&runtime.authorityLease.expiresAt>now());
 const authenticated=req=>{const grant=parse(cookie(req));if(!current()||String(req.headers.host)!==new URL(origin).host)throw new TypeError('Preview authority is unavailable.');return grant;};
 const handler=async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
  try{
   if(req.url==='/__playground/redeem'){
    if(req.method!=='POST'||req.headers.origin!==controlOrigin||String(req.headers.host)!==new URL(origin).host||!current())throw new TypeError('Preview entry was refused.');let body='';for await(const chunk of req){body+=chunk.toString();if(Buffer.byteLength(body)>8192)throw new TypeError('Preview entry exceeded its bound.');}
    const value=new URLSearchParams(body).get('grant'),grant=parse(value);const receipt=await open(join(runtime.root,'control','preview-'+grant.nonce+'.used'),'wx',0o600);await receipt.close();
    res.setHeader('Set-Cookie',COOKIE+'='+value+'; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age='+Math.max(1,Math.floor((grant.expiresAt-now())/1000)));
    res.setHeader('Content-Type','text/html; charset=utf-8');return res.end('<!doctype html><meta name="referrer" content="no-referrer"><title>Private preview</title><script>location.replace("/")</script>');
   }
   const grant=authenticated(req);if(!req.url?.startsWith('/')||req.url.startsWith('//')||/[\x00-\x1f\\]/.test(req.url))throw new TypeError('Invalid preview path.');
   const headers=upstreamHeaders(req);const proxy=request({hostname:'127.0.0.1',port:grant.port,method:req.method,path:req.url,headers,agent:false},upstream=>{
    res.statusCode=upstream.statusCode??502;
    for(const [name,value] of Object.entries(upstream.headers)){
     if(omitted.has(name)||['content-length','cache-control','referrer-policy'].includes(name)||value===undefined)continue;
     if(name==='set-cookie'){const safe=(Array.isArray(value)?value:[value]).filter(v=>v.split('=')[0].trim().toLowerCase()!==COOKIE.toLowerCase());if(safe.length)res.setHeader(name,safe);}
     else if(name==='location'){try{const location=new URL(String(value),origin);if(['localhost','127.0.0.1'].includes(location.hostname))res.setHeader(name,new URL(location.pathname+location.search+location.hash,origin).href);else if(['http:','https:'].includes(location.protocol))res.setHeader(name,value);}catch{/* Withhold invalid redirect. */}}
     else res.setHeader(name,value);
    }
    upstream.on('error',()=>res.destroy());upstream.pipe(res);
   });
   const timer=setTimeout(()=>{proxy.destroy();res.destroy();},Math.max(1,Math.min(requestTimeoutMs,grant.expiresAt-now())));timer.unref();res.on('close',()=>{clearTimeout(timer);proxy.destroy();});
   proxy.on('error',()=>{if(!res.headersSent){res.statusCode=502;res.end('Private development server unavailable.');}else res.destroy();});
   let size=0;req.on('data',chunk=>{size+=chunk.length;if(size>maxRequestBytes){proxy.destroy();res.statusCode=413;res.end('Preview request exceeds its configured bound.');}else if(!proxy.write(chunk))req.pause();});proxy.on('drain',()=>req.resume());req.on('end',()=>proxy.end());req.on('aborted',()=>proxy.destroy());
  }catch{res.statusCode=401;res.setHeader('Content-Type','text/plain; charset=utf-8');res.end('Private preview authorization is expired or unavailable. Open a new preview through the authenticated MCP.');}
 };
 const upgrade=(req,socket,head)=>{
  let grant;try{grant=authenticated(req);if(req.method!=='GET'||!req.url?.startsWith('/')||req.url.startsWith('//')||/[\x00-\x1f\\]/.test(req.url))throw Error();}catch{socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');return;}
  const upstream=connect({host:'127.0.0.1',port:grant.port}),timer=setTimeout(()=>{upstream.destroy();socket.destroy();},Math.max(1,grant.expiresAt-now()));timer.unref();
  upstream.on('connect',()=>{const headers={...upstreamHeaders(req),connection:'Upgrade',upgrade:'websocket'};upstream.write(req.method+' '+req.url+' HTTP/1.1\r\n'+Object.entries(headers).map(([k,v])=>k+': '+v).join('\r\n')+'\r\n\r\n');if(head.length)upstream.write(head);socket.pipe(upstream);upstream.pipe(socket);});
  const close=()=>{clearTimeout(timer);upstream.destroy();socket.destroy();};upstream.on('error',close);socket.on('error',close);socket.on('close',close);upstream.on('close',close);
 };
 return {handler,upgrade};
}
