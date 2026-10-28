import { redact } from '../github/content-protection.js';
// PUB-1: PRIVATE, unexposed tenant isolation foundation. No request route may call this
// until PUB-2 binds a verified GitHub numeric subject to the session. Existing owner
// data in the legacy (public) schema is never migrated, copied or modified here.
import { validZone } from '../core/time-zone.js';
import { randomUUID,createHash } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { createDb, SCHEMA_TABLES } from '../db.js';
import { initTenantRuntimeSchema } from './runtime-limits.js';
import { initMarketplaceSchema, createMarketplaceStore } from '../marketplace/store.js';

/** Postgres refuses two sessions replacing the same function at once ("tuple concurrently updated", SQLSTATE XX000).
 * Many first-time sign-ins can run this setup together, so that one refusal is retried a few times; anything else is raised. */
export async function retryConcurrent(run, attempts = 6) {
  for (let i = 1; ; i += 1) {
    try { return await run(); } catch (error) {
      if (i >= attempts || !/tuple concurrently updated/i.test(String(error?.message ?? error))) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * i + Math.floor(Math.random() * 25)));
    }
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SCHEMA = /^gh_t_[0-9a-f]{32}$/;
const GITHUB_SUBJECT = /^[1-9][0-9]{0,18}$/;
const ROLES = new Set(['owner', 'admin', 'member']);

function validUuid(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new TypeError('A trusted opaque identity ID is required.');
  return value.toLowerCase();
}
export function tenantSchemaName(tenantId) {
  return 'gh_t_' + validUuid(tenantId).replaceAll('-', '');
}

/** Never include public in the search path: if the tenant schema is missing,
 * unqualified legacy table queries must fail, not silently fall back. The
 * Postgres options parameter is connection-scoped, never a pooled SET call. */
export function tenantConnectionString(connectionString, tenantId) {
  const schema = tenantSchemaName(tenantId);
  if (!SCHEMA.test(schema)) throw new TypeError('Invalid tenant namespace.');
  if (typeof connectionString !== 'string' || !connectionString) throw new TypeError('No tenant database is configured.');
  let url;
  try { url = new URL(connectionString); } catch { throw new TypeError('Invalid tenant database configuration.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname ||
      url.searchParams.has('options') || url.searchParams.has('search_path') ||
      url.searchParams.has('service') || url.searchParams.has('sslpassword')) {
    throw new TypeError('Tenant DB URL requires a direct, unmodified PostgreSQL connection configuration.');
  }
  // For session-based PostgreSQL adapters. HTTP queries use transaction-local
  // configuration below; pooled startup options are not portable.
  url.searchParams.set('options', '-c search_path=' + schema);
  return url.toString();
}

/** Production HTTP requests have no persistent session. Configure the path in
 * the SAME transaction as every query, without public fallback or pooled SET
 * leakage. Injected session adapters retain the connection-options contract. */
export function createTenantSql(connectionString, tenantId, sqlFactory = neon) {
  const scoped = tenantConnectionString(connectionString, tenantId);
  if (sqlFactory !== neon) return sqlFactory(scoped);
  const url = new URL(scoped);
  url.searchParams.delete('options');
  const raw = neon(url.toString());
  const schema = tenantSchemaName(tenantId);
  return async (strings, ...values) => {
    const [, rows] = await raw.transaction([
      raw`SELECT set_config('search_path', ${schema}, true)`,
      raw(strings, ...values)
    ]);
    return rows;
  };
}

/** A connection must prove the exact tenant namespace before *any* read or
 * initSchema. This also catches a driver or proxy that ignored URL options. */
export async function assertTenantSearchPath(sql, tenantId) {
  const schema = tenantSchemaName(tenantId);
  const rows = await sql`SELECT current_schema() AS active_schema, current_setting('search_path') AS configured_path`;
  if (rows.length !== 1 || rows[0].active_schema !== schema ||
      rows[0].configured_path !== schema) {
    throw new Error('Tenant database namespace unavailable. No account data was accessed.');
  }
  return schema;
}

/**
 * A private registry with a trusted-provisioning interface. It is intentionally
 * NOT a public login API and never trusts a GitHub login or ChatGPT email as identity.
 * Stable numeric GitHub subject must be verified by PUB-2 *before* invoking enroll.
 */
export function createTenantDirectory(sql) {
  if (typeof sql !== 'function') throw new TypeError('Tenant directory requires a parameterized SQL adapter.');
  let bindingSchemaReady=null;
  function ensureUserBindingSchema() {
    if (!bindingSchemaReady) {
      bindingSchemaReady=sql`ALTER TABLE gh_tenant_user_authorizations
        ADD COLUMN IF NOT EXISTS authority_binding JSONB`;
      bindingSchemaReady.catch(()=>{bindingSchemaReady=null;});
    }
    return bindingSchemaReady;
  }
  async function ensureOptionalSetupSchema(){
      await sql`CREATE TABLE IF NOT EXISTS gh_tenant_optional_setup_states (
        state_hash TEXT PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES gh_tenants(id),
        identity_id UUID NOT NULL REFERENCES gh_tenant_identities(id),
        client_id TEXT NOT NULL,
        account_login TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('K','P','M')),
        redirect_uri TEXT NOT NULL,
        membership_revision BIGINT NOT NULL,
        pilot_revision BIGINT NOT NULL,
        expected_fingerprint TEXT,
        expires_at TIMESTAMPTZ NOT NULL DEFAULT (now()+interval '10 minutes')
      )`;
      await sql`CREATE INDEX IF NOT EXISTS gh_tenant_optional_setup_expires
        ON gh_tenant_optional_setup_states (expires_at)`;
      await sql`ALTER TABLE gh_tenant_optional_setup_states
        ADD COLUMN IF NOT EXISTS oauth_context JSONB`;
      await widenOptionalKinds();
  }
  // GOD-1: kind 'M' (the master token). Additive: older tables are re-checked once, new ones are created with it.
  async function widenOptionalKinds(){
    for(const table of ['gh_tenant_optional_credentials','gh_tenant_optional_setup_states']){
      const name=table+'_kind_check';
      const found=await sql`SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c
        WHERE c.conname=${name} AND c.conrelid=to_regclass(${table})`;
      if(found.length===1 && !String(found[0].def).includes("'M'")){
        if(table==='gh_tenant_optional_credentials'){
          await sql`ALTER TABLE gh_tenant_optional_credentials DROP CONSTRAINT IF EXISTS gh_tenant_optional_credentials_kind_check`;
          await sql`ALTER TABLE gh_tenant_optional_credentials ADD CONSTRAINT gh_tenant_optional_credentials_kind_check CHECK (kind IN ('K','P','M'))`;
        }else{
          await sql`ALTER TABLE gh_tenant_optional_setup_states DROP CONSTRAINT IF EXISTS gh_tenant_optional_setup_states_kind_check`;
          await sql`ALTER TABLE gh_tenant_optional_setup_states ADD CONSTRAINT gh_tenant_optional_setup_states_kind_check CHECK (kind IN ('K','P','M'))`;
        }
      }
    }
  }
  return {
    marketplaceBinding: (tenantId) => createMarketplaceStore(sql).binding(tenantId),
    async initSchema() {
      await sql`CREATE TABLE IF NOT EXISTS gh_tenant_identities (
        id UUID PRIMARY KEY, provider TEXT NOT NULL CHECK (provider = 'github'),
        provider_subject TEXT NOT NULL CHECK (provider_subject ~ '^[1-9][0-9]{0,18}$'),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (provider, provider_subject)
      )`;
      await sql`CREATE TABLE IF NOT EXISTS gh_tenants (
        id UUID PRIMARY KEY, namespace TEXT NOT NULL UNIQUE
          CHECK (namespace ~ '^gh_t_[0-9a-f]{32}$'),
        status TEXT NOT NULL DEFAULT 'provisioning'
          CHECK (status IN ('provisioning','active','suspended')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS gh_tenant_memberships (
        tenant_id UUID NOT NULL REFERENCES gh_tenants(id),
        identity_id UUID NOT NULL REFERENCES gh_tenant_identities(id),
        role TEXT NOT NULL CHECK (role IN ('owner','admin','member')),
        active BOOLEAN NOT NULL DEFAULT TRUE, revision BIGINT NOT NULL DEFAULT 1,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, identity_id)
      )`;
      await sql`CREATE INDEX IF NOT EXISTS gh_tenant_memberships_identity
        ON gh_tenant_memberships (identity_id, active)`;
      // PUB-2 closed PRIVATE pilot. This registry never grants tenant access by
      // itself: live, active membership AND an owner-issued pilot allowlist entry
      // are required. There is deliberately no public enrollment endpoint.
      await sql`CREATE TABLE IF NOT EXISTS gh_tenant_pilot_bootstraps (
        identity_id UUID NOT NULL REFERENCES gh_tenant_identities(id),
        account_login TEXT NOT NULL CHECK (
          account_login = lower(account_login) AND
          account_login ~ '^[a-z0-9][a-z0-9-]{0,38}$'),
        tenant_id UUID NOT NULL UNIQUE REFERENCES gh_tenants(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (identity_id, account_login)
      )`;
      await retryConcurrent(() => sql`CREATE OR REPLACE FUNCTION gh_bootstrap_private_pilot(
        principal_id UUID, account_name TEXT, proposed_id UUID
      ) RETURNS UUID LANGUAGE plpgsql SECURITY INVOKER AS $body$
      DECLARE existing_id UUID;
      DECLARE schema_name TEXT;
      BEGIN
        IF account_name !~ '^[a-z0-9][a-z0-9-]{0,38}$'
          OR account_name <> lower(account_name) THEN
          RAISE EXCEPTION 'Invalid private pilot account';
        END IF;
        PERFORM id FROM gh_tenant_identities WHERE id = principal_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Private pilot identity absent'; END IF;
        SELECT tenant_id INTO existing_id FROM gh_tenant_pilot_bootstraps
          WHERE identity_id=principal_id AND account_login=account_name;
        IF existing_id IS NOT NULL THEN RETURN existing_id; END IF;
        schema_name := 'gh_t_' || replace(proposed_id::text, '-', '');
        INSERT INTO gh_tenants (id,namespace,status)
          VALUES (proposed_id,schema_name,'provisioning');
        INSERT INTO gh_tenant_memberships (tenant_id,identity_id,role)
          VALUES (proposed_id,principal_id,'owner');
        INSERT INTO gh_tenant_pilot_bootstraps (identity_id,account_login,tenant_id)
          VALUES (principal_id,account_name,proposed_id);
        PERFORM gh_provision_tenant_namespace(schema_name);
        RETURN proposed_id;
      END $body$`);
      await sql`CREATE TABLE IF NOT EXISTS gh_tenant_pilot_allowlist (
        tenant_id UUID NOT NULL REFERENCES gh_tenants(id),
        identity_id UUID NOT NULL REFERENCES gh_tenant_identities(id),
        active BOOLEAN NOT NULL DEFAULT TRUE,
        revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, identity_id)
      )`;
      // Individual GitHub App user credentials are never kept on the shared
      // gh_accounts row. Each verified human in one tenant has a separate
      // encrypted grant, including when their accounts/installations overlap.
      await sql`CREATE TABLE IF NOT EXISTS gh_tenant_user_authorizations (
        tenant_id UUID NOT NULL REFERENCES gh_tenants(id),
        identity_id UUID NOT NULL REFERENCES gh_tenant_identities(id),
        account_login TEXT NOT NULL,
        user_login TEXT NOT NULL,
        access_enc TEXT NOT NULL,
        access_expires_at TIMESTAMPTZ NOT NULL,
        refresh_enc TEXT,
        refresh_expires_at TIMESTAMPTZ,
        refresh_claim_id TEXT,
        refresh_claim_expires_at TIMESTAMPTZ,
        revision BIGINT NOT NULL DEFAULT 1,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id,identity_id,account_login)
      )`;
      // CAP-3 adds no bearer store. Legacy grants retain their ciphertext and
      // remain unverified until consent supplies fresh scoped readback.
      await ensureUserBindingSchema();
      // CAP-3 private-member optional authority: encrypted only, bounded type,
      // versioned actor/tenant epoch and no legacy owner-token fallback.
      await sql`CREATE TABLE IF NOT EXISTS gh_tenant_optional_credentials (
        tenant_id UUID NOT NULL REFERENCES gh_tenants(id),
        identity_id UUID NOT NULL REFERENCES gh_tenant_identities(id),
        account_login TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('K','P','M')),
        provider_host TEXT NOT NULL DEFAULT 'github.com',
        actor_id BIGINT NOT NULL,
        account_id BIGINT NOT NULL,
        membership_revision BIGINT NOT NULL,
        pilot_revision BIGINT NOT NULL,
        access_enc TEXT NOT NULL,
        cipher_fingerprint TEXT NOT NULL,
        verified_operation TEXT NOT NULL,
        verified_resource TEXT NOT NULL,
        scopes TEXT[] NOT NULL,
        expires_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ,
        revision BIGINT NOT NULL DEFAULT 1,
        PRIMARY KEY (tenant_id,identity_id,account_login,kind)
      )`;
      await ensureOptionalSetupSchema();
      // GitHub redirect state lives in the private registry only long enough
      // to finish one GitHub authorization. Store a hash of the browser secret.
      await sql`CREATE TABLE IF NOT EXISTS gh_tenant_oauth_flows (
        state_hash TEXT PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES gh_tenants(id),
        identity_id UUID NOT NULL REFERENCES gh_tenant_identities(id),
        client_id TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        client_state TEXT,
        code_challenge TEXT NOT NULL,
        account_login TEXT NOT NULL,
        mode TEXT NOT NULL CHECK (mode IN ('preview','production')),
        profile TEXT NOT NULL CHECK (profile IN ('read_only','everyday','full')),
        listing TEXT NOT NULL CHECK (listing IN ('compact','catalog')),
        provider_verifier TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      await sql`ALTER TABLE gh_tenant_oauth_flows
        ADD COLUMN IF NOT EXISTS optional_kind TEXT`;
      // PUB-6 (dark): public simple-connect. Root-level, additive. A public client
      // stores only a hash of its secret; flows are short-lived single-use rows.
      // LAUNCH-1: who may become a NEW public person while GITHUB_PUBLIC_INVITE_ONLY is on. Existing people are never affected.
      await sql`CREATE TABLE IF NOT EXISTS gh_public_invites (
        login TEXT PRIMARY KEY CHECK (login = lower(login) AND login ~ '^[a-z0-9][a-z0-9-]{0,38}$'),
        added_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS gh_public_clients (
        client_id TEXT PRIMARY KEY CHECK (client_id ~ '^pcl_[A-Za-z0-9_-]{32,64}$'),
        secret_hash TEXT NOT NULL,
        redirect_uris TEXT[] NOT NULL CHECK (cardinality(redirect_uris) BETWEEN 1 AND 8),
        auth_method TEXT NOT NULL DEFAULT 'client_secret_post' CHECK (auth_method IN ('none', 'client_secret_post')),
        client_name TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      // Additive for already-deployed stores: existing confidential clients retain their method.
      await sql`ALTER TABLE gh_public_clients ADD COLUMN IF NOT EXISTS auth_method TEXT NOT NULL DEFAULT 'client_secret_post'`;
      await sql`CREATE TABLE IF NOT EXISTS gh_public_flows (
        state_hash TEXT PRIMARY KEY,
        stage TEXT NOT NULL CHECK (stage IN ('signin','install','god')),
        client_id TEXT NOT NULL REFERENCES gh_public_clients(client_id) ON DELETE CASCADE,
        redirect_uri TEXT NOT NULL,
        client_state TEXT,
        code_challenge TEXT NOT NULL,
        tier TEXT NOT NULL CHECK (tier IN ('standard','god')),
        account_login TEXT,
        allow_changes BOOLEAN NOT NULL DEFAULT FALSE,
        after_install BOOLEAN NOT NULL DEFAULT FALSE,
        provider_verifier TEXT,
        tenant_id UUID,
        identity_id UUID,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      await sql`ALTER TABLE gh_public_flows ADD COLUMN IF NOT EXISTS time_zone TEXT`;
      await sql`ALTER TABLE gh_public_flows ADD COLUMN IF NOT EXISTS offers TEXT`;
      await sql`ALTER TABLE gh_public_flows ADD COLUMN IF NOT EXISTS purpose TEXT`;
      // PUB-5 A: which public people hold which App installation. Numbers only (no names, no tokens). It lets the
      // App-uninstall clean-up find the right people with ONE query instead of opening every person's store.
      await sql`CREATE TABLE IF NOT EXISTS gh_public_installations (
        installation_id BIGINT NOT NULL,
        tenant_id UUID NOT NULL REFERENCES gh_tenants(id),
        PRIMARY KEY (installation_id, tenant_id)
      )`;
      await sql`CREATE INDEX IF NOT EXISTS gh_public_installations_tenant ON gh_public_installations (tenant_id)`;
      // PUB-5 B: how much each public person uses the service. Numbers only. Calls and changes per UTC day (kept 400 days) and
      // changes per hour (kept 48 hours) drive the free fair-use limits, the owner's Public usage page and the cost estimate.
      await sql`CREATE TABLE IF NOT EXISTS gh_public_usage_daily (
        day DATE NOT NULL,
        tenant_id UUID NOT NULL REFERENCES gh_tenants(id),
        calls INT NOT NULL DEFAULT 0,
        writes INT NOT NULL DEFAULT 0,
        errors INT NOT NULL DEFAULT 0,
        PRIMARY KEY (day, tenant_id)
      )`;
      await sql`CREATE INDEX IF NOT EXISTS gh_public_usage_daily_tenant ON gh_public_usage_daily (tenant_id, day)`;
      await sql`CREATE TABLE IF NOT EXISTS gh_public_usage_hourly (
        hour TIMESTAMPTZ NOT NULL,
        tenant_id UUID NOT NULL REFERENCES gh_tenants(id),
        calls INT NOT NULL DEFAULT 0,
        writes INT NOT NULL DEFAULT 0,
        errors INT NOT NULL DEFAULT 0,
        PRIMARY KEY (hour, tenant_id)
      )`;
      // PUB-5 B: when an app registration last got a token, so registrations nobody uses can be cleaned away.
      await sql`ALTER TABLE gh_public_clients ADD COLUMN IF NOT EXISTS last_token_at TIMESTAMPTZ`;
      // PUB-6: owner-requested deletion of ONE public person's data. Only a tenant created by the public sign-in
      // (bootstrap key 'public-connect') with a single member can go. It removes every root row that points at the tenant,
      // then drops that tenant's own database namespace, so nothing of theirs survives and nobody else's data is touched.
      await retryConcurrent(() => sql`CREATE OR REPLACE FUNCTION gh_forget_public_tenant(target UUID)
        RETURNS BOOLEAN LANGUAGE plpgsql SECURITY INVOKER AS $body$
      DECLARE ns TEXT; ident UUID; others INTEGER;
      BEGIN
        SELECT namespace INTO ns FROM gh_tenants WHERE id = target FOR UPDATE;
        IF NOT FOUND THEN RETURN FALSE; END IF;
        SELECT identity_id INTO ident FROM gh_tenant_pilot_bootstraps
          WHERE tenant_id = target AND account_login = 'public-connect';
        IF ident IS NULL THEN RAISE EXCEPTION 'Not a public sign-in tenant'; END IF;
        SELECT count(*) INTO others FROM gh_tenant_memberships
          WHERE tenant_id = target AND identity_id <> ident;
        IF others > 0 THEN RAISE EXCEPTION 'Tenant has other members'; END IF;
        DELETE FROM gh_tenant_optional_setup_states WHERE tenant_id = target;
        DELETE FROM gh_tenant_optional_credentials WHERE tenant_id = target;
        DELETE FROM gh_tenant_user_authorizations WHERE tenant_id = target;
        DELETE FROM gh_tenant_oauth_flows WHERE tenant_id = target;
        DELETE FROM gh_public_flows WHERE tenant_id = target;
        DELETE FROM gh_tenant_pilot_allowlist WHERE tenant_id = target;
        DELETE FROM gh_public_installations WHERE tenant_id = target;
        DELETE FROM gh_public_usage_daily WHERE tenant_id = target;
        DELETE FROM gh_public_usage_hourly WHERE tenant_id = target;
        DELETE FROM gh_tenant_pilot_bootstraps WHERE tenant_id = target;
        DELETE FROM gh_tenant_memberships WHERE tenant_id = target;
        DELETE FROM gh_tenants WHERE id = target;
        EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', ns);
        IF NOT EXISTS (SELECT 1 FROM gh_tenant_memberships WHERE identity_id = ident)
          AND NOT EXISTS (SELECT 1 FROM gh_tenant_pilot_bootstraps WHERE identity_id = ident) THEN
          DELETE FROM gh_tenant_identities WHERE id = ident;
        END IF;
        RETURN TRUE;
      END $body$`);
      await sql`CREATE INDEX IF NOT EXISTS gh_public_flows_expires
        ON gh_public_flows (expires_at)`;
      await sql`ALTER TABLE gh_public_flows ADD COLUMN IF NOT EXISTS marketplace_account_id BIGINT`;
      await initMarketplaceSchema(sql);
      // This function only accepts server-generated opaque namespaces. Unlike
      // concatenating raw SQL in JS, %I quotes the identifier within PostgreSQL.
      // It is SECURITY INVOKER (no privilege elevation) and has no public HTTP route.
      await retryConcurrent(() => sql`CREATE OR REPLACE FUNCTION gh_provision_tenant_namespace(namespace_text TEXT)
        RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER AS $body$
        BEGIN
          IF namespace_text !~ '^gh_t_[0-9a-f]{32}$' THEN
            RAISE EXCEPTION 'Invalid tenant namespace';
          END IF;
          EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', namespace_text);
        END $body$`);
    },

    /** Called only after a real provider lookup has established this numeric user ID. */
    /** Only an authenticated owner flow that just verified GitHub may call
     * this. One transaction serializes duplicate taps for the same owner. */
    async provisionPilotForOwnerAccount(identityId, accountLogin) {
      const id=validUuid(identityId);
      if(typeof accountLogin!=='string' ||
          !/^[a-z0-9][a-z0-9-]{0,38}$/.test(accountLogin))
        throw new TypeError('Invalid private pilot account name.');
      const proposed=randomUUID();
      const rows=await sql`SELECT gh_bootstrap_private_pilot(
        ${id}::uuid,${accountLogin},${proposed}::uuid) AS tenant_id`;
      if(rows.length!==1 || !rows[0].tenant_id)
        throw new Error('Private pilot creation is unavailable.');
      return String(rows[0].tenant_id);
    },

    async enrollVerifiedGithubSubject(subject) {
      if (typeof subject !== 'string' || !GITHUB_SUBJECT.test(subject))
        throw new TypeError('A verified numeric GitHub subject is required.');
      const id = randomUUID();
      const rows = await sql`INSERT INTO gh_tenant_identities (id,provider,provider_subject)
        VALUES (${id}::uuid,'github',${subject})
        ON CONFLICT (provider,provider_subject) DO UPDATE
          SET provider_subject = EXCLUDED.provider_subject
        RETURNING id`;
      return rows[0].id;
    },

    /** Provisioning never enables an external sign-in: the tenant begins closed. */
    async provision(ownerIdentityId) {
      const owner = validUuid(ownerIdentityId);
      const id = randomUUID();
      const namespace = tenantSchemaName(id);
      const rows = await sql`INSERT INTO gh_tenants (id,namespace,status)
        SELECT ${id}::uuid,${namespace},'provisioning'
        WHERE EXISTS (SELECT 1 FROM gh_tenant_identities WHERE id = ${owner}::uuid)
        RETURNING id,namespace,status`;
      if (!rows.length) throw new Error('Verified owner identity is not enrolled.');
      await sql`INSERT INTO gh_tenant_memberships (tenant_id,identity_id,role)
        VALUES (${id}::uuid,${owner}::uuid,'owner')`;
      // If schema creation fails, tenant remains non-active and unusable.
      await sql`SELECT gh_provision_tenant_namespace(${namespace})`;
      return { id: String(rows[0].id), namespace, status: 'provisioning' };
    },

    /** Caller must initialize and verify ALL existing tables in the isolated
     * namespace before the row can be made active. */
    async activate(tenantId, namespaceVerified) {
      const id = validUuid(tenantId);
      if (namespaceVerified !== tenantSchemaName(id)) return false;
      // Never trust a caller-supplied namespace string as an initialization proof.
      // The provisioning role independently verifies all known table families first.
      const present = await sql`SELECT count(*)::integer AS table_count FROM pg_catalog.pg_tables
        WHERE schemaname = ${namespaceVerified} AND tablename = ANY(${SCHEMA_TABLES}::text[])`;
      if (present.length !== 1 || Number(present[0].table_count) !== SCHEMA_TABLES.length) return false;
      const rows = await sql`UPDATE gh_tenants SET status = 'active'
        WHERE id = ${id}::uuid AND namespace = ${namespaceVerified}
          AND status = 'provisioning' RETURNING id`;
      return rows.length === 1;
    },

    /** No global account listing exists here; a nonmember, suspended tenant, or
     * revoked user gets the same absence result. Caller identity is provider-bound
     * in PUB-2. Check on every scoped session creation (no cached privileges). */
    async authorized(tenantId, identityId) {
      const t = validUuid(tenantId), i = validUuid(identityId);
      const rows = await sql`SELECT t.id, t.namespace, m.role, m.revision
        FROM gh_tenants t JOIN gh_tenant_memberships m ON m.tenant_id = t.id
        WHERE t.id = ${t}::uuid AND m.identity_id = ${i}::uuid
          AND t.status = 'active' AND m.active = TRUE`;
      return rows.length === 1 ? { tenantId: String(rows[0].id),
        namespace: rows[0].namespace, role: rows[0].role,
        membershipRevision: Number(rows[0].revision) } : null;
    },

    /** Private owner-only test allowlisting; never enough without live membership
     * and a verified GitHub numeric subject. It cannot create a membership. */
    async allowlistPilotIdentity(tenantId, ownerIdentityId, targetIdentityId) {
      const t = validUuid(tenantId), owner = validUuid(ownerIdentityId), target = validUuid(targetIdentityId);
      const rows = await sql`INSERT INTO gh_tenant_pilot_allowlist (tenant_id,identity_id,active)
        SELECT ${t}::uuid,${target}::uuid,TRUE
        WHERE EXISTS (SELECT 1 FROM gh_tenant_memberships m
          JOIN gh_tenants ten ON ten.id=m.tenant_id
          WHERE m.tenant_id=${t}::uuid AND m.identity_id=${owner}::uuid
            AND m.role='owner' AND m.active=TRUE AND ten.status='active')
          AND EXISTS (SELECT 1 FROM gh_tenant_memberships target
            WHERE target.tenant_id=${t}::uuid AND target.identity_id=${target}::uuid
              AND target.active=TRUE)
        ON CONFLICT (tenant_id,identity_id) DO UPDATE SET active=TRUE,
          revision=gh_tenant_pilot_allowlist.revision+1,updated_at=now()
        RETURNING identity_id`;
      return rows.length === 1;
    },

    /** Owner can shut off a pilot session. No other tenant or ordinary member
     * can revoke someone else's pilot authorization. */
    async revokePilotIdentity(tenantId, ownerIdentityId, targetIdentityId) {
      const t = validUuid(tenantId), owner = validUuid(ownerIdentityId), target = validUuid(targetIdentityId);
      const rows = await sql`UPDATE gh_tenant_pilot_allowlist p
        SET active=FALSE, revision=p.revision+1, updated_at=now()
        WHERE p.tenant_id=${t}::uuid AND p.identity_id=${target}::uuid AND p.active=TRUE
          AND EXISTS (SELECT 1 FROM gh_tenant_memberships m
            WHERE m.tenant_id=${t}::uuid AND m.identity_id=${owner}::uuid
              AND m.role='owner' AND m.active=TRUE)
        RETURNING p.identity_id`;
      return rows.length === 1;
    },

    /** Called ONLY AFTER independent GET /user verification; caller input
     * alone is not proof. No unapproved member, disabled pilot identity,
     * provisioning tenant or global legacy fallback can appear here. */
    async resolveAllowlistedPilotSubject(tenantId, verifiedSubject) {
      const t = validUuid(tenantId);
      if (typeof verifiedSubject !== 'string' || !GITHUB_SUBJECT.test(verifiedSubject))
        throw new TypeError('Verified numeric GitHub subject required.');
      const rows = await sql`SELECT i.id AS identity_id, t.id AS tenant_id,
          t.namespace,m.role,m.revision AS membership_revision,p.revision AS pilot_revision
        FROM gh_tenant_identities i
        JOIN gh_tenant_memberships m ON m.identity_id=i.id
        JOIN gh_tenants t ON t.id=m.tenant_id
        JOIN gh_tenant_pilot_allowlist p ON p.tenant_id=t.id AND p.identity_id=i.id
        WHERE i.provider='github' AND i.provider_subject=${verifiedSubject}
          AND t.id=${t}::uuid AND t.status='active'
          AND m.active=TRUE AND p.active=TRUE`;
      if (rows.length !== 1) return null;
      const row=rows[0];
      return Object.freeze({ identityId: String(row.identity_id), tenantId: String(row.tenant_id),
        namespace: row.namespace, role: row.role,
        membershipRevision: Number(row.membership_revision), pilotRevision: Number(row.pilot_revision) });
    },

    /** Resolve a previously provider-verified identity from a SERVER-SIGNED token
     * on every request, not from a caller-supplied tenant ID. Both membership
     * and private pilot allowlist must be live. Revocation takes effect at once. */
    async authorizedPilotIdentity(tenantId, identityId) {
      const t = validUuid(tenantId), i = validUuid(identityId);
      const rows = await sql`SELECT t.id,t.namespace,m.role,m.revision AS membership_revision,
          p.revision AS pilot_revision
        FROM gh_tenants t
        JOIN gh_tenant_memberships m ON m.tenant_id=t.id
        JOIN gh_tenant_pilot_allowlist p ON p.tenant_id=t.id AND p.identity_id=m.identity_id
        WHERE t.id=${t}::uuid AND m.identity_id=${i}::uuid
          AND t.status='active' AND m.active=TRUE AND p.active=TRUE`;
      if (rows.length !== 1) return null;
      const v = rows[0];
      return Object.freeze({ tenantId: String(v.id), identityId: i,
        namespace: v.namespace, role: v.role,
        membershipRevision: Number(v.membership_revision),
        pilotRevision: Number(v.pilot_revision) });
    },

    /** Save only encrypted provider tokens after verified GitHub /user +
     * installation proof. Atomic eligibility check prevents stale pilot
     * approvals from writing a shared credential or another tenant's row. */

    /** The protected enrollment handler must verify GitHub /user identity and
     * one harmless exact K/P endpoint before passing encrypted bytes here.
     * SQL checks active signed membership, current pilot epoch and numeric
     * GitHub principal again; insert and CAS replacement are single statement.
     */
    async putPilotOptionalCredential({tenantId,identityId,accountLogin,kind,
      actorId,accountId,membershipRevision,pilotRevision,accessEnc,
      operation,resource,scopes,expiresAt=null,expectedFingerprint=null}) {
      const t=validUuid(tenantId),i=validUuid(identityId);
      const permitted=(kind==='M'&&operation==='GET /user'&&
        resource==='user/'+actorId&&accountId===actorId&&accountLogin==='master'&&
        Array.isArray(scopes)&&scopes.length>=1&&scopes.length<=60&&
        scopes.every(x=>typeof x==='string'&&/^[a-z_]+(?::[a-z_]+)*$/.test(x)))||
        (kind==='K'&&operation==='GET /notifications'&&
        resource==='user/'+actorId&&Array.isArray(scopes)&&
        scopes.length===1&&scopes[0]==='notifications')||
        (kind==='P'&&operation==='GET /orgs/{org}/packages'&&
          resource==='org/'+accountId&&Array.isArray(scopes)&&
          scopes.includes('read:packages')&&scopes.length<=4&&
          scopes.every(x=>['read:packages','write:packages','delete:packages','repo'].includes(x)));
      if(!permitted||typeof accountLogin!=='string'||!/^[a-z0-9][a-z0-9-]{0,38}$/.test(accountLogin)||
        !Number.isSafeInteger(actorId)||actorId<1||!Number.isSafeInteger(accountId)||accountId<1||
        !Number.isSafeInteger(membershipRevision)||membershipRevision<1||
        !Number.isSafeInteger(pilotRevision)||pilotRevision<1||
        typeof accessEnc!=='string'||!accessEnc.startsWith('v1.')||
        (expectedFingerprint!==null && (typeof expectedFingerprint!=='string'||
          !/^[a-f0-9]{64}$/.test(expectedFingerprint)))||
        (expiresAt!==null && (!(expiresAt instanceof Date)||
          !Number.isFinite(expiresAt.valueOf())||expiresAt<=new Date())))
        throw new TypeError('Invalid private optional credential proof.');
      const fingerprint=createHash('sha256').update(accessEnc).digest('hex');
      const rows=await sql`INSERT INTO gh_tenant_optional_credentials(
        tenant_id,identity_id,account_login,kind,provider_host,
        actor_id,account_id,membership_revision,pilot_revision,access_enc,
        cipher_fingerprint,verified_operation,verified_resource,scopes,expires_at)
        SELECT ${t}::uuid,${i}::uuid,${accountLogin},${kind},'github.com',
          ${actorId},${accountId},${membershipRevision},${pilotRevision},
          ${accessEnc},${fingerprint},${operation},${resource},${scopes}::text[],${expiresAt}
        WHERE EXISTS (SELECT 1 FROM gh_tenants ten
          JOIN gh_tenant_memberships m ON m.tenant_id=ten.id
          JOIN gh_tenant_pilot_allowlist p ON p.tenant_id=ten.id AND p.identity_id=m.identity_id
          JOIN gh_tenant_identities ident ON ident.id=m.identity_id
          JOIN gh_tenant_pilot_bootstraps b ON b.tenant_id=ten.id
          WHERE ten.id=${t}::uuid AND ten.status='active' AND m.identity_id=${i}::uuid
            AND m.active=TRUE AND p.active=TRUE AND
            m.revision=${membershipRevision} AND p.revision=${pilotRevision} AND
            ident.provider='github' AND ident.provider_subject=${String(actorId)} AND
            (b.account_login=${accountLogin} OR b.account_login='public-connect'))
        ON CONFLICT (tenant_id,identity_id,account_login,kind)
        DO UPDATE SET actor_id=EXCLUDED.actor_id,account_id=EXCLUDED.account_id,
          membership_revision=EXCLUDED.membership_revision,pilot_revision=EXCLUDED.pilot_revision,
          access_enc=EXCLUDED.access_enc,cipher_fingerprint=EXCLUDED.cipher_fingerprint,
          verified_operation=EXCLUDED.verified_operation,verified_resource=EXCLUDED.verified_resource,
          scopes=EXCLUDED.scopes,expires_at=EXCLUDED.expires_at,revoked_at=NULL,
          revision=gh_tenant_optional_credentials.revision+1
        WHERE ${expectedFingerprint}::text IS NOT NULL AND
          gh_tenant_optional_credentials.cipher_fingerprint=${expectedFingerprint}
        RETURNING revision`;
      return rows.length===1;
    },
    /** Encrypted grant retrieval for trusted runtime only; never MCP output. */
    async getPilotOptionalCredential({tenantId,identityId,accountLogin,kind}) {
      const t=validUuid(tenantId),i=validUuid(identityId);
      if(!/^[a-z0-9][a-z0-9-]{0,38}$/.test(accountLogin)||!['K','P','M'].includes(kind))return null;
      const rows=await sql`SELECT g.access_enc,g.cipher_fingerprint,g.kind,g.actor_id,
        g.account_id,g.verified_operation,g.verified_resource,g.scopes,
        g.expires_at,g.revision,g.provider_host
        FROM gh_tenant_optional_credentials g
        JOIN gh_tenants ten ON ten.id=g.tenant_id
        JOIN gh_tenant_memberships m ON m.tenant_id=g.tenant_id AND m.identity_id=g.identity_id
        JOIN gh_tenant_pilot_allowlist p ON p.tenant_id=g.tenant_id AND p.identity_id=g.identity_id
        JOIN gh_tenant_identities ident ON ident.id=g.identity_id
        JOIN gh_tenant_pilot_bootstraps b ON b.tenant_id=g.tenant_id
        WHERE g.tenant_id=${t}::uuid AND g.identity_id=${i}::uuid
          AND g.account_login=${accountLogin} AND g.kind=${kind}
          AND g.revoked_at IS NULL AND ten.status='active' AND m.active=TRUE AND p.active=TRUE
          AND g.membership_revision=m.revision AND g.pilot_revision=p.revision
          AND ident.provider='github' AND ident.provider_subject=g.actor_id::text
          AND (b.account_login=g.account_login OR b.account_login='public-connect') AND
          (g.expires_at IS NULL OR g.expires_at>now())`;
      return rows.length===1?rows[0]:null;
    },
    async revokePilotOptionalCredential({tenantId,identityId,accountLogin,kind,expectedFingerprint=null}) {
      const t=validUuid(tenantId),i=validUuid(identityId);
      if(!/^[a-z0-9][a-z0-9-]{0,38}$/.test(accountLogin)||!['K','P','M'].includes(kind)||
        (expectedFingerprint!==null&&!/^[a-f0-9]{64}$/.test(expectedFingerprint)))return false;
      const rows=await sql`UPDATE gh_tenant_optional_credentials g
        SET revoked_at=now(),revision=g.revision+1,
          access_enc='v1.revoked',cipher_fingerprint=repeat('0',64)
        FROM gh_tenants ten,gh_tenant_memberships m,gh_tenant_pilot_allowlist p,
          gh_tenant_identities ident,gh_tenant_pilot_bootstraps b
        WHERE g.tenant_id=${t}::uuid AND g.identity_id=${i}::uuid
          AND g.account_login=${accountLogin} AND g.kind=${kind}
          AND g.revoked_at IS NULL
          AND (${expectedFingerprint}::text IS NULL OR
               g.cipher_fingerprint=${expectedFingerprint})
          AND ten.id=g.tenant_id AND ten.status='active'
          AND m.tenant_id=ten.id AND m.identity_id=g.identity_id AND m.active
          AND p.tenant_id=ten.id AND p.identity_id=g.identity_id AND p.active
          AND ident.id=g.identity_id AND ident.provider='github'
          AND ident.provider_subject=g.actor_id::text
          AND b.tenant_id=g.tenant_id AND (b.account_login=g.account_login OR b.account_login='public-connect')
        RETURNING g.kind`;
      return rows.length===1;
    },

    async storePilotUserAuthorization({ tenantId, identityId, accountLogin,
      userLogin, accessEnc, accessExpiresAt, refreshEnc = null,
      refreshExpiresAt = null, authorityBinding = null }) {
      const t=validUuid(tenantId), i=validUuid(identityId);
      if (typeof accountLogin!=='string' ||
          !/^[a-z0-9][a-z0-9-]{0,38}$/.test(accountLogin) ||
          typeof userLogin!=='string' || userLogin.length<1 || userLogin.length>39 ||
          typeof accessEnc!=='string' || !accessEnc.startsWith('v1.') ||
          (refreshEnc!==null && (typeof refreshEnc!=='string' || !refreshEnc.startsWith('v1.'))) ||
          !(accessExpiresAt instanceof Date) || !Number.isFinite(accessExpiresAt.valueOf()) ||
          (refreshExpiresAt!==null && (!(refreshExpiresAt instanceof Date) ||
            !Number.isFinite(refreshExpiresAt.valueOf())))) {
        throw new TypeError('A verified, encrypted tenant user authorization is required.');
      }
      await ensureUserBindingSchema();
      await initMarketplaceSchema(sql);
      const rows=await sql`INSERT INTO gh_tenant_user_authorizations (
        tenant_id,identity_id,account_login,user_login,access_enc,access_expires_at,
        refresh_enc,refresh_expires_at,authority_binding)
        SELECT ${t}::uuid,${i}::uuid,${accountLogin},${userLogin},
          ${accessEnc},${accessExpiresAt},${refreshEnc},${refreshExpiresAt},
          ${authorityBinding===null?null:JSON.stringify(authorityBinding)}::jsonb
        WHERE EXISTS (SELECT 1 FROM gh_tenants t
          JOIN gh_tenant_memberships m ON m.tenant_id=t.id
          JOIN gh_tenant_pilot_allowlist p ON p.tenant_id=t.id AND p.identity_id=m.identity_id
          WHERE t.id=${t}::uuid AND t.status='active'
            AND NOT EXISTS (SELECT 1 FROM gh_marketplace_tenants mc WHERE mc.tenant_id=t.id AND mc.status<>'active')
            AND m.identity_id=${i}::uuid AND m.active=TRUE AND p.active=TRUE
            AND (${authorityBinding===null} OR (
              m.revision=${authorityBinding?.membershipRevision??0}
              AND p.revision=${authorityBinding?.pilotRevision??0}
              AND EXISTS (SELECT 1 FROM gh_tenant_identities ident
                WHERE ident.id=${i}::uuid AND ident.provider='github'
                  AND ident.provider_subject=${String(authorityBinding?.githubUserId??'')}))))
        ON CONFLICT (tenant_id,identity_id,account_login) DO UPDATE SET
          user_login=EXCLUDED.user_login,access_enc=EXCLUDED.access_enc,
          access_expires_at=EXCLUDED.access_expires_at,
          refresh_enc=EXCLUDED.refresh_enc,
          refresh_expires_at=EXCLUDED.refresh_expires_at,
          authority_binding=EXCLUDED.authority_binding,
          refresh_claim_id=NULL,refresh_claim_expires_at=NULL,
          revision=gh_tenant_user_authorizations.revision+1,updated_at=now()
        RETURNING revision`;
      return rows.length===1;
    },

    /** Retrieval always checks fresh tenant membership and pilot allowlist;
     * the credential NEVER belongs to a shared account login alone. */
    async getPilotUserAuthorization(tenantId,identityId,accountLogin) {
      const t=validUuid(tenantId), i=validUuid(identityId);
      if (typeof accountLogin!=='string' ||
          !/^[a-z0-9][a-z0-9-]{0,38}$/.test(accountLogin)) return null;
      const rows=await sql`SELECT u.user_login,u.access_enc,u.access_expires_at,
          u.refresh_enc,u.refresh_expires_at,u.refresh_claim_id,
          u.refresh_claim_expires_at,u.revision,to_jsonb(u)->'authority_binding' AS authority_binding
        FROM gh_tenant_user_authorizations u
        JOIN gh_tenants t ON t.id=u.tenant_id
        JOIN gh_tenant_memberships m ON m.tenant_id=t.id AND m.identity_id=u.identity_id
        JOIN gh_tenant_pilot_allowlist p ON p.tenant_id=t.id AND p.identity_id=u.identity_id
        WHERE u.tenant_id=${t}::uuid AND u.identity_id=${i}::uuid
          AND u.account_login=${accountLogin} AND t.status='active'
          AND m.active=TRUE AND p.active=TRUE`;
      return rows.length===1 ? rows[0] : null;
    },

    /** A single PostgreSQL UPDATE claims each one-use provider refresh token
     * for one exact tenant member. A second Vercel instance cannot refresh the
     * same stored value while the first lease is active. */
    async claimPilotUserRefresh({tenantId,identityId,accountLogin,
      expectedAccessEnc,claimId}) {
      const t=validUuid(tenantId),i=validUuid(identityId);
      if(typeof accountLogin!=='string' || !/^[a-z0-9][a-z0-9-]{0,38}$/.test(accountLogin) ||
        typeof expectedAccessEnc!=='string' || !expectedAccessEnc.startsWith('v1.') ||
        typeof claimId!=='string' || !/^[a-f0-9-]{36}$/.test(claimId)) return null;
      await initMarketplaceSchema(sql);
      const rows=await sql`UPDATE gh_tenant_user_authorizations u
        SET refresh_claim_id=${claimId},
          refresh_claim_expires_at=now()+interval '60 seconds'
        WHERE u.tenant_id=${t}::uuid AND u.identity_id=${i}::uuid
          AND u.account_login=${accountLogin}
          AND u.access_enc=${expectedAccessEnc}
          AND u.refresh_enc IS NOT NULL AND u.refresh_expires_at>now()
          AND NOT EXISTS (SELECT 1 FROM gh_marketplace_tenants mc WHERE mc.tenant_id=u.tenant_id AND mc.status<>'active')
          AND (u.refresh_claim_id IS NULL OR u.refresh_claim_expires_at<now())
          AND EXISTS (SELECT 1 FROM gh_tenant_memberships m
            JOIN gh_tenants ten ON ten.id=m.tenant_id
            JOIN gh_tenant_pilot_allowlist p ON p.tenant_id=m.tenant_id
              AND p.identity_id=m.identity_id
            WHERE m.tenant_id=${t}::uuid AND m.identity_id=${i}::uuid
              AND m.active=TRUE AND ten.status='active' AND p.active=TRUE)
        RETURNING u.refresh_enc,u.user_login`;
      return rows.length===1?rows[0]:null;
    },

    async finishPilotUserRefresh({tenantId,identityId,accountLogin,
      expectedAccessEnc,claimId,accessEnc,accessExpiresAt,
      refreshEnc,refreshExpiresAt,authorityBinding=null}) {
      const t=validUuid(tenantId),i=validUuid(identityId);
      await ensureUserBindingSchema();
      const rows=await sql`UPDATE gh_tenant_user_authorizations u
        SET access_enc=${accessEnc},access_expires_at=${accessExpiresAt},
          refresh_enc=${refreshEnc},refresh_expires_at=${refreshExpiresAt},
          authority_binding=${authorityBinding===null?null:JSON.stringify(authorityBinding)}::jsonb,
          refresh_claim_id=NULL,refresh_claim_expires_at=NULL,
          revision=u.revision+1,updated_at=now()
        WHERE u.tenant_id=${t}::uuid AND u.identity_id=${i}::uuid
          AND u.account_login=${accountLogin} AND u.access_enc=${expectedAccessEnc}
          AND u.refresh_claim_id=${claimId}
          AND EXISTS (SELECT 1 FROM gh_tenant_memberships m
            JOIN gh_tenants ten ON ten.id=m.tenant_id
            JOIN gh_tenant_pilot_allowlist p ON p.tenant_id=m.tenant_id AND p.identity_id=m.identity_id
            WHERE m.tenant_id=${t}::uuid AND m.identity_id=${i}::uuid
              AND m.active=TRUE AND ten.status='active' AND p.active=TRUE
              AND (${authorityBinding===null} OR (
                m.revision=${authorityBinding?.membershipRevision??0}
                AND p.revision=${authorityBinding?.pilotRevision??0})))
        RETURNING u.revision`;
      return rows.length===1;
    },

    /** On GitHub invalid_grant, clear only the failed one-use claim;
     * a newer reauthorization can never be erased by a late response. */
    async invalidatePilotUserRefresh({tenantId,identityId,accountLogin,
      expectedAccessEnc,claimId}) {
      const t=validUuid(tenantId),i=validUuid(identityId);
      const rows=await sql`DELETE FROM gh_tenant_user_authorizations
        WHERE tenant_id=${t}::uuid AND identity_id=${i}::uuid
          AND account_login=${accountLogin} AND access_enc=${expectedAccessEnc}
          AND refresh_claim_id=${claimId} RETURNING identity_id`;
      return rows.length===1;
    },

    async releasePilotUserRefresh({tenantId,identityId,accountLogin,claimId}) {
      const t=validUuid(tenantId),i=validUuid(identityId);
      await sql`UPDATE gh_tenant_user_authorizations
        SET refresh_claim_id=NULL,refresh_claim_expires_at=NULL
        WHERE tenant_id=${t}::uuid AND identity_id=${i}::uuid
          AND account_login=${accountLogin} AND refresh_claim_id=${claimId}`;
    },

    async getPilotVerifiedSubject(tenantId,identityId) {
      const t=validUuid(tenantId),i=validUuid(identityId);
      const rows=await sql`SELECT ident.provider_subject
        FROM gh_tenant_identities ident
        JOIN gh_tenant_memberships m ON m.identity_id=ident.id
        JOIN gh_tenants ten ON ten.id=m.tenant_id
        JOIN gh_tenant_pilot_allowlist p ON p.tenant_id=ten.id AND p.identity_id=ident.id
        WHERE ten.id=${t}::uuid AND ident.id=${i}::uuid
          AND ten.status='active' AND m.active=TRUE AND p.active=TRUE
          AND ident.provider='github'`;
      return rows.length===1?rows[0].provider_subject:null;
    },

    /** Revoking user consent does not revoke or damage the organization's
     * separate installation or any other team member's personal credentials. */
    async revokePilotUserAuthorization(tenantId,identityId,accountLogin) {
      const t=validUuid(tenantId),i=validUuid(identityId);
      if (typeof accountLogin!=='string' ||
          !/^[a-z0-9][a-z0-9-]{0,38}$/.test(accountLogin)) return false;
      const rows=await sql`DELETE FROM gh_tenant_user_authorizations
        WHERE tenant_id=${t}::uuid AND identity_id=${i}::uuid
          AND account_login=${accountLogin} RETURNING identity_id`;
      return rows.length===1;
    },

    /** One-use GitHub callback state; all OAuth settings are saved by the
     * server during a gated request rather than trusted from callback query. */

    /** Fresh, server-issued state proves context and is consumed before any
     * provider call. A stale browser/tab cannot renew or revoke a later grant. */
    async createPilotOptionalSetupState({stateHash,tenantId,identityId,clientId,
      accountLogin,kind,redirectUri,membershipRevision,pilotRevision,
      expectedFingerprint=null,oauthContext=null}) {
      const t=validUuid(tenantId),i=validUuid(identityId);
      if(!/^[a-f0-9]{64}$/.test(stateHash)||typeof clientId!=='string'||
        !(clientId.startsWith('tcl_')||clientId.startsWith('pcl_'))||
        !/^[a-z0-9][a-z0-9-]{0,38}$/.test(accountLogin)||
        !['K','P','M'].includes(kind)||typeof redirectUri!=='string'||
        redirectUri.length>2048||
        !Number.isSafeInteger(membershipRevision)||membershipRevision<1||
        !Number.isSafeInteger(pilotRevision)||pilotRevision<1||
        (expectedFingerprint!==null&&!/^[a-f0-9]{64}$/.test(expectedFingerprint)))
        throw new TypeError('Invalid optional credential setup.');
      // Provisioning owns DDL: user GET cannot silently migrate the registry.
      await sql`DELETE FROM gh_tenant_optional_setup_states WHERE expires_at<now()`;
      const rows=await sql`INSERT INTO gh_tenant_optional_setup_states (
        state_hash,tenant_id,identity_id,client_id,account_login,kind,
        redirect_uri,membership_revision,pilot_revision,expected_fingerprint,oauth_context)
        SELECT ${stateHash},${t}::uuid,${i}::uuid,${clientId},${accountLogin},
          ${kind},${redirectUri},${membershipRevision},${pilotRevision},${expectedFingerprint},
          ${oauthContext===null?null:JSON.stringify(oauthContext)}::jsonb
        WHERE EXISTS (SELECT 1 FROM gh_tenants ten
          JOIN gh_tenant_memberships m ON m.tenant_id=ten.id
          JOIN gh_tenant_pilot_allowlist p ON p.tenant_id=ten.id AND p.identity_id=m.identity_id
          JOIN gh_tenant_pilot_bootstraps b ON b.tenant_id=ten.id
          WHERE ten.id=${t}::uuid AND ten.status='active' AND
            m.identity_id=${i}::uuid AND m.active AND p.active AND
            (b.account_login=${accountLogin} OR b.account_login='public-connect') AND
            m.revision=${membershipRevision} AND p.revision=${pilotRevision})
        RETURNING state_hash`;
      return rows.length===1;
    },
    async consumePilotOptionalSetupState(stateHash) {
      if(typeof stateHash!=='string'||!/^[a-f0-9]{64}$/.test(stateHash))return null;
      const rows=await sql`DELETE FROM gh_tenant_optional_setup_states
        WHERE state_hash=${stateHash} AND expires_at>now()
        RETURNING tenant_id,identity_id,client_id,account_login,kind,
          redirect_uri,membership_revision,pilot_revision,expected_fingerprint,oauth_context`;
      const row=rows[0];
      return row?{tenantId:String(row.tenant_id),identityId:String(row.identity_id),
        clientId:row.client_id,accountLogin:row.account_login,
        kind:row.kind,redirectUri:row.redirect_uri,
        membershipRevision:Number(row.membership_revision),
        pilotRevision:Number(row.pilot_revision),
        expectedFingerprint:row.expected_fingerprint,oauthContext:row.oauth_context}:null;
    },
    /** Read the CAS of the previously sealed token even if its local proof
     * has expired. Revoked rows cannot be renewed without fresh consent. */
    async pilotOptionalFingerprint({tenantId,identityId,accountLogin,kind}) {
      const t=validUuid(tenantId),i=validUuid(identityId);
      if(!/^[a-z0-9][a-z0-9-]{0,38}$/.test(accountLogin)||
        !['K','P','M'].includes(kind))return null;
      const rows=await sql`SELECT g.cipher_fingerprint FROM gh_tenant_optional_credentials g
        JOIN gh_tenants ten ON ten.id=g.tenant_id
        JOIN gh_tenant_memberships m ON m.tenant_id=g.tenant_id AND m.identity_id=g.identity_id
        JOIN gh_tenant_pilot_allowlist p ON p.tenant_id=g.tenant_id AND p.identity_id=g.identity_id
        JOIN gh_tenant_identities ident ON ident.id=g.identity_id
        JOIN gh_tenant_pilot_bootstraps b ON b.tenant_id=g.tenant_id
        WHERE g.tenant_id=${t}::uuid AND g.identity_id=${i}::uuid
          AND g.account_login=${accountLogin} AND g.kind=${kind}
          AND ten.status='active' AND m.active AND p.active
          AND ident.provider='github' AND ident.provider_subject=g.actor_id::text
          AND (b.account_login=g.account_login OR b.account_login='public-connect')`;
      return rows.length===1?{cipher_fingerprint:rows[0].cipher_fingerprint}:null;
    },

    async createPilotOAuthFlow({ stateHash, tenantId, identityId, clientId,
      redirectUri, clientState, codeChallenge, accountLogin, mode, profile,
      listing, providerVerifier,optionalKind=null }) {
      const t=validUuid(tenantId), i=validUuid(identityId);
      if (!/^[a-f0-9]{64}$/.test(stateHash) || typeof clientId!=='string' ||
          clientId.length<32 || typeof redirectUri!=='string' ||
          typeof providerVerifier!=='string' || providerVerifier.length<43 ||
          !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge) ||
          typeof accountLogin!=='string' ||
          !['preview','production'].includes(mode) ||
          !['read_only','everyday','full'].includes(profile) ||
          !['compact','catalog'].includes(listing) ||
          (optionalKind!==null && optionalKind!=='K') ||
          (clientState!==null && (typeof clientState!=='string' || clientState.length>256)))
        throw new TypeError('Invalid private pilot GitHub authorization state.');
      const rows=await sql`INSERT INTO gh_tenant_oauth_flows (
        state_hash,tenant_id,identity_id,client_id,redirect_uri,client_state,
        code_challenge,account_login,mode,profile,listing,provider_verifier,optional_kind,expires_at)
        SELECT ${stateHash},${t}::uuid,${i}::uuid,${clientId},${redirectUri},
          ${clientState},${codeChallenge},${accountLogin},${mode},${profile},
          ${listing},${providerVerifier},${optionalKind},now()+interval '10 minutes'
        WHERE EXISTS (SELECT 1 FROM gh_tenant_memberships m
          JOIN gh_tenants t ON t.id=m.tenant_id
          JOIN gh_tenant_pilot_allowlist p ON p.tenant_id=m.tenant_id AND p.identity_id=m.identity_id
          WHERE m.tenant_id=${t}::uuid AND m.identity_id=${i}::uuid
            AND m.active=TRUE AND p.active=TRUE AND t.status='active')
        RETURNING state_hash`;
      return rows.length===1;
    },

    async consumePilotOAuthFlow(stateHash) {
      if (typeof stateHash!=='string' || !/^[a-f0-9]{64}$/.test(stateHash)) return null;
      const rows=await sql`DELETE FROM gh_tenant_oauth_flows f
        WHERE f.state_hash=${stateHash} AND f.expires_at>now()
        RETURNING tenant_id,identity_id,client_id,redirect_uri,client_state,
          code_challenge,account_login,mode,profile,listing,provider_verifier,optional_kind`;
      const row=rows[0];
      return row ? { tenantId:String(row.tenant_id),identityId:String(row.identity_id),
        clientId:row.client_id,redirectUri:row.redirect_uri,clientState:row.client_state,
        codeChallenge:row.code_challenge,accountLogin:row.account_login,
        mode:row.mode,profile:row.profile,listing:row.listing,
        providerVerifier:row.provider_verifier,optionalKind:row.optional_kind } : null;
    },

    // ---- PUB-6 public simple-connect (dark; see src/tenancy/public-connect.js) ----
    /** Returns false when the configured client cap is already reached. */
    async createPublicClient({ clientId, secretHash, authMethod = 'client_secret_post', redirectUris, clientName = null, maxClients }) {
      if (!/^pcl_[A-Za-z0-9_-]{32,64}$/.test(String(clientId)) ||
          !/^[a-f0-9]{64}$/.test(String(secretHash)) || !['none', 'client_secret_post'].includes(authMethod) ||
          !Array.isArray(redirectUris) || redirectUris.length < 1 || redirectUris.length > 8 ||
          !Number.isSafeInteger(maxClients) || maxClients < 1)
        throw new TypeError('Invalid public client registration.');
      const rows = await sql`INSERT INTO gh_public_clients (client_id,secret_hash,redirect_uris,auth_method,client_name)
        SELECT ${clientId},${secretHash},${redirectUris}::text[],${authMethod},${clientName}
        WHERE (SELECT count(*) FROM gh_public_clients) < ${maxClients}
        RETURNING client_id`;
      return rows.length === 1;
    },
    /** PUB-5 B: marks an app registration as in use (at most once a day, one cheap statement). */
    async touchPublicClient(clientId) {
      if (!/^pcl_[A-Za-z0-9_-]{32,64}$/.test(String(clientId))) return false;
      const rows = await sql`UPDATE gh_public_clients SET last_token_at = now() WHERE client_id = ${clientId}
        AND (last_token_at IS NULL OR last_token_at < now() - interval '1 day') RETURNING client_id`;
      return rows.length === 1;
    },
    /** PUB-5 B: removes app registrations that never got a token in `days` days (at most `limit` per call). Built-in pages are kept. */
    async deleteStalePublicClients({ days = 30, limit = 50, keep = [] } = {}) {
      const d = Math.min(Math.max(Number.isInteger(days) ? days : 30, 1), 3650), n = Math.min(Math.max(Number.isInteger(limit) ? limit : 50, 1), 50);
      const rows = await sql`DELETE FROM gh_public_clients WHERE client_id IN (
          SELECT client_id FROM gh_public_clients
          WHERE coalesce(last_token_at, created_at) < now() - (${d} * interval '1 day')
            AND client_id <> ALL(${keep.map(String)}::text[])
          ORDER BY coalesce(last_token_at, created_at) LIMIT ${n}) RETURNING client_id`;
      return rows.length;
    },
    async getPublicClient(clientId) {
      if (!/^pcl_[A-Za-z0-9_-]{32,64}$/.test(String(clientId))) return null;
      const rows = await sql`SELECT client_id,secret_hash,redirect_uris,auth_method,client_name
        FROM gh_public_clients WHERE client_id=${clientId}`;
      const r = rows[0];
      return r ? { clientId: r.client_id, secretHash: r.secret_hash,
        redirectUris: r.redirect_uris, authMethod: r.auth_method, clientName: r.client_name } : null;
    },
    /** Emergency lever: removing a public client stops every future token for it. */
    async deletePublicClient(clientId) {
      const rows = await sql`DELETE FROM gh_public_clients WHERE client_id=${String(clientId)} RETURNING client_id`;
      return rows.length === 1;
    },
    /** Returns false when too many sign-ins are already open (capacity guard). */
    async createPublicFlow({ stateHash, stage, clientId, redirectUri, clientState = null,
      codeChallenge, tier, accountLogin = null, allowChanges = false, timeZone = null, purpose = null, offers = null,
      providerVerifier = null, afterInstall = false, tenantId = null, identityId = null, marketplaceAccountId = null, ttlSeconds = 600, maxOpen, maxOpenPerClient = 200 }) {
      if (!/^[a-f0-9]{64}$/.test(String(stateHash)) ||
          !['signin', 'install', 'god'].includes(stage) ||
          !['standard', 'god'].includes(tier) ||
          !/^[A-Za-z0-9_-]{43}$/.test(String(codeChallenge)) ||
          typeof redirectUri !== 'string' ||
          (clientState !== null && (typeof clientState !== 'string' || clientState.length > 256)) ||
          (accountLogin !== null && !/^[a-z0-9][a-z0-9-]{0,38}(,[a-z0-9][a-z0-9-]{0,38}){0,9}$/.test(String(accountLogin))) ||
          (timeZone !== null && !validZone(timeZone)) ||
          (purpose !== null && !['forget', 'master', 'approve', 'manage', 'revoke', 'revoke_form'].includes(purpose)) ||
          (offers !== null && !(Array.isArray(offers) && offers.length >= 1 && offers.length <= 8 && offers.every((o) =>
            /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(String(o?.login)) && Number.isSafeInteger(o?.id) && o.id > 0 && ['User', 'Organization'].includes(o?.type)))) ||
          !Number.isSafeInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 1800 ||
          !Number.isSafeInteger(maxOpen) || maxOpen < 1 ||
          !Number.isSafeInteger(maxOpenPerClient) || maxOpenPerClient < 1)
        throw new TypeError('Invalid public connection state.');
      if (marketplaceAccountId !== null && (!Number.isSafeInteger(marketplaceAccountId) || marketplaceAccountId<1))
        throw new TypeError('Invalid Marketplace account.');
      const t = tenantId === null ? null : validUuid(tenantId);
      const i = identityId === null ? null : validUuid(identityId);
      await sql`DELETE FROM gh_public_flows WHERE expires_at < now() - interval '1 hour'`;
      const rows = await sql`INSERT INTO gh_public_flows (state_hash,stage,client_id,redirect_uri,
          client_state,code_challenge,tier,account_login,allow_changes,after_install,provider_verifier,
          tenant_id,identity_id,expires_at,time_zone,purpose,offers,marketplace_account_id)
        SELECT ${stateHash},${stage},${clientId},${redirectUri},${clientState},${codeChallenge},
          ${tier},${accountLogin},${allowChanges === true},${afterInstall === true},${providerVerifier},
          ${t}::uuid,${i}::uuid,now() + (${ttlSeconds} * interval '1 second'),${timeZone},${purpose},${offers === null ? null : JSON.stringify(offers)},${marketplaceAccountId}
        WHERE (SELECT count(*) FROM gh_public_flows WHERE expires_at > now()) < ${maxOpen}
          AND (SELECT count(*) FROM gh_public_flows WHERE client_id = ${clientId} AND expires_at > now()) < ${maxOpenPerClient}
        RETURNING state_hash`;
      return rows.length === 1;
    },
    /** Cheap clean-up of ONE client's finished sign-in steps (HARD-1): expired rows never count towards a cap, this just keeps the table small. */
    async purgeExpiredPublicFlows(clientId) {
      if (typeof clientId !== 'string' || clientId.length > 80) return 0;
      const rows = await sql`DELETE FROM gh_public_flows WHERE client_id = ${clientId} AND expires_at <= now() RETURNING state_hash`;
      return rows.length;
    },
    /** Single use: the row is deleted as it is read. */
    async consumePublicFlow(stateHash, stage) {
      if (!/^[a-f0-9]{64}$/.test(String(stateHash)) ||
          !['signin', 'install', 'god'].includes(stage)) return null;
      const rows = await sql`DELETE FROM gh_public_flows
        WHERE state_hash=${stateHash} AND stage=${stage} AND expires_at > now()
        RETURNING client_id,redirect_uri,client_state,code_challenge,tier,account_login,
          allow_changes,after_install,provider_verifier,tenant_id,identity_id,time_zone,purpose,offers,marketplace_account_id`;
      const r = rows[0];
      return r ? { clientId: r.client_id, redirectUri: r.redirect_uri, clientState: r.client_state,
        codeChallenge: r.code_challenge, tier: r.tier, accountLogin: r.account_login,
        allowChanges: r.allow_changes, afterInstall: r.after_install, providerVerifier: r.provider_verifier, timeZone: r.time_zone ?? null, purpose: r.purpose ?? null,
        offers: (() => { try { return r.offers ? JSON.parse(r.offers) : null; } catch { return null; } })(),
        tenantId: r.tenant_id ? String(r.tenant_id) : null,
        marketplaceAccountId: r.marketplace_account_id ? Number(r.marketplace_account_id) : null,
        identityId: r.identity_id ? String(r.identity_id) : null } : null;
    },
    /** LAUNCH-1 invite list (names are GitHub logins, lower-cased). */
    async addPublicInvites(logins) {
      const clean = [...new Set((Array.isArray(logins) ? logins : []).map((l) => String(l).trim().toLowerCase()))].slice(0, 100);
      if (!clean.length || clean.some((l) => !/^[a-z0-9][a-z0-9-]{0,38}$/.test(l))) throw new TypeError('Invite names must be valid GitHub account names.');
      for (const login of clean) await sql`INSERT INTO gh_public_invites (login) VALUES (${login}) ON CONFLICT (login) DO NOTHING`;
      return clean.length;
    },
    async removePublicInvite(login) {
      const rows = await sql`DELETE FROM gh_public_invites WHERE login = ${String(login).trim().toLowerCase()} RETURNING login`;
      return rows.length === 1;
    },
    async listPublicInvites() { return (await sql`SELECT login FROM gh_public_invites ORDER BY login LIMIT 500`).map((r) => r.login); },
    async isPublicInvited(login) {
      return (await sql`SELECT 1 FROM gh_public_invites WHERE login = ${String(login ?? '').trim().toLowerCase()}`).length === 1;
    },
    /** LAUNCH-1: the person revoked the App's authorization on GitHub, so every stored user grant of theirs goes. */
    async revokeUserAuthorizationsBySubject(subject) {
      if (!/^[1-9][0-9]{0,18}$/.test(String(subject))) return 0;
      const rows = await sql`DELETE FROM gh_tenant_user_authorizations a USING gh_tenant_identities i
        WHERE a.identity_id = i.id AND i.provider = 'github' AND i.provider_subject = ${String(subject)} RETURNING a.identity_id`;
      return rows.length;
    },
    /** LAUNCH-1: public tenants that could hold an installation (bounded; the same cap the usage summary uses). */
    async listPublicTenantIds(limit = 1000) {
      const max = Math.min(Math.max(Number.isInteger(limit) ? limit : 1000, 1), 1000);
      return (await sql`SELECT tenant_id FROM gh_tenant_pilot_bootstraps WHERE account_login='public-connect' ORDER BY created_at LIMIT ${max}`).map((r) => String(r.tenant_id));
    },
    /** PUB-5 A: replaces this person's rows in the installation lookup. One statement, so it is all-or-nothing. Numbers only. */
    async indexPublicInstallations(tenantId, installationIds) {
      const t = validUuid(tenantId);
      const ids = [...new Set((Array.isArray(installationIds) ? installationIds : []).map(Number))];
      if (ids.some((n) => !Number.isSafeInteger(n) || n <= 0)) throw new TypeError('Invalid installation id.');
      const list = JSON.stringify(ids);
      await sql`WITH gone AS (
          DELETE FROM gh_public_installations WHERE tenant_id = ${t}::uuid
            AND installation_id NOT IN (SELECT value::bigint FROM jsonb_array_elements_text(${list}::jsonb))
          RETURNING 1)
        INSERT INTO gh_public_installations (installation_id, tenant_id)
          SELECT value::bigint, ${t}::uuid FROM jsonb_array_elements_text(${list}::jsonb)
          ON CONFLICT DO NOTHING`;
      return ids.length;
    },
    /** PUB-5 A: the people who hold this installation (one root query). */
    async publicTenantsForInstallation(installationId) {
      if (!Number.isSafeInteger(installationId) || installationId <= 0) return [];
      return (await sql`SELECT tenant_id FROM gh_public_installations WHERE installation_id = ${installationId}`).map((r) => String(r.tenant_id));
    },
    /** PUB-5 A: public people in pages of `size`, after the last id seen (no ceiling). */
    async publicTenantPage(afterId, size = 200) {
      const after = afterId ? validUuid(afterId) : '00000000-0000-0000-0000-000000000000';
      const max = Math.min(Math.max(Number.isInteger(size) ? size : 200, 1), 500);
      return (await sql`SELECT tenant_id FROM gh_tenant_pilot_bootstraps WHERE account_login='public-connect' AND tenant_id > ${after}::uuid
        ORDER BY tenant_id LIMIT ${max}`).map((r) => String(r.tenant_id));
    },
    /** PUB-5 A: public people whose personal GitHub name matches, found through the grant kept at the shared level. */
    async publicTenantsByUserLogin(login) {
      const name = String(login ?? '').trim().toLowerCase();
      return (await sql`SELECT DISTINCT a.tenant_id FROM gh_tenant_user_authorizations a
        JOIN gh_tenant_pilot_bootstraps b ON b.tenant_id = a.tenant_id AND b.account_login='public-connect'
        WHERE lower(a.user_login) = ${name}`).map((r) => String(r.tenant_id));
    },
    /** PUB-5 A: one-time fill of the installation lookup from each person's own store. `readInstallationIds(tenantId)` reads one store.
     * Each page of 200 people is written by ONE statement guarded by a transaction-level advisory lock (a statement is its own
     * transaction, which also holds on Neon's HTTP driver): a second caller waits, then re-inserts the same rows harmlessly. */
    async backfillPublicInstallations({ readInstallationIds }) {
      let people = 0, last = null;
      for (let ids = await this.publicTenantPage(null, 200); ids.length; ids = await this.publicTenantPage(last, 200)) {
        const rows = [];
        for (const tenantId of ids) {
          last = tenantId;
          let installs = [];
          try { installs = await readInstallationIds(tenantId); } catch { continue; }
          for (const n of installs) if (Number.isSafeInteger(n) && n > 0) rows.push({ i: n, t: tenantId });
          people += 1;
        }
        if (rows.length) {
          const json = JSON.stringify(rows);
          await sql`INSERT INTO gh_public_installations (installation_id, tenant_id)
            SELECT (e->>'i')::bigint, (e->>'t')::uuid FROM (SELECT pg_advisory_xact_lock(5005001)) AS lock,
              jsonb_array_elements(${json}::jsonb) e
            ON CONFLICT DO NOTHING`;
        }
      }
      return people;
    },
    /** The public tenant of an already-known GitHub person, or null. Look-up only: it never enrolls anyone. */
    async findPublicTenantBySubject(subject, tenantKey = 'public-connect') {
      if (!/^[1-9][0-9]{0,18}$/.test(String(subject))) return null;
      if (tenantKey !== 'public-connect' && !/^marketplace-[1-9][0-9]{0,15}$/.test(tenantKey)) return null;
      const rows = await sql`SELECT b.tenant_id FROM gh_tenant_identities i
        JOIN gh_tenant_pilot_bootstraps b ON b.identity_id = i.id
        WHERE i.provider = 'github' AND i.provider_subject = ${String(subject)} AND b.account_login = ${tenantKey}`;
      return rows[0] ? String(rows[0].tenant_id) : null;
    },
    /** Makes sure the built-in "delete my data" page has a client row to hang its sign-in on. It can never receive tokens:
     * its secret hash is random and unknown, and the authorize page refuses its id. */
    async ensureForgetClient(clientId, redirectUri, secretHash) {
      return await this.ensureBuiltInClient(clientId, redirectUri, secretHash, 'Delete my data');
    },
    /** Same for any built-in page (delete my data, My connection). */
    async ensureBuiltInClient(clientId, redirectUri, secretHash, name) {
      await sql`INSERT INTO gh_public_clients (client_id, secret_hash, redirect_uris, client_name)
        VALUES (${clientId}, ${secretHash}, ${[redirectUri]}::text[], ${redact(String(name)).slice(0, 100)})
        ON CONFLICT (client_id) DO UPDATE SET redirect_uris = EXCLUDED.redirect_uris`;
    },
    /** Reserved nonsecret public Muse client: fixed verified Meta callback, no owner credential. */
    async ensureMusePublicClient(clientId, redirectUri, secretHash) {
      if (!/^pcl_[A-Za-z0-9_-]{32,64}$/.test(clientId) || !/^https:\/\/agent\.meta\.ai\/api\/hatch\/oauth\/callback$/.test(redirectUri) ||
          !/^[a-f0-9]{64}$/.test(secretHash)) throw new TypeError('Invalid Muse registration.');
      await sql`INSERT INTO gh_public_clients (client_id, secret_hash, redirect_uris, auth_method, client_name)
        VALUES (${clientId}, ${secretHash}, ${[redirectUri]}::text[], 'none', 'Meta Muse')
        ON CONFLICT (client_id) DO NOTHING`;
    },
    /** Deletes one public person's tenant completely (see gh_forget_public_tenant). False when it does not exist. */
    async forgetPublicTenant(tenantId) {
      const t = validUuid(tenantId);
      const rows = await sql`SELECT gh_forget_public_tenant(${t}::uuid) AS done`;
      return rows[0]?.done === true;
    },
    /** Self-serve tenants created so far (one per verified identity and account). */
    async countPilotTenants() {
      const rows = await sql`SELECT count(*)::integer AS n FROM gh_tenant_pilot_bootstraps`;
      return rows[0].n;
    },
    async findPilotTenant(identityId, accountLogin) {
      const i = validUuid(identityId);
      const rows = await sql`SELECT tenant_id FROM gh_tenant_pilot_bootstraps
        WHERE identity_id=${i}::uuid AND account_login=${String(accountLogin)}`;
      return rows[0] ? String(rows[0].tenant_id) : null;
    },

    /** Privileged owner setup only: list the trusted server-bootstrap tenants
     * for one exact account. No public API takes an arbitrary tenant ID. */
    async listPilotsForAccount(accountLogin) {
      if(typeof accountLogin!=='string' ||
          !/^[a-z0-9][a-z0-9-]{0,38}$/.test(accountLogin))
        throw new TypeError('Invalid private pilot account.');
      const rows=await sql`SELECT tenant_id,identity_id FROM gh_tenant_pilot_bootstraps
        WHERE account_login=${accountLogin} ORDER BY created_at`;
      return rows.map(row=>({tenantId:String(row.tenant_id),
        ownerIdentityId:String(row.identity_id)}));
    },

    /** Remove private pilot's encrypted user grants and pending browser states
     * for this exact owner-verified account after all pilot sessions are revoked.
     * Server-owned App keys are not touched and no other account is queried. */
    async purgePrivatePilotRootSecrets(accountLogin) {
      if(typeof accountLogin!=='string' ||
          !/^[a-z0-9][a-z0-9-]{0,38}$/.test(accountLogin))
        throw new TypeError('Invalid private pilot account.');
      await ensureOptionalSetupSchema();
      const rows=await sql`WITH extras AS (
        DELETE FROM gh_tenant_optional_credentials g
        WHERE EXISTS (SELECT 1 FROM gh_tenant_pilot_bootstraps b
          WHERE b.tenant_id=g.tenant_id AND b.account_login=${accountLogin})
        RETURNING kind
      ), auth AS (
        DELETE FROM gh_tenant_user_authorizations a
        WHERE EXISTS (SELECT 1 FROM gh_tenant_pilot_bootstraps p
          WHERE p.tenant_id=a.tenant_id AND p.account_login=${accountLogin})
        RETURNING identity_id
      ), optional_states AS (
        DELETE FROM gh_tenant_optional_setup_states f
        WHERE EXISTS (SELECT 1 FROM gh_tenant_pilot_bootstraps p
          WHERE p.tenant_id=f.tenant_id AND p.account_login=${accountLogin})
        RETURNING state_hash
      ), states AS (
        DELETE FROM gh_tenant_oauth_flows f
        WHERE EXISTS (SELECT 1 FROM gh_tenant_pilot_bootstraps p
          WHERE p.tenant_id=f.tenant_id AND p.account_login=${accountLogin})
        RETURNING state_hash
      ) SELECT (SELECT count(*)::integer FROM auth) AS user_grants,
        (SELECT count(*)::integer FROM states) + (SELECT count(*)::integer FROM optional_states) AS pending_states,
        (SELECT count(*)::integer FROM extras) AS optional_grants`;
      return rows.length===1?{userGrants:Number(rows[0].user_grants),
        pendingStates:Number(rows[0].pending_states),
        optionalGrants:Number(rows[0].optional_grants)}:null;
    },

    /** Owner emergency stop. The calling setup route must have already
     * authenticated its owner/passphrase; no MCP caller invokes this method.
     * All existing bearer/client/code epochs for this account become stale. */
    async revokePrivatePilotsForAccount(accountLogin) {
      if (typeof accountLogin!=='string' ||
          !/^[a-z0-9][a-z0-9-]{0,38}$/.test(accountLogin))
        throw new TypeError('An exact private pilot account is required.');
      const rows=await sql`UPDATE gh_tenant_pilot_allowlist p
        SET active=FALSE,revision=p.revision+1,updated_at=now()
        WHERE p.active=TRUE AND EXISTS (
          SELECT 1 FROM gh_tenant_pilot_bootstraps b
          WHERE b.tenant_id=p.tenant_id AND b.account_login=${accountLogin})
        RETURNING p.tenant_id`;
      return rows.length;
    },

    /** Membership widening is owner-controlled: no public self-grant. */
    async grant(tenantId, actorIdentityId, targetIdentityId, role) {
      const t = validUuid(tenantId), actor = validUuid(actorIdentityId), target = validUuid(targetIdentityId);
      if (!ROLES.has(role) || role === 'owner') throw new TypeError('Only member/admin grants are supported.');
      const rows = await sql`INSERT INTO gh_tenant_memberships (tenant_id,identity_id,role)
        SELECT ${t}::uuid,${target}::uuid,${role}
        WHERE EXISTS (SELECT 1 FROM gh_tenant_memberships own
          JOIN gh_tenants ten ON ten.id = own.tenant_id
          WHERE own.tenant_id = ${t}::uuid AND own.identity_id = ${actor}::uuid
            AND own.role = 'owner' AND own.active = TRUE AND ten.status = 'active')
          AND EXISTS (SELECT 1 FROM gh_tenant_identities WHERE id = ${target}::uuid)
        ON CONFLICT (tenant_id,identity_id) DO UPDATE SET role = EXCLUDED.role,
          active = TRUE, revision = gh_tenant_memberships.revision + 1, updated_at = now()
        WHERE gh_tenant_memberships.role <> 'owner'
        RETURNING identity_id,revision`;
      return rows.length === 1;
    },

    async revoke(tenantId, actorIdentityId, targetIdentityId) {
      const t = validUuid(tenantId), actor = validUuid(actorIdentityId), target = validUuid(targetIdentityId);
      const rows = await sql`UPDATE gh_tenant_memberships m
        SET active = FALSE, revision = revision + 1, updated_at = now()
        WHERE m.tenant_id = ${t}::uuid AND m.identity_id = ${target}::uuid
          AND m.active = TRUE AND m.role <> 'owner'
          AND EXISTS (SELECT 1 FROM gh_tenant_memberships own
            WHERE own.tenant_id = ${t}::uuid AND own.identity_id = ${actor}::uuid
              AND own.role = 'owner' AND own.active = TRUE)
        RETURNING m.identity_id`;
      return rows.length === 1;
    }
  };
}

/** Never takes tenant from an HTTP parameter or cookie. PUB-2 must first verify
 * identity with GitHub and resolve membership through the service-owned registry.
 * Private tests may inject an isolated session SQL factory; production pins
 * every HTTP transaction. Both must pass exact namespace assertions. */
export async function openAuthorizedTenantDb({ directory, tenantId, verifiedIdentityId,
  connectionString = process.env.DATABASE_URL, sqlFactory = neon }) {
  if (!directory || typeof directory.authorized !== 'function')
    throw new TypeError('A private tenant directory is required.');
  const bound = await directory.authorized(tenantId, verifiedIdentityId);
  if (!bound || bound.namespace !== tenantSchemaName(tenantId))
    throw new Error('Tenant membership is not authorized.');
  const marketplace = await directory.marketplaceBinding?.(tenantId);
  if (marketplace && !marketplace.active) throw new Error('Marketplace subscription is not active.');
  const sql = createTenantSql(connectionString, tenantId, sqlFactory);
  await assertTenantSearchPath(sql, tenantId);
  const db = createDb(sql);
  await upgradeTenantSchemaOnce(tenantId, connectionString, db, sql);
  return { tenant: Object.freeze(bound), db, sql };
}

// HARD-2: a tenant's tables are created once, when the person first signs in. A release that adds a column (GOD-5 added
// accounts.allow_changes) must therefore reach people who signed in earlier. Every statement in initSchema is additive and
// IF NOT EXISTS, so the first request for a tenant on each server instance re-runs it. A failure is not remembered (the next
// request tries again) and never blocks the request, because reads that do not touch the new column keep working.
const upgradedTenants = new Map();
async function upgradeTenantSchemaOnce(tenantId, connectionString, db, sql) {
  const key = `${tenantId}|${connectionString ?? ''}`;
  if (!upgradedTenants.has(key)) {
    const running = (async () => {
      await db.initSchema();
      await initTenantRuntimeSchema(sql);
    })();
    upgradedTenants.set(key, running);
    running.catch(() => { if (upgradedTenants.get(key) === running) upgradedTenants.delete(key); });
  }
  try { await upgradedTenants.get(key); } catch { /* retried on the next request */ }
}
export function forgetUpgradedTenantsForTests() { upgradedTenants.clear(); }

/** For a newly provisioned, inactive tenant only. The caller is trusted internal
 * code; never expose this to an MCP tool, arbitrary OAuth client or public URL. */
export async function initializeProvisionedTenant({ tenantId, connectionString = process.env.DATABASE_URL,
  sqlFactory = neon }) {
  const sql = createTenantSql(connectionString, tenantId, sqlFactory);
  const namespace = await assertTenantSearchPath(sql, tenantId);
  const db = createDb(sql);
  await db.initSchema();
  await initTenantRuntimeSchema(sql);
  const tables=await db.listTables();
  if (!SCHEMA_TABLES.every(name=>tables.includes(name)) ||
      !tables.includes('gh_tenant_budget_windows') ||
      !tables.includes('gh_tenant_runtime_metrics') ||
      !tables.includes('gh_tenant_storage_slots'))
    throw new Error('Tenant schema is not fully initialized. No tenant was activated.');
  return { namespace, db };
}
