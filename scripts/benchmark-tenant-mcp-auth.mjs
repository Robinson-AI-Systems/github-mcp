// Synthetic artificial-delay benchmark only. Not an official-vs-custom MCP comparison.
import { readTenantMcpEligibility, tenantMcpAccountsLive } from '../src/tenancy/mcp-route.js';
const delay = (ms = 20) => new Promise(resolve => setTimeout(resolve, ms));
const env={GITHUB_PILOT_APP_ID:'91',VERCEL_ENV:'production'};
const claim={tenantId:'tenant-a',identityId:'identity-a'};
const record={credential_kind:'app',app_id:91,installation_id:23,
  installation_status:'active',production_enabled:true};
const directory={
  authorizedPilotIdentity:async()=>{await delay();return {active:true};},
  authorized:async()=>{await delay();return {active:true};},
  marketplaceBinding:async()=>{await delay();return null;}
};
const db={getAccount:async()=>{await delay();return record;},
  getAccessToken:async()=>{await delay();return {client_id:'tcl_test'};}};
const runs=[];
for(let i=0;i<4;i++){
  const startSerial=performance.now();
  // Previous hot path read pilot, market, authorized, market again,
  // token row, three accounts in a loop and the same token row again.
  await directory.authorizedPilotIdentity();
  await directory.marketplaceBinding();
  await directory.authorized();
  await directory.marketplaceBinding();
  await db.getAccessToken();
  for(const a of ['a','b','c']) await db.getAccount(a);
  await db.getAccessToken();
  const serial=performance.now()-startSerial;
  const startOptimized=performance.now();
  await readTenantMcpEligibility(directory,claim);
  // Open the namespace and prove the grant remain real SQL in production;
  // only duplicate membership/marketplace/token reads are absent here.
  await db.getAccessToken();
  await tenantMcpAccountsLive(db,['a','b','c'],'production',env);
  const optimized=performance.now()-startOptimized;
  runs.push({serial,optimized});
}
const median=vals=>{const a=[...vals].sort((x,y)=>x-y);return (a[1]+a[2])/2;};
const serialControlMedianMs=Math.round(median(runs.map(r=>r.serial)));
const optimizedMedianMs=Math.round(median(runs.map(r=>r.optimized)));
const report={benchmark:'simulated tenant authentication SQL (NOT production)',
  fakeSqlDelayMs:20,repetitions:4,
  serialControlMedianMs,optimizedMedianMs,
  reductionPercent:Math.round(100*(1-optimizedMedianMs/serialControlMedianMs))};
if(optimizedMedianMs>=serialControlMedianMs)process.exitCode=1;
console.log(JSON.stringify(report));
