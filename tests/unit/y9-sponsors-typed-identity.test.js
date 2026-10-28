import {describe,it,expect} from 'vitest';
import {makeWorld,parse,doorsFor} from '../../test/helpers/write-contract.js';
import * as sponsor from '../../src/tools/y9-sponsorship.js';

const recipient='maintainer';
const active={id:'sponsor-1',isActive:true,isOneTimePayment:false,privacyLevel:'PRIVATE',
  isSponsorOptedIntoEmail:false,sponsorable:{login:recipient},tier:{id:'tier-5',monthlyPriceInCents:500}};
const mutations=gh=>gh.calls.filter(c=>/^mutation/.test(c.body?.query??''));
async function fixture({payerType='Organization',recipientType='User',...options}={}){
  const w=await makeWorld({mode:'production',profile:'full'});
  const payer='example-org';
  if(payerType!=='Organization'){
    await w.db.upsertAccount({login:payer,accountId:1011,accountType:payerType,label:payer,credentialKind:'fine_grained'});
    await w.credentials.storeUserAuthorization(payer,{userLogin:payer,accessToken:'ghu_FAKE0123456789abcdefghij',expiresIn:28800});
  }
  let payerIdentityReads=0;
  w.gh.when('GET /user').reply(200,()=>{ payerIdentityReads++; return options.me??{login:payerType==='User'?payer:'example-owner',id:payerType==='User'?1011:42,type:'User'}; });
  w.payerIdentityReads=()=>payerIdentityReads;
  w.gh.when('GET /user/memberships/orgs/{org}').reply(200,options.membership??{state:'active',role:'admin'});
  w.gh.when('GET /users/{username}').reply(200,options.actor??{login:recipient,id:73,type:recipientType});
  let tierReads=0;
  w.gh.when('POST /graphql').reply(200,request=>{
    const query=request.body.query;
    const isTiers=query.includes('Y9Tiers');
    const root=(isTiers?recipientType:payerType)==='User'?'user':'organization';
    // Real GitHub reports partial errors for the nonexistent opposite root.
    const roots=[...query.matchAll(/\b(user|organization)\(login:/g)].map(x=>x[1]);
    if(roots.length!==1||roots[0]!==root)return {data:{[root]:null},errors:[{type:'NOT_FOUND',message:'Wrong account type'}]};
    if(isTiers){
      tierReads++;
      const tier={id:'tier-5',isOneTime:!!options.cadenceChanges&&tierReads>1,monthlyPriceInCents:500};
      const row=options.listing??{login:recipient,hasSponsorsListing:true,sponsorsListing:{tiers:{nodes:[tier],pageInfo:{hasNextPage:false}}}};
      return {data:{[root]:row}};
    }
    if(query.includes('Y9Sponsor'))return {data:{[root]:options.relationship??{login:payer,sponsorshipsAsSponsor:{
      totalCount:options.active?1:0,pageInfo:{hasNextPage:false},nodes:options.active?[active]:[]}}}};
    return {errors:[{message:'Unexpected mutation in read fixture'}]};
  });
  return w;
}
describe('Sponsors verified entity selection',()=>{
  // An unreadable paid preflight fails target/read verification. Unknown pricing
  // does not replace that real cause with an owner spending refusal.
  for(const payerType of ['User','Organization'])for(const recipientType of ['User','Organization']){
    it('reads '+payerType+' payer and '+recipientType+' recipient without an opposite-type NOT_FOUND',async()=>{
      const w=await fixture({payerType,recipientType});
      const r=await sponsor.handlers.github_sponsor_get({recipient},w.ctx);
      expect(r).toMatchObject({payer:'example-org',recipient,active:null,sponsors_listing_available:true,
        tiers:[{id:'tier-5',one_time:false,price_cents:500}]});
      expect(w.gh.invalid).toEqual([]);
      expect(w.payerIdentityReads()).toBe(1); // one verified U read for two simultaneous inventories
      expect(mutations(w.gh)).toEqual([]);
    });
  }
  it('reports a verified absent listing without inventing tiers',async()=>{
    const w=await fixture({listing:{login:recipient,hasSponsorsListing:false,sponsorsListing:null}});
    expect(await sponsor.handlers.github_sponsor_get({recipient},w.ctx)).toMatchObject({
      active:null,sponsors_listing_available:false,tiers:[]});
    const out=parse(await sponsor.handlers.github_sponsor_set({recipient,action:'start',tierId:'tier-5',confirm:true},w.ctx));
    expect(out).toMatchObject({done:false,status:'refused_by_guard',refusedBy:'read'});
    expect(mutations(w.gh)).toEqual([]);
  });
  for(const listing of [
    {login:recipient,hasSponsorsListing:true,sponsorsListing:null},
    {login:'foreign',hasSponsorsListing:false,sponsorsListing:null},
    {login:recipient,hasSponsorsListing:false},
    {login:recipient,hasSponsorsListing:true,sponsorsListing:{tiers:{nodes:[],pageInfo:{hasNextPage:true}}}}
  ])it('refuses inconsistent, mismatched or truncated listing '+JSON.stringify(listing),async()=>{
    const w=await fixture({listing});
    await expect(sponsor.handlers.github_sponsor_get({recipient},w.ctx)).rejects.toThrow(TypeError);
    const out=parse(await sponsor.handlers.github_sponsor_set({recipient,action:'start',tierId:'tier-5',confirm:true},w.ctx));
    expect(out).toMatchObject({status:'refused_by_guard',refusedBy:'read'});
    expect(mutations(w.gh)).toEqual([]);
  });
  for(const options of [
    {me:{login:'foreign',id:42,type:'User'}},
    {me:{login:'example-owner',id:42,type:'Organization'}},
    {me:{login:'example-owner',id:0,type:'User'}},
    {payerType:'User',me:{login:'example-org',id:999,type:'User'}},
    {payerType:'Bot'},
    {membership:{state:'active',role:'member'}},
    {actor:{login:'foreign',id:73,type:'User'}},
    {actor:{login:recipient,id:73,type:'Bot'}}
  ])it('refuses unverified payer/recipient '+JSON.stringify(options),async()=>{
    const w=await fixture(options);
    await expect(sponsor.handlers.github_sponsor_get({recipient},w.ctx)).rejects.toThrow(TypeError);
    const out=parse(await sponsor.handlers.github_sponsor_set({recipient,action:'start',tierId:'tier-5',confirm:true},w.ctx));
    expect(out).toMatchObject({status:'refused_by_guard',refusedBy:'read'});
    expect(mutations(w.gh)).toEqual([]);
  });
  for(const relationship of [
    {login:'foreign',sponsorshipsAsSponsor:{nodes:[],totalCount:0,pageInfo:{hasNextPage:false}}},
    {login:'example-org',sponsorshipsAsSponsor:{nodes:[],totalCount:1,pageInfo:{hasNextPage:false}}},
    {login:'example-org',sponsorshipsAsSponsor:{nodes:[{...active,sponsorable:{login:'foreign'}}],totalCount:1,pageInfo:{hasNextPage:false}}},
    {login:'example-org',sponsorshipsAsSponsor:{nodes:[],totalCount:0,pageInfo:{}}}
  ])it('refuses incomplete or foreign relationship data '+JSON.stringify(relationship),async()=>{
    const w=await fixture({relationship});
    await expect(sponsor.handlers.github_sponsor_get({recipient},w.ctx)).rejects.toThrow(TypeError);
    const out=parse(await sponsor.handlers.github_sponsor_set({recipient,action:'start',tierId:'tier-5',confirm:true},w.ctx));
    expect(out).toMatchObject({status:'refused_by_guard',refusedBy:'read'});
    expect(mutations(w.gh)).toEqual([]);
  });
  it('refuses a changed tier cadence before any payment mutation',async()=>{
    const w=await fixture({cadenceChanges:true});
    const out=parse(await sponsor.handlers.github_sponsor_set({recipient,action:'start',tierId:'tier-5',confirm:true},w.ctx));
    expect(out.done).toBe(false);
    expect(JSON.stringify(out)).toContain('cadence');
    expect(mutations(w.gh)).toEqual([]);
  });
  for(const args of [{privacyLevel:'PUBLIC'},{receiveEmails:true}]){
    for(const door of doorsFor({tool:sponsor.tools.find(t=>t.name==='github_sponsor_change'),handler:sponsor.handlers.github_sponsor_change})){
      it(door.name+' classifies exposure and allows a delegated access guard to refuse '+JSON.stringify(args),async()=>{
        const w=await fixture({active:true});
        const preview=parse(await door.call(w,{recipient,action:'preferences',...args,dryRun:true}));
        expect(preview.preview).toContain('ACCESS CHANGE');
        expect(preview.preview).toContain(recipient);
        w.ctx.gates=[async({classification})=>classification.accessWidening?{refuse:'Access changes are disabled by this delegated pass.',by:'delegated access'}:null];
        const out=parse(await door.call(w,{recipient,action:'preferences',...args,confirm:true}));
        expect(out).toMatchObject({status:'refused_by_guard',refusedBy:'delegated access'});
        expect(mutations(w.gh)).toEqual([]);
      });
    }
  }
});
