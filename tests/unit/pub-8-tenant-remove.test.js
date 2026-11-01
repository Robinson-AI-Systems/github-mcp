// PUB-8: the owner-only removal of one person by identity. The nine write-contract checks run through every door with an
// in-memory removal store (the real store is proven on PostgreSQL in tests/db/pub-8-tenant-removal.test.js).
import { describe, expect, it } from 'vitest';
import { runWriteContract, makeWorld, parse } from '../../test/helpers/write-contract.js';
import { definition } from '../../src/tools/tenant-remove.js';
import { registry } from '../../src/tools/index.js';
import { createDispatch } from '../../src/tools/dispatch.js';
import { mergeNamespaces, toolsForListing, toolsForProfile, isToolVisible } from '../../src/core/registry.js';
import { pageToolsForListing } from '../../src/core/tool-pages.js';
import { isOperatorConnection, operatorConnection } from '../../src/core/authority.js';
import * as meta from '../../src/tools/meta.js';

const ID = '11111111-2222-4333-8444-555555555555';
const TENANT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

/** An in-memory store with one person, one space, one stored GitHub sign-in. */
function fakeStore({ owner = false, shared = false } = {}) {
  const state = { present: true, removed: 0, revocations: 0 };
  const plan = () => ({ identity_id: ID, identity_present: true, github_id: '31001', logins: ['stranger-dev'], owner,
    tenants: [{ tenant_id: TENANT, kind: 'public', status: 'active', other_members: shared ? 1 : 0, shared_rows: { gh_tenant_user_authorizations: 1 },
      namespace_present: true, namespace_rows: { oauth_tokens: 2 }, github_sign_ins: 1, saved_keys: 1, assistant_connections: 2, assistant_apps: 1,
      async_jobs: 1, settings_rows: 3, device_pointers: 1, playground: [{ phase: 'attached', placement: 'managed', cleanupRequested: false }] }] });
  return {
    state,
    async resolve({ identity, login }) { if (!state.present) return null; return identity === ID || String(login).toLowerCase() === 'stranger-dev' ? ID : null; },
    async plan(id) { return state.present && id === ID ? plan() : null; },
    async revocationTokens() { state.revocations += 1; return [{ account: 'stranger-dev', token: 'ghu_FAKE0123456789stranger' }]; },
    async appClient() { return { clientId: 'Iv1.FAKEclient0001', clientSecret: 'FAKE-client-secret-value' }; },
    async remove() { state.present = false; state.removed += 1; return 1; },
    async readback(p) { return { identity_present: state.present, member_elsewhere: false, tenants: p.tenants.map((t) => ({ tenant_id: t.tenant_id,
      tenant_row: state.present, namespace_present: state.present, shared_rows: state.present ? 1 : 0, device_pointers: state.present ? 1 : 0,
      playground_awaiting_sweep: 1, playground_unflagged: 0 })) }; }
  };
}
const arrange = (gh, replies) => {
  gh.when('DELETE /applications/{client_id}/token').reply(204, null);
  // GitHub's own "check a token" answers 404 once the token is revoked; the mismatch fixture says it still works.
  gh.when('POST /applications/{client_id}/token').reply(replies === 'mismatch' ? 200 : 404, replies === 'mismatch' ? { id: 1, token: null } : { message: 'Not Found' });
};
const prepare = (w) => { w.db.tenantRemoval = fakeStore(); };

runWriteContract({
  label: 'github_tenant_remove', definition, args: { identity: ID }, arrange, prepare,
  profile: 'full', operator: true, needsConfirm: false, expectedWrites: 2
});

const operatorWorld = async (store = fakeStore(), extra = {}) => {
  const w = await makeWorld({ profile: 'full', operator: true, ...extra });
  arrange(w.gh, 'ok');
  w.db.tenantRemoval = store;
  return { ...w, store };
};
const writes = (gh) => gh.calls.filter((c) => c.method !== 'GET');
const solo = mergeNamespaces([{ tools: [definition.tool], handlers: { [definition.tool.name]: definition.handler } }]);
const withMeta = mergeNamespaces([meta, { tools: [definition.tool], handlers: { [definition.tool.name]: definition.handler } }]);
const dispatchFor = (w) => createDispatch({ env: w.ctx.env, credentials: w.credentials, gates: [], fetch: w.gh.fetch, now: w.ctx.now });

describe('PUB-8 github_tenant_remove: owner only, previewed, confirmed', () => {
  it('without confirm it only previews (journaled as a preview) and changes nothing', async () => {
    const w = await operatorWorld();
    const out = parse(await definition.handler({ identity: ID }, w.ctx));
    expect(out).toMatchObject({ status: 'needs_confirmation', needsConfirmation: true, done: false });
    expect(out.preview).toContain('REMOVE person ' + ID);
    expect(out.preview).toContain('revoke 1 stored GitHub sign-in at GitHub first');
    expect(out.preview).toContain('1 Playground allocation handed to cleanup');
    expect(writes(w.gh)).toEqual([]);
    expect(w.store.state).toMatchObject({ present: true, removed: 0, revocations: 0 });
    expect(await w.db.getChange(1)).toMatchObject({ dryRun: true, tool: 'github_tenant_remove' });
  });

  it('with confirm it revokes the GitHub sign-in before removing, reads back absence and never returns a token', async () => {
    const w = await operatorWorld();
    const order = [];
    const remove = w.store.remove;
    w.store.remove = async (p) => { order.push(['remove', writes(w.gh).length]); return remove(p); };
    const out = parse(await definition.handler({ login: 'Stranger-Dev', confirm: true }, w.ctx));
    expect(out).toMatchObject({ status: 'applied', confirmed: true, done: true });
    expect(out.result.github_sign_ins).toEqual([{ account: 'stranger-dev', at_github: 'revoked', still_valid: false }]);
    expect(out.result.readback.identity_present).toBe(false);
    expect(order).toEqual([['remove', 2]]); // the DELETE and the check were sent before any data went
    const [del, check] = writes(w.gh);
    expect(del).toMatchObject({ route: 'DELETE /applications/{client_id}/token' });
    expect(check).toMatchObject({ route: 'POST /applications/{client_id}/token' });
    expect(w.gh.invalid).toEqual([]);
    const text = JSON.stringify(out) + JSON.stringify(await w.db.getChange(1));
    expect(text).not.toContain('ghu_FAKE0123456789stranger');
    expect(text).not.toContain('FAKE-client-secret-value');
  });

  it('refuses the owner\'s own identity unless includeOwnIdentity is also given', async () => {
    const w = await operatorWorld(fakeStore({ owner: true }));
    const refused = parse(await definition.handler({ identity: ID, confirm: true }, w.ctx));
    expect(refused).toMatchObject({ status: 'refused_by_guard', refusedBy: 'read', reason_code: 'own_identity' });
    expect(refused.error).toContain('includeOwnIdentity');
    expect(writes(w.gh)).toEqual([]);
    expect(w.store.state.present).toBe(true);
    const allowed = parse(await definition.handler({ identity: ID, includeOwnIdentity: true, confirm: true }, w.ctx));
    expect(allowed).toMatchObject({ status: 'applied', confirmed: true });
    expect(allowed.result.owner_identity).toBe(true);
  });

  it('an unknown identity sends nothing and says nothing is stored', async () => {
    const w = await operatorWorld();
    const out = parse(await definition.handler({ identity: '99999999-2222-4333-8444-555555555555', confirm: true }, w.ctx));
    expect(out).toMatchObject({ status: 'not_applied', reason_code: 'no_operation_started', no_change_sent: true });
    expect(out.error).toContain('Nothing is stored for');
    expect(writes(w.gh)).toEqual([]);
    expect(w.store.state).toMatchObject({ present: true, revocations: 0 });
  });

  it('a person sharing a space with others is refused; exactly one of identity or login is required', async () => {
    const w = await operatorWorld(fakeStore({ shared: true }));
    expect(parse(await definition.handler({ identity: ID, confirm: true }, w.ctx))).toMatchObject({ status: 'refused_by_guard', reason_code: 'shared_tenant' });
    expect(parse(await definition.handler({ confirm: true }, w.ctx))).toMatchObject({ status: 'refused', error: 'Give exactly one of identity or login.' });
    expect(parse(await definition.handler({ identity: ID, login: 'stranger-dev', confirm: true }, w.ctx))).toMatchObject({ status: 'refused' });
    expect(w.store.state.present).toBe(true);
  });

  it('a GitHub refusal to revoke stops before any data is removed; a removal repeated later finds nothing and sends nothing', async () => {
    const w = await operatorWorld();
    w.gh.when('DELETE /applications/{client_id}/token').reply(500, { message: 'boom' });
    const failed = parse(await definition.handler({ identity: ID, confirm: true }, w.ctx));
    expect(['uncertain', 'rejected']).toContain(failed.status);
    expect(w.store.state).toMatchObject({ present: true, removed: 0 });
    const ok = await operatorWorld();
    expect(parse(await definition.handler({ identity: ID, confirm: true, requestKey: 'first' }, ok.ctx)).status).toBe('applied');
    const again = parse(await definition.handler({ identity: ID, confirm: true, requestKey: 'second' }, ok.ctx));
    expect(again).toMatchObject({ status: 'not_applied', no_change_sent: true });
    expect(ok.store.state.removed).toBe(1);
  });

  it('is never listed to, and never callable by, anyone but the operator\'s own connection (every door)', async () => {
    const operator = { client_id: 'c', default_account: 'example-org', accounts: ['example-org'], mode: 'preview', profile: 'full', listing: 'catalog', operator: true };
    const person = { ...operator, operator: undefined };
    const pass = { ...operator, pass: true };
    expect(isOperatorConnection(operator)).toBe(true);
    for (const c of [person, pass, { ...operator, profile: 'everyday' }, null]) {
      expect(isOperatorConnection(c)).toBe(false);
      expect(isToolVisible(definition.tool, c?.profile ?? 'full', c)).toBe(false);
    }
    const names = (list) => list.map((t) => t.name);
    expect(names(toolsForProfile(registry, 'full', operator))).toContain('github_tenant_remove');
    expect(names(toolsForProfile(registry, 'full', person))).not.toContain('github_tenant_remove');
    expect(names(toolsForProfile(registry, 'full'))).not.toContain('github_tenant_remove');
    expect(names(toolsForListing(registry, 'full', 'catalog', person))).not.toContain('github_tenant_remove');
    const pages = (c) => { const all = []; let cursor; do { const p = pageToolsForListing(registry, 'full', 'catalog', cursor, c); all.push(...p.tools); cursor = p.nextCursor; } while (cursor); return names(all); };
    expect(pages(operator)).toContain('github_tenant_remove');
    expect(pages(person)).not.toContain('github_tenant_remove');

    // A full owner of their OWN tenant (no operator mark) gets "unknown tool" from dispatch and from github_call, and nothing runs.
    const w = await makeWorld({ profile: 'full' });
    w.db.tenantRemoval = fakeStore();
    const direct = await dispatchFor(w)({ registry: solo, name: 'github_tenant_remove', args: { identity: ID, confirm: true }, connection: w.connection, db: w.db });
    expect(direct.isError).toBe(true);
    expect(direct.content[0].text).toContain('Unknown or unavailable tool');
    const viaCall = await dispatchFor(w)({ registry: withMeta, name: 'github_call', args: { name: 'github_tenant_remove', args: { identity: ID, confirm: true } }, connection: w.connection, db: w.db });
    expect(JSON.stringify(viaCall)).toMatch(/Unknown or unavailable tool|not available|unavailable/);
    const handler = parse(await definition.handler({ identity: ID, confirm: true }, w.ctx));
    expect(handler).toMatchObject({ status: 'refused' });
    expect(handler.error).toContain('Only the service owner');
    expect(w.db.tenantRemoval.state).toMatchObject({ present: true, revocations: 0 });
    expect(writes(w.gh)).toEqual([]);
  });

  it('only the operator route marks its connector connections', () => {
    const base = (record) => ({ connection: Object.freeze({ client_id: record.client_id, profile: record.profile }) });
    const wrapped = operatorConnection(base);
    expect(wrapped({ client_id: 'a', profile: 'full', kind: 'connector' }).connection).toMatchObject({ operator: true });
    expect(wrapped({ client_id: 'a', profile: 'full', kind: 'pass' }).connection.operator).toBeUndefined();
    expect(operatorConnection(() => null)({ kind: 'connector' })).toBeNull();
    expect(operatorConnection(() => ({ refuse: { status: 403 } }))({ kind: 'connector' })).toEqual({ refuse: { status: 403 } });
  });
});
