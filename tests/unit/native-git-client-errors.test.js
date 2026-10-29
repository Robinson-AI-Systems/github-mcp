import {it,expect} from 'vitest';
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
