// Mandatory image integration, not included in the ordinary unit runner.
import {it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {makeWorld,parse,doorsFor} from '../../test/helpers/write-contract.js';
import {preparePlaygroundWorld} from '../../test/helpers/playground-world.js';
import * as tools from '../../src/tools/playground.js';
const base={owner:'example-org',repo:'hello',workspace_id:'job_0123456789abcdef'};
it('actual connector handler, dispatcher and github_call execute real UID1000 commands and read actual exit/log results',async()=>{
 expect(process.getuid()).toBe(0);
 const definition={tool:tools.tools.find(t=>t.name==='github_playground_execute'),handler:tools.handlers.github_playground_execute};
 for(const door of doorsFor(definition)){
  const w=await makeWorld({profile:'full',mode:'production',gates:[]});w.gh.when('GET /repos/{owner}/{repo}').reply(200,{full_name:'example-org/hello'});const close=await preparePlaygroundWorld(w,{real:true});
  try{
   const args={...base,argv:[process.execPath,'-e',"require('fs').writeFileSync('output.txt','actual command output');console.log('actual log');process.exit(7)"],requestKey:'real-command-'+door.name};
   const accepted=parse(await door.call(w,args));expect(accepted.status).toBe('applied');const id=accepted.result.execution_id;const slot=w.playground.runtime.active.get(id);if(slot)await slot.done;
   const status=await tools.handlers.github_playground_read({...base,operation:'status',execution_id:id},w.ctx);expect(status).toMatchObject({id,state:'failed',exitCode:7});expect(await readFile(join(w.playground.root,'repo/output.txt'),'utf8')).toBe('actual command output');
   const log=await tools.handlers.github_playground_read({...base,operation:'logs',execution_id:id},w.ctx);expect(Buffer.from(log.base64,'base64').toString()).toBe('actual log\n');expect(log.complete).toBe(true);
   w.advanceClock(3600000);expect(parse(await door.call(w,args)).replayed).toBe(true);
   const long=parse(await door.call(w,{...base,argv:[process.execPath,'-e','setInterval(()=>{},1000)'],requestKey:'cancel-'+door.name}));const cancelled=parse(await tools.handlers.github_playground_cancel({...base,execution_id:long.result.execution_id},w.ctx));expect(cancelled).toMatchObject({status:'applied',result:{execution:{state:'failed',reason:'cancelled'}}});
  }finally{await close();}
 }
});
