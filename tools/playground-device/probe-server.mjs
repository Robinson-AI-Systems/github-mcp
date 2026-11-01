// PLAY-2 user-side loopback service. The user starts and tunnels it from their
// own PC; it has NO Docker socket, GitHub key, command execution or control-plane
// private signer. It can only attest to receiving a live signed probe.
import {createServer} from 'node:http';
import {sign,createPublicKey} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadOrCreateDeviceKey} from './pair.mjs';
import {createPersistentProbeNonceStore} from './probe-nonces.mjs';
import {readLocalCanaryReceipt} from './canary-receipt.mjs';
import {verifyLocalRuntimeCanaryClaim,localRuntimeCanaryReply} from '../../src/playground/device-canary.js';
import {verifyDeviceProbeClaim,deviceProbeResponse,pinnedDeviceOrigin} from '../../src/playground/device-probe.js';

export function createDeviceProbeServer({deviceId,origin,generation,controlPublicKey,devicePrivateKey,now=Date.now,consumeNonce=null,canarySource=null}={}){
 pinnedDeviceOrigin(origin);
 if(!/^[a-f0-9]{32}$/.test(deviceId??'')||!Number.isSafeInteger(generation)||generation<1||
    !devicePrivateKey||devicePrivateKey.asymmetricKeyType!=='ed25519')throw new TypeError('Verified local device key, identity and generation required.');
 const recent=new Map();
 const server=createServer({headersTimeout:8000,requestTimeout:10000,maxHeaderSize:8192},async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Type','application/json');
  const send=(status,error)=>{res.statusCode=status;res.end(JSON.stringify({error}));};
  if(req.method!=='POST'||!['/v1/enrollment/probe','/v1/enrollment/canary'].includes(req.url)||
     (req.url==='/v1/enrollment/canary'&&!canarySource))return send(404,'not_found');
  try{
   if(Number(req.headers['content-length']??0)>4096)return send(413,'request_too_large');
   let length=0;const parts=[];
   for await(const chunk of req){length+=chunk.length;if(length>4096)return send(413,'request_too_large');parts.push(chunk);}
   const body=Buffer.concat(parts).toString('utf8');
   const claim=req.url==='/v1/enrollment/probe'
     ?verifyDeviceProbeClaim(body,String(req.headers['x-robinson-signature']??''),controlPublicKey,{deviceId,origin,generation,now})
     :verifyLocalRuntimeCanaryClaim(body,String(req.headers['x-robinson-signature']??''),controlPublicKey,{deviceId,origin,generation,now});
   for(const [nonce,expiry] of recent)if(expiry<=now())recent.delete(nonce);
   if(recent.has(claim.nonce)||recent.size>=256)return send(409,'claim_replayed_or_busy');
   if(consumeNonce)await consumeNonce(claim);
   recent.set(claim.nonce,claim.expiresAt);
   let proof;
   if(req.url==='/v1/enrollment/probe')proof=JSON.stringify(deviceProbeResponse(claim,{now}));
   else{
    const publicKey='ed25519:'+createPublicKey(devicePrivateKey).export({format:'der',type:'spki'}).toString('base64');
    const receipt=await readLocalCanaryReceipt({deviceId,generation,origin,
      binding:canarySource.binding,image:canarySource.image,now,publicKey});
    proof=JSON.stringify(localRuntimeCanaryReply(claim,receipt,{now}));
   }
   res.setHeader('x-robinson-device-signature','ed25519:'+sign(null,Buffer.from(proof),devicePrivateKey).toString('base64url'));
   res.statusCode=200;res.end(proof);
  }catch{return send(401,'invalid_authorization');}
 });
 return server;
}
function parse(argv){
 const o={},valid=new Set(['--device','--origin','--generation','--control-key','--port','--binding','--image']);
 for(let i=0;i<argv.length;i+=2){if(!valid.has(argv[i])||typeof argv[i+1]!=='string'||Object.hasOwn(o,argv[i]))throw Error();o[argv[i]]=argv[i+1];}
 if(!o['--device']||!o['--origin']||!o['--control-key']||!/^[1-9][0-9]*$/.test(o['--generation']??'')||
    !/^[1-9][0-9]*$/.test(o['--port']??'')||
    !Number.isSafeInteger(Number(o['--generation']))||
    Number(o['--port'])<1024||Number(o['--port'])>65535||
    Boolean(o['--binding'])!==Boolean(o['--image'])||
    (o['--binding']&&!/^[a-f0-9]{64}$/.test(o['--binding']))||
    (o['--image']&&!/^[a-z0-9][a-z0-9._/-]*(?::[a-z0-9._-]+)?@sha256:[a-f0-9]{64}$/.test(o['--image'])))throw Error();
 return o;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 try{
  const o=parse(process.argv.slice(2));
  const {privateKey}=await loadOrCreateDeviceKey();
  const consumeNonce=await createPersistentProbeNonceStore();
  const server=createDeviceProbeServer({deviceId:o['--device'],origin:o['--origin'],
    generation:Number(o['--generation']),controlPublicKey:o['--control-key'],devicePrivateKey:privateKey,consumeNonce,
    ...(o['--binding']?{canarySource:{binding:o['--binding'],image:o['--image']}}:{})});
  server.listen(Number(o['--port']),'127.0.0.1',()=>{
   process.stdout.write('The signed Playground device probe listens on local loopback only. Configure your own outbound HTTPS tunnel to this port; it cannot execute code.\n');
  });
 }catch{
  process.stderr.write('Device probe could not start. Check the reviewed key, own tunnel origin, pairing and command arguments.\n');
  process.exitCode=1;
 }
}
