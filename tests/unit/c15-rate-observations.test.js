import {describe,it,expect} from 'vitest';
import {createRateCollector,rateFromHeaders,recordRate,assertNotBlocked} from '../../src/github/rate.js';
import {createDispatch} from '../../src/tools/dispatch.js';
const NOW=Date.UTC(2026,9,27,20);
const head=(remaining,resource='core')=>({
  'x-ratelimit-remaining':String(remaining),'x-ratelimit-reset':String(Math.floor((NOW+60000)/1000)),
  'x-ratelimit-resource':resource});
describe('C-15 provider-header observations',()=>{
  it('persists the actual primary reset and remaining without another GitHub request',async()=>{
    const writes=[];const db={recordRateState:async row=>writes.push(row)};
    const row=await recordRate(db,'org',head(0),{now:()=>NOW});
    expect(writes).toHaveLength(1);
    expect(row).toMatchObject({resource:'core',remaining:0,
      resetAt:new Date(NOW+60000),blockedUntil:new Date(NOW+61000)});
    expect(writes[0].account).toBe('org');
  });
  it.each([['core',12],['search',4],['graphql',123]])('observes %s fresh remaining and reset without additional provider traffic', (resource,remaining)=>{
    const o=rateFromHeaders(head(remaining,resource),{now:()=>NOW});
    expect(o).toMatchObject({resource,remaining,resetAt:new Date(NOW+60000)});
    const collector=createRateCollector({now:()=>NOW});
    collector.record({account:'org',credential:'app',resource,observation:o});
    expect(collector.snapshot().items[0]).toMatchObject({account:'org',credential:'app',resource,remaining,source:'fresh'});
  });
  it('distinguishes secondary retry-after from primary exhaustion and unknown rate data',()=>{
    expect(rateFromHeaders({...head(8),'retry-after':'40'},{status:429,now:()=>NOW}))
      .toMatchObject({remaining:8,throttle:'secondary',blockedUntil:new Date(NOW+40000)});
    expect(rateFromHeaders(head(0),{status:403,now:()=>NOW}).throttle).toBe('primary');
    expect(rateFromHeaders({}, {status:403})).toBe(null);
  });
  it('never promotes expired remaining counts to a current allowance',()=>{
    const o=rateFromHeaders({'x-ratelimit-remaining':'80','x-ratelimit-reset':String(Math.floor((NOW-1000)/1000))});
    const c=createRateCollector({now:()=>NOW});
    c.record({account:'org',credential:'app',resource:'core',observation:o});
    expect(c.snapshot().items[0]).not.toHaveProperty('remaining');
  });
  it('does not conflate distinct accounts, credentials, or buckets and clips many rows',()=>{
    const c=createRateCollector({now:()=>NOW,max:3});
    for(const [account,credential,resource] of [
      ['org','app','core'],['org','personal','core'],['org','god_mode','core'],
      ['another','app','core'],['org','app','search'],['org','user','core']
    ])c.record({account,credential,resource,observation:rateFromHeaders(head(12,resource),{now:()=>NOW})});
    const out=c.snapshot();
    expect(out.items).toHaveLength(3);expect(out.more_observations).toBe(true);
    expect(new Set(out.items.map(x=>[x.account,x.credential,x.resource].join(':'))).size).toBe(3);
  });
  it('in a concurrent same-epoch pair retains lower observed remaining and newer reset wins',()=>{
    const c=createRateCollector({now:()=>NOW});
    for(const remaining of [3,9,2])c.record({account:'org',credential:'app',resource:'core',
      observation:rateFromHeaders(head(remaining),{now:()=>NOW})});
    expect(c.snapshot().items[0].remaining).toBe(2);
    const tomorrow={'x-ratelimit-remaining':'500','x-ratelimit-reset':String(Math.floor((NOW+3600000)/1000))};
    c.record({account:'org',credential:'app',resource:'core',observation:rateFromHeaders(tomorrow,{now:()=>NOW})});
    expect(c.snapshot().items[0].remaining).toBe(500);
    c.record({account:'org',credential:'app',resource:'core',observation:rateFromHeaders(head(1),{now:()=>NOW})});
    expect(c.snapshot().items[0].remaining).toBe(500);
  });
  it('cached DB block is labelled cached, cannot replace a fresh response, and causes no GitHub fetch',async()=>{
    const c=createRateCollector({now:()=>NOW});
    const db={getRateState:async()=>({remaining:7,reset_at:new Date(NOW+60000),blocked_until:new Date(NOW+30000)})};
    await expect(assertNotBlocked(db,'org','core',{onBlocked:state=>{
      c.record({account:'org',credential:'app',resource:'core',source:'cached',
        observation:{resource:'core',remaining:state.remaining,resetAt:state.reset_at,blockedUntil:state.blocked_until}});
    }})).rejects.toMatchObject({code:'rate_limited'});
    expect(c.snapshot().items[0]).toMatchObject({source:'cached',remaining:7});
    c.record({account:'org',credential:'app',resource:'core',
      observation:rateFromHeaders(head(3),{now:()=>NOW})});
    c.record({account:'org',credential:'app',resource:'core',source:'cached',
      observation:{resource:'core',remaining:7}});
    expect(c.snapshot().items[0]).toMatchObject({source:'fresh',remaining:3});
  });
});
describe('C-15 shared canonical dispatcher final response',()=>{
  const connection={client_id:'mine',accounts:['org'],default_account:'org',mode:'preview',profile:'read_only'};
  const dispatch=createDispatch({now:()=>NOW});
  function fixture(){
    const calls=[];
    const registry={tools:[
      {name:'github_testing_parent',area:'test',annotations:{readOnlyHint:true},usesRegistry:true,
        inputSchema:{type:'object',additionalProperties:false}},
      {name:'github_testing_child',area:'test',annotations:{readOnlyHint:true},
        inputSchema:{type:'object',additionalProperties:false}}
    ],handlers:{
      github_testing_parent:async(_,ctx)=>{
        await ctx.callTool('github_testing_child',{});
        return {result:'parent'};
      },
      github_testing_child:async(_,ctx)=>{
        ctx.rateObservations.record({account:'org',credential:'app',resource:'core',
          observation:rateFromHeaders(head(7),{now:()=>NOW})});
        return {result:'child'};
      }
    }};
    return {registry,calls};
  }
  it('adds observed rate only at the top-level response and preserves its text copy',async()=>{
    const f=fixture();const r=await dispatch({registry:f.registry,name:'github_testing_parent',args:{},
      connection,db:{},});
    expect(r.structuredContent).toMatchObject({result:'parent',meta:{github_rate:{items:[{remaining:7,source:'fresh'}]}}});
    expect(JSON.parse(r.content[0].text)).toEqual(r.structuredContent);
  });
  it('keeps rate meta in the full payload that RTC restores after large-text deduplication',async()=>{
    const registry={tools:[{name:'github_testing_large',area:'test',annotations:{readOnlyHint:true},
      inputSchema:{type:'object',additionalProperties:false}}],handlers:{
        github_testing_large:async(_,ctx)=>{
          ctx.rateObservations.record({account:'org',credential:'app',resource:'core',
            observation:rateFromHeaders(head(5),{now:()=>NOW})});
          return {body:'text'.repeat(600)};
        }
      }};
    const r=await dispatch({registry,name:'github_testing_large',args:{},connection,db:{}});
    expect(r.structuredContent).toMatchObject({full_payload_location:'content[0].text',
      meta:{github_rate:{items:[{remaining:5,source:'fresh'}]}}});
    expect(JSON.parse(r.content[0].text)).toMatchObject({body:'text'.repeat(600),
      meta:{github_rate:{items:[{remaining:5}]}}});
  });
  it('shares metadata with direct reads when known',async()=>{
    const f=fixture();const r=await dispatch({registry:f.registry,name:'github_testing_child',args:{},connection,db:{}});
    expect(r.structuredContent.meta.github_rate.items[0].remaining).toBe(7);
  });
});
