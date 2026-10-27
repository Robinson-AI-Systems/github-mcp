// C-8 reproducible fake-IO benchmark. The 25 ms sleeps represent DB
// scheduling only: these numbers are NOT production or GitHub API timings.
import { performance } from 'node:perf_hooks';
import { actAsFor } from '../src/github/act-as.js';
import { createTenantMetricBuffer, withTenantProviderMetrics } from '../src/tenancy/runtime-limits.js';

const fakeReadMs=25,repetitions=5;
const delay=()=>new Promise(resolve=>setTimeout(resolve,fakeReadMs));
const median=(numbers)=>[...numbers].sort((a,b)=>a-b)[Math.floor(numbers.length/2)];
const clock=async(fn)=>{const start=performance.now();await fn();return performance.now()-start;};

async function measure(fn) {
  const times=[];
  for (let i=0;i<repetitions;i++) times.push(await clock(fn));
  return Number(median(times).toFixed(2));
}

const read=async()=>{await delay();return null;};
const serialControl=async()=>{
  await read(); await read(); await read(); await read();
};
const optimizedEvidence=async()=>{
  const ctx={
    db:{ getRateState:async()=>{await delay();return null;},getSetting:async()=>{await delay();return null;} },
    credentials:{masterStatus:async()=>({enrolled:true,subject:'synthetic',scopes:['repo'],login:'fixture'})},
    connection:{profile:'full'},actAsCache:{},env:{}
  };
  const result=await actAsFor(ctx,{cred:'I'});
  if(result.on!==true) throw new Error('Synthetic Act-as evidence unexpectedly refused.');
};
const mockSql=async()=>{await delay();return []};
const mockFetch=async()=>new Response(null,{status:200});
const legacy=withTenantProviderMetrics(mockSql,mockFetch);
const before=async()=>{await legacy();await legacy();};
const after=async()=>{
  const metrics=createTenantMetricBuffer(mockSql);
  const fetch=withTenantProviderMetrics(mockSql,mockFetch,{buffer:metrics});
  await fetch();await fetch();await metrics.flush();
};
const rows=[
  {name:'actAsEvidence',serialControlMedianMs:await measure(serialControl),
    optimizedMedianMs:await measure(optimizedEvidence)},
  {name:'providerTwoReadsAndFlush',serialControlMedianMs:await measure(before),
    optimizedMedianMs:await measure(after)}
];
process.stdout.write(JSON.stringify({fakeReadMs,repetitions,rows})+'\n');
