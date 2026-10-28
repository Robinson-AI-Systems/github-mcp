import { describe, it, expect } from 'vitest';
import { makeWorld, parse } from '../../test/helpers/write-contract.js';
import * as copilot from '../../src/tools/y9-copilot.js';
import * as copilotRepos from '../../src/tools/y9-copilot-repos.js';
import * as sponsor from '../../src/tools/y9-sponsorship.js';
import * as hosted from '../../src/tools/y9-hosted-runners.js';
import * as agent from '../../src/tools/y9-agent-tasks.js';
import { registry } from '../../src/tools/index.js';
import { spendGate } from '../../src/tools/spend-guard.js';
import { inspectGraphql } from '../../src/github/graphql-schema.js';

const defs=[...copilot.tools,...copilotRepos.tools,...sponsor.tools,...hosted.tools,...agent.tools];
const call=async (module,name,w,args)=>{ const reply=await module.handlers[name](args,w.ctx); return module.tools.find(x=>x.name===name)?.readContract?reply:parse(reply); };
describe('Y-9d financial and Copilot integration',()=>{
  it('validates all sponsorship reads and paid mutations against the vendored GitHub GraphQL schema',()=>{
    const docs=sponsor.sponsorDocuments;
    for(const doc of [docs.tiers,docs.tiersOrganization])
      expect(inspectGraphql(doc,{recipient:'example-maintainer'},'query').points).toBeGreaterThan(0);
    for(const doc of [docs.state,docs.stateUser])
      expect(inspectGraphql(doc,{sponsor:'example-org',recipient:['example-maintainer']},'query').points).toBeGreaterThan(0);
    for(const [doc,input] of [
      [docs.start,{sponsorLogin:'example-org',sponsorableLogin:'example-maintainer',tierId:'tier-id'}],
      [docs.cancel,{sponsorLogin:'example-org',sponsorableLogin:'example-maintainer'}],
      [docs.preferences,{sponsorLogin:'example-org',sponsorableLogin:'example-maintainer',privacyLevel:'PRIVATE'}]
    ])expect(inspectGraphql(doc,{input},'mutation').mutation).toBeTruthy();
  });
  it('registers every named capability exactly once with its advertised permission profile',()=>{
    const names=defs.map(x=>x.name);
    expect(new Set(names).size).toBe(17);
    for(const name of names){
      expect(registry.tools.some(x=>x.name===name)).toBe(true);
      const def=defs.find(x=>x.name===name);
      expect(def.name.startsWith('github_')).toBe(true);
      if(def.writes){expect(def.declarations.confirm).toBe('always');expect(def.profiles).toContain('full');}
    }
  });
  it('prevents any hosted-runner update from a PREVIEW connection',async()=>{
    const w=await makeWorld({delegated:true,mode:'preview',profile:'full'});
    w.gh.when('GET /orgs/{org}/actions/hosted-runners/{hosted_runner_id}')
      .reply(200,{id:18,name:'linux-large',maximum_runners:10,status:'ready'});
    const r=await call(hosted,'github_hosted_runner_manage',w,{runnerId:18,action:'update',name:'safer'});
    expect(r.status).toBe('refused_by_guard');
    expect(r.refusedBy).toBe('mode');
    expect(w.gh.calls.some(x=>x.method==='PATCH'||x.method==='DELETE')).toBe(false);
  });
  it('supports read-only hosted-runner inventory without a write',async()=>{
    const w=await makeWorld({mode:'preview',profile:'read_only'});
    w.gh.when('GET /orgs/{org}/actions/hosted-runners').reply(200,{
      total_count:1,runners:[{id:18,name:'linux-large',maximum_runners:5}]});
    const r=await call(hosted,'github_hosted_runner_list',w,{});
    expect(r.complete).toBe(true);
    expect(r.runners[0]).toMatchObject({name:'linux-large',maximum_runners:5});
    expect(w.gh.calls.every(x=>x.method==='GET')).toBe(true);
  });
  it('Cloud agent expansion never starts in PREVIEW',async()=>{
    const w=await makeWorld({delegated:true,mode:'preview',profile:'full'});
    w.gh.when('GET /orgs/{org}/copilot/coding-agent/permissions')
      .reply(200,{enabled_repositories:'none'});
    const result=await call(copilot,'github_copilot_agent_policy_set',w,
      {enabledRepositories:'all',confirm:true});
    expect(result.status).toBe('refused_by_guard');
    expect(w.gh.calls.filter(x=>x.method==='PUT')).toHaveLength(0);
  });
  it('requires a real user principal for paid Sponsorship changes',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    w.gh.when('GET /user').reply(403,{message:'no user authorization'});
    const result=await call(sponsor,'github_sponsor_set',w,
      {recipient:'example-maintainer',action:'start',tierId:'tier001',confirm:true});
    expect(result.done).toBe(false);
    expect(w.gh.calls.every(x=>x.method!=='POST'||x.route!=='POST /graphql')).toBe(true);
  });
  it('a product user can preview metered cloud-agent execution without a fake cost or mutation',async()=>{
    const w=await makeWorld({mode:'production',profile:'full',gates:[spendGate()]});
    w.gh.when('GET /user').reply(200,{id:10,login:'example-owner'});
    w.gh.when('GET /repos/{owner}/{repo}').reply(200,{
      id:100,full_name:'example-org/test-repo',default_branch:'main',archived:false,disabled:false});
    w.gh.when('GET /repos/{owner}/{repo}/branches/{branch}')
      .reply(200,{name:'main',commit:{sha:'a'.repeat(40)}});
    const result=await call(agent,'github_copilot_agent_task_start',w,
      {repo:'test-repo',prompt:'Review the pull request and add a test',dryRun:true});
    expect(result.status).toBe('preview');
    expect(result.preview).toContain('COST UNKNOWN');
    expect(w.gh.calls.every(x=>x.method==='GET')).toBe(true);
  });
  it('a product user can preview runner creation with unknown future cost',async()=>{
    const w=await makeWorld({mode:'production',profile:'full',gates:[spendGate()]});
    w.gh.when('GET /orgs/{org}/actions/hosted-runners/machine-sizes')
      .reply(200,{machine_sizes:[{id:'4-core'}]});
    w.gh.when('GET /orgs/{org}/actions/runner-groups')
      .reply(200,{runner_groups:[{id:7,name:'Default'}]});
    w.gh.when('GET /orgs/{org}/actions/hosted-runners')
      .reply(200,{total_count:0,runners:[]});
    const args={name:'team-linux',runnerGroupId:7,imageId:'ubuntu-latest',
      imageSource:'github',size:'4-core'};
    const preview=await call(hosted,'github_hosted_runner_create',w,{...args,dryRun:true});
    expect(preview.status).toBe('preview');
    expect(preview.preview).toContain('COST UNKNOWN');
    expect(w.gh.calls.every(x=>x.method==='GET')).toBe(true);
  });
  it('a user-selected $0 limit refuses unknown metered charges',async()=>{
    const w=await makeWorld({delegated:true,mode:'production',profile:'full',gates:[spendGate()]});
    await w.db.setSpendLimitCents('example-org',0);
    w.gh.when('GET /orgs/{org}/actions/hosted-runners/machine-sizes')
      .reply(200,{machine_sizes:[{id:'4-core'}]});
    w.gh.when('GET /orgs/{org}/actions/runner-groups')
      .reply(200,{runner_groups:[{id:7,name:'Default'}]});
    w.gh.when('GET /orgs/{org}/actions/hosted-runners')
      .reply(200,{total_count:0,runners:[]});
    const out=await call(hosted,'github_hosted_runner_create',w,{name:'team-linux',
      runnerGroupId:7,imageId:'ubuntu-latest',imageSource:'github',size:'4-core',confirm:true});
    expect(out.status).toBe('refused_by_guard');
    expect(out.refusedBy).toBe('spend limit');
    expect(w.gh.calls.every(x=>x.method==='GET')).toBe(true);
  });
});
