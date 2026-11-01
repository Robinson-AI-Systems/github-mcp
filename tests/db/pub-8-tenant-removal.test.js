// PUB-8 on real PostgreSQL: a fake person with a row in EVERY shared table that has a tenant_id column, their own namespace with
// settings, connections, jobs and Playground rows, is removed by the owner tool; absence is proven, and the other person and the
// owner's own space are untouched. The person-facing "Delete my data" path uses the same SQL core.
import crypto from 'node:crypto';
import pg from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db.js';
import { createTenantDirectory, tenantSchemaName, initializeProvisionedTenant } from '../../src/tenancy/directory.js';
import { createMarketplaceStore } from '../../src/marketplace/store.js';
import { createTenantRemoval } from '../../src/tenancy/tenant-removal.js';
import { encryptSecret } from '../../src/core/crypto.js';
import { definition } from '../../src/tools/tenant-remove.js';

let admin, env, url, root, directory, store;
const clients = [], pool = new Map();
const connect = async (u) => { const c = new pg.Client({ connectionString: u }); await c.connect(); clients.push(c); return c; };
const sqlFor = (client) => async (template, ...values) => {
  let query = template[0];
  for (let i = 0; i < values.length; i++) query += '$' + (i + 1) + template[i + 1];
  return (await client.query(query, values)).rows;
};
const tenantSqlFactory = (u) => {
  if (!pool.has(u)) { const p = connect(u); pool.set(u, async (parts, ...params) => sqlFor(await p)(parts, ...params)); }
  return pool.get(u);
};
const q = (text, params = []) => admin.query(text, params).then((r) => r.rows);
const APP_CLIENT = 'Iv1.FAKEpub8client';
const revoked = [];
let refuseRevocation = false;
// Fake GitHub for the App's own token endpoints only. A revoked token is "Not Found" to the check.
const fetchImpl = async (input, init = {}) => {
  const req = input instanceof Request ? input : new Request(input, init);
  const u = new URL(req.url);
  if (u.pathname !== `/applications/${APP_CLIENT}/token`) throw new Error('unexpected GitHub call ' + req.method + ' ' + u.pathname);
  if (req.headers.get('authorization') !== 'Basic ' + Buffer.from(APP_CLIENT + ':FAKE-pub8-secret').toString('base64')) return Response.json({ message: 'Bad credentials' }, { status: 401 });
  const { access_token } = await req.json();
  if (req.method === 'DELETE') { if (refuseRevocation) return Response.json({ message: 'boom' }, { status: 500 }); revoked.push(access_token); return new Response(null, { status: 204 }); }
  return revoked.includes(access_token) ? Response.json({ message: 'Not Found' }, { status: 404 }) : Response.json({ id: 1, token: null });
};

/** One person: identity, tenant (bootstrap key), membership, own namespace, rows in every shared carrier and Playground pointers. */
async function makePerson({ subject, login, key = 'public-connect', full = true }) {
  const identity = crypto.randomUUID(), tenant = crypto.randomUUID(), ns = tenantSchemaName(tenant);
  await q('INSERT INTO gh_tenant_identities(id,provider,provider_subject) VALUES ($1,\'github\',$2)', [identity, String(subject)]);
  await q('INSERT INTO gh_tenants(id,namespace,status) VALUES ($1,$2,\'active\')', [tenant, ns]);
  await q('INSERT INTO gh_tenant_memberships(tenant_id,identity_id,role) VALUES ($1,$2,\'owner\')', [tenant, identity]);
  await q('INSERT INTO gh_tenant_pilot_bootstraps(identity_id,account_login,tenant_id) VALUES ($1,$2,$3)', [identity, key, tenant]);
  await q(`CREATE SCHEMA "${ns}"`);
  const { db } = await initializeProvisionedTenant({ tenantId: tenant, connectionString: url, sqlFactory: tenantSqlFactory });
  const kek = Buffer.from(env.TOKEN_ENCRYPTION_KEY, 'base64url');
  const token = `ghu_FAKE${login.replace(/-/g, '')}0001`;
  const enc = encryptSecret(token, { key: kek, aad: `github-mcp/private-tenant/${tenant}/identity/${identity}/account/${login}/access` });
  await q(`INSERT INTO gh_tenant_user_authorizations(tenant_id,identity_id,account_login,user_login,access_enc,access_expires_at)
    VALUES ($1,$2,$3,$3,$4,now()+interval '8 hours')`, [tenant, identity, login, enc]);
  if (full) {
    await q('INSERT INTO gh_tenant_pilot_allowlist(tenant_id,identity_id) VALUES ($1,$2)', [tenant, identity]);
    await q(`INSERT INTO gh_tenant_optional_credentials(tenant_id,identity_id,account_login,kind,actor_id,account_id,membership_revision,pilot_revision,
      access_enc,cipher_fingerprint,verified_operation,verified_resource,scopes) VALUES ($1,$2,$3,'M',$4,$4,1,1,'sealed-FAKE','fp','GET /user','user',ARRAY['repo'])`, [tenant, identity, login, subject]);
    await q(`INSERT INTO gh_tenant_optional_setup_states(state_hash,tenant_id,identity_id,client_id,account_login,kind,redirect_uri,membership_revision,pilot_revision)
      VALUES ($1,$2,$3,'tcl_x',$4,'M','https://x.example.test/cb',1,1)`, ['s' + tenant, tenant, identity, login]);
    await q(`INSERT INTO gh_tenant_oauth_flows(state_hash,tenant_id,identity_id,client_id,redirect_uri,code_challenge,account_login,mode,profile,listing,provider_verifier,expires_at)
      VALUES ($1,$2,$3,'tcl_x','https://x.example.test/cb','c',$4,'preview','full','catalog','v',now()+interval '5 minutes')`, ['f' + tenant, tenant, identity, login]);
    await q(`INSERT INTO gh_public_flows(state_hash,stage,client_id,redirect_uri,code_challenge,tier,tenant_id,identity_id,expires_at)
      VALUES ($1,'god',$2,'https://x.example.test/cb','c','standard',$3,$4,now()+interval '5 minutes')`, ['p' + tenant, PCL, tenant, identity]);
    await q('INSERT INTO gh_public_installations(installation_id,tenant_id) VALUES ($1,$2)', [subject + 7, tenant]);
    await q('INSERT INTO gh_public_usage_daily(day,tenant_id,calls) VALUES (current_date,$1,5)', [tenant]);
    await q('INSERT INTO gh_public_usage_hourly(hour,tenant_id,calls) VALUES (date_trunc(\'hour\',now()),$1,5)', [tenant]);
    await q('INSERT INTO gh_marketplace_tenants(tenant_id,account_id,identity_id) VALUES ($1,$2,$3)', [tenant, subject + 900, identity]);
    await q('INSERT INTO gh_marketplace_grants(tenant_id,identity_id,account_login,access_enc,fingerprint) VALUES ($1,$2,$3,$4,md5($4))', [tenant, identity, login, enc]);
  }
  // The person's own namespace: an assistant app and connection, a job, settings and a Playground allocation row.
  await db.setSetting('time_zone', { zone: 'UTC' });
  await q(`INSERT INTO "${ns}".oauth_clients(client_id,data) VALUES ('tcl_x','{}')`);
  await q(`INSERT INTO "${ns}".oauth_tokens(token_hash,client_id,default_account,accounts,expires_at) VALUES ($1,'tcl_x',$2,ARRAY[$2],now()+interval '1 hour')`, ['h' + tenant, login]);
  await q(`INSERT INTO "${ns}".gh_async_jobs(id,connection_id,owner,kind,expires_at) VALUES ('job_' || substr(md5($1),1,16),'tcl_x',$2,'native-git-workspace',now()+interval '1 hour')`, [tenant, login]);
  const scope = { tenantId: tenant, identityId: identity };
  const binding = crypto.createHash('sha256').update(tenant).digest('hex'), device = crypto.createHash('sha256').update('d' + tenant).digest('hex');
  await db.setSetting('playground.' + binding.slice(0, 40), { kind: 'playground-allocation', binding, scope, phase: 'attached', revision: 3 });
  await root.setSetting('pg_index.' + binding.slice(0, 40), { kind: 'playground-index', revision: 1, allocation: { binding, scope, phase: 'attached', placement: 'managed', revision: 3 } });
  await root.setSetting('pg_index.' + device.slice(0, 40), { kind: 'playground-index', revision: 1, allocation: { binding: device, scope, phase: 'attached', placement: 'device', revision: 2 } });
  const deviceId = crypto.randomBytes(16).toString('hex');
  await root.setSetting('fleet_route.' + deviceId, { kind: 'fleet-device-route', tenantId: tenant, identityId: identity, clientId: 'tcl_x', deviceId });
  await root.setSetting('pg_pair.' + crypto.randomBytes(24).toString('hex'), { kind: 'playground-pair-selector', tenantId: tenant, identityId: identity, clientId: 'tcl_x', deviceId });
  return { identity, tenant, ns, token, login, binding, device, deviceId };
}
const PCL = 'pcl_' + 'a'.repeat(40);
const carriers = async () => (await q(`SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t
  ON t.table_schema=c.table_schema AND t.table_name=c.table_name AND t.table_type='BASE TABLE'
  WHERE c.table_schema=current_schema() AND c.column_name='tenant_id' ORDER BY 1`)).map((r) => r.table_name);
const rowsFor = async (tenant) => {
  const out = {};
  for (const table of await carriers()) out[table] = Number((await q(`SELECT count(*)::int n FROM "${table}" WHERE tenant_id::text=$1`, [tenant]))[0].n);
  return out;
};
const schemaExists = async (ns) => (await q('SELECT 1 FROM pg_namespace WHERE nspname=$1', [ns])).length === 1;
const settingsFor = async (tenant) => q(`SELECT setting, value FROM server_settings WHERE value->>'tenantId'=$1 OR value->'allocation'->'scope'->>'tenantId'=$1 ORDER BY setting`, [tenant]);
const ctxFor = (connection) => ({ connection, db: root, env, fetch: fetchImpl, gates: [], now: Date.now });
const OPERATOR = Object.freeze({ client_id: 'owner-connector', default_account: 'service-owner', accounts: ['service-owner'], mode: 'production', profile: 'full', listing: 'catalog', operator: true });
const parse = (r) => r.structuredContent;

beforeAll(async () => {
  url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('Disposable TEST_DATABASE_URL is required.');
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url).hostname)) throw new Error('Refusing non-local PostgreSQL.');
  admin = await connect(url);
  const ns = 'github_pub8_' + crypto.randomBytes(6).toString('hex');
  await admin.query(`CREATE SCHEMA "${ns}"`); await admin.query(`SET search_path TO "${ns}"`);
  admin.ns = ns;
  env = { DATABASE_URL: url, TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64url'),
    GITHUB_PILOT_APP_CLIENT_ID: APP_CLIENT, GITHUB_PILOT_APP_CLIENT_SECRET: 'FAKE-pub8-secret' };
  directory = createTenantDirectory(sqlFor(admin)); await directory.initSchema();
  root = createDb(sqlFor(admin)); await root.initSchema();
  await createMarketplaceStore(sqlFor(admin)).init();
  await q(`INSERT INTO gh_public_clients(client_id,secret_hash,redirect_uris) VALUES ($1,'x',ARRAY['https://x.example.test/cb'])`, [PCL]);
  // The owner's own direct account (its personal GitHub id identifies the owner's identity).
  await root.upsertAccount({ login: 'service-owner', accountId: 4242, accountType: 'User', label: 'service-owner', credentialKind: 'fine_grained' });
  store = createTenantRemoval({ rootSql: sqlFor(admin), connectionString: url, env, sqlFactory: tenantSqlFactory });
  root.tenantRemoval = store;
});
afterAll(async () => {
  if (admin) {
    const ids = await admin.query('SELECT id FROM gh_tenants').then((r) => r.rows).catch(() => []);
    for (const r of ids) await admin.query(`DROP SCHEMA IF EXISTS "${tenantSchemaName(r.id)}" CASCADE`).catch(() => {});
    await admin.query(`DROP SCHEMA IF EXISTS "${admin.ns}" CASCADE`).catch(() => {});
  }
  for (const c of clients.reverse()) await c.end().catch(() => {});
});

describe('PUB-8 owner removes a person by identity (real PostgreSQL)', () => {
  it('previews, then revokes at GitHub first, removes every row of the person, reads back absence and leaves everyone else untouched', async () => {
    const marketplace = await createMarketplaceStore(sqlFor(admin));
    expect(marketplace).toBeTruthy();
    const alice = await makePerson({ subject: 31001, login: 'alice-dev' });
    const bob = await makePerson({ subject: 31002, login: 'bob-test' });
    // Every shared table that carries a tenant_id holds something of alice's, so the proof covers every table (a table added later fails here).
    const before = await rowsFor(alice.tenant);
    expect(Object.keys(before).length).toBeGreaterThan(8);
    for (const [table, n] of Object.entries(before)) expect(n, table + ' has no fixture row for the person').toBeGreaterThan(0);
    const bobBefore = await rowsFor(bob.tenant), bobSettings = await settingsFor(bob.tenant);
    expect(bobSettings.length).toBe(4);

    const preview = parse(await definition.handler({ login: 'alice-dev' }, ctxFor(OPERATOR)));
    expect(preview).toMatchObject({ status: 'needs_confirmation', needsConfirmation: true });
    expect(preview.preview).toContain(`REMOVE person ${alice.identity} (GitHub alice-dev)`);
    expect(preview.preview).toContain('revoke 1 stored GitHub sign-in at GitHub first');
    expect(preview.preview).toContain('1 saved key');
    expect(preview.preview).toContain('1 assistant connection');
    expect(preview.preview).toContain('1 job');
    expect(preview.preview).toContain('2 Playground allocations handed to cleanup');
    expect(preview.preview).toContain('2 device pointers');
    expect(revoked).toEqual([]);
    expect(await schemaExists(alice.ns)).toBe(true);

    const out = parse(await definition.handler({ identity: alice.identity, confirm: true }, ctxFor(OPERATOR)));
    expect(out).toMatchObject({ status: 'applied', confirmed: true, done: true });
    expect(revoked).toEqual([alice.token]); // the sealed copy decrypted under its own binding; the archived duplicate revoked once
    expect(out.result.github_sign_ins).toEqual([{ account: 'alice-dev', at_github: 'revoked', still_valid: false }]);
    expect(JSON.stringify(out)).not.toContain(alice.token);

    // Independent absence: no shared row, no namespace, no identity, no device pointers; the managed allocation awaits the sweep.
    for (const [table, n] of Object.entries(await rowsFor(alice.tenant))) expect(n, table + ' still holds the removed person').toBe(0);
    expect(await schemaExists(alice.ns)).toBe(false);
    expect(await q('SELECT 1 FROM gh_tenant_identities WHERE id=$1', [alice.identity])).toEqual([]);
    expect(await q('SELECT 1 FROM gh_tenants WHERE id=$1', [alice.tenant])).toEqual([]);
    expect(await q('SELECT 1 FROM gh_public_flows WHERE identity_id=$1', [alice.identity])).toEqual([]);
    const left = await settingsFor(alice.tenant);
    expect(left.map((r) => r.setting.split('.')[0]).sort()).toEqual(['pg_index', 'pg_index']);
    const managed = left.find((r) => r.value.allocation.placement === 'managed').value.allocation;
    expect(managed).toMatchObject({ phase: 'attached', cleanupRequested: true, cleanupReason: 'namespace_removed' });
    const device = left.find((r) => r.value.allocation.placement === 'device').value.allocation;
    expect(device).toMatchObject({ phase: 'disposed', disposed: true, cleanupEvidence: 'tenant_removed_device_authority_revoked', volumesVerified: false, revision: 3 });
    // The regular sweep still finds the managed row (and not the device one) to dispose through its usual path.
    const inventory = (await root.listPlaygroundIndexes({ limit: 100 })).map((r) => r.value.allocation.binding);
    expect(inventory).toContain(alice.binding);
    expect(inventory).not.toContain(alice.device);
    expect(out.result.readback.spaces).toEqual([{ tenant_id: alice.tenant, record: false, namespace: false, shared_rows: 0, device_pointers: 0, playground_awaiting_sweep: 1 }]);

    // Bob is untouched.
    expect(await rowsFor(bob.tenant)).toEqual(bobBefore);
    expect(await settingsFor(bob.tenant)).toEqual(bobSettings);
    expect(await schemaExists(bob.ns)).toBe(true);
    expect(await q(`SELECT count(*)::int n FROM "${bob.ns}".oauth_tokens`)).toEqual([{ n: 1 }]);
    expect(revoked).not.toContain(bob.token);

    // Same request again: a replay, nothing sent. A new request: nothing stored, nothing sent.
    expect(parse(await definition.handler({ identity: alice.identity, confirm: true }, ctxFor(OPERATOR)))).toMatchObject({ status: 'replayed', replayed: true });
    expect(parse(await definition.handler({ identity: alice.identity, confirm: true, requestKey: 'later' }, ctxFor(OPERATOR)))).toMatchObject({ status: 'not_applied', no_change_sent: true });
    expect(revoked).toEqual([alice.token]);
    // Journaled in the owner's change log.
    const log = await q(`SELECT tool, summary FROM change_log WHERE tool='github_tenant_remove' ORDER BY id`);
    expect(log.some((r) => r.summary.startsWith('REMOVE person ' + alice.identity))).toBe(true);
  });

  it('refuses the owner\'s own identity (pilot space or own GitHub id) without the separate flag, and unknown people', async () => {
    const pilot = await makePerson({ subject: 31010, login: 'pilot-owner', key: 'scratch-org', full: false });
    const own = await makePerson({ subject: 4242, login: 'service-owner', full: false });
    for (const who of [pilot, own]) {
      const refused = parse(await definition.handler({ identity: who.identity, confirm: true }, ctxFor(OPERATOR)));
      expect(refused).toMatchObject({ status: 'refused_by_guard', reason_code: 'own_identity' });
      expect(await schemaExists(who.ns)).toBe(true);
    }
    expect(revoked).not.toContain(pilot.token);
    const unknown = parse(await definition.handler({ login: 'nobody-here', confirm: true }, ctxFor(OPERATOR)));
    expect(unknown).toMatchObject({ status: 'not_applied', no_change_sent: true });
    expect(parse(await definition.handler({ identity: own.identity, includeOwnIdentity: true, confirm: true }, ctxFor(OPERATOR))))
      .toMatchObject({ status: 'applied', confirmed: true });
    expect(await schemaExists(own.ns)).toBe(false);
    expect(await schemaExists(pilot.ns)).toBe(true);
  });

  it('a person\'s own tenant connection cannot use it; a failed GitHub revocation removes nothing', async () => {
    const carol = await makePerson({ subject: 31003, login: 'carol-new', full: false });
    const person = { ...OPERATOR, operator: undefined, client_id: 'tcl_x', default_account: 'carol-new', accounts: ['carol-new'] };
    expect(parse(await definition.handler({ identity: carol.identity, confirm: true }, ctxFor(person)))).toMatchObject({ status: 'refused' });
    refuseRevocation = true;
    try {
      const failed = parse(await definition.handler({ identity: carol.identity, confirm: true }, ctxFor(OPERATOR)));
      expect(['uncertain', 'rejected']).toContain(failed.status);
    } finally { refuseRevocation = false; }
    expect(await schemaExists(carol.ns)).toBe(true);
    expect((await rowsFor(carol.tenant)).gh_tenant_user_authorizations).toBe(1);
  });

  it('the person-facing "Delete my data" path (gh_forget_public_tenant) runs the same core: every row, the namespace and Playground pointers go', async () => {
    const dave = await makePerson({ subject: 31006, login: 'dave-solo' });
    expect(await directory.forgetPublicTenant(dave.tenant)).toBe(true);
    for (const [table, n] of Object.entries(await rowsFor(dave.tenant))) expect(n, table).toBe(0);
    expect(await schemaExists(dave.ns)).toBe(false);
    expect((await settingsFor(dave.tenant)).map((r) => r.setting.split('.')[0])).toEqual(['pg_index', 'pg_index']);
    const after = await store.readback({ identity_id: dave.identity, tenants: [{ tenant_id: dave.tenant }] });
    expect(after.identity_present).toBe(false);
    expect(after.tenants[0]).toMatchObject({ tenant_row: false, namespace_present: false, shared_rows: 0, device_pointers: 0, playground_unflagged: 0 });
    // Still refuses a private pilot space and a shared space.
    const erin = await makePerson({ subject: 31007, login: 'erin-member', key: 'scratch-org-2', full: false });
    await expect(directory.forgetPublicTenant(erin.tenant)).rejects.toThrow();
    const frank = await makePerson({ subject: 31008, login: 'frank-shared', full: false });
    const guest = crypto.randomUUID();
    await q('INSERT INTO gh_tenant_identities(id,provider,provider_subject) VALUES ($1,\'github\',\'31009\')', [guest]);
    await q('INSERT INTO gh_tenant_memberships(tenant_id,identity_id,role) VALUES ($1,$2,\'member\')', [frank.tenant, guest]);
    await expect(directory.forgetPublicTenant(frank.tenant)).rejects.toThrow();
    expect(parse(await definition.handler({ identity: frank.identity, confirm: true }, ctxFor(OPERATOR)))).toMatchObject({ status: 'refused_by_guard', reason_code: 'shared_tenant' });
    expect(await schemaExists(frank.ns)).toBe(true);
  });
});
