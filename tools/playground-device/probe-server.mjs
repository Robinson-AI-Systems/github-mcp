// PLAY-2 user-side loopback service. The user starts and tunnels it from their
// own PC; it has NO Docker socket, GitHub key, command execution or control-plane
// private signer. It can only attest to receiving a live signed probe.
import {createServer} from 'node:http';
import {sign} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadOrCreateDeviceKey} from './pair.mjs';
import {createPersistentProbeNonceStore} from './probe-nonces.mjs';
import {verifyDeviceProbeClaim,deviceProbeResponse,pinnedDeviceOrigin} from '../../src/playground/device-probe.js';

export function createDeviceProbeServer({deviceId,origin,generation,controlPublicKey,devicePrivateKey,now=Date.now,consumeNonce=null}={}){
 pinnedDeviceOrigin(origin);
 if(!/^[a-f0-9]{32}$/.test(deviceId??'')||!Number.isSafeInteger(generation)||generation<1||
    !devicePrivateKey||devicePrivateKey.asymmetricKeyType!=='ed25519')throw new TypeError('Verified local device key, identity and generation required.');
 const recent=new Map();
 const server=createServer({headersTimeout:8000,requestTimeout:10000,maxHeaderSize:8192},async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Type','application/json');
  const send=(status,error)=>{res.statusCode=status;res.end(JSON.stringify({error}));};
  if(req.url!=='/v1/enrollment/probe'||req.method!=='POST')return send(404,'not_found');
  try{
   if(Number(req.headers['content-length']??0)>4096)return send(413,'request_too_large');
   let length=0;const parts=[];
   for await(const chunk of req){length+=chunk.length;if(length>4096)return send(413,'request_too_large');parts.push(chunk);}
   const body=Buffer.concat(parts).toString('utf8');
   const claim=verifyDeviceProbeClaim(body,String(req.headers['x-robinson-signature']??''),controlPublicKey,
     {deviceId,origin,generation,now});
   for(const [nonce,expiry] of recent)if(expiry<=now())recent.delete(nonce);
   if(recent.has(claim.nonce)||recent.size>=256)return send(409,'claim_replayed_or_busy');
   if(consumeNonce)await consumeNonce(claim);
   recent.set(claim.nonce,claim.expiresAt);
   const proof=JSON.stringify(deviceProbeResponse(claim,{now}));
   res.setHeader('x-robinson-device-signature','ed25519:'+sign(null,Buffer.from(proof),devicePrivateKey).toString('base64url'));
   res.statusCode=200;res.end(proof);
  }catch{return send(401,'invalid_authorization');}
 });
 return server;
}
function parse(argv){
 const o={},valid=new Set(['--device','--origin','--generation','--control-key','--port']);
 for(let i=0;i<argv.length;i+=2){if(!valid.has(argv[i])||typeof argv[i+1]!=='string'||Object.hasOwn(o,argv[i]))throw Error();o[argv[i]]=argv[i+1];}
 if(!o['--device']||!o['--origin']||!o['--control-key']||!/^[1-9][0-9]*$/.test(o['--generation']??'')||
    !/^[1-9][0-9]*$/.test(o['--port']??'')||
    !Number.isSafeInteger(Number(o['--generation']))||
    Number(o['--port'])<1024||Number(o['--port'])>65535)throw Error();
 return o;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 try{
  const o=parse(process.argv.slice(2));
  const {privateKey}=await loadOrCreateDeviceKey();
  const consumeNonce=await createPersistentProbeNonceStore();
  const server=createDeviceProbeServer({deviceId:o['--device'],origin:o['--origin'],
    generation:Number(o['--generation']),controlPublicKey:o['--control-key'],devicePrivateKey:privateKey,consumeNonce});
  server.listen(Number(o['--port']),'127.0.0.1',()=>{
   process.stdout.write('The signed Playground device probe listens on local loopback only. Configure your own outbound HTTPS tunnel to this port; it cannot execute code.\n');
  });
 }catch{
  process.stderr.write('Device probe could not start. Check the reviewed key, own tunnel origin, pairing and command arguments.\n');
  process.exitCode=1;
 }
}
