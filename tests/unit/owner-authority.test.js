import { describe, expect, it } from 'vitest';
import { defineWrite } from '../../src/core/write.js';
import { createGates } from '../../src/tools/gates.js';
import { makeWorld, parse, doorsFor } from '../../test/helpers/write-contract.js';
import { blockers } from '../../src/tools/pulls-merge.js';

const build = (changes = {}) => defineWrite({
  name: 'github_owner_fixture', area: 'fixture', audience: ['O'], description: 'Authority fixture.',
  properties: { owner: { type: 'string' } },
  declarations: { production: 'always', spend: true, accessWidening: true, notifies: true, confirm: 'always' },
  target: (a, c) => ({ owner: a.owner ?? c.connection.default_account, repo: 'hello', scope: 'repo' }),
  read: async () => ({ on: false }), classify: () => ({ production: 'repository settings',
    accessWidening: 'invite a person', notifies: ['outside-person'] }),
  price: () => null, summarize: () => 'Apply the requested settings',
  apply: async ({ ctx }) => { ctx.db.ownerWrites = (ctx.db.ownerWrites ?? 0) + 1; return { status: 200 }; },
  readAfter: async () => ({ on: true }), verify: ({ after }) => after.on,
  requestKey: (_c, a) => 'rmcp_owner_' + (a.requestKey ?? 'same'), ...changes
});

describe('full owner authority versus explicit delegation', () => {
  for (const door of doorsFor(build())) {
    it(`${door.name}: one-call production, unknown spend, access and notification, journal and replay`, async () => {
      const w = await makeWorld({ profile: 'full', mode: 'preview', gates: createGates() });
      await w.db.setSpendLimitCents('example-org', 0);
      await w.db.seedProtectedResources([{ kind: 'repo', target: 'example-org/hello', level: 'locked', reason: 'old default' }]);
      const result = parse(await door.call(w, {}));
      expect(result).toMatchObject({ status: 'applied', confirmed: true });
      expect(result.summary).toMatch(/COST UNKNOWN/);
      expect(result.summary).toMatch(/NOTIFIES outside-person/);
      expect((await w.db.getChange(result.logged.id)).confirmed).toBe(true);
      expect(parse(await door.call(w, {}))).toMatchObject({ status: 'replayed' });
      expect(w.db.ownerWrites).toBe(1);
    });
  }
  it('keeps an explicitly restricted production/pass grant from using owner semantics', async () => {
    const w = await makeWorld({ profile: 'full', delegated: true, mode: 'preview', gates: createGates() });
    const result = parse(await build().handler({ confirm: true }, w.ctx));
    expect(result).toMatchObject({ status: 'refused_by_guard', refusedBy: 'mode' });
    expect(w.db.ownerWrites).toBeUndefined();
  });
  it('turns unavailable pricing into a disclosure on owner connections', async () => {
    const w = await makeWorld({ profile: 'full', gates: createGates() });
    const result = parse(await build({ price: () => { throw new Error('unavailable'); } }).handler({}, w.ctx));
    expect(result).toMatchObject({ status: 'applied' });
    expect(result.summary).toMatch(/COST UNKNOWN/);
  });
  it('still refuses read-only grants, foreign targets and missing journal storage', async () => {
    const read = await makeWorld({ profile: 'read_only', gates: createGates() });
    expect(parse(await build().handler({}, read.ctx)).status).toBe('refused');
    const w = await makeWorld({ profile: 'full', gates: createGates() });
    expect(parse(await build().handler({ owner: 'foreign' }, w.ctx)).status).toBe('refused');
    expect(parse(await build().handler({}, { ...w.ctx, db: {} })).status).toBe('refused');
    expect(w.db.ownerWrites).toBeUndefined();
  });
  it('preserves dryRun and independent readback honesty', async () => {
    const w = await makeWorld({ profile: 'full', gates: createGates() });
    expect(parse(await build().handler({ dryRun: true }, w.ctx)).status).toBe('preview');
    expect(w.db.ownerWrites).toBeUndefined();
    const result = parse(await build({ readAfter: async () => ({ on: false }) }).handler({}, w.ctx));
    expect(result).toMatchObject({ status: 'unconfirmed', confirmed: false, done: false });
    expect(result.warning).toBeTruthy();
  });
  it('ordinary owner merge relays rules to GitHub while retaining expected-head accuracy', () => {
    const pr = { state: 'open', head_sha: 'a'.repeat(40), draft: true, mergeable: false, mergeable_state: 'blocked' };
    expect(blockers({ ownerDirected: true, pr, ci: { green: false } }, { expectedHeadSha: pr.head_sha })).toEqual([]);
    expect(blockers({ ownerDirected: true, pr, ci: { green: false } }, {})).toEqual([]);
    expect(blockers({ ownerDirected: true, pr }, { expectedHeadSha: 'b'.repeat(40) })).toHaveLength(1);
    expect(blockers({ ownerDirected: false, pr, ci: { green: false, problems: ['red'] } }, { expectedHeadSha: pr.head_sha })).not.toEqual([]);
  });
});

describe('owner actions through real tool/client boundaries', () => {
  it('submits default-branch deletion to GitHub and relays its rejection without a local policy veto or pacing slot', async () => {
    const { registry } = await import('../../src/tools/index.js');
    const { createDispatch } = await import('../../src/tools/dispatch.js');
    const w = await makeWorld({ profile: 'full', mode: 'preview', gates: createGates() });
    w.db.claimWriteSlot = async () => { throw new Error('owner writes must not reserve a fixed spacing slot'); };
    w.gh.when('GET /repos/{owner}/{repo}/git/ref/{ref}').reply(200, { object: { sha: 'a'.repeat(40) } });
    w.gh.when('GET /repos/{owner}/{repo}').reply(200, { default_branch: 'main' });
    w.gh.when('DELETE /repos/{owner}/{repo}/git/refs/{ref}').reply(422, { message: 'Cannot delete the default branch' });
    const reply = await createDispatch({ credentials: w.credentials, gates: w.ctx.gates,
      fetch: w.gh.fetch, now: w.ctx.now, sleep: w.ctx.sleep })({
      registry, name: 'github_branch_delete', args: { repo: 'hello', branch: 'main' },
      connection: w.connection, db: w.db
    });
    expect(parse(reply)).toMatchObject({ status: 'rejected', done: false });
    expect(w.gh.calls.filter(c => c.method === 'DELETE')).toHaveLength(1);
    expect(w.gh.invalid).toEqual([]);
  });
});
