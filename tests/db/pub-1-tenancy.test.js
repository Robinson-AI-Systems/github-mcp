import crypto from 'node:crypto';
import pg from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createDb, SCHEMA_TABLES } from '../../src/db.js';
import { createTenantDirectory, tenantConnectionString, tenantSchemaName,
  openAuthorizedTenantDb, initializeProvisionedTenant } from '../../src/tenancy/directory.js';

let root, legacy, directory, first, second, a, b, tenantA, tenantB, rootSchema;
const clients = [];
const adapter = client => async (parts, ...values) => {
  let query = parts[0];
  for (let i = 0; i < values.length; i++) query += '$' + (i + 1) + parts[i + 1];
  return (await client.query(query, values)).rows;
};
const connect = async connectionString => {
  const client = new pg.Client({ connectionString });
  await client.connect(); clients.push(client); return client;
};
const query = (client, text, values = []) => client.query(text, values).then(result => result.rows);

beforeAll(async () => {
  const database = process.env.TEST_DATABASE_URL;
  if (!database) throw new Error('TEST_DATABASE_URL must point to disposable localhost Postgres.');
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(database).hostname))
    throw new Error('Refusing remote Postgres in the PUB-1 isolation tests.');
  root = await connect(database);
  rootSchema = 'github_pub1_test_' + crypto.randomBytes(6).toString('hex');
  await root.query('CREATE SCHEMA "' + rootSchema + '"');
  await root.query('SET search_path TO "' + rootSchema + '"');
  const rootSql = adapter(root);
  legacy = createDb(rootSql);
  await legacy.initSchema();
  await legacy.upsertAccount({ login: 'overlap-org', accountId: 902, accountType: 'Organization',
    label: 'Existing private owner account', credentialKind: 'app', appId: 902 });
  directory = createTenantDirectory(rootSql);
  await directory.initSchema();
  const p1 = await directory.enrollVerifiedGithubSubject('10001');
  const p2 = await directory.enrollVerifiedGithubSubject('10002');
  a = await directory.provision(p1);
  b = await directory.provision(p2);
  // A caller must not make a tenant active before all tables are real,
  // even when it knows the correct opaque schema name.
  expect(await directory.activate(a.id, tenantSchemaName(a.id))).toBe(false);
  expect(await directory.activate(b.id, tenantSchemaName(b.id))).toBe(false);

  // Genuine separate PostgreSQL connections with the exact per-tenant startup
  // search_path option; no app SELECT/INSERT may accidentally use the public table.
  first = await connect(tenantConnectionString(database, a.id));
  second = await connect(tenantConnectionString(database, b.id));
  const sqlA = adapter(first), sqlB = adapter(second);
  expect((await initializeProvisionedTenant({ tenantId: a.id, connectionString: database,
    sqlFactory: () => sqlA })).namespace).toBe(tenantSchemaName(a.id));
  expect((await initializeProvisionedTenant({ tenantId: b.id, connectionString: database,
    sqlFactory: () => sqlB })).namespace).toBe(tenantSchemaName(b.id));
  expect(await directory.activate(a.id, tenantSchemaName(a.id))).toBe(true);
  expect(await directory.activate(b.id, tenantSchemaName(b.id))).toBe(true);

  tenantA = await openAuthorizedTenantDb({ directory, tenantId: a.id, verifiedIdentityId: p1,
    connectionString: database, sqlFactory: () => sqlA });
  tenantB = await openAuthorizedTenantDb({ directory, tenantId: b.id, verifiedIdentityId: p2,
    connectionString: database, sqlFactory: () => sqlB });

  // Expose only internal verified identity IDs to test membership behaviors;
  // no new public OAuth route or provider login is being asserted.
  a.owner = p1; b.owner = p2;
});

afterAll(async () => {
  if (root) {
    for (const tenant of [a, b]) if (tenant?.id) {
      const namespace = tenantSchemaName(tenant.id);
      await root.query('DROP SCHEMA IF EXISTS "' + namespace + '" CASCADE').catch(() => {});
    }
    if (rootSchema) await root.query('DROP SCHEMA IF EXISTS "' + rootSchema + '" CASCADE').catch(() => {});
  }
  for (const client of clients.reverse()) await client.end().catch(() => {});
});

describe('PUB-1 real PostgreSQL tenant scope and legacy preservation', () => {
  it('isolates every existing store table with a separately verified namespace', async () => {
    const expected = [...SCHEMA_TABLES].sort();
    const tablesA=await tenantA.db.listTables();
    const tablesB=await tenantB.db.listTables();
    for(const name of [...expected,'gh_tenant_budget_windows','gh_tenant_runtime_metrics']){
      expect(tablesA).toContain(name);
      expect(tablesB).toContain(name);
    }
    expect((await query(first, "SELECT current_schema() AS schema"))[0].schema).toBe(tenantSchemaName(a.id));
    expect((await query(second, "SELECT current_schema() AS schema"))[0].schema).toBe(tenantSchemaName(b.id));
    // This root schema remains separate; it contains existing owner data and new
    // dormant directory tables, and was not copied into either isolated tenant.
    expect((await legacy.getAccount('overlap-org')).label).toBe('Existing private owner account');
    expect(await tenantA.db.getAccount('overlap-org')).toBeNull();
    expect(await tenantB.db.getAccount('overlap-org')).toBeNull();
  });

  it('permits overlapping GitHub account IDs, names and OAuth client IDs without sharing bearer grants', async () => {
    for (const [db, label, profile] of [[tenantA.db, 'Tenant A', 'read_only'], [tenantB.db, 'Tenant B', 'full']]) {
      await db.upsertAccount({ login: 'overlap-org', accountId: 902, accountType: 'Organization',
        label, credentialKind: 'app', appId: 902 });
      await db.createOAuthClient({ clientId: 'shared-client-id', clientSecret: 'FAKE-fixture-nonsecret',
        clientName: label, redirectUris: ['https://localhost.example.test/oauth'] });
      await db.createAccessToken({ clientId: 'shared-client-id',
        accessToken: 'fixture-access-' + (profile === 'full' ? 'b' : 'a'),
        refreshToken: 'fixture-refresh-' + (profile === 'full' ? 'b' : 'a'),
        defaultAccount: 'overlap-org', accounts: ['overlap-org'],
        mode: 'preview', profile, listing: 'compact' });
    }
    expect((await tenantA.db.getAccount('overlap-org')).label).toBe('Tenant A');
    expect((await tenantB.db.getAccount('overlap-org')).label).toBe('Tenant B');
    expect((await legacy.getAccount('overlap-org')).label).toBe('Existing private owner account');
    expect((await tenantB.db.getAccessToken('fixture-access-a'))).toBeNull();
    expect((await tenantA.db.getAccessToken('fixture-access-b'))).toBeNull();
    expect((await tenantA.db.getTokenByRefreshToken('fixture-refresh-b'))).toBeNull();
    expect((await tenantB.db.getTokenByRefreshToken('fixture-refresh-a'))).toBeNull();
    const rotated = await tenantA.db.rotateRefreshToken({ refreshToken: 'fixture-refresh-a',
      clientId: 'shared-client-id', accessToken: 'fixture-access-a-new',
      newRefreshToken: 'fixture-refresh-a-new' });
    expect(rotated.profile).toBe('read_only');
    expect((await tenantB.db.getAccessToken('fixture-access-a-new'))).toBeNull();
    expect((await tenantA.db.getAccessToken('fixture-access-a-new')).profile).toBe('read_only');
    expect((await tenantB.db.getAccessToken('fixture-access-b')).profile).toBe('full');
  });

  it('isolates audit replay keys, job IDs, retained handles, protected policies and scratch run identifiers', async () => {
    const key = 'repeat-across-tenants';
    const claimA = await tenantA.db.claimChange({ account: 'overlap-org', tool: 'github_fixture',
      summary: 'Tenant A only', requestKey: key });
    const claimB = await tenantB.db.claimChange({ account: 'overlap-org', tool: 'github_fixture',
      summary: 'Tenant B only', requestKey: key });
    expect(claimA.claimed).toBe(true);
    expect(claimB.claimed).toBe(true);
    expect((await tenantA.db.claimChange({ account: 'overlap-org', tool: 'github_fixture',
      summary: 'Tenant A replay', requestKey: key })).claimed).toBe(false);
    expect((await tenantB.db.claimChange({ account: 'overlap-org', tool: 'github_fixture',
      summary: 'Tenant B replay', requestKey: key })).claimed).toBe(false);
    expect((await tenantA.db.listChanges())[0].summary).toBe('Tenant A only');
    expect((await tenantB.db.listChanges())[0].summary).toBe('Tenant B only');

    for (const [c, name] of [[first, 'Tenant A'], [second, 'Tenant B']]) {
      await query(c, "INSERT INTO result_store (handle,connection,expires_at,summary,body) VALUES ($1,$2,now()+interval '1 day',$3,$4::jsonb)",
        ['res_' + 'x'.repeat(24), 'same-connection', name, JSON.stringify({ owner: name })]);
      await query(c, "INSERT INTO gh_async_jobs (id,connection_id,owner,kind,expires_at) VALUES ('job_aaaaaaaaaaaaaaaa','same-connection','overlap-org','fixture',now()+interval '1 day')");
      await query(c, "INSERT INTO protected_resources (kind,target,level,reason) VALUES ('repo','overlap-org/same-repo','pr-only',$1)", [name]);
      await query(c, "INSERT INTO dev_runs (id,account,connection) VALUES ('shared-fixture-run','overlap-org','same-connection')");
      await query(c, "INSERT INTO server_settings (setting,value) VALUES ('fixture', $1::jsonb)", [JSON.stringify({ owner: name })]);
    }
    expect((await query(first, "SELECT summary FROM result_store"))[0].summary).toBe('Tenant A');
    expect((await query(second, "SELECT summary FROM result_store"))[0].summary).toBe('Tenant B');
    expect((await tenantA.db.getResult('res_' + 'x'.repeat(24), 'same-connection')).body.owner).toBe('Tenant A');
    expect((await tenantB.db.getResult('res_' + 'x'.repeat(24), 'same-connection')).body.owner).toBe('Tenant B');
    expect((await tenantA.db.getJob('job_aaaaaaaaaaaaaaaa', 'same-connection')).state).toBe('pending');
    expect((await tenantB.db.getJob('job_aaaaaaaaaaaaaaaa', 'same-connection')).state).toBe('pending');
    expect((await query(first, "SELECT reason FROM protected_resources WHERE target = 'overlap-org/same-repo'"))[0].reason).toBe('Tenant A');
    expect((await query(second, "SELECT reason FROM protected_resources WHERE target = 'overlap-org/same-repo'"))[0].reason).toBe('Tenant B');
    await query(first, "DELETE FROM dev_runs WHERE id = 'shared-fixture-run'");
    expect((await query(second, "SELECT count(*)::integer AS n FROM dev_runs"))[0].n).toBe(1);
    await query(first, "DELETE FROM gh_async_jobs WHERE id = 'job_aaaaaaaaaaaaaaaa'");
    expect((await query(second, "SELECT count(*)::integer AS n FROM gh_async_jobs"))[0].n).toBe(1);
  });

  it('RELAY-OWNER-1: a scoped database knows its person\'s verified numeric GitHub id, unlisted and outside the stored scope', async () => {
    expect(tenantA.db.verifiedGithubSubject).toBe('10001');
    expect(tenantB.db.verifiedGithubSubject).toBe('10002');
    expect(Object.keys(tenantA.db)).not.toContain('verifiedGithubSubject');
    expect(JSON.stringify(tenantA.db.playgroundScope)).not.toContain('10001');
    expect(tenantA.tenant.verifiedSubject).toBe('10001');
  });

  it('checks owner membership at each scoped DB acquisition and rejects foreign, revoked and unready principals', async () => {
    expect(await directory.authorized(a.id, b.owner)).toBeNull();
    const sqlFactory = () => { throw new Error('must not even connect to database'); };
    await expect(openAuthorizedTenantDb({ directory, tenantId: a.id, verifiedIdentityId: b.owner,
      connectionString: process.env.TEST_DATABASE_URL, sqlFactory })).rejects.toThrow(/not authorized/);
    await expect(openAuthorizedTenantDb({ directory, tenantId: a.id, verifiedIdentityId: 'anonymous',
      connectionString: process.env.TEST_DATABASE_URL, sqlFactory })).rejects.toThrow(/identity ID/);
    expect(await directory.grant(a.id, b.owner, b.owner, 'admin')).toBe(false);
    expect(await directory.grant(a.id, a.owner, a.owner, 'admin')).toBe(false);
    expect(await directory.grant(a.id, a.owner, a.owner, 'member')).toBe(false);
    expect((await directory.authorized(a.id, a.owner)).role).toBe('owner');
    expect(await directory.grant(a.id, a.owner, b.owner, 'admin')).toBe(true);
    const granted = await directory.authorized(a.id, b.owner);
    expect(granted.role).toBe('admin');
    expect(await directory.revoke(a.id, b.owner, a.owner)).toBe(false); // owner cannot be removed
    expect(await directory.revoke(a.id, a.owner, b.owner)).toBe(true);
    expect(await directory.authorized(a.id, b.owner)).toBeNull();
    expect(await directory.activate(a.id, tenantSchemaName(a.id))).toBe(false); // no duplicate activation
  });

  it('reinitializes tenant schema idempotently without migrating or rewriting existing owner data', async () => {
    await tenantA.db.initSchema();
    await tenantB.db.initSchema();
    await directory.initSchema();
    expect((await tenantA.db.getAccount('overlap-org')).label).toBe('Tenant A');
    expect((await tenantB.db.getAccount('overlap-org')).label).toBe('Tenant B');
    expect((await legacy.getAccount('overlap-org')).label).toBe('Existing private owner account');
  });
});
