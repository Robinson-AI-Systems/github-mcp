import {it,expect,vi} from 'vitest';
import {nativeWorkerRoute,nativeWorkerHost} from '../../src/native-git/protocol.js';
import {callNativeWorker} from '../../src/native-git/client.js';
const ctx=fetch=>({env:{NATIVE_GIT_WORKER_URL:'https://worker.example.test/',NATIVE_GIT_WORKER_KEY:'FAKE-worker-service-key-for-local-tests-only'},fetch});
const call=fetch=>callNativeWorker(ctx(fetch),{action:'capabilities'});
it('never reflects network exception bodies and labels uncertain transport failures',async()=>{
 await expect(call(async()=>{throw new Error('private /data/tenant/path');})).rejects.toMatchObject({safeMessage:true,nativeCode:'native_transport'});
 try{await call(async()=>{throw new Error('private /data/tenant/path');});}catch(e){expect(e.message).not.toContain('/data');}
});
it.each(['null','[]','not json'])('rejects invalid worker response %s without reflecting it',async body=>{
 await expect(call(async()=>new Response(body))).rejects.toMatchObject({safeMessage:true,nativeCode:'native_response'});
});
it('handles missing and interrupted bodies explicitly',async()=>{
 await expect(call(async()=>new Response(null))).rejects.toMatchObject({nativeCode:'native_response'});
 const stream=new ReadableStream({start(c){c.error(new Error('private stream failure'));}});
 await expect(call(async()=>new Response(stream))).rejects.toMatchObject({nativeCode:'native_response'});
});
it('bounds and redacts worker reasons and keeps busy hints distinct',async()=>{
 try{await call(async()=>new Response(JSON.stringify({reason:'Cannot read /data/workspaces/private/file '+ 'x'.repeat(400)}),{status:400}));}catch(e){expect(e.message.length).toBeLessThan(300);expect(e.message).not.toContain('/data/workspaces');expect(e.safeMessage).toBe(true);}
 await expect(call(async()=>new Response('{}',{status:429}))).rejects.toMatchObject({nativeCode:'native_busy',status:429});
});

it('pins configured canonical origins and refuses missing hosts or invalid legacy cutovers before transport',async()=>{
 const env={NATIVE_GIT_WORKER_URL:'https://new-worker.example.test',NATIVE_GIT_PREVIOUS_WORKER_URL:'https://old-worker.example.test',NATIVE_GIT_WORKER_CUTOVER_AT:'2026-10-29T15:55:56.268Z'};
 const old=nativeWorkerHost({NATIVE_GIT_WORKER_URL:env.NATIVE_GIT_PREVIOUS_WORKER_URL});
 expect(nativeWorkerRoute(env,{host:old})).toBe('https://old-worker.example.test/v1/workspace');
 expect(nativeWorkerRoute(env,{createdAt:'2026-10-29T15:55:56.267Z'})).toContain('old-worker');
 expect(nativeWorkerRoute(env,{createdAt:'2026-10-29T15:55:56.268Z'})).toContain('new-worker');
 expect(nativeWorkerRoute(env)).toContain('new-worker');
 const fetch=vi.fn();
 await expect(callNativeWorker({...ctx(fetch),env},{action:'capabilities',job:{host:'f'.repeat(32)}})).rejects.toMatchObject({safeMessage:true,safeCode:'native_worker_host_unavailable'});
 await expect(callNativeWorker({...ctx(fetch),env:{...env,NATIVE_GIT_WORKER_CUTOVER_AT:'invalid'}},{action:'capabilities',job:{createdAt:'2026-10-29T15:00:00Z'}})).rejects.toMatchObject({safeMessage:true,safeCode:'native_worker_route_configuration'});
 await expect(callNativeWorker({...ctx(fetch),env:{...env,NATIVE_GIT_PREVIOUS_WORKER_URL:undefined}},{action:'capabilities',job:{host:old}})).rejects.toMatchObject({safeMessage:true,safeCode:'native_worker_host_unavailable'});
 expect(fetch).not.toHaveBeenCalled();
});
