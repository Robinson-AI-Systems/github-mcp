import {afterEach} from 'vitest';
import {runWriteContract} from '../../test/helpers/write-contract.js';
import {prepareNativeWorld} from '../../test/helpers/native-git-world.js';
import * as playground from '../../src/tools/playground.js';
const cleanups=[];afterEach(async()=>{for(const close of cleanups.splice(0))await close();});
const name='github_playground_workspace';
runWriteContract({label:name,definition:{tool:playground.tools.find(t=>t.name===name),handler:playground.handlers[name]},args:{owner:'example-org',repo:'hello',workspace_id:'job_0123456789abcdef',operation:'provision',requestKey:'provision'},needsConfirm:true,profile:'full',expectedWrites:0,
 arrange:(gh,outcome)=>{gh.nativeOutcome=outcome;gh.when('GET /repos/{owner}/{repo}').reply(200,{full_name:'example-org/hello'});},
 prepare:async w=>{
  cleanups.push(await prepareNativeWorld(w,{existing:true}));const rows=new Map();let sequence=0;
  const prior=w.ctx.fetch;
  const fetch=async(url,init)=>{
   if(new URL(url).origin!=='https://dokploy.example.test')return prior(url,init);
   const u=new URL(url),op=u.pathname.split('/').pop(),input=init.method==='GET'?Object.fromEntries(u.searchParams):JSON.parse(init.body),row=rows.get(input.composeId);
   if(op==='project.one')return Response.json({projectId:'fixture',environments:[{environmentId:'fixture-env',compose:[...rows.values()]}]});
   if(op==='compose.create'){const created={...input,composeId:'compose-'+ ++sequence,environment:{projectId:'fixture'},domains:[],composeStatus:'idle',afterDeploy:0};rows.set(created.composeId,created);return Response.json(created);}
   if(op==='compose.one'){if(row?.composeStatus==='done'&&!row.appName.includes('manager')&&++row.afterDeploy>1&&w.gh.nativeOutcome==='mismatch')return Response.json(null,{status:404});return Response.json(row??null,{status:row?200:404});}
   if(op==='domain.create'){rows.get(input.composeId).domains.push(input);return Response.json(input);}
   if(op==='compose.deploy'){row.composeStatus='done';return Response.json({});}
   throw Error('Unexpected provider operation '+op);
  };
  w.gh.fetch=fetch;w.ctx={...w.ctx,fetch,env:{...w.ctx.env,PUBLIC_BASE_URL:'https://mcp.example.test',PLAYGROUND_DOKPLOY_ORIGIN:'https://dokploy.example.test',PLAYGROUND_DOKPLOY_API_KEY:'FAKE_PROJECT_KEY',PLAYGROUND_DOKPLOY_PROJECT_ID:'fixture',PLAYGROUND_DOKPLOY_ENVIRONMENT_ID:'fixture-env',PLAYGROUND_IMAGE:'ghcr.io/example/runtime@sha256:'+'a'.repeat(64),PLAYGROUND_INGRESS_IPV4:'107.90.116.157',PLAYGROUND_ADMISSION:JSON.stringify({project:'fixture',observedAt:w.ctx.now(),availableMemoryBytes:8*1024**3,availableDiskBytes:10*1024**3,pressure:0})}};
  await w.nativeReady();
 }
});
