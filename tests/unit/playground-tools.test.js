import {afterEach,it,expect} from 'vitest';
import {runWriteContract,makeWorld,parse,doorsFor} from '../../test/helpers/write-contract.js';
import {preparePlaygroundWorld} from '../../test/helpers/playground-world.js';
import * as playground from '../../src/tools/playground.js';
import {playgroundRecord,playgroundAllocation,playgroundBinding,playgroundRequestKey,callPlayground} from '../../src/playground/client.js';
import {nativeRecord} from '../../src/native-git/client.js';
import {createDispatch} from '../../src/tools/dispatch.js';
import {registry} from '../../src/tools/index.js';
const cleanups=[];afterEach(async()=>{for(const close of cleanups.splice(0))await close();});
const definition=name=>({tool:playground.tools.find(t=>t.name===name),handler:playground.handlers[name]});
const base={owner:'example-org',repo:'hello',workspace_id:'job_0123456789abcdef'};
const arrange=(gh,outcome)=>{gh.nativeOutcome=outcome;gh.when('GET /repos/{owner}/{repo}').reply(200,{full_name:'example-org/hello'});};
for(const [name,args] of [
 ['github_playground_execute',{...base,argv:['npm','test'],requestKey:'command-one'}],
 ['github_playground_cancel',{...base,execution_id:'a'.repeat(64)}]
])runWriteContract({label:name,definition:definition(name),args,arrange,needsConfirm:true,profile:'full',expectedWrites:0,prepare:async w=>cleanups.push(await preparePlaygroundWorld(w))});
async function world(){const w=await makeWorld({profile:'full',mode:'production',gates:[]});arrange(w.gh,'ok');cleanups.push(await preparePlaygroundWorld(w));return w;}
it('all write doors execute once across time buckets and make acceptance distinct from command success',async()=>{
 for(const door of doorsFor(definition('github_playground_execute'))){const w=await world(),args={...base,argv:['npm','test'],requestKey:'stable-command'};const first=parse(await door.call(w,args));expect(first).toMatchObject({status:'applied',result:{accepted:true,command_succeeded:false}});w.advanceClock(3600000);const second=parse(await door.call(w,args));expect(second.replayed).toBe(true);expect(w.playground.starts()).toBe(1);expect(w.playgroundRequests.filter(x=>x.action==='start')).toHaveLength(1);expect(w.playgroundRequests.every(x=>!('credential'in x))).toBe(true);}
});
it('registers discoverable agent-facing tools and applies repository/area/read-only restrictions before execution',async()=>{
 const w=await world(),dispatch=createDispatch({env:w.ctx.env,credentials:w.ctx.credentials,fetch:w.ctx.fetch,now:w.ctx.now});const call=(name,args,connection=w.ctx.connection)=>dispatch({registry,name,args,connection,db:w.db});for(const query of ['playground execute','runtime sandbox','shell commands']){const search=parse(await call('github_search_tools',{query}));expect(JSON.stringify(search)).toContain('github_playground_execute');}
 const args={...base,argv:['true'],requestKey:'deny'};
 for(const connection of [{...w.ctx.connection,profile:'read_only'},{...w.ctx.connection,pass:true,allow_writes:true,areas:['git']},{...w.ctx.connection,pass:true,allow_writes:true,areas:['playground'],repos:['example-org/other']}]){const before=w.playgroundRequests.length;expect((await call('github_playground_execute',args,connection)).isError).toBe(true);expect(w.playgroundRequests.length).toBe(before);}
});
it('rejects foreign workspaces, mismatched repository, invalid allocation routes and missing setup without any runtime send',async()=>{
 const w=await world(),record=await nativeRecord(w.ctx,base.workspace_id);const entry={workspace_id:base.workspace_id,binding:playgroundBinding(record),origin:'https://playground.example.test/'};
 for(const route of [{...entry,origin:'http://127.0.0.1/'},{...entry,origin:'https://host.test/path'},{...entry,binding:'a'.repeat(64)},{...entry,credential:'ghp_FAKE_FORBIDDEN'}])expect(()=>playgroundAllocation({PLAYGROUND_ALLOCATIONS:JSON.stringify([route])},record)).toThrow();
 expect(()=>playgroundAllocation({},record)).toThrow(/No isolated/);expect(()=>playgroundAllocation({PLAYGROUND_ALLOCATIONS:JSON.stringify([entry,entry])},record)).toThrow();
 await expect(playgroundRecord(w.ctx,{...base,repo:'other'})).rejects.toThrow(/does not match/);await expect(playgroundRecord({...w.ctx,connection:{...w.ctx.connection,client_id:'foreign'}},base)).rejects.toThrow();expect(w.playgroundRequests).toHaveLength(0);
});
it('reports transport uncertainty without retry and withholds incompletely protected base64 logs',async()=>{
 const w=await world(),record=await playgroundRecord(w.ctx,base);let sent=0;const ctx={...w.ctx,fetch:async()=>{sent++;throw new Error('private transport diagnostic');}};
 await expect(callPlayground(ctx,record,'capabilities')).rejects.toThrow(/original execution/);expect(sent).toBe(1);
 expect(()=>playgroundRequestKey(w.ctx,{...base})).toThrow(/stable requestKey/);
});
it('capabilities do not renew leases and log retrieval includes complete retained windows',async()=>{
 const w=await world(),read=playground.handlers.github_playground_read;const before=await w.db.getJob(base.workspace_id,(await nativeRecord(w.ctx,base.workspace_id)).binding.connection);w.advanceClock(1000);const cap=await read({...base,operation:'capabilities'},w.ctx);expect(cap.product).toBe("Robinson's Playground");const after=await w.db.getJob(base.workspace_id,(await nativeRecord(w.ctx,base.workspace_id)).binding.connection);expect(String(after.expires_at)).toBe(String(before.expires_at));
 const logs=await read({...base,operation:'logs',execution_id:'a'.repeat(64)},w.ctx);expect(Buffer.from(logs.base64,'base64').toString()).toContain('complete fixture output');expect(logs.complete).toBe(true);
});
it('changed argv with the same caller intent is refused by the original runtime receipt, never executed twice',async()=>{
 const w=await world(),handler=playground.handlers.github_playground_execute;
 expect(parse(await handler({...base,argv:['first'],requestKey:'same-intent'},w.ctx)).status).toBe('applied');
 const changed=parse(await handler({...base,argv:['second'],requestKey:'same-intent'},w.ctx));expect(changed.status).toBe('rejected');expect(changed.error).toContain('execution_id=');expect(w.playground.starts()).toBe(1);
 const status=await playground.handlers.github_playground_read({...base,operation:'status',requestKey:'same-intent'},w.ctx);expect(status.state).toBe('running');
});

it('unattached capabilities disclose only nonsecret setup binding after exact repository authorization',async()=>{
 const w=await world(),ctx={...w.ctx,env:{...w.ctx.env,PLAYGROUND_ALLOCATIONS:'[]'}};
 const setup=await playground.handlers.github_playground_read({...base,operation:'capabilities'},ctx);expect(setup).toMatchObject({setup_required:true,runtime_attached:false,workspace_id:base.workspace_id});expect(setup.allocation_binding).toMatch(/^[a-f0-9]{64}$/);expect(setup.verification_key).toMatch(/^ed25519:/);expect(setup).not.toHaveProperty('authority');expect(w.playgroundRequests).toHaveLength(0);
 await expect(playground.handlers.github_playground_read({...base,repo:'foreign',operation:'capabilities'},ctx)).rejects.toThrow();
});
