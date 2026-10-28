import { describe, expect, it } from 'vitest';
import { runWriteContract, makeWorld, doorsFor, parse } from '../../test/helpers/write-contract.js';
import * as repos from '../../src/tools/repos-write.js';
import { protectedResourceGate } from '../../src/tools/protect-guard.js';

const def = (name) => ({ tool: repos.tools.find((t) => t.name === name), handler: repos.handlers[name] });
const R = { repo: 'hello' };
const REPO = 'GET /repos/{owner}/{repo}';
const base = (extra = {}) => ({ name: 'hello', full_name: 'example-org/hello', owner: { login: 'example-org' }, private: true, visibility: 'private', default_branch: 'main', archived: false, fork: false,
  allow_squash_merge: true, allow_merge_commit: true, description: 'Old', topics: ['a'], size: 10, open_issues_count: 1, forks_count: 0, stargazers_count: 0, ...extra });
const seq = (gh, route, steps) => gh.when(route).replySequence(steps.map(([status, body]) => ({ status, body })));
const writes = (gh) => gh.calls.filter((c) => !['GET', 'HEAD'].includes(c.method));
const gone = [404, { message: 'Not Found' }];
const FULL = { profile: 'full' };

runWriteContract({
  label: 'github_repo_create', definition: def('github_repo_create'), args: { name: 'newrepo', visibility: 'public' }, needsConfirm: true, accessWidening: true,
  arrange(gh, outcome) {
    seq(gh, REPO, [gone, [200, base({ name: 'newrepo', full_name: 'example-org/newrepo', visibility: outcome === 'ok' ? 'public' : 'private', private: outcome !== 'ok' })]]);
    gh.when('POST /orgs/{org}/repos').reply(201, base({ name: 'newrepo' }));
  }
});

runWriteContract({
  label: 'github_repo_create_from_template', definition: def('github_repo_create_from_template'), args: { template_owner: 'example-org', template_repo: 'tpl', name: 'fromtpl', visibility: 'public' }, needsConfirm: true, accessWidening: true,
  arrange(gh, outcome) {
    seq(gh, REPO, [gone, [200, base({ name: 'tpl', is_template: true })], [200, base({ name: 'fromtpl', visibility: outcome === 'ok' ? 'public' : 'private', private: outcome !== 'ok' })]]);
    gh.when('POST /repos/{template_owner}/{template_repo}/generate').reply(201, base({ name: 'fromtpl' }));
  }
});

runWriteContract({
  label: 'github_repo_update_settings (merge option)', definition: def('github_repo_update_settings'), args: { ...R, allow_squash_merge: false }, needsConfirm: true, production: true, ...FULL,
  arrange(gh, outcome) {
    seq(gh, REPO, [[200, base()], [200, base({ allow_squash_merge: outcome !== 'ok' })]]);
    gh.when('PATCH /repos/{owner}/{repo}').reply(200, base());
  }
});

runWriteContract({
  label: 'github_repo_set_visibility', definition: def('github_repo_set_visibility'), args: { ...R, visibility: 'public' }, needsConfirm: true, production: true, accessWidening: true, ...FULL,
  arrange(gh, outcome) {
    seq(gh, REPO, [[200, base()], [200, base({ visibility: outcome === 'ok' ? 'public' : 'private', private: outcome !== 'ok' })]]);
    gh.when('PATCH /repos/{owner}/{repo}').reply(200, base());
  }
});

runWriteContract({
  label: 'github_repo_set_default_branch', definition: def('github_repo_set_default_branch'), args: { ...R, branch: 'dev' }, needsConfirm: true, production: true, ...FULL,
  arrange(gh, outcome) {
    seq(gh, REPO, [[200, base()], [200, base({ default_branch: outcome === 'ok' ? 'dev' : 'main' })]]);
    gh.when('GET /repos/{owner}/{repo}/branches/{branch}').reply(200, { name: 'dev' });
    gh.when('PATCH /repos/{owner}/{repo}').reply(200, base());
  }
});

runWriteContract({
  label: 'github_repo_rename', definition: def('github_repo_rename'), args: { ...R, new_name: 'renamed' }, needsConfirm: true, production: true, ...FULL,
  arrange(gh, outcome) {
    seq(gh, REPO, [[200, base()], [200, base({ name: outcome === 'ok' ? 'renamed' : 'hello' })]]);
    gh.when('PATCH /repos/{owner}/{repo}').reply(200, base());
  }
});

runWriteContract({
  label: 'github_repo_set_archived', definition: def('github_repo_set_archived'), args: { ...R, archived: true }, needsConfirm: true, production: true, ...FULL,
  arrange(gh, outcome) {
    seq(gh, REPO, [[200, base()], [200, base({ archived: outcome === 'ok' })]]);
    gh.when('PATCH /repos/{owner}/{repo}').reply(200, base());
  }
});

runWriteContract({
  label: 'github_repo_transfer', definition: def('github_repo_transfer'), args: { ...R, new_owner: 'new-home' }, needsConfirm: true, production: true, accessWidening: true, ...FULL,
  arrange(gh, outcome) {
    seq(gh, REPO, [[200, base()], [200, base({ owner: { login: outcome === 'ok' ? 'new-home' : 'example-org' }, full_name: 'new-home/hello' })]]);
    gh.when('POST /repos/{owner}/{repo}/transfer').reply(202, base());
  }
});

runWriteContract({
  label: 'github_repo_delete', definition: def('github_repo_delete'), args: { ...R }, needsConfirm: true, production: true, ...FULL,
  arrange(gh, outcome) {
    seq(gh, REPO, outcome === 'ok' ? [[200, base()], gone, [200, base()], gone] : [[200, base()], [200, base()]]);
    gh.when('DELETE /repos/{owner}/{repo}').reply(204, '');
  }
});

runWriteContract({
  label: 'github_repo_fork', definition: def('github_repo_fork'), args: { source_owner: 'someone', source_repo: 'lib' }, needsConfirm: false,
  arrange(gh, outcome) {
    seq(gh, REPO, [[200, base({ name: 'lib', visibility: 'public', private: false })], gone, [200, base({ name: 'lib', fork: outcome === 'ok' })]]);
    gh.when('POST /repos/{owner}/{repo}/forks').reply(202, base({ name: 'lib' }));
  }
});

runWriteContract({
  label: 'github_repo_sync_fork', definition: def('github_repo_sync_fork'), args: { ...R, branch: 'dev' }, needsConfirm: false,
  arrange(gh, outcome) {
    gh.when(REPO).reply(200, base({ fork: true, parent: { full_name: 'up/hello' } }));
    gh.when('GET /repos/{owner}/{repo}/branches/{branch}').reply(200, { name: 'dev', protected: false });
    gh.when('GET /repos/{owner}/{repo}/rules/branches/{branch}').reply(200, []);
    gh.when('POST /repos/{owner}/{repo}/merge-upstream').reply(200, { merge_type: outcome === 'ok' ? 'fast-forward' : 'unexpected', base_branch: 'up/hello:main', message: 'Successfully fetched and fast-forwarded' });
  }
});

runWriteContract({
  label: 'github_repo_set_custom_properties', definition: def('github_repo_set_custom_properties'), args: { ...R, properties: { tier: 'gold' } }, needsConfirm: false, ...FULL,
  arrange(gh, outcome) {
    seq(gh, 'GET /repos/{owner}/{repo}/properties/values', [[200, []], [200, outcome === 'ok' ? [{ property_name: 'tier', value: 'gold' }] : []]]);
    gh.when('PATCH /repos/{owner}/{repo}/properties/values').reply(204, '');
  }
});

runWriteContract({
  label: 'github_repo_star', definition: def('github_repo_star'), args: { repo_owner: 'someone', repo: 'lib' }, needsConfirm: false,
  arrange(gh, outcome) {
    seq(gh, 'GET /user/starred/{owner}/{repo}', [gone, outcome === 'ok' ? [204, ''] : gone]);
    gh.when('PUT /user/starred/{owner}/{repo}').reply(204, '');
  }
});

describe('repository changes: extra checks (BATCH-D §4 D-1)', () => {
  const call = async (name, w, args) => parse(await doorsFor(def(name))[0].call(w, args));

  it('making a repository public names the risk and is an access change', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    seq(w.gh, REPO, [[200, base()]]);
    const out = await call('github_repo_set_visibility', w, { ...R, visibility: 'public', dryRun: true });
    expect(out.preview).toContain('anyone can read the code and its history, including old commits');
    expect(out.preview).toContain('ACCESS CHANGE');
    expect(out.preview).toContain('PRODUCTION');
  });

  it('making a repository private is production but not an access widening', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    seq(w.gh, REPO, [[200, base({ visibility: 'public', private: false })]]);
    const out = await call('github_repo_set_visibility', w, { ...R, visibility: 'private', dryRun: true });
    expect(out.preview).not.toContain('ACCESS CHANGE');
  });

  it('github_repo_delete on a pr-only protected repository is refused', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full', delegated: true, accounts: ['robinson-ai-systems'], gates: [protectedResourceGate()] });
    seq(w.gh, REPO, [[200, base({ name: 'github-mcp', full_name: 'robinson-ai-systems/github-mcp' })]]);
    const out = await call('github_repo_delete', w, { repo: 'github-mcp', confirm: true });
    expect(out).toMatchObject({ status: 'refused_by_guard', refusedBy: 'protected resource' });
    expect(writes(w.gh)).toEqual([]);
  });

  it('github_repo_create is private by default and sends no public flag', async () => {
    const w = await makeWorld();
    seq(w.gh, REPO, [gone, [200, base({ name: 'newrepo' })]]);
    w.gh.when('POST /orgs/{org}/repos').reply(201, base({ name: 'newrepo' }));
    const out = await call('github_repo_create', w, { name: 'newrepo' });
    expect(out).toMatchObject({ status: 'applied' });
    expect(w.gh.calls.find((c) => c.method === 'POST').body).toMatchObject({ name: 'newrepo', visibility: 'private' });
    expect(w.gh.invalid).toEqual([]);
  });

  it('github_repo_create for a personal account uses the user route with private=true', async () => {
    const w = await makeWorld();
    await w.db.upsertAccount({ login: 'example-org', accountId: 1, accountType: 'User', label: 'x', credentialKind: 'fine_grained' });
    seq(w.gh, REPO, [gone, [200, base({ name: 'newrepo' })]]);
    w.gh.when('POST /user/repos').reply(201, base({ name: 'newrepo' }));
    expect(await call('github_repo_create', w, { name: 'newrepo' })).toMatchObject({ status: 'applied' });
    expect(w.gh.calls.find((c) => c.method === 'POST').body).toMatchObject({ private: true });
  });

  it('github_repo_create refuses a name that already exists, sending nothing', async () => {
    const w = await makeWorld();
    seq(w.gh, REPO, [[200, base()]]);
    const out = await call('github_repo_create', w, { name: 'hello', confirm: true });
    expect(out.status).toBe('rejected');
    expect(writes(w.gh)).toEqual([]);
  });

  it('settings: a description change needs no production switch; topics are replaced; the previous values are the undo', async () => {
    const w = await makeWorld({ profile: 'full' });
    seq(w.gh, REPO, [[200, base()], [200, base({ description: 'New', topics: ['b', 'c'] })]]);
    w.gh.when('PATCH /repos/{owner}/{repo}').reply(200, base());
    w.gh.when('PUT /repos/{owner}/{repo}/topics').reply(200, { names: ['b', 'c'] });
    const out = await call('github_repo_update_settings', w, { ...R, description: 'New', topics: ['b', 'c'], confirm: true });
    expect(out).toMatchObject({ status: 'applied', confirmed: true });
    expect(writes(w.gh).map((c) => c.route)).toEqual(['PATCH /repos/{owner}/{repo}', 'PUT /repos/{owner}/{repo}/topics']);
    expect(w.gh.invalid).toEqual([]);
    const row = await w.db.getChange(1);
    expect(row.inverse).toMatchObject({ tool: 'github_repo_update_settings', args: { repo: 'hello', description: 'Old', topics: ['a'] } });
  });

  it('settings: asking for nothing is a plain refusal', async () => {
    const w = await makeWorld({ profile: 'full' });
    const out = await call('github_repo_update_settings', w, { ...R });
    expect(out).toMatchObject({ status: 'refused' });
    expect(out.error).toContain('Say what to change');
  });

  it('a rename is undone by renaming back', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    seq(w.gh, REPO, [[200, base()], [200, base({ name: 'renamed' })]]);
    w.gh.when('PATCH /repos/{owner}/{repo}').reply(200, base());
    await call('github_repo_rename', w, { ...R, new_name: 'renamed', confirm: true });
    expect((await w.db.getChange(1)).inverse).toMatchObject({ tool: 'github_repo_rename', args: { repo: 'renamed', new_name: 'hello' } });
  });

  it('delete and transfer have no inverse', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    seq(w.gh, REPO, [[200, base()], gone]);
    w.gh.when('DELETE /repos/{owner}/{repo}').reply(204, '');
    await call('github_repo_delete', w, { ...R, confirm: true });
    expect((await w.db.getChange(1)).inverse ?? null).toBeNull();
  });

  it('the change tools are hidden from a read-only profile', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    const out = await doorsFor(def('github_repo_delete'))[1].call(w, { ...R, dryRun: true });
    expect(out.isError).toBe(true);
  });
});
