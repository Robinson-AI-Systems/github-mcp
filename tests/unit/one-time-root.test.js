// ONE-TIME-ROOT-1: a one-time secret issued through a tenant-routed connection must be consumable by the owner's setup page,
// which reads the ROOT database. Before this, the owner connecting from claude.ai (a tenant, RELAY-OWNER-1) minted runner
// tokens into his tenant schema and every reveal answered 410.
import { describe, expect, it } from 'vitest';
import { makeWorld, parse } from '../../test/helpers/write-contract.js';
import { createFakeDb } from '../../test/helpers/fake-db.js';
import * as write from '../../src/tools/runners-write.js';
import { ownerOneTimeStore } from '../../src/tools/one-time-root.js';
import { createOneTimeStore } from '../../src/core/one-time-secrets.js';
import { readEncryptionKey } from '../../src/core/crypto.js';

const O = 'example-org';
const SECRET = 'AFAKE_TOKEN_123';
const registerRoutes = (gh) => {
  gh.when('GET /orgs/{org}/actions/runners').reply(200, { total_count: 0, runners: [] });
  gh.when('POST /orgs/{org}/actions/runners/registration-token').reply(201, { token: SECRET, expires_at: '2030-01-01T00:00:00Z' });
};
/** The owner's page: the root store, built exactly as src/runtime.js builds it. */
const pageStore = (w) => createOneTimeStore({ db: w.db, service: 'github', setupPath: '/api/github/setup', encryptionKey: readEncryptionKey(w.ctx.env) });
const showId = (reveal) => new URL(reveal, 'https://example.test').searchParams.get('show');

/** A tenant-routed owner: ctx.db is the tenant's own schema (a second fake database); the root is reachable as publicDb. */
const asTenant = async (w) => {
  const tenantDb = createFakeDb({ clock: w.ctx.now });
  await tenantDb.initSchema();
  tenantDb.playgroundScope = Object.freeze({ tenantId: 't-owner', identityId: 'i-owner', membershipRevision: 1 });
  return { ...w, tenantDb, ctx: { ...w.ctx, db: tenantDb, publicDb: w.db } };
};

describe('one-time secrets are issued where the setup page reveals them', () => {
  it('a runner token minted from a tenant-routed connection is revealed once by the root page store, and is not in the tenant schema', async () => {
    const w = await asTenant(await makeWorld({ mode: 'production', profile: 'full' }));
    registerRoutes(w.gh);
    const r = parse(await write.handlers.github_runner_register({ owner: O, kind: 'registration', confirm: true }, w.ctx));
    expect(JSON.stringify(r)).not.toContain(SECRET);
    const id = showId(r.result.reveal);
    expect(id).toMatch(/^[A-Za-z0-9_-]{32}$/);
    // the tenant's own table never saw it
    expect(await w.tenantDb.consumeOneTimeSecret(id)).toBeNull();
    // the owner's page finds it, exactly once
    const shown = await pageStore(w).consume(id);
    expect(shown).toMatchObject({ kind: 'github-runner-registration-token', account: O, secret: SECRET });
    expect(await pageStore(w).consume(id)).toBeNull();
  });
  it('an owner connection on the root database behaves as before', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    registerRoutes(w.gh);
    const r = parse(await write.handlers.github_runner_register({ owner: O, kind: 'registration', confirm: true }, w.ctx));
    const shown = await pageStore(w).consume(showId(r.result.reveal));
    expect(shown?.secret).toBe(SECRET);
  });
  it('ownerOneTimeStore prefers the root handle: publicDb when given, the tenant db only when the context is not tenant-scoped', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    const other = createFakeDb({ clock: w.ctx.now }); await other.initSchema();
    const t = await ownerOneTimeStore({ ...w.ctx, db: other, publicDb: w.db }).issue({ account: O, kind: 'probe', secret: 'x' });
    expect(await pageStore(w).consume(showId(t.setupPath))).toMatchObject({ secret: 'x' });
    const u = await ownerOneTimeStore({ ...w.ctx, db: other }).issue({ account: O, kind: 'probe', secret: 'y' });
    expect(await pageStore(w).consume(showId(u.setupPath))).toBeNull(); // not root-scoped → stays in `other`, as before
    expect(await other.consumeOneTimeSecret(showId(u.setupPath))).not.toBeNull();
  });
});
