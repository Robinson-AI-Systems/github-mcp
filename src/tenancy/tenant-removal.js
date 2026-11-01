// PUB-8: the owner's removal of ONE person (by identity, or by GitHub login resolved to an identity) and everything stored for
// them. Trusted server code: only the owner-only tool `github_tenant_remove` uses this store, on the owner's own (root) database.
// The data removal itself is the SQL core `gh_remove_person_tenant` (src/tenancy/directory.js), which the owner setup page and the
// person's own "Delete my data" page also use through `gh_forget_public_tenant`.
// What leaves this module: counts, opaque ids, GitHub account names and phases. Decrypted GitHub tokens exist only inside
// `revocationTokens` for the single revocation request each, and are never returned by the tool, logged or stored.
import { createDb } from '../db.js';
import { decryptSecret, readEncryptionKey } from '../core/crypto.js';
import { pilotAppClient } from './pilot-app-client.js';
import { createTenantDirectory, tenantSchemaName } from './directory.js';
import { findPublicTenantsByLogin } from './forget-person.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LOGIN = /^[a-z0-9][a-z0-9-]{0,38}$/;
const safe = (message, code) => Object.assign(new TypeError(message), { safeMessage: true, safeCode: code });
const exists = async (sql, name) => (await sql`SELECT to_regclass(${name}) IS NOT NULL AS ok`)[0]?.ok === true;
const n = (v) => Number(v ?? 0);

/** Kind of tenant from its bootstrap key: the person's public sign-in, a Marketplace customer, or an owner-made private pilot. */
const kindOf = (key) => key === 'public-connect' ? 'public' : /^marketplace-\d+$/.test(String(key ?? '')) ? 'marketplace' : key ? 'private_pilot' : 'other';

/** @param {{ rootSql: Function, connectionString?: string, env?: object, sqlFactory?: Function }} deps */
export function createTenantRemoval({ rootSql, connectionString = process.env.DATABASE_URL, env = process.env, sqlFactory } = {}) {
  if (typeof rootSql !== 'function') throw new TypeError('The owner database is required.');
  const sql = rootSql;
  let ready = null;
  const init = () => (ready ??= createTenantDirectory(sql).initSchema().catch((e) => { ready = null; throw e; }));

  /** Rows per shared table with a tenant_id column (the same catalog list the SQL core empties). One static statement:
   * `query_to_xml` runs each count with the catalog's own quoted name (%I) and the value quoted as a literal (%L). */
  async function sharedCounts(tenantId) {
    const rows = await sql`SELECT c.table_name AS name, (xpath('/row/n/text()', query_to_xml(format(
        'SELECT count(*) AS n FROM %I WHERE tenant_id::text = %L', c.table_name, ${tenantId}::text), false, true, '')))[1]::text::int AS n
      FROM information_schema.columns c JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
      WHERE c.table_schema = current_schema() AND c.column_name = 'tenant_id' ORDER BY c.table_name`;
    return Object.fromEntries(rows.filter((r) => n(r.n) > 0).map((r) => [String(r.name), n(r.n)]));
  }
  /** Stored GitHub sign-ins (a Marketplace grant archives the same sealed token as its sign-in, so it is counted once). */
  async function distinctSignIns(tenantId) {
    const grants = await exists(sql, 'gh_marketplace_grants');
    const rows = grants
      ? await sql`SELECT count(DISTINCT access_enc)::int AS n FROM (SELECT access_enc FROM gh_tenant_user_authorizations WHERE tenant_id = ${tenantId}::uuid
          UNION ALL SELECT access_enc FROM gh_marketplace_grants WHERE tenant_id = ${tenantId}::uuid) s`
      : await sql`SELECT count(*)::int AS n FROM gh_tenant_user_authorizations WHERE tenant_id = ${tenantId}::uuid`;
    return n(rows[0]?.n);
  }
  async function schemaExists(tenantId) {
    const rows = await sql`SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname = ${tenantSchemaName(tenantId)}) AS present`;
    return rows[0]?.present === true;
  }
  /** Rows per table inside the person's own namespace, or null when it is gone. */
  async function schemaCounts(tenantId) {
    if (!await schemaExists(tenantId)) return null;
    const rows = await sql`SELECT table_name AS name, (xpath('/row/n/text()', query_to_xml(format(
        'SELECT count(*) AS n FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text::int AS n
      FROM information_schema.tables WHERE table_schema = ${tenantSchemaName(tenantId)} AND table_type = 'BASE TABLE' ORDER BY table_name`;
    return Object.fromEntries(rows.map((r) => [String(r.name), n(r.n)]));
  }
  async function rootSettings(tenantId) {
    if (!await exists(sql, 'server_settings')) return { pointers: 0, allocations: [] };
    const pointers = await sql`SELECT count(*)::int AS n FROM server_settings
      WHERE (setting LIKE 'fleet_route.%' OR setting LIKE 'pg_pair.%') AND value->>'tenantId' = ${tenantId}`;
    const allocations = await sql`SELECT value->'allocation'->>'phase' AS phase, value->'allocation'->>'placement' AS placement,
        (value->'allocation'->>'cleanupRequested') = 'true' AS cleanup
      FROM server_settings WHERE setting LIKE 'pg_index.%' AND value->'allocation'->'scope'->>'tenantId' = ${tenantId}`;
    return { pointers: n(pointers[0]?.n), allocations: allocations.map((a) => ({ phase: a.phase ?? 'unknown', placement: a.placement === 'device' ? 'device' : 'managed', cleanupRequested: a.cleanup === true })) };
  }
  /** The service owner's own identities: those that made a private pilot, or whose GitHub id/login is a connected account. */
  async function ownerMarks(identityId, subject, logins) {
    const pilot = await sql`SELECT 1 FROM gh_tenant_pilot_bootstraps WHERE identity_id = ${identityId}::uuid
      AND account_login <> 'public-connect' AND account_login !~ '^marketplace-[0-9]+$' LIMIT 1`;
    if (pilot.length) return true;
    if (!await exists(sql, 'gh_accounts')) return false;
    const names = logins.map((l) => l.toLowerCase());
    const rows = await sql`SELECT 1 FROM gh_accounts WHERE (account_type = 'User' AND account_id::text = ${String(subject ?? '')})
      OR lower(COALESCE(user_login, '')) = ANY(${names}::text[]) OR (account_type = 'User' AND lower(login) = ANY(${names}::text[])) LIMIT 1`;
    return rows.length > 0;
  }

  return Object.freeze({
    /** @returns {Promise<string|null>} the identity id for an identity id or a personal GitHub login (never an organization). */
    async resolve({ identity, login } = {}) {
      await init();
      if (identity !== undefined) {
        const id = String(identity).toLowerCase();
        if (!UUID.test(id)) throw safe('An identity id looks like 8-4-4-4-12 hexadecimal characters.', 'invalid_identity');
        const rows = await sql`SELECT id FROM gh_tenant_identities WHERE id = ${id}::uuid`;
        return rows[0] ? String(rows[0].id) : null;
      }
      const name = String(login ?? '').trim().toLowerCase();
      if (!LOGIN.test(name)) throw safe('Enter a valid personal GitHub account name.', 'invalid_login');
      const viaGrant = await sql`SELECT DISTINCT identity_id FROM gh_tenant_user_authorizations WHERE lower(user_login) = ${name}`;
      let ids = viaGrant.map((r) => String(r.identity_id));
      if (!ids.length && connectionString) {
        // The person's own store confirms a personal account (an organization name never identifies a person).
        const tenants = await findPublicTenantsByLogin(sql, name, { connectionString, sqlFactory });
        if (tenants.length) ids = (await sql`SELECT DISTINCT identity_id FROM gh_tenant_memberships WHERE tenant_id = ANY(${tenants}::uuid[])`)
          .map((r) => String(r.identity_id));
      }
      if (ids.length > 1) throw safe(`More than one stored person used ${name}; remove each by identity id.`, 'ambiguous_login');
      return ids[0] ?? null;
    },

    /** Everything that would be removed, as counts. Throws a plain refusal for a shared tenant. */
    async plan(identityId) {
      await init();
      const who = (await sql`SELECT id, provider_subject FROM gh_tenant_identities WHERE id = ${identityId}::uuid`)[0];
      const tenantRows = await sql`SELECT DISTINCT t.id, t.namespace, t.status, b.account_login FROM gh_tenants t
        LEFT JOIN gh_tenant_pilot_bootstraps b ON b.tenant_id = t.id
        WHERE t.id IN (SELECT tenant_id FROM gh_tenant_memberships WHERE identity_id = ${identityId}::uuid
          UNION SELECT tenant_id FROM gh_tenant_pilot_bootstraps WHERE identity_id = ${identityId}::uuid) ORDER BY t.id`;
      if (!who && !tenantRows.length) return null;
      const logins = [...new Set((await sql`SELECT DISTINCT user_login FROM gh_tenant_user_authorizations WHERE identity_id = ${identityId}::uuid`)
        .map((r) => String(r.user_login)))].sort();
      const tenants = [];
      for (const t of tenantRows) {
        const tenantId = String(t.id);
        const others = await sql`SELECT count(*)::int AS n FROM gh_tenant_memberships WHERE tenant_id = ${tenantId}::uuid AND identity_id <> ${identityId}::uuid`;
        const shared = await sharedCounts(tenantId);
        const own = await schemaCounts(tenantId);
        const settings = await rootSettings(tenantId);
        tenants.push({
          tenant_id: tenantId, kind: kindOf(t.account_login), status: t.status, other_members: n(others[0]?.n),
          shared_rows: shared, namespace_present: own !== null, namespace_rows: own ?? {},
          github_sign_ins: await distinctSignIns(tenantId),
          saved_keys: n(shared.gh_tenant_optional_credentials),
          assistant_connections: n(own?.oauth_tokens), assistant_apps: n(own?.oauth_clients), async_jobs: n(own?.gh_async_jobs),
          settings_rows: n(own?.server_settings), device_pointers: settings.pointers,
          playground: settings.allocations.filter((a) => a.phase !== 'disposed')
        });
      }
      return { identity_id: identityId, identity_present: !!who, github_id: who ? String(who.provider_subject) : null, logins,
        owner: who ? await ownerMarks(identityId, who.provider_subject, logins) : false, tenants };
    },

    /** Decrypted stored GitHub user tokens of these tenants, for one revocation each. Never returned by the tool. */
    async revocationTokens(plan) {
      const key = readEncryptionKey(env);
      const out = [];
      for (const t of plan.tenants) {
        for (const g of await sql`SELECT tenant_id, identity_id, account_login, access_enc FROM gh_tenant_user_authorizations WHERE tenant_id = ${t.tenant_id}::uuid`)
          out.push({ account: String(g.account_login), token: decryptSecret(g.access_enc, { key,
            aad: `github-mcp/private-tenant/${g.tenant_id}/identity/${g.identity_id}/account/${String(g.account_login).toLowerCase()}/access` }) });
        if (await exists(sql, 'gh_marketplace_grants'))
          for (const g of await sql`SELECT tenant_id, identity_id, account_login, access_enc FROM gh_marketplace_grants WHERE tenant_id = ${t.tenant_id}::uuid`)
            out.push({ account: String(g.account_login), token: decryptSecret(g.access_enc, { key,
              aad: `github-mcp/private-tenant/${g.tenant_id}/identity/${g.identity_id}/account/${g.account_login}/access` }) });
      }
      // A Marketplace grant archives the same token as the sign-in it came from: revoke each token once.
      const seen = new Set();
      return out.filter((t) => !seen.has(t.token) && seen.add(t.token));
    },
    /** The service App's OAuth client (the only party GitHub lets revoke a token it issued). */
    appClient: () => pilotAppClient({ env, db: createDb(sql) }),

    /** Removes every tenant in the plan through the one SQL core. Already-removed tenants count as done (replay-safe). */
    async remove(plan) {
      await init();
      let removed = 0;
      for (const t of plan.tenants) {
        const rows = await sql`SELECT gh_remove_person_tenant(${t.tenant_id}::uuid) AS done`;
        if (rows[0]?.done === true) removed += 1;
      }
      // An identity with no tenant left (for example a half-finished earlier sign-in) goes too, through the same SQL core.
      if (plan.identity_present) await sql`SELECT gh_remove_person_identity(${plan.identity_id}::uuid) AS done`;
      return removed;
    },

    /** Independent readback after removal: nothing of the person may remain. */
    async readback(plan) {
      const tenants = [];
      for (const t of plan.tenants) {
        const rows = Object.values(await sharedCounts(t.tenant_id)).reduce((a, b) => a + b, 0);
        const tenantRow = (await sql`SELECT 1 FROM gh_tenants WHERE id = ${t.tenant_id}::uuid`).length > 0;
        const settings = await rootSettings(t.tenant_id);
        tenants.push({ tenant_id: t.tenant_id, tenant_row: tenantRow, namespace_present: await schemaExists(t.tenant_id), shared_rows: rows,
          device_pointers: settings.pointers,
          playground_awaiting_sweep: settings.allocations.filter((a) => a.phase !== 'disposed' && a.placement === 'managed' && a.cleanupRequested).length,
          playground_unflagged: settings.allocations.filter((a) => a.phase !== 'disposed' && !a.cleanupRequested).length });
      }
      const identity = (await sql`SELECT 1 FROM gh_tenant_identities WHERE id = ${plan.identity_id}::uuid`).length > 0;
      const elsewhere = (await sql`SELECT 1 FROM gh_tenant_memberships WHERE identity_id = ${plan.identity_id}::uuid LIMIT 1`).length > 0;
      return { identity_present: identity, member_elsewhere: elsewhere, tenants };
    }
  });
}

/** True when the readback proves the person is gone (managed Playground rows may still await the regular sweep). */
export const removalProven = (after) => after && after.identity_present === false && after.member_elsewhere === false &&
  after.tenants.every((t) => !t.tenant_row && !t.namespace_present && t.shared_rows === 0 && t.device_pointers === 0 && t.playground_unflagged === 0);
