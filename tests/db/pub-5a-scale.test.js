// PUB-5 A: the public service works for thousands of people. The App-uninstall clean-up, "delete a person" and the usage
// summary no longer visit every person one by one or stop at a fixed number. Real throwaway PostgreSQL; no real tokens.
import crypto from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db.js';
import { createTenantDirectory, createTenantSql, initializeProvisionedTenant, tenantSchemaName } from '../../src/tenancy/directory.js';
import { createPublicCleanup } from '../../src/tenancy/public-cleanup.js';
import { findPublicTenantsByLogin, forgetPublicPerson } from '../../src/tenancy/forget-person.js';
import { publicUsageSummary } from '../../src/tenancy/usage-summary.js';

let admin, directory, root, url;
const clients = [], opened = new Set();
const connect = async (u) => { const c = new pg.Client({ connectionString: u }); await c.connect(); clients.push(c); return c; };
const sqlFor = (client) => async (template, ...values) => {
  let query = template[0];
  for (let i = 0; i < values.length; i++) query += '$' + (i + 1) + template[i + 1];
  return (await client.query(query, values)).rows;
};
const rootSql = () => sqlFor(admin);
// One shared connection that switches to the person's own namespace before each query (hundreds of people must not open
// hundreds of connections). It also remembers which stores were opened, so a test can prove only the right ones were touched.
let shared = null, turn = Promise.resolve();
const tenantSqlFactory = (u) => {
  const options = new URL(u).searchParams.get('options');
  const schema = options.replace('-c search_path=', '');
  // The switch and the query run as one unit: two callers at once (the concurrent backfill below) must never interleave a
  // second person's SET between the first person's SET and query, or one store would be read as another's.
  return (parts, ...params) => {
    const run = turn.then(async () => {
      opened.add(options);
      shared ??= await connect(url);
      await shared.query('SET search_path TO "' + schema + '"');
      return sqlFor(shared)(parts, ...params);
    });
    turn = run.catch(() => {});
    return run;
  };
};
const optionsOf = (tenantId) => '-c search_path=' + tenantSchemaName(tenantId);
let subjectCounter = 700000;
/** A public person with root rows only (no store): cheap enough to make hundreds. */
async function lightPerson() {
  const identityId = await directory.enrollVerifiedGithubSubject(String(++subjectCounter));
  return { identityId, tenantId: await directory.provisionPilotForOwnerAccount(identityId, 'public-connect') };
}
/** A public person with a real store holding App accounts. */
async function realPerson(login, installationIds) {
  const person = await lightPerson();
  const { db } = await initializeProvisionedTenant({ tenantId: person.tenantId, connectionString: url, sqlFactory: tenantSqlFactory });
  await db.upsertAccount({ login, accountId: subjectCounter, accountType: 'User', label: login, credentialKind: 'app', appId: 960005 });
  for (const [i, id] of installationIds.entries()) {
    if (i > 0) await db.upsertAccount({ login: login + '-org' + i, accountId: subjectCounter + i, accountType: 'Organization', label: login + i, credentialKind: 'app', appId: 960005 });
    await db.setInstallation(i === 0 ? login : login + '-org' + i, { installationId: id, repositorySelection: 'all', permissions: {}, status: 'active' });
  }
  await directory.indexPublicInstallations(person.tenantId, installationIds);
  return { ...person, db };
}
const rowsFor = async (tenantId) => (await admin.query('SELECT installation_id FROM gh_public_installations WHERE tenant_id=$1 ORDER BY 1', [tenantId])).rows.map((r) => Number(r.installation_id));
const cleanup = () => createPublicCleanup({ rootSql: rootSql(), connectionString: url, sqlFactory: tenantSqlFactory });

beforeAll(async () => {
  url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('Disposable TEST_DATABASE_URL is required.');
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url).hostname)) throw new Error('Refusing non-local PostgreSQL.');
  admin = await connect(url);
  const ns = 'github_pub5a_' + crypto.randomBytes(6).toString('hex');
  await admin.query('CREATE SCHEMA "' + ns + '"'); await admin.query('SET search_path TO "' + ns + '"');
  admin.ns = ns;
  directory = createTenantDirectory(rootSql()); await directory.initSchema();
  root = createDb(rootSql()); await root.initSchema();
}, 120000);
afterAll(async () => {
  if (admin) {
    const ids = await admin.query('SELECT tenant_id FROM gh_tenant_pilot_bootstraps').then((r) => r.rows).catch(() => []);
    for (const r of ids) await admin.query('DROP SCHEMA IF EXISTS "' + tenantSchemaName(r.tenant_id) + '" CASCADE').catch(() => {});
    await admin.query('DROP SCHEMA IF EXISTS "' + admin.ns + '" CASCADE').catch(() => {});
  }
  for (const c of clients.reverse()) await c.end().catch(() => {});
});

describe('PUB-5 A: the installation lookup', () => {
  it('replaces a person\'s rows, keeps numbers only, and is removed with the person', async () => {
    const p = await lightPerson();
    expect(await directory.indexPublicInstallations(p.tenantId, [9001, 9002, 9001])).toBe(2);
    expect(await rowsFor(p.tenantId)).toEqual([9001, 9002]);
    await directory.indexPublicInstallations(p.tenantId, [9002, 9003]);
    expect(await rowsFor(p.tenantId)).toEqual([9002, 9003]);
    await directory.indexPublicInstallations(p.tenantId, []);
    expect(await rowsFor(p.tenantId)).toEqual([]);
    await expect(directory.indexPublicInstallations(p.tenantId, [0])).rejects.toThrow();
    await expect(directory.indexPublicInstallations(p.tenantId, ['x'])).rejects.toThrow();
    const cols = (await admin.query("SELECT column_name FROM information_schema.columns WHERE table_name='gh_public_installations' AND table_schema=$1 ORDER BY 1", [admin.ns])).rows.map((r) => r.column_name);
    expect(cols).toEqual(['installation_id', 'tenant_id']);
    await directory.indexPublicInstallations(p.tenantId, [9004]);
    expect(await directory.forgetPublicTenant(p.tenantId)).toBe(true);
    expect(await rowsFor(p.tenantId)).toEqual([]);
  });

  it('backfills people who signed in before the lookup existed, and two callers at once do not duplicate', async () => {
    const a = await realPerson('backfill-a', [9101]);
    const b = await realPerson('backfill-b', [9102, 9103]);
    await admin.query('DELETE FROM gh_public_installations WHERE tenant_id = ANY($1::uuid[])', [[a.tenantId, b.tenantId]]);
    const read = async (tenantId) => {
      const sql = createTenantSql(url, tenantId, tenantSqlFactory);
      return (await sql`SELECT installation_id FROM gh_accounts WHERE credential_kind='app' AND installation_id IS NOT NULL`).map((r) => Number(r.installation_id));
    };
    const [x, y] = await Promise.all([directory.backfillPublicInstallations({ readInstallationIds: read }), directory.backfillPublicInstallations({ readInstallationIds: read })]);
    expect(x).toBeGreaterThanOrEqual(2); expect(y).toBeGreaterThanOrEqual(2);
    expect(await rowsFor(a.tenantId)).toEqual([9101]);
    expect(await rowsFor(b.tenantId)).toEqual([9102, 9103]);
    const dupes = (await admin.query('SELECT installation_id, tenant_id, count(*) FROM gh_public_installations GROUP BY 1,2 HAVING count(*) > 1')).rowCount;
    expect(dupes).toBe(0);
  });
});

describe('PUB-5 A: App uninstall with many people present', () => {
  it('changes only the matching person and opens only that person\'s store, with 500 people present', async () => {
    const target = await realPerson('uninstall-target', [9201]);
    const bystander = await realPerson('uninstall-bystander', [9202]);
    for (let i = 0; i < 500; i++) await lightPerson();
    opened.clear();
    const started = Date.now();
    expect(await cleanup().installationChanged({ installationId: 9201, action: 'deleted' })).toBe(1);
    const ms = Date.now() - started;
    expect([...opened]).toEqual([optionsOf(target.tenantId)]);
    expect((await target.db.getAccount('uninstall-target')).installation_status).toBe('none');
    expect((await bystander.db.getAccount('uninstall-bystander')).installation_status).toBe('active');
    console.log('PUB-5A uninstall with 500+ people present took ' + ms + ' ms');
    expect(ms).toBeLessThan(5000);
  });

  it('on first use fills the lookup from the people\'s own stores once, then never scans again', async () => {
    const early = await realPerson('early-person', [9301]);
    await admin.query('DELETE FROM gh_public_installations');
    await admin.query("DELETE FROM gh_settings WHERE key = 'public_installations_backfilled'").catch(() => {});
    expect(await cleanup().installationChanged({ installationId: 9301, action: 'suspend' })).toBe(1);
    expect((await early.db.getAccount('early-person')).installation_status).toBe('suspended');
    expect(await root.getSetting('public_installations_backfilled')).toBe(true);
    opened.clear();
    expect(await cleanup().installationChanged({ installationId: 424242, action: 'deleted' })).toBe(0);
    expect(opened.size).toBe(0);
  });
});

describe('PUB-5 A: delete a person and the usage summary have no ceiling', () => {
  it('finds a person through the shared grant, and through the paged scan when the grant is gone', async () => {
    const zoe = await realPerson('zoe-dev', [9401]);
    for (let i = 0; i < 120; i++) await lightPerson(); // more than the old 100 ceiling
    const opts = { connectionString: url, sqlFactory: tenantSqlFactory };
    await admin.query(`INSERT INTO gh_tenant_user_authorizations (tenant_id, identity_id, account_login, user_login, access_enc, access_expires_at)
      VALUES ($1,$2,'zoe-dev','Zoe-Dev','FAKE-sealed', now() + interval '1 hour')`, [zoe.tenantId, zoe.identityId]);
    opened.clear();
    expect(await findPublicTenantsByLogin(rootSql(), 'zoe-dev', opts)).toEqual([zoe.tenantId]);
    expect([...opened]).toEqual([optionsOf(zoe.tenantId)]); // found through the grant: only her store was opened
    await admin.query('DELETE FROM gh_tenant_user_authorizations WHERE tenant_id = $1', [zoe.tenantId]);
    expect(await findPublicTenantsByLogin(rootSql(), 'zoe-dev', opts)).toEqual([zoe.tenantId]); // fallback scan, past 100 people
    expect(await findPublicTenantsByLogin(rootSql(), 'nobody-here-at-all', opts)).toEqual([]);
    await expect(findPublicTenantsByLogin(rootSql(), 'bad name!', opts)).rejects.toThrow();
    expect(await forgetPublicPerson(directory, rootSql(), 'zoe-dev', opts)).toBe(1);
    expect((await admin.query('SELECT 1 FROM information_schema.schemata WHERE schema_name=$1', [tenantSchemaName(zoe.tenantId)])).rowCount).toBe(0);
    expect(await rowsFor(zoe.tenantId)).toEqual([]);
  });

  it('counts 250 and more people (the old limit was 100), with no ceiling (PR B reads one daily table, so the total is never cut)', async () => {
    const before = (await admin.query("SELECT count(*)::int AS n FROM gh_tenant_pilot_bootstraps WHERE account_login='public-connect'")).rows[0].n;
    for (let i = Math.max(0, 250 - before); i > 0; i--) await lightPerson();
    const total = (await admin.query("SELECT count(*)::int AS n FROM gh_tenant_pilot_bootstraps WHERE account_login='public-connect'")).rows[0].n;
    expect(total).toBeGreaterThanOrEqual(250);
    const out = await publicUsageSummary(rootSql(), { connectionString: url, sqlFactory: tenantSqlFactory });
    expect(out.peopleConnected).toBe(total);
    expect(out.partial).toBe(false);
    expect(out.peopleConnected).toBeGreaterThan(100);
    expect(JSON.stringify(out)).not.toMatch(/tok|@|ghp_/);
  });
});
