// Disposable CI rehearsal of the exact owner-run Docker installer contract.
// No paid/production device, real enrollment or controller service is touched.
import {randomBytes,generateKeyPairSync} from 'node:crypto';
import {devicePlan,createLocalRuntime} from './install.mjs';

const {publicKey}=generateKeyPairSync('ed25519');
const plan=devicePlan({
 deviceId:randomBytes(16).toString('hex'),
 binding:randomBytes(32).toString('hex'),
 image:'robinson-coding:test',
 controlPublicKey:'ed25519:'+publicKey.export({format:'der',type:'spki'}).toString('base64'),
 cpuCpus:2,memoryMiB:2048,allowLocalImage:true
});
const runtime=createLocalRuntime();
let passed=false;
try{
 const preview=runtime.plan(plan);
 if(preview.providerMutated!==false||preview.controllerAdmission!==false)throw new Error('Local plan unexpectedly admits or mutates a host.');
 await runtime.install(plan);
 const proof=await runtime.canary(plan);
 if(proof.canaryPassed!==true||proof.controllerAdmission!==false||
   proof.postgres!=='15'||proof.node!=='24'||proof.chromium!==true)
   throw new Error('Actual container canary did not meet its declared local proof.');
 passed=true;
}finally{
 const result=await runtime.remove(plan);
 if(result.disposed!==true||!result.volumeAbsent||!result.networkAbsent||!result.containerAbsent)
   throw new Error('Actual container process/volume/network cleanup was not confirmed.');
}
if(passed)process.stdout.write('Local enrolled-device runtime canary and whole-owned-resource removal passed (not remote enrollment).\n');
