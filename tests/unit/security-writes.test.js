import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { runWriteContract, makeWorld, parse } from '../../test/helpers/write-contract.js';
import { spendGate as actualSpendGate } from '../../src/tools/spend-guard.js';
import * as advisories from '../../src/tools/advisories.js';
import * as scanning from '../../src/tools/security-scanning-writes.js';
import * as config from '../../src/tools/security-config.js';
import { turnsOnPaid } from '../../src/tools/security-config.js';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';

const def = (ns, name) => ({ tool: ns.tools.find((t) => t.name === name), handler: ns.handlers[name] });
const O = 'example-org';
const R = { owner: O, repo: 'app' };
const ok = (outcome) => outcome === 'ok';
const GHSA = 'GHSA-2222-3333-4444';
const ADV = '/repos/{owner}/{repo}/security-advisories';
const TEXT = 'SECRET DETAILS OF THE HOLE';
const adv = (over = {}) => ({ ghsa_id: GHSA, state: 'draft', severity: 'high', summary: 'Bad bug', description: TEXT, cve_id: null, html_url: 'https://example.test/advisory', vulnerabilities: [{ package: { ecosystem: 'npm', name: 'pkg' } }], ...over });
const sha = (t) => createHash('sha256').update(t).digest('hex');

// ---- advisories ------------------------------------------------------------------------------------------------------
runWriteContract({ label: 'github_security_advisory_save', definition: def(advisories, 'github_security_advisory_save'), needsConfirm: false, profile: 'full',
  args: { ...R, summary: 'Bad bug', description: TEXT, severity: 'high', vulnerabilities: [{ ecosystem: 'npm', name: 'pkg' }] },
  arrange: (gh, o) => {
    gh.when(`GET ${ADV}/{ghsa_id}`).reply(404, { message: 'Not Found' });
    gh.when(`POST ${ADV}`).reply(201, (req) => { gh.when(`GET ${ADV}/{ghsa_id}`).reply(200, adv({ summary: ok(o) ? req.body.summary : 'something else', description: req.body.description })); return adv({ summary: req.body.summary, description: req.body.description }); });
  } });
runWriteContract({ label: 'github_security_advisory_publish', definition: def(advisories, 'github_security_advisory_publish'), needsConfirm: true, production: true, profile: 'full',
  args: { ...R, ghsa: GHSA, confirmGhsa: GHSA },
  arrange: (gh, o) => {
    gh.when(`GET ${ADV}/{ghsa_id}`).reply(200, adv());
    gh.when(`PATCH ${ADV}/{ghsa_id}`).reply(200, () => { if (ok(o)) gh.when(`GET ${ADV}/{ghsa_id}`).reply(200, adv({ state: 'published' })); return adv({ state: 'published' }); });
  } });
runWriteContract({ label: 'github_security_advisory_request_cve', definition: def(advisories, 'github_security_advisory_request_cve'), needsConfirm: true, production: true, profile: 'full',
  args: { ...R, ghsa: GHSA },
  arrange: (gh, o) => {
    gh.when(`GET ${ADV}/{ghsa_id}`).reply(200, adv());
    gh.when(`POST ${ADV}/{ghsa_id}/cve`).reply(202, () => { if (!ok(o)) gh.when(`GET ${ADV}/{ghsa_id}`).reply(404, { message: 'Not Found' }); return null; });
  } });
runWriteContract({ label: 'github_security_report_vulnerability', definition: def(advisories, 'github_security_report_vulnerability'), needsConfirm: true, notifies: ['upstream-org'], profile: 'full',
  args: { owner: 'upstream-org', repo: 'lib', summary: 'Bad bug', description: TEXT },
  arrange: (gh, o) => {
    gh.when(`GET ${ADV}/{ghsa_id}`).reply(404, { message: 'Not Found' });
    gh.when(`POST ${ADV}/reports`).reply(201, (req) => { if (ok(o)) gh.when(`GET ${ADV}/{ghsa_id}`).reply(200, adv({ state: 'triage', description: req.body.description })); return adv({ state: 'triage' }); });
  } });

// ---- code scanning, secret patterns, Dependabot ----------------------------------------------------------------------------
const SETUP = '/repos/{owner}/{repo}/code-scanning/default-setup';
const setupRoutes = (gh, o, isPrivate = false) => {
  gh.when('GET /repos/{owner}/{repo}').reply(200, { id: 1, name: 'app', private: isPrivate, visibility: isPrivate ? 'private' : 'public' });
  gh.when(`GET ${SETUP}`).reply(200, { state: 'not-configured', languages: [] });
  gh.when(`PATCH ${SETUP}`).reply(202, () => { if (ok(o)) gh.when(`GET ${SETUP}`).reply(200, { state: 'configured', languages: ['javascript-typescript'], query_suite: 'default' }); return { run_id: 1, run_url: 'https://example.test/run' }; });
};
runWriteContract({ label: 'github_security_code_scanning_default_setup', definition: def(scanning, 'github_security_code_scanning_default_setup'), needsConfirm: true, production: true, profile: 'full',
  args: { ...R, state: 'configured', languages: ['javascript-typescript'] }, arrange: (gh, o) => setupRoutes(gh, o) });

// Entire write lifecycle for private paid code scanning; public fixture above remains
// separate so a private user-charge grant cannot silently alter cost-free routes.
runWriteContract({label:'github_security_code_scanning_default_setup private paid',
  definition:def(scanning,'github_security_code_scanning_default_setup'),
  needsConfirm:true,production:true,profile:'full',
  args:{...R,state:'configured',languages:['javascript-typescript']},
  arrange:(gh,o)=>setupRoutes(gh,o,true)});

const PAT = '/orgs/{org}/secret-scanning/custom-patterns';
const pattern = (over = {}) => ({ id: 31, name: 'Internal key', pattern: 'ACME_[A-Z0-9]{16}', slug: 'internal_key', state: 'published', push_protection_enabled: false, custom_pattern_version: 'v1', ...over });
runWriteContract({ label: 'github_security_secret_pattern_save', definition: def(scanning, 'github_security_secret_pattern_save'), needsConfirm: true, profile: 'full',
  args: { owner: O, action: 'create', name: 'Internal key', pattern: 'ACME_[A-Z0-9]{16}' },
  arrange: (gh, o) => {
    gh.when(`GET ${PAT}`).reply(200, []);
    gh.when(`POST ${PAT}`).reply(201, (req) => { const made = pattern({ pattern: ok(o) ? req.body.patterns[0].pattern : 'other' }); gh.when(`GET ${PAT}`).reply(200, [made]); return { created_patterns: [made], errors: [] }; });
  } });
runWriteContract({ label: 'github_security_secret_pattern_save (delete)', definition: def(scanning, 'github_security_secret_pattern_save'), needsConfirm: true, production: true, profile: 'full',
  args: { owner: O, action: 'delete', patternId: 31, name: 'Internal key', afterDelete: 'resolve_alerts' },
  arrange: (gh, o) => {
    gh.when(`GET ${PAT}`).reply(200, [pattern()]);
    gh.when(`DELETE ${PAT}`).reply(204, () => { if (ok(o)) gh.when(`GET ${PAT}`).reply(200, []); return null; });
  } });

const DEP = '/orgs/{org}/dependabot/repository-access';
runWriteContract({ label: 'github_security_dependabot_org_settings', definition: def(scanning, 'github_security_dependabot_org_settings'), needsConfirm: true, accessWidening: true, profile: 'full',
  args: { org: O, addRepositoryIds: [5] },
  arrange: (gh, o) => {
    gh.when(`GET ${DEP}`).reply(200, { default_level: 'public', accessible_repositories: [{ id: 1 }] });
    gh.when(`PATCH ${DEP}`).reply(204, () => { if (ok(o)) gh.when(`GET ${DEP}`).reply(200, { default_level: 'public', accessible_repositories: [{ id: 1 }, { id: 5 }] }); return null; });
  } });

// ---- code-security configurations -------------------------------------------------------------------------------------------
const CFG = '/orgs/{org}/code-security/configurations';
const cfg = (over = {}) => ({ id: 9, name: 'Baseline', description: 'Org baseline', target_type: 'organization', advanced_security: 'disabled', dependabot_alerts: 'enabled', secret_scanning: 'disabled', enforcement: 'enforced', ...over });
const repoRow = (id, name, isPrivate = false, status = 'attached') => ({ status, repository: { id, name, private: isPrivate } });
runWriteContract({ label: 'github_security_config_save', definition: def(config, 'github_security_config_save'), needsConfirm: true, profile: 'full',
  args: { org: O, name: 'Strict', description: 'Stricter', settings: { dependabot_alerts: 'enabled' } },
  arrange: (gh, o) => {
    gh.when(`GET ${CFG}`).reply(200, [cfg()]);
    gh.when(`POST ${CFG}`).reply(201, (req) => { const made = cfg({ id: 10, name: ok(o) ? req.body.name : 'Other', description: req.body.description, dependabot_alerts: req.body.dependabot_alerts }); gh.when(`GET ${CFG}/{configuration_id}`).reply(200, made); return made; });
  } });
const attachArrange = (paid) => (gh, o) => {
  gh.when(`GET ${CFG}/{configuration_id}`).reply(200, cfg(paid ? { secret_scanning: 'enabled' } : {}));
  gh.when(`GET ${CFG}/{configuration_id}/repositories`).reply(200, []);
  gh.when(`POST ${CFG}/{configuration_id}/attach`).reply(202, () => { if (ok(o)) gh.when(`GET ${CFG}/{configuration_id}/repositories`).reply(200, [repoRow(1, 'app')]); return null; });
};
runWriteContract({ label: 'github_security_config_attach', definition: def(config, 'github_security_config_attach'), needsConfirm: true, production: true, profile: 'full', args: { org: O, configurationId: 9, scope: 'public' }, arrange: attachArrange(false) });
runWriteContract({
  label:'github_security_config_attach private paid scope',
  definition:def(config,'github_security_config_attach'),needsConfirm:true,
  production:true,profile:'full',
  args:{org:O,configurationId:9,scope:'private_or_internal'},
  arrange:(gh,outcome)=>{
    gh.when(`GET ${CFG}/{configuration_id}`).reply(200,cfg({secret_scanning:'enabled'}));
    gh.when(`GET ${CFG}/{configuration_id}/repositories`).reply(200,[]);
    gh.when(`POST ${CFG}/{configuration_id}/attach`).reply(202,()=>{
      if(ok(outcome))
        gh.when(`GET ${CFG}/{configuration_id}/repositories`)
          .reply(200,[repoRow(11,'private-app',true)]);
      return null;
    });
  }
});
runWriteContract({ label: 'github_security_config_default', definition: def(config, 'github_security_config_default'), needsConfirm: true, production: true, profile: 'full', args: { org: O, configurationId: 9, newRepos: 'public' },
  arrange: (gh, o) => {
    gh.when(`GET ${CFG}/{configuration_id}`).reply(200, cfg());
    gh.when(`GET ${CFG}/defaults`).reply(200, []);
    gh.when(`PUT ${CFG}/{configuration_id}/defaults`).reply(200, () => { if (ok(o)) gh.when(`GET ${CFG}/defaults`).reply(200, [{ default_for_new_repos: 'public', configuration: cfg() }]); return { default_for_new_repos: 'public', configuration: cfg() }; });
  } });
runWriteContract({ label: 'github_security_config_detach', definition: def(config, 'github_security_config_detach'), needsConfirm: true, production: true, profile: 'full', args: { org: O, repositories: ['app'] },
  arrange: (gh, o) => {
    gh.when('GET /repos/{owner}/{repo}').reply(200, { id: 1, name: 'app', private: false, visibility: 'public' });
    gh.when('GET /repos/{owner}/{repo}/code-security-configuration').reply(200, { state: 'attached', configuration: cfg() });
    gh.when(`DELETE ${CFG}/detach`).reply(204, () => { if (ok(o)) gh.when('GET /repos/{owner}/{repo}/code-security-configuration').reply(404, { message: 'Not Found' }); return null; });
  } });
runWriteContract({ label: 'github_security_config_delete', definition: def(config, 'github_security_config_delete'), needsConfirm: true, production: true, profile: 'full', args: { org: O, configurationId: 9, name: 'Baseline' },
  arrange: (gh, o) => {
    gh.when(`GET ${CFG}/{configuration_id}`).reply(200, cfg());
    gh.when(`GET ${CFG}/{configuration_id}/repositories`).reply(200, [repoRow(1, 'app')]);
    gh.when(`DELETE ${CFG}/{configuration_id}`).reply(204, () => { if (ok(o)) gh.when(`GET ${CFG}/{configuration_id}`).reply(404, { message: 'Not Found' }); return null; });
  } });

describe('Y-7 rules', () => {
  const run = async (w, name, args, gates = w.ctx.gates) => parse(await createDispatch({ env: w.ctx.env, credentials: w.credentials, gates, fetch: w.gh.fetch, now: w.ctx.now, sleep: w.ctx.sleep })({ registry, name, args, connection: w.connection, db: w.db }));
  const mutations = (w) => w.gh.calls.filter((c) => !['GET', 'HEAD'].includes(c.method));
  it('all twelve tools are registered, full profile only, descriptions short', () => {
    const names = [...advisories.tools, ...scanning.tools, ...config.tools].map((t) => t.name);
    expect(names).toHaveLength(12);
    for (const n of names) { const t = registry.tools.find((x) => x.name === n); expect(t, n).toBeTruthy(); expect(t.description.length, n).toBeLessThanOrEqual(160); expect(t.declarations.profiles, n).toEqual(['full']); }
  });
  it('publishing needs the GHSA id typed twice and sends nothing otherwise', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    w.gh.when(`GET ${ADV}/{ghsa_id}`).reply(200, adv());
    const r = await run(w, 'github_security_advisory_publish', { ...R, ghsa: GHSA, confirmGhsa: 'GHSA-2222-3333-5555', confirm: true }).catch(() => ({ done: false }));
    expect(r.done).not.toBe(true);
    expect(mutations(w)).toHaveLength(0);
  });
  it('the advisory description never reaches a result or the change log, only its hash', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    gh_create(w.gh);
    const r = await run(w, 'github_security_advisory_save', { ...R, summary: 'Bad bug', description: TEXT, severity: 'high', vulnerabilities: [{ ecosystem: 'npm', name: 'pkg' }], confirm: true });
    expect(JSON.stringify(r)).not.toContain(TEXT);
    expect(JSON.stringify(r)).toContain(sha(TEXT));
    const log = await w.db.listChanges({ includePreviews: true, limit: 50 });
    expect(log.length).toBeGreaterThan(0);
    expect(JSON.stringify(log)).not.toContain(TEXT);
  });
  it('an already published advisory is not published twice', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    w.gh.when(`GET ${ADV}/{ghsa_id}`).reply(200, adv({ state: 'published' }));
    const r = await run(w, 'github_security_advisory_publish', { ...R, ghsa: GHSA, confirmGhsa: GHSA, confirm: true }).catch(() => ({ done: false }));
    expect(r.done).not.toBe(true);
    expect(mutations(w)).toHaveLength(0);
  });
  it('can enable private code scanning when end-user authorizes uncapped provider billing', async () => {
    const w=await makeWorld({ mode:'production', profile:'full',gates:[actualSpendGate()] });
    setupRoutes(w.gh,'ok',true);
    const first=await run(w,'github_security_code_scanning_default_setup',
      {...R,state:'configured',dryRun:true});
    expect(first.status).toBe('preview');
    expect(first.preview).toContain('COST UNKNOWN');
    expect(mutations(w)).toHaveLength(0);
    const result=await run(w,'github_security_code_scanning_default_setup',
      {...R,state:'configured',confirm:true});
    expect(result).toMatchObject({status:'applied',done:true});
    expect(mutations(w).map(x=>x.route)).toEqual([`PATCH ${SETUP}`]);
    expect(w.gh.invalid).toEqual([]);
  });
  it('honors user-selected $0 for private scanning but allows free public scanning', async () => {
    const w=await makeWorld({delegated:true, mode:'production', profile:'full', gates:[actualSpendGate()] });
    await w.db.setSpendLimitCents(O,0);
    setupRoutes(w.gh,'ok',true);
    const blocked=await run(w,'github_security_code_scanning_default_setup',
      {...R,state:'configured',confirm:true});
    expect(blocked).toMatchObject({status:'refused_by_guard',refusedBy:'spend limit'});
    expect(mutations(w)).toHaveLength(0);
    setupRoutes(w.gh,'ok',false);
    const allowed=await run(w,'github_security_code_scanning_default_setup',
      {...R,state:'configured',confirm:true});
    expect(allowed.status).toBe('applied');
    expect(mutations(w)).toHaveLength(1);
  });
  it('turnsOnPaid recognises paid settings', () => {
    expect(turnsOnPaid({ secret_scanning: 'enabled' })).toBe(true);
    expect(turnsOnPaid({ advanced_security: 'code_security' })).toBe(true);
    expect(turnsOnPaid({ dependabot_alerts: 'enabled', dependency_graph: 'enabled', secret_scanning: 'disabled' })).toBe(false);
  });
  it('paid organization security configurations can be attached to private/all with informed approval', async () => {
    for (const scope of ['all','private_or_internal']) {
      const w=await makeWorld({mode:'production',profile:'full',gates:[actualSpendGate()]});
      w.gh.when(`GET ${CFG}/{configuration_id}`).reply(200,cfg({secret_scanning:'enabled'}));
      w.gh.when(`GET ${CFG}/{configuration_id}/repositories`).reply(200,[]);
      w.gh.when(`POST ${CFG}/{configuration_id}/attach`).reply(202,()=>{
        w.gh.when(`GET ${CFG}/{configuration_id}/repositories`).reply(200,
          [repoRow(1,'secret-app',true)]);
        return null;
      });
      const preview=await run(w,'github_security_config_attach',
        {org:O,configurationId:9,scope,dryRun:true});
      expect(preview.status).toBe('preview');
      expect(preview.preview).toContain('COST UNKNOWN');
      const applied=await run(w,'github_security_config_attach',
        {org:O,configurationId:9,scope,confirm:true});
      expect(applied).toMatchObject({status:'applied'});
      expect(mutations(w)).toHaveLength(1);
      expect(w.gh.invalid).toEqual([]);
    }
  });
  it('a paid configuration may be attached to public repositories at a selected $0 budget', async () => {
    const w=await makeWorld({mode:'production',profile:'full',gates:[actualSpendGate()]});
    await w.db.setSpendLimitCents(O,0);
    attachArrange(true)(w.gh,'ok');
    const r=await run(w,'github_security_config_attach',
      {org:O,configurationId:9,scope:'public',confirm:true});
    expect(r.status).toBe('applied');
    expect(mutations(w)).toHaveLength(1);
  });
  it('an explicit cost ceiling forbids paid configuration on private repositories', async () => {
    const w=await makeWorld({delegated:true,mode:'production',profile:'full',gates:[actualSpendGate()]});
    await w.db.setSpendLimitCents(O,10000);
    attachArrange(true)(w.gh,'ok');
    const r=await run(w,'github_security_config_attach',
      {org:O,configurationId:9,scope:'private_or_internal',confirm:true});
    expect(r).toMatchObject({status:'refused_by_guard',refusedBy:'spend limit'});
    expect(mutations(w)).toHaveLength(0);
  });
  it('can set paid security configurations as new private repository defaults', async () => {
    const w=await makeWorld({mode:'production',profile:'full',gates:[actualSpendGate()]});
    w.gh.when(`GET ${CFG}/{configuration_id}`).reply(200,cfg({secret_scanning:'enabled'}));
    w.gh.when(`GET ${CFG}/defaults`).replySequence([
      {status:200,body:[]},
      {status:200,body:[{default_for_new_repos:'all',configuration:cfg()}]}
    ]);
    w.gh.when(`PUT ${CFG}/{configuration_id}/defaults`).reply(200,
      {default_for_new_repos:'all',configuration:cfg()});
    const res=await run(w,'github_security_config_default',
      {org:O,configurationId:9,newRepos:'all',confirm:true});
    expect(res.status).toBe('applied');
    expect(mutations(w)).toHaveLength(1);
    expect(w.gh.invalid).toEqual([]);
  });
  it('can enable a paid config already attached to a private repo, with no hidden writes', async () => {
    const w=await makeWorld({mode:'production',profile:'full',gates:[actualSpendGate()]});
    w.gh.when(`GET ${CFG}/{configuration_id}`).replySequence([
      {status:200,body:cfg()},
      {status:200,body:cfg({secret_scanning:'enabled'})}
    ]);
    w.gh.when(`GET ${CFG}/{configuration_id}/repositories`).reply(200,
      [repoRow(2,'secret-app',true)]);
    w.gh.when(`PATCH ${CFG}/{configuration_id}`).reply(200,cfg({secret_scanning:'enabled'}));
    const res=await run(w,'github_security_config_save',{
      org:O,configurationId:9,settings:{secret_scanning:'enabled'},confirm:true});
    expect(res).toMatchObject({status:'applied'});
    expect(mutations(w)).toHaveLength(1);
    expect(w.gh.invalid).toEqual([]);
  });
  it('a configuration cannot be deleted without its exact name', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    w.gh.when(`GET ${CFG}/{configuration_id}`).reply(200, cfg());
    w.gh.when(`GET ${CFG}/{configuration_id}/repositories`).reply(200, []);
    const r = await run(w, 'github_security_config_delete', { org: O, configurationId: 9, name: 'baseline', confirm: true }).catch(() => ({ done: false }));
    expect(r.done).not.toBe(true);
    expect(mutations(w)).toHaveLength(0);
  });
  it('the pattern text is kept out of the change log (only its hash)', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    w.gh.when(`GET ${PAT}`).reply(200, []);
    w.gh.when(`POST ${PAT}`).reply(201, (req) => { const made = pattern({ pattern: req.body.patterns[0].pattern }); w.gh.when(`GET ${PAT}`).reply(200, [made]); return { created_patterns: [made] }; });
    const r = await run(w, 'github_security_secret_pattern_save', { owner: O, action: 'create', name: 'Internal key', pattern: 'ACME_[A-Z0-9]{16}', confirm: true });
    expect(r.done).toBe(true);
    const log = await w.db.listChanges({ includePreviews: true, limit: 50 });
    expect(JSON.stringify(log)).not.toContain('ACME_[A-Z0-9]{16}');
  });
});

function gh_create(gh) {
  gh.when(`GET ${ADV}/{ghsa_id}`).reply(404, { message: 'Not Found' });
  gh.when(`POST ${ADV}`).reply(201, (req) => { gh.when(`GET ${ADV}/{ghsa_id}`).reply(200, adv({ summary: req.body.summary, description: req.body.description })); return adv({ summary: req.body.summary, description: req.body.description }); });
}


describe('Y-7 large-org complete security-configuration cursor and readback contracts',()=>{
  const PAGE='GET /orgs/{org}/code-security/configurations/{configuration_id}/repositories';
  const CONFIGS='GET /orgs/{org}/code-security/configurations';
  const CONFIG='GET /orgs/{org}/code-security/configurations/{configuration_id}';
  const WRITE_CONFIG='PATCH /orgs/{org}/code-security/configurations/{configuration_id}';
  const listPage=(n=100)=>Array.from({length:n},(_,i)=>({
    status:'attached',repository:{id:i+1,name:'repo-'+(i+1),private:false}
  }));
  const link=(path,cursor)=>'<https://api.github.com'+path+'?per_page=100&after='+encodeURIComponent(cursor)+'>; rel="next"';
  const pagedRepos=(gh,{lastPrivate=false,malformed=false}={})=>{
    const second={status:'attached',repository:{id:101,name:'private-last',
      private:lastPrivate,visibility:lastPrivate?'private':'public'}};
    gh.when(PAGE).replySequence([
      {status:200,body:listPage(),headers:{link:link('/orgs/example-org/code-security/configurations/9/repositories','cursor-secret-2')}},
      {status:200,body:malformed?{items:[second]}:[second]}
    ]);
  };
  async function run(w,name,args){
    return parse(await createDispatch({env:w.ctx.env,credentials:w.credentials,
      gates:w.ctx.gates,fetch:w.gh.fetch,now:w.ctx.now,sleep:w.ctx.sleep})({
      registry,name,args,connection:w.connection,db:w.db
    }));
  }
  const params={org:'example-org',configurationId:9,
    settings:{secret_scanning:'enabled'}};
  it('can edit an organization security configuration attached to >100 repositories with full verified paid exposure',async()=>{
    const w=await makeWorld({mode:'production',profile:'full',gates:[actualSpendGate()]});
    w.gh.when(CONFIG).replySequence([
      {status:200,body:cfg()},
      {status:200,body:cfg({secret_scanning:'enabled'})}
    ]);
    pagedRepos(w.gh,{lastPrivate:true});
    w.gh.when(WRITE_CONFIG).reply(200,cfg({secret_scanning:'enabled'}));
    const out=await run(w,'github_security_config_save',{...params,confirm:true});
    expect(out).toMatchObject({status:'applied',done:true});
    expect(w.gh.calls.filter(c=>c.route===PAGE).map(x=>x.query.after)).toEqual([undefined,'cursor-secret-2']);
    expect(w.gh.calls.filter(c=>c.method==='PATCH')).toHaveLength(1);
    expect(w.gh.invalid).toEqual([]);
  });
  it('refuses price-unknown >100 paid attachments with a real user-selected cap before provider PATCH',async()=>{
    const w=await makeWorld({delegated:true,mode:'production',profile:'full',gates:[actualSpendGate()]});
    await w.db.setSpendLimitCents('example-org',100);
    w.gh.when(CONFIG).reply(200,cfg());
    pagedRepos(w.gh,{lastPrivate:true});
    const out=await run(w,'github_security_config_save',{...params,confirm:true});
    expect(out).toMatchObject({status:'refused_by_guard',refusedBy:'spend limit'});
    expect(w.gh.calls.filter(c=>c.method==='PATCH')).toHaveLength(0);
  });
  it('sees duplicate configuration names on a later cursor page before CREATE',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    const path='/orgs/example-org/code-security/configurations';
    w.gh.when(CONFIGS).replySequence([
      {status:200,body:Array.from({length:100},(_,i)=>cfg({id:i+1,name:'existing-'+i})),
        headers:{link:link(path,'org-config-next')}},
      {status:200,body:[cfg({id:101,name:'Strict'})]}
    ]);
    const out=await run(w,'github_security_config_save',{org:'example-org',
      name:'Strict',description:'New security defaults',confirm:true});
    expect(out.done).not.toBe(true);
    expect(w.gh.calls.filter(c=>c.route===CONFIGS).map(c=>c.query.after)).toEqual([undefined,'org-config-next']);
    expect(w.gh.calls.filter(c=>c.method==='POST')).toHaveLength(0);
  });
  it('fails closed on wrong-origin cursor, repeated/duplicate pages and unknown attachment state before DELETE',async()=>{
    for(const fault of ['wrong-host','duplicate','invalid-response','full-page-no-next','denied']){
      const w=await makeWorld({mode:'production',profile:'full'});
      w.gh.when(CONFIG).reply(200,cfg());
      const path='/orgs/example-org/code-security/configurations/9/repositories';
      const first=listPage();
      if(fault==='wrong-host')w.gh.when(PAGE).reply(200,first,
        {link:'<https://evil.invalid'+path+'?after=next>; rel="next"'});
      else if(fault==='full-page-no-next')w.gh.when(PAGE).reply(200,first);
      else if(fault==='denied')w.gh.when(PAGE).reply(403,{message:'Forbidden'});
      else w.gh.when(PAGE).replySequence([
        {status:200,body:first,headers:{link:link(path,'one')}},
        {status:200,body:fault==='duplicate'?[first[0]]:{not_a_list:true}}
      ]);
      const out=await run(w,'github_security_config_delete',{
        org:'example-org',configurationId:9,name:'Baseline',confirm:true});
      expect(out.done).not.toBe(true);
      expect(w.gh.calls.filter(c=>c.method==='DELETE')).toHaveLength(0);
    }
  });
  it('verifies the complete provider-supported 255-character configuration description instead of truncating to 200',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    const description='Verified owner security policy '.repeat(13).slice(0,255);
    w.gh.when(CONFIG).replySequence([
      {status:200,body:cfg()},
      {status:200,body:cfg({description})}
    ]);
    w.gh.when(PAGE).reply(200,[]);
    w.gh.when(WRITE_CONFIG).reply(200,{description});
    const out=await run(w,'github_security_config_save',{
      org:'example-org',configurationId:9,description,confirm:true});
    expect(out).toMatchObject({status:'applied',done:true});
    expect(out.result.configuration.description).toBe(description);
    expect(w.gh.calls.filter(x=>x.method==='PATCH')).toHaveLength(1);
  });
  it('rejects descriptions beyond GitHub pinned 255-character maximum without provider writes',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    w.gh.when(CONFIG).reply(200,cfg());
    w.gh.when(PAGE).reply(200,[]);
    // Invalid input is rejected by the dispatcher schema before the handler
    // returns a JSON write receipt; inspect the actual MCP error envelope.
    const out=await createDispatch({env:w.ctx.env,credentials:w.credentials,
      gates:w.ctx.gates,fetch:w.gh.fetch,now:w.ctx.now,sleep:w.ctx.sleep})({
      registry,name:'github_security_config_save',
      args:{org:'example-org',configurationId:9,description:'x'.repeat(256),confirm:true},
      connection:w.connection,db:w.db
    });
    expect(out.isError).toBe(true);
    // The MCP schema emits a sanitized user-facing rejection message; the
    // exact numeric limit is asserted separately against the registered schema.
    expect(registry.tools.find(t=>t.name==='github_security_config_save')
      .inputSchema.properties.description.maxLength).toBe(255);
    expect(out.content?.[0]?.text).toMatch(/description is too long/i);
    expect(w.gh.calls).toHaveLength(0);
  });
  it('does not claim confirmed success when requested nested settings or enforcement are ignored',async()=>{
    for(const mismatch of ['enforcement','nested']){
      const w=await makeWorld({mode:'production',profile:'full'});
      const input=mismatch==='nested'?
        {settings:{code_scanning_options:{allow_advanced:true}}}:
        {settings:{enforcement:'unenforced'}};
      w.gh.when(CONFIG).replySequence([
        {status:200,body:cfg({code_scanning_options:{allow_advanced:false}})},
        {status:200,body:cfg({code_scanning_options:{allow_advanced:false}})}
      ]);
      w.gh.when(PAGE).reply(200,[]);
      w.gh.when(WRITE_CONFIG).reply(200,{});
      const out=await run(w,'github_security_config_save',{
        org:'example-org',configurationId:9,...input,confirm:true});
      expect(out.status).not.toBe('applied');
      expect(w.gh.calls.filter(c=>c.method==='PATCH')).toHaveLength(1);
      expect(w.gh.invalid).toEqual([]);
    }
  });
});
