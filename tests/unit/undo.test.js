import { describe, expect, it } from 'vitest';
import { makeWorld, parse } from '../../test/helpers/write-contract.js';
import { createDispatch } from '../../src/tools/dispatch.js';
import { mergeNamespaces } from '../../src/core/registry.js';
import * as repos from '../../src/tools/repos-write.js';
import * as undo from '../../src/tools/undo.js';

const REPO = 'GET /repos/{owner}/{repo}';
const base = (extra = {}) => ({ name: 'hello', full_name: 'example-org/hello', owner: { login: 'example-org' }, private: true, visibility: 'private', default_branch: 'main', archived: false, fork: false,
  allow_squash_merge: true, allow_merge_commit: true, description: 'Old', topics: ['a'], size: 10, open_issues_count: 1, forks_count: 0, stargazers_count: 0, ...extra });
const seq = (gh, route, steps) => gh.when(route).replySequence(steps.map(([status, body]) => ({ status, body })));
const patches = (gh) => gh.calls.filter((c) => c.method === 'PATCH');
const registry = mergeNamespaces([undo, repos]);
const run = (w, name, args) => createDispatch({ env: w.ctx.env, credentials: w.credentials, gates: w.ctx.gates, fetch: w.gh.fetch, now: w.ctx.now, sleep: w.ctx.sleep })
  .call(null, { registry, name, args, connection: w.connection, db: w.db }).then(parse);
const row = (extra = {}) => ({ account: 'example-org', repo: 'example-org/hello', mode: 'production', connection: 'client-1', tool: 'github_repo_set_archived', target: 'example-org/hello',
  summary: 'Archive example-org/hello', dryRun: false, confirmed: true, production: true, inverse: { tool: 'github_repo_set_archived', args: { owner: 'example-org', repo: 'hello', archived: false } }, ...extra });

async function archived() {
  const w = await makeWorld({ mode: 'production', profile: 'full' });
  seq(w.gh, REPO, [[200, base()], [200, base({ archived: true })]]);
  w.gh.when('PATCH /repos/{owner}/{repo}').reply(200, base());
  const out = await run(w, 'github_repo_set_archived', { repo: 'hello', archived: true, confirm: true });
  expect(out).toMatchObject({ status: 'applied', confirmed: true });
  return w;
}

describe('X-1 undo of a finished change', () => {
  it('previews, asks first, then runs the stored opposite through the same guarded tool', async () => {
    const w = await archived();
    seq(w.gh, REPO, [[200, base({ archived: true })], [200, base({ archived: true })], [200, base({ archived: true })], [200, base()]]);
    const preview = await run(w, 'github_undo_change', { changeId: 1, dryRun: true });
    expect(preview).toMatchObject({ status: 'preview', undoing: { changeId: 1, runs: 'github_repo_set_archived' } });
    expect(preview.preview).toContain('Unarchive');
    const ask = await run(w, 'github_undo_change', { changeId: 1, dryRun: true });
    expect(ask.status).toBe('preview');
    expect(patches(w.gh)).toHaveLength(1);
    const done = await run(w, 'github_undo_change', { changeId: 1, confirm: true });
    expect(done).toMatchObject({ status: 'applied', confirmed: true, undoing: { changeId: 1 } });
    expect(patches(w.gh)).toHaveLength(2);
    expect(patches(w.gh)[1].body).toMatchObject({ archived: false });
  });

  it('an undo is a normal change with its own opposite (undo of an undo)', async () => {
    const w = await archived();
    seq(w.gh, REPO, [[200, base({ archived: true })], [200, base()]]);
    await run(w, 'github_undo_change', { changeId: 1, confirm: true });
    expect((await w.db.getChange(2)).inverse).toMatchObject({ tool: 'github_repo_set_archived', args: { archived: true } });
    seq(w.gh, REPO, [[200, base()], [200, base({ archived: true })]]);
    const again = await run(w, 'github_undo_change', { changeId: 2, confirm: true });
    expect(again).toMatchObject({ status: 'applied', confirmed: true });
  });

  it('the same change cannot be undone twice: it was followed by the undo itself', async () => {
    const w = await archived();
    seq(w.gh, REPO, [[200, base({ archived: true })], [200, base()]]);
    await run(w, 'github_undo_change', { changeId: 1, confirm: true });
    const second = await run(w, 'github_undo_change', { changeId: 1, confirm: true });
    expect(second).toMatchObject({ status: 'refused', newerChanges: [2] });
    expect(second.reason).toContain('newer change');
    expect(patches(w.gh)).toHaveLength(2);
  });

  it('refuses when a newer change to the same repository overtook it, naming that change', async () => {
    const w = await archived();
    await w.db.recordChange(row({ tool: 'github_repo_rename', summary: 'Rename example-org/hello', inverse: null }));
    const out = await run(w, 'github_undo_change', { changeId: 1, confirm: true });
    expect(out).toMatchObject({ status: 'refused', newerChanges: [2] });
    expect(out.reason).toContain('Rename example-org/hello');
    expect(patches(w.gh)).toHaveLength(1);
  });

  it('an unrelated tool family or another repository does not block', async () => {
    const w = await archived();
    await w.db.recordChange(row({ tool: 'github_label_save', repo: 'example-org/hello', inverse: null }));
    await w.db.recordChange(row({ repo: 'example-org/other', target: 'example-org/other' }));
    seq(w.gh, REPO, [[200, base({ archived: true })], [200, base()]]);
    expect(await run(w, 'github_undo_change', { changeId: 1, confirm: true })).toMatchObject({ status: 'applied' });
  });

  it('says what to do instead for changes with no clean opposite', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    await w.db.recordChange(row({ tool: 'github_pr_merge', summary: 'Merge #4', inverse: null }));
    await w.db.recordChange(row({ tool: 'github_secret_set', summary: 'Set a secret', inverse: null }));
    await w.db.recordChange(row({ tool: 'github_repo_delete', summary: 'Delete', inverse: null }));
    expect((await run(w, 'github_undo_change', { changeId: 1 })).reason).toContain('revert pull request');
    expect((await run(w, 'github_undo_change', { changeId: 2 })).reason).toContain('setup page');
    expect((await run(w, 'github_undo_change', { changeId: 3 })).reason).toContain('contact GitHub support');
    expect(w.gh.calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });

  it('refuses previews, unconfirmed changes, unknown numbers and other accounts without revealing them', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    await w.db.recordChange(row({ dryRun: true, confirmed: false }));
    await w.db.recordChange(row({ confirmed: false, summary: 'UNCONFIRMED: Archive' }));
    await w.db.recordChange(row({ account: 'someone-else', repo: 'someone-else/x', target: 'someone-else/x' }));
    expect((await run(w, 'github_undo_change', { changeId: 1 })).reason).toContain('only a preview');
    expect((await run(w, 'github_undo_change', { changeId: 2 })).reason).toContain('never confirmed');
    const foreign = await run(w, 'github_undo_change', { changeId: 3 });
    const unknown = await run(w, 'github_undo_change', { changeId: 99 });
    expect(foreign.reason).toContain('no change number 3');
    expect(unknown.reason).toContain('no change number 99');
    expect(JSON.stringify(foreign)).not.toContain('someone-else');
  });

  it('refuses to undo a production change on a preview connection', async () => {
    const w = await makeWorld({ mode: 'preview', profile: 'full' });
    await w.db.recordChange(row());
    const out = await run(w, 'github_undo_change', { changeId: 1, confirm: true });
    expect(out).toMatchObject({ status: 'refused' });
    expect(out.reason).toContain('Read-only');
    expect(w.gh.calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });

  it('refuses when the profile cannot use the stored opposite', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'everyday' });
    await w.db.recordChange(row());
    const out = await run(w, 'github_undo_change', { changeId: 1, confirm: true });
    expect(out.status).toBe('refused');
    expect(out.reason).toContain("profile cannot use");
  });

  it('refuses a damaged stored opposite and never lets it carry its own approval', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    await w.db.recordChange(row({ inverse: { tool: 'rm -rf', args: {} } }));
    await w.db.recordChange(row({ inverse: { tool: 'github_repo_set_archived', args: { owner: 'example-org', repo: 'hello', archived: false, confirm: true, dryRun: false } } }));
    expect((await run(w, 'github_undo_change', { changeId: 1, confirm: true })).reason).toContain('not usable');
    seq(w.gh, REPO, [[200, base({ archived: true })]]);
    const out = await run(w, 'github_undo_change', { changeId: 2, dryRun: true });
    expect(out.status).toBe('preview');
    expect(patches(w.gh)).toEqual([]);
  });
});
