import { redact } from './github/content-protection.js';
// Foundation database layer (A-2). Lazy Neon client plus the additive foundation schema of docs/designs/BATCH-A.md §2.
// Every statement is a static tagged template (no string building) and uses IF NOT EXISTS: running initSchema() twice
// changes nothing, and nothing here ever drops, alters or deletes. Credentials are ciphertext (*_enc) or hashes
// (*_hash) only; no column holds a plain token, key or secret.
import { neon } from '@neondatabase/serverless';
import { createHash } from 'node:crypto';
import { hashToken } from './core/oauth.js';
import { createDevLedger } from './dev/ledger.js';
import { DEFAULT_PROJECTS, validateProjectProfile, storedProject } from './data/profile-schema.js';

/** The 13 foundation tables, in BATCH-A §2 order. Later batches add their own tables and their own lists. */
export const SCHEMA_TABLES = Object.freeze([
  'gh_apps',
  'gh_accounts',
  'gh_installation_tokens',
  'setup_states',
  'oauth_clients',
  'oauth_codes',
  'oauth_tokens',
  'rtc_pass_rate',
  'rtc_pass_scopes',
  'rtc_pass_grants',
  'login_attempts',
  'change_log',
  'gh_write_batches',
  'one_time_secrets',
  'gh_rate_state',
  'gh_write_slots',
  'gh_etag_cache',
  'server_settings',
  'protected_resources',
  'known_projects',
  'result_store',
  'gh_async_jobs',
  'secret_entry_requests',
  'dev_runs',
  'dev_run_objects',
  'dev_run_intents',
  'dev_repo_birth_labels',
  'dev_forwarders',
  'dev_cleanup_executions'
]);
export const RESULT_HANDLE = /^res_[A-Za-z0-9_-]{20,64}$/;
export const JOB_ID = /^job_[0-9a-f]{16}$/;

export const PROTECTED_KINDS = Object.freeze(['repo', 'installation']);
export const PROTECTED_LEVELS = Object.freeze(['pr-only', 'locked']);
export const PROTECTED_SEEDED_KEY = 'protected_resources_seeded';
const REPO_TARGET = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?\/[a-z0-9._-]{1,100}$/;

/** Checks one protected-list entry and returns it in its stored form (lowercase target). Throws a TypeError with a plain sentence. */
export function checkProtected({ kind, target, level, reason }) {
  if (!PROTECTED_KINDS.includes(kind)) throw new TypeError('A protected entry is a repo or an installation.');
  if (!PROTECTED_LEVELS.includes(level)) throw new TypeError('The level is pr-only or locked.');
  const t = String(target ?? '').trim().toLowerCase();
  if (kind === 'repo' && !REPO_TARGET.test(t)) throw new TypeError('A repository is written owner/name.');
  if (kind === 'installation' && !(t === '*' || /^[0-9]{1,15}$/.test(t))) throw new TypeError('An installation is its number, or * for all of this server\'s own Apps.');
  const why = String(reason ?? '').trim();
  if (why.length < 3 || why.length > 300) throw new TypeError('Give a reason of 3 to 300 characters.');
  return { kind, target: t, level, reason: why };
}
const normalizeProtected = (r) => ({ kind: r.kind, target: r.target, level: r.level, reason: r.reason, updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at });

/**
 * The per-connection settings a login stores and every token refresh must copy forward (Robinson Tool Contract §2).
 * A-3 copies every one of these when it refreshes a token.
 */
export const CONNECTION_FIELDS = Object.freeze(['default_account', 'accounts', 'mode', 'profile', 'listing']);

/** Cached bodies larger than this are not kept (A9). */
export const ETAG_BODY_LIMIT_BYTES = 256 * 1024;

/** What a single-use setup state can be for. `enable_production` is the first step of turning production on (B-2). */
export const SETUP_PURPOSES = Object.freeze(['manifest', 'user_auth', 'enable_production']);
export const CONNECTION_MODES = Object.freeze(['preview', 'production']);
export const CONNECTION_PROFILES = Object.freeze(['read_only', 'everyday', 'full']);
export const CONNECTION_LISTINGS = Object.freeze(['catalog', 'compact']);

/**
 * Validates the settings a login chose before they are written to a code or token row (BATCH-A A6): at least one
 * allowed account, a default account that is one of them, and known mode, profile and listing values.
 * Whether `production` is allowed for those accounts is decided by the login endpoint (A-3b), not here.
 */
export function checkConnection({ defaultAccount, accounts, mode, profile, listing }) {
  if (!Array.isArray(accounts) || !accounts.length || accounts.some((a) => typeof a !== 'string' || !a) || new Set(accounts).size !== accounts.length) {
    throw new TypeError('A connection needs a non-empty list of distinct account names.');
  }
  if (typeof defaultAccount !== 'string' || !accounts.includes(defaultAccount)) throw new TypeError('The default account must be one of the allowed accounts.');
  if (!CONNECTION_MODES.includes(mode)) throw new TypeError(`Unknown connection mode: ${mode}`);
  if (!CONNECTION_PROFILES.includes(profile)) throw new TypeError(`Unknown connection profile: ${profile}`);
  if (!CONNECTION_LISTINGS.includes(listing)) throw new TypeError(`Unknown connection listing: ${listing}`);
  return { defaultAccount, accounts: [...accounts], mode, profile, listing };
}

/** Pick exactly the CONNECTION_FIELDS from a stored oauth_codes / oauth_tokens row (missing values become null). */
export function connectionSettings(row) {
  const settings = {};
  for (const field of CONNECTION_FIELDS) {
    const value = row?.[field];
    settings[field] = Array.isArray(value) ? [...value] : (value ?? null);
  }
  return settings;
}

/** The production Neon HTTP client. Created on first use, never at import time. */
export function productionSql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not configured. Set it in the server environment.');
  return neon(url);
}

/**
 * @param {Function} [sql] a Neon-shaped tagged-template query function (the production client by default)
 * @returns {{ initSchema(): Promise<void>, listTables(): Promise<string[]> }}
 */
export const jsonOrNull = (v) => (v === undefined || v === null ? null : JSON.stringify(v));
/** Fixed shape for a change-log row; unknown keys are ignored so a caller cannot write arbitrary columns. */
export function normalizeChange(c = {}) {
  if (typeof c.tool !== 'string' || !c.tool) throw new TypeError('A change needs a tool name.');
  if (typeof c.summary !== 'string' || !c.summary) throw new TypeError('A change needs a summary.');
  return {
    account: c.account ?? null, repo: c.repo ?? null, mode: c.mode ?? null, connection: c.connection ?? null, tool: c.tool, target: c.target ?? null,
    summary: redact(c.summary).slice(0, 2000), before: jsonOrNull(c.before), after: jsonOrNull(c.after), dryRun: c.dryRun === true, confirmed: c.confirmed ?? null,
    production: c.production === true, accessWidening: c.accessWidening === true, notifies: Array.isArray(c.notifies) ? c.notifies.slice(0, 50).map(String) : [],
    spendCents: Number.isSafeInteger(c.spendCents) ? c.spendCents : null, requestKey: c.requestKey ?? null, githubRequestId: c.githubRequestId ?? null, inverse: jsonOrNull(c.inverse)
  };
}
export function changeView(row) {
  return { id: Number(row.id), at: row.at, summary: row.summary, confirmed: row.confirmed, after: row.after ?? null, connection: row.connection ?? null, githubRequestId: row.github_request_id ?? null,
    ...(row.tool ? { tool: row.tool, account: row.account, repo: row.repo, mode: row.mode, production: row.production, dryRun: row.dry_run, requestKey: row.request_key,
      notifies: row.notifies ?? [], spendCents: row.spend_cents == null ? null : Number(row.spend_cents), inverse: row.inverse ?? null, before: row.before ?? null, actedAs: row.acted_as ?? null } : {}) };
}

export function createDb(sql = productionSql()) {
  if (typeof sql !== 'function') throw new TypeError('createDb needs a Neon-shaped tagged-template query function.');

  // Keep schema initialization strictly additive/static. Seed lazily after the
  // migration, never overwriting an owner-edited profile or its revision.
  let seedsApplied=false;
  async function seedKnownProjects() {
    if(seedsApplied)return;
    for(const initial of DEFAULT_PROJECTS) {
      const profile=validateProjectProfile(initial);
      await sql`INSERT INTO known_projects (id,name,status,version,profile)
        VALUES (${profile.id},${profile.name},${profile.status},1,${JSON.stringify(profile)}::jsonb)
        ON CONFLICT (id) DO NOTHING`;
    }
    seedsApplied=true;
  }

  return {
    ...createDevLedger(sql),
    /** Creates the foundation tables and index if they are missing. One statement per call (Neon's HTTP driver). */
    async initSchema() {
      await sql`CREATE TABLE IF NOT EXISTS gh_apps (
        id BIGINT PRIMARY KEY,
        slug TEXT NOT NULL,
        owner_login TEXT NOT NULL,
        owner_type TEXT NOT NULL,
        client_id TEXT NOT NULL,
        client_secret_enc TEXT NOT NULL,
        private_key_enc TEXT NOT NULL,
        webhook_secret_enc TEXT NOT NULL,
        permissions JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS gh_accounts (
        login TEXT PRIMARY KEY,
        account_id BIGINT NOT NULL UNIQUE,
        account_type TEXT NOT NULL,
        label TEXT NOT NULL,
        credential_kind TEXT NOT NULL DEFAULT 'app',
        app_id BIGINT,
        installation_id BIGINT,
        repository_selection TEXT,
        installation_permissions JSONB,
        installation_status TEXT NOT NULL DEFAULT 'none',
        user_login TEXT,
        user_token_enc TEXT,
        user_token_expires_at TIMESTAMPTZ,
        user_refresh_enc TEXT,
        user_refresh_expires_at TIMESTAMPTZ,
        user_refresh_claim TEXT,
        user_refresh_claim_expires_at TIMESTAMPTZ,
        fine_grained_enc TEXT,
        fine_grained_last4 TEXT,
        fine_grained_expires_at TIMESTAMPTZ,
        classic_enc TEXT,
        classic_scopes TEXT[],
        classic_last4 TEXT,
        plan_name TEXT,
        production_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        spend_limit_cents INTEGER NOT NULL DEFAULT 0,
        spend_limit_explicit BOOLEAN NOT NULL DEFAULT FALSE,
        is_default BOOLEAN NOT NULL DEFAULT FALSE,
        is_scratch BOOLEAN NOT NULL DEFAULT FALSE,
        added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        checked_at TIMESTAMPTZ
      )`;
      // Additive and rerunnable: existing I/U/K credentials and account policy stay intact.
      await sql`ALTER TABLE gh_accounts ADD COLUMN IF NOT EXISTS package_enc TEXT,
        ADD COLUMN IF NOT EXISTS package_scopes TEXT[],
        ADD COLUMN IF NOT EXISTS package_actor TEXT,
        ADD COLUMN IF NOT EXISTS package_expires_at TIMESTAMPTZ`;
      // CAP-3 owner-side optional grant proof contains NO token material.
      // Legacy grants deliberately start unverified; proof lives in this same
      // isolated database namespace and is cleared on any token replacement.
      await sql`ALTER TABLE gh_accounts ADD COLUMN IF NOT EXISTS additional_credential_proofs
        JSONB NOT NULL DEFAULT '{}'::jsonb`;
      // Coordinate one-use GitHub OAuth refresh without deleting existing credentials.
      await sql`ALTER TABLE gh_accounts ADD COLUMN IF NOT EXISTS user_refresh_claim TEXT,
        ADD COLUMN IF NOT EXISTS user_refresh_claim_expires_at TIMESTAMPTZ`;
      // Existing default-zero values were builder policy, not customer-selected limits.
      // Distinguish a user-selected restriction from the legacy default without
      // discarding positive caps that were deliberately configured.
      await sql`ALTER TABLE gh_accounts ADD COLUMN IF NOT EXISTS spend_limit_explicit BOOLEAN NOT NULL DEFAULT FALSE`;
      // GOD-5 "extra places": a row with credential_kind = 'master' is an organization or repositories reached with the person's
      // master token where the App is not installed. Changes start OFF; allowed_repos NULL means the whole owner.
      await sql`ALTER TABLE gh_accounts ADD COLUMN IF NOT EXISTS allow_changes BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS allowed_repos TEXT[]`;
      await sql`CREATE TABLE IF NOT EXISTS gh_installation_tokens (
        installation_id BIGINT NOT NULL,
        scope_key TEXT NOT NULL,
        token_enc TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (installation_id, scope_key)
      )`;
      await sql`CREATE TABLE IF NOT EXISTS setup_states (
        state TEXT PRIMARY KEY,
        purpose TEXT NOT NULL,
        account_hint TEXT,
        code_verifier_enc TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL
      )`;
      await sql`CREATE TABLE IF NOT EXISTS oauth_clients (
        client_id TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS oauth_codes (
        code TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        data JSONB NOT NULL,
        default_account TEXT,
        accounts TEXT[],
        mode TEXT NOT NULL DEFAULT 'preview',
        profile TEXT NOT NULL DEFAULT 'everyday',
        listing TEXT NOT NULL DEFAULT 'catalog',
        expires_at TIMESTAMPTZ NOT NULL
      )`;
      await sql`CREATE TABLE IF NOT EXISTS oauth_tokens (
        token_hash TEXT PRIMARY KEY,
        client_id TEXT,
        refresh_hash TEXT,
        default_account TEXT,
        accounts TEXT[],
        mode TEXT NOT NULL DEFAULT 'preview',
        profile TEXT NOT NULL DEFAULT 'everyday',
        listing TEXT NOT NULL DEFAULT 'catalog',
        kind TEXT NOT NULL DEFAULT 'connector',
        expires_at TIMESTAMPTZ,
        last_used_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      // PUB-5 C: the refresh token before the current one; showing it again means it was copied, and ends the sign-in.
      await sql`ALTER TABLE oauth_tokens ADD COLUMN IF NOT EXISTS prev_refresh_hash TEXT`;
      await sql`ALTER TABLE oauth_tokens ADD COLUMN IF NOT EXISTS rotated_at TIMESTAMPTZ`;
      await sql`CREATE TABLE IF NOT EXISTS rtc_pass_rate (
        token_hash TEXT PRIMARY KEY,
        window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
        hit_count INTEGER NOT NULL DEFAULT 0
      )`;
      await sql`CREATE TABLE IF NOT EXISTS rtc_pass_scopes (
        token_hash TEXT PRIMARY KEY,
        areas TEXT[] NOT NULL DEFAULT ARRAY['server','meta'],
        allow_writes BOOLEAN NOT NULL DEFAULT FALSE,
        production_access BOOLEAN NOT NULL DEFAULT FALSE,
        money_limit_cents BIGINT NOT NULL DEFAULT 0,
        CHECK (allow_writes = FALSE),
        CHECK (production_access = FALSE),
        CHECK (money_limit_cents = 0),
        CHECK (array_length(areas,1) = 2 AND areas @> ARRAY['server','meta']::text[])
      )`;
      // R-2: the request budget is stored per pass and read from the pass row on every call (never hard-coded).
      // R-1: what a scoped pass may do. Its profile and mode are copied here so the database itself refuses a read-only pass that can
      // write, an access/spend allowance without writes, or a production pass that cannot change anything.
      await sql`CREATE TABLE IF NOT EXISTS rtc_pass_grants (
        token_hash TEXT PRIMARY KEY,
        profile TEXT NOT NULL CHECK (profile IN ('read_only','everyday','full')),
        mode TEXT NOT NULL CHECK (mode IN ('preview','production')),
        areas TEXT[],
        repos TEXT[],
        allow_writes BOOLEAN NOT NULL DEFAULT FALSE,
        allow_access_changes BOOLEAN NOT NULL DEFAULT FALSE,
        money_limit_cents BIGINT NOT NULL DEFAULT 0 CHECK (money_limit_cents >= 0),
        for_hub BOOLEAN NOT NULL DEFAULT FALSE,
        CHECK (profile <> 'read_only' OR (allow_writes = FALSE AND allow_access_changes = FALSE AND money_limit_cents = 0)),
        CHECK (allow_writes OR (allow_access_changes = FALSE AND money_limit_cents = 0)),
        CHECK (mode <> 'production' OR allow_writes)
      )`;
      await sql`ALTER TABLE rtc_pass_scopes ADD COLUMN IF NOT EXISTS rate_limit_per_minute INTEGER NOT NULL DEFAULT 120
        CHECK (rate_limit_per_minute BETWEEN 1 AND 600)`;
      await sql`CREATE TABLE IF NOT EXISTS login_attempts (
        id BIGSERIAL PRIMARY KEY,
        ip TEXT NOT NULL,
        attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        success BOOLEAN NOT NULL
      )`;
      await sql`CREATE TABLE IF NOT EXISTS change_log (
        id BIGSERIAL PRIMARY KEY,
        at TIMESTAMPTZ NOT NULL DEFAULT now(),
        account TEXT,
        repo TEXT,
        mode TEXT,
        connection TEXT,
        tool TEXT NOT NULL,
        target TEXT,
        summary TEXT NOT NULL,
        before JSONB,
        after JSONB,
        dry_run BOOLEAN NOT NULL DEFAULT FALSE,
        confirmed BOOLEAN,
        production BOOLEAN NOT NULL DEFAULT FALSE,
        access_widening BOOLEAN NOT NULL DEFAULT FALSE,
        notifies TEXT[],
        spend_cents BIGINT,
        request_key TEXT,
        github_request_id TEXT,
        inverse JSONB,
        undone_by BIGINT
      )`;
      // GOD-6: who GitHub recorded as acting ('you' = the person's own token, 'app', 'mixed'); null before this existed.
      await sql`ALTER TABLE change_log ADD COLUMN IF NOT EXISTS acted_as TEXT`;
      await sql`CREATE INDEX IF NOT EXISTS change_log_request_key ON change_log (request_key, at)`;
      // One real (non-preview) write per request key, enforced by the database so two instances cannot both claim it (B-1).
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS change_log_request_once ON change_log (request_key) WHERE dry_run = FALSE AND request_key IS NOT NULL`;
      // C-16: durable connection-scoped sequential write intent/receipts.
      // Only the intent SHA-256 and safe per-item read-back references are stored;
      // no original arguments, source bytes, user text or credentials.
      await sql`CREATE TABLE IF NOT EXISTS gh_write_batches (
        batch_id TEXT PRIMARY KEY,
        connection TEXT NOT NULL,
        account TEXT NOT NULL,
        intent_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running'
          CHECK (status IN ('running','partial','complete','uncertain')),
        lease_id TEXT,
        lease_until TIMESTAMPTZ,
        items JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      await sql`CREATE INDEX IF NOT EXISTS gh_write_batches_scope
        ON gh_write_batches (connection, account, status)`;
      await sql`CREATE TABLE IF NOT EXISTS one_time_secrets (
        id TEXT PRIMARY KEY,
        account TEXT,
        kind TEXT NOT NULL,
        ciphertext TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL,
        viewed_at TIMESTAMPTZ
      )`;
      await sql`CREATE TABLE IF NOT EXISTS gh_rate_state (
        account TEXT NOT NULL,
        resource TEXT NOT NULL,
        remaining INTEGER,
        reset_at TIMESTAMPTZ,
        blocked_until TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (account, resource)
      )`;
      await sql`CREATE TABLE IF NOT EXISTS gh_write_slots (
        installation_key TEXT PRIMARY KEY,
        next_write_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS gh_etag_cache (
        account TEXT NOT NULL,
        url_key TEXT NOT NULL,
        etag TEXT NOT NULL,
        body JSONB NOT NULL,
        stored_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (account, url_key)
      )`;
      await sql`CREATE TABLE IF NOT EXISTS server_settings (
        setting TEXT PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS protected_resources (
        kind TEXT NOT NULL,
        target TEXT NOT NULL,
        level TEXT NOT NULL,
        reason TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (kind, target)
      )`;
      // P-1: versioned optional policy profiles; seed ON CONFLICT DO NOTHING so owner
      // edits are never silently replaced by a deployment.
      await sql`CREATE TABLE IF NOT EXISTS known_projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active','draft','retired')),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
        profile JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      // Big results kept behind a handle for 24 hours, readable only by the connection that made them (C-1).
      await sql`CREATE TABLE IF NOT EXISTS result_store (
        handle TEXT PRIMARY KEY,
        connection TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL,
        summary TEXT,
        body JSONB NOT NULL
      )`;
      await sql`CREATE INDEX IF NOT EXISTS result_store_expires ON result_store (expires_at)`;
      // Slow GitHub operations that finish later (Y-8): who started it, what it is waiting for, and where the result will be kept.
      await sql`CREATE TABLE IF NOT EXISTS gh_async_jobs (
        id TEXT PRIMARY KEY,
        connection_id TEXT NOT NULL,
        owner TEXT NOT NULL,
        repo TEXT,
        kind TEXT NOT NULL,
        provider_ref TEXT,
        state TEXT NOT NULL DEFAULT 'pending',
        result_handle TEXT,
        detail TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_polled_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ NOT NULL
      )`;
      await sql`CREATE INDEX IF NOT EXISTS gh_async_jobs_connection_idx ON gh_async_jobs (connection_id, state)`;
      // A secret the owner will type on the setup page (G-3): who it is for and where it goes, never the value itself.
      await sql`CREATE TABLE IF NOT EXISTS secret_entry_requests (
        id TEXT PRIMARY KEY,
        account TEXT NOT NULL,
        scope JSONB NOT NULL,
        mode TEXT NOT NULL,
        connection TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL,
        completed_at TIMESTAMPTZ
      )`;
      await sql`CREATE TABLE IF NOT EXISTS dev_runs (
        id TEXT PRIMARY KEY,
        account TEXT NOT NULL,
        connection TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        scenarios TEXT[] NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        status TEXT NOT NULL DEFAULT 'active',
        cleaned_at TIMESTAMPTZ
      )`;
      await sql`CREATE INDEX IF NOT EXISTS dev_runs_scope ON dev_runs (account, connection, created_at DESC)`;
      await sql`CREATE TABLE IF NOT EXISTS dev_run_objects (
        run_id TEXT NOT NULL REFERENCES dev_runs(id),
        object_type TEXT NOT NULL,
        owner TEXT NOT NULL,
        repo TEXT,
        object_id TEXT NOT NULL,
        created_sha TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        cleaned BOOLEAN NOT NULL DEFAULT FALSE,
        PRIMARY KEY (run_id, object_type, owner, object_id)
      )`;
      await sql`CREATE INDEX IF NOT EXISTS dev_run_objects_pending ON dev_run_objects (run_id, cleaned)`;
      await sql`CREATE TABLE IF NOT EXISTS dev_run_intents (
        run_id TEXT NOT NULL REFERENCES dev_runs(id),
        step_id TEXT NOT NULL,
        object_type TEXT NOT NULL,
        owner TEXT NOT NULL,
        repo TEXT,
        object_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'claimed' CHECK (status IN ('claimed', 'uncertain', 'recorded')),
        object_id TEXT,
        created_sha TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (run_id, step_id)
      )`;
      await sql`CREATE TABLE IF NOT EXISTS dev_repo_birth_labels (
        run_id TEXT PRIMARY KEY REFERENCES dev_runs(id),
        owner TEXT NOT NULL,
        repo TEXT NOT NULL,
        source_sha TEXT NOT NULL CHECK (source_sha ~ '^[a-f0-9]{40}$'),
        labels JSONB NOT NULL,
        captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CHECK (jsonb_typeof(labels) = 'array')
      )`;
      await sql`CREATE TABLE IF NOT EXISTS dev_forwarders (
        id TEXT PRIMARY KEY CHECK (id ~ '^fwd_[A-Za-z0-9_-]{16}$'),
        account TEXT NOT NULL,
        connection TEXT NOT NULL,
        url TEXT NOT NULL,
        events TEXT[] NOT NULL DEFAULT '{}',
        secret_enc TEXT NOT NULL,
        run_id TEXT,
        repo TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_used_at TIMESTAMPTZ
      )`;
      await sql`CREATE INDEX IF NOT EXISTS dev_forwarders_scope ON dev_forwarders (account, connection, created_at)`;
      await sql`CREATE TABLE IF NOT EXISTS dev_cleanup_executions (
        run_id TEXT PRIMARY KEY REFERENCES dev_runs(id),
        executor_id UUID NOT NULL,
        acquired_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
    },

    /** Keeps a big result behind a handle. Also deletes up to 100 expired rows (no cron). */
    async putResult({ handle, connection, summary = null, body, ttlSeconds = 86400 }) {
      if (!RESULT_HANDLE.test(handle ?? '')) throw new TypeError('A result handle looks like res_ followed by letters and digits.');
      if (typeof connection !== 'string' || !connection) throw new TypeError('A result belongs to a connection.');
      await sql`DELETE FROM result_store WHERE handle IN (SELECT handle FROM result_store WHERE expires_at < now() LIMIT 100)`;
      await sql`INSERT INTO result_store (handle, connection, expires_at, summary, body)
        VALUES (${handle}, ${connection}, now() + make_interval(secs => ${ttlSeconds}), ${summary === null ? null : redact(String(summary)).slice(0, 500)}, ${JSON.stringify(body)}::jsonb)`;
    },
    /** The kept result, only for the connection that made it and only while it has not expired. */
    async getResult(handle, connection) {
      if (!RESULT_HANDLE.test(handle ?? '') || typeof connection !== 'string' || !connection) return null;
      const rows = await sql`SELECT handle, summary, body, created_at, expires_at FROM result_store WHERE handle = ${handle} AND connection = ${connection} AND expires_at > now()`;
      return rows[0] ?? null;
    },

    /** Starts tracking a slow GitHub operation (Y-8). Also deletes up to 100 expired jobs (no cron). */
    async createJob({ id, connection, owner, repo = null, kind, providerRef = null, ttlMinutes = 1440 }) {
      if (!JOB_ID.test(id ?? '')) throw new TypeError('A job id looks like job_ followed by 16 hex digits.');
      if (typeof connection !== 'string' || !connection || typeof owner !== 'string' || !owner || typeof kind !== 'string' || !kind) throw new TypeError('A job needs a connection, an owner and a kind.');
      await sql`DELETE FROM gh_async_jobs WHERE id IN (SELECT id FROM gh_async_jobs WHERE expires_at < now() LIMIT 100)`;
      const rows = await sql`INSERT INTO gh_async_jobs (id, connection_id, owner, repo, kind, provider_ref, expires_at)
        VALUES (${id}, ${connection}, ${owner}, ${repo}, ${kind}, ${providerRef === null ? null : String(providerRef).slice(0, 200)}, now() + make_interval(mins => ${ttlMinutes}))
        RETURNING id, connection_id, owner, repo, kind, provider_ref, state, result_handle, detail, created_at, updated_at, last_polled_at, expires_at`;
      return rows[0];
    },
    /** The job, only for the connection that started it and only while it has not expired. */
    async getJob(id, connection) {
      if (!JOB_ID.test(id ?? '') || typeof connection !== 'string' || !connection) return null;
      const rows = await sql`SELECT id, connection_id, owner, repo, kind, provider_ref, state, result_handle, detail, created_at, updated_at, last_polled_at, expires_at
        FROM gh_async_jobs WHERE id = ${id} AND connection_id = ${connection} AND expires_at > now()`;
      return rows[0] ?? null;
    },
    /** Connection-bound native workspace inventory; metadata is reauthorized before tools return it. */
    async listNativeGitWorkspaces(connection, { after = null, limit = 10 } = {}) {
      if (typeof connection !== 'string' || !connection) return [];
      if (after !== null && !JOB_ID.test(after) || !Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new TypeError('Invalid workspace inventory page.');
      return sql`SELECT id, owner, repo, expires_at FROM gh_async_jobs
        WHERE connection_id = ${connection} AND kind = 'native-git-workspace' AND state = 'pending' AND expires_at > now() AND (${after}::text IS NULL OR id > ${after})
        ORDER BY id LIMIT ${limit + 1}`;
    },

    /** Moves a pending job on (ready, failed or expired). A job that is no longer pending is left alone. Returns the row or null. */
    async finishJob(id, connection, { state, resultHandle = null, detail = null }) {
      if (!['ready', 'failed', 'expired'].includes(state)) throw new TypeError('A job finishes as ready, failed or expired.');
      const rows = await sql`UPDATE gh_async_jobs SET state = ${state}, result_handle = ${resultHandle}, detail = ${detail === null ? null : redact(String(detail)).slice(0, 200)}, updated_at = now()
        WHERE id = ${id} AND connection_id = ${connection} AND state = 'pending' AND expires_at > now()
        RETURNING id, connection_id, owner, repo, kind, provider_ref, state, result_handle, detail, created_at, updated_at, last_polled_at, expires_at`;
      return rows[0] ?? null;
    },
    /** Marks a poll and says whether GitHub may be asked again: true at most once per `minGapSeconds`. */
    async claimJobPoll(id, connection, minGapSeconds = 10) {
      const rows = await sql`UPDATE gh_async_jobs SET last_polled_at = now()
        WHERE id = ${id} AND connection_id = ${connection} AND state = 'pending' AND expires_at > now()
          AND (last_polled_at IS NULL OR last_polled_at <= now() - make_interval(secs => ${minGapSeconds}::float8))
        RETURNING id`;
      return rows.length === 1;
    },

    // Project profile reads fail closed on malformed storage, overlapping scopes
    // or a database error: an absent optional profile is the only neutral state.
    async listKnownProjects() {
      await seedKnownProjects();
      const rows=await sql`SELECT id,name,status,version,profile,updated_at
        FROM known_projects ORDER BY id`;
      return rows.map(storedProject);
    },
    async getKnownProject(id) {
      await seedKnownProjects();
      const rows=await sql`SELECT id,name,status,version,profile,updated_at
        FROM known_projects WHERE id=${id}`;
      return storedProject(rows[0]??null);
    },
    async profileForRepository(owner,repo) {
      await seedKnownProjects();
      const slug=(String(owner)+'/'+String(repo)).toLowerCase();
      const rows=await sql`SELECT id,name,status,version,profile,updated_at
        FROM known_projects WHERE status='active'
          AND profile->'repos' @> ${JSON.stringify([slug])}::jsonb LIMIT 2`;
      if(rows.length>1)throw new Error('Overlapping project policies cannot be resolved safely.');
      return rows.length?storedProject(rows[0]).profile:null;
    },
    // Controlled, optimistic policy update for owner routes; never silently
    // downgrade or overwrite an unexpected revision or immutable seed identity.
    async createKnownProject(profileRaw) {
      await seedKnownProjects();
      const p=validateProjectProfile(profileRaw);
      if(p.status!=='draft')throw new TypeError('New project policies start as drafts; owner activation is separate.');
      const rows=await sql`INSERT INTO known_projects(id,name,status,version,profile)
        VALUES (${p.id},${p.name},'draft',1,${JSON.stringify(p)}::jsonb)
        ON CONFLICT(id) DO NOTHING RETURNING id,name,status,version,profile,updated_at`;
      return storedProject(rows[0]??null);
    },
    async saveKnownProject(profileRaw, expectedVersion) {
      const p=validateProjectProfile(profileRaw);
      if(!Number.isSafeInteger(expectedVersion)||expectedVersion<1)
        throw new TypeError('A known project update needs its exact current version.');
      const rows=await sql`UPDATE known_projects SET
        name=${p.name},status=${p.status},profile=${JSON.stringify(p)}::jsonb,
        version=version+1,updated_at=now()
        WHERE id=${p.id} AND version=${expectedVersion} RETURNING id,name,status,version,profile,updated_at`;
      return storedProject(rows[0]??null);
    },
    /** Names of the tables in the connection's current schema, sorted. */
    async listTables() {
      const rows = await sql`SELECT table_name FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' ORDER BY table_name`;
      return rows.map((row) => row.table_name);
    },

    // ---- Connector login store (A-3a). Codes, tokens and client secrets are stored as SHA-256 hashes only. ----

    async createOAuthClient({ clientId, clientSecret, authMethod = 'client_secret_post', redirectUris, clientName, authorizedAccount = null }) {
      if (!clientId || !['none', 'client_secret_post'].includes(authMethod) ||
          (authMethod === 'none' ? clientSecret !== null : !clientSecret) ||
          !Array.isArray(redirectUris) || !redirectUris.length) {
        throw new TypeError('Missing OAuth client registration fields.');
      }
      if (authorizedAccount !== null && (typeof authorizedAccount !== 'string' ||
          !/^[A-Za-z0-9-]{1,39}$/.test(authorizedAccount)))
        throw new TypeError('Invalid OAuth client account binding.');
      const data = JSON.stringify({ client_secret_hash: clientSecret ? hashToken(clientSecret) : null,
        token_endpoint_auth_method: authMethod, redirect_uris: redirectUris,
        client_name: clientName || null, authorized_account: authorizedAccount?.toLowerCase() ?? null });
      await sql`INSERT INTO oauth_clients (client_id, data) VALUES (${clientId}, ${data}::jsonb)`;
    },

    /** PUB-6: copies an already-registered public client into this tenant's own table. Only the secret's hash is
     * ever known here, never the secret itself. Idempotent; a changed redirect list or secret overwrites. */
    async mirrorOAuthClient({ clientId, secretHash, authMethod = 'client_secret_post', redirectUris, clientName, authorizedAccount }) {
      if (!clientId || !['none', 'client_secret_post'].includes(authMethod) || !/^[a-f0-9]{64}$/.test(String(secretHash)) || !Array.isArray(redirectUris) || !redirectUris.length ||
          (authorizedAccount !== null && (typeof authorizedAccount !== 'string' || !/^[A-Za-z0-9-]{1,39}$/.test(authorizedAccount))))
        throw new TypeError('Invalid OAuth client mirror.');
      const data = JSON.stringify({ client_secret_hash: secretHash,
        token_endpoint_auth_method: authMethod, redirect_uris: redirectUris,
        client_name: clientName || null, authorized_account: authorizedAccount?.toLowerCase() ?? null });
      await sql`INSERT INTO oauth_clients (client_id, data) VALUES (${clientId}, ${data}::jsonb)
        ON CONFLICT (client_id) DO UPDATE SET data = EXCLUDED.data`;
    },

    async getOAuthClient(clientId) {
      const rows = await sql`SELECT client_id, data FROM oauth_clients WHERE client_id = ${clientId}`;
      return rows[0] ? { client_id: rows[0].client_id, ...rows[0].data } : null;
    },
    // Aggregate status for the owner-authenticated setup screen only.
    // Connector tokens are counted separately from preview RTC passes.
    async getConnectorOAuthReadiness() {
      const rows=await sql`SELECT
        (SELECT count(*)::integer FROM oauth_clients) AS registered_clients,
        (SELECT count(*)::integer FROM oauth_tokens
          WHERE kind='connector' AND revoked_at IS NULL) AS unrevoked_sessions,
        (SELECT count(*)::integer FROM oauth_tokens
          WHERE kind='connector' AND revoked_at IS NULL AND expires_at>now()) AS usable_access_tokens,
        (SELECT count(*)::integer FROM oauth_tokens
          WHERE kind='connector' AND revoked_at IS NULL AND refresh_hash IS NOT NULL) AS refresh_credentials`;
      return rows[0];
    },

    async createAuthCode({ code, clientId, redirectUri, codeChallenge, codeChallengeMethod = 'S256', defaultAccount, accounts,
      mode = 'preview', profile = 'everyday', listing = 'catalog', ttlSeconds = 600 }) {
      const connection = checkConnection({ defaultAccount, accounts, mode, profile, listing });
      const data = JSON.stringify({ redirect_uri: redirectUri, code_challenge: codeChallenge, code_challenge_method: codeChallengeMethod });
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
      await sql`INSERT INTO oauth_codes (code, client_id, data, default_account, accounts, mode, profile, listing, expires_at)
        VALUES (${hashToken(code)}, ${clientId}, ${data}::jsonb, ${connection.defaultAccount}, ${connection.accounts}::text[],
          ${connection.mode}, ${connection.profile}, ${connection.listing}, ${expiresAt})`;
    },

    /** Single use: the row is deleted as it is read. Expired codes are refused. */
    async consumeAuthCode(code) {
      if (typeof code !== 'string' || !code) return null;
      const rows = await sql`DELETE FROM oauth_codes WHERE code = ${hashToken(code)} AND expires_at > now()
        RETURNING client_id, data, default_account, accounts, mode, profile, listing`;
      const row = rows[0];
      return row ? { client_id: row.client_id, ...row.data, ...connectionSettings(row) } : null;
    },

    async createAccessToken({ accessToken, refreshToken, clientId, defaultAccount, accounts,
      mode = 'preview', profile = 'everyday', listing = 'catalog', ttlSeconds = 3600 }) {
      const connection = checkConnection({ defaultAccount, accounts, mode, profile, listing });
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
      await sql`INSERT INTO oauth_tokens (token_hash, refresh_hash, client_id, default_account, accounts, mode, profile, listing, expires_at)
        VALUES (${hashToken(accessToken)}, ${refreshToken ? hashToken(refreshToken) : null}, ${clientId}, ${connection.defaultAccount},
          ${connection.accounts}::text[], ${connection.mode}, ${connection.profile}, ${connection.listing}, ${expiresAt})`;
    },

    /** Owner-only RTC pass issuance: existing OAuth table, distinct kind and preview/read_only only. */
    async createRtcPass({pass,account,passId,expiresAt,rateLimitPerMinute=120}) {
      if(!Number.isInteger(rateLimitPerMinute)||rateLimitPerMinute<1||rateLimitPerMinute>600)
        throw new TypeError('The request limit must be a whole number from 1 to 600 per minute.');
      if(!/^rtc_pass_[A-Za-z0-9_-]{43}$/.test(pass)||!/^[a-f0-9]{24}$/.test(passId)||
        typeof account!=='string'||!account||!(expiresAt instanceof Date)||
        !Number.isFinite(expiresAt.getTime())||expiresAt<=new Date()||
        expiresAt>new Date(Date.now()+30*86400000))
        throw new TypeError('Invalid RTC pass scope or expiry.');
      // Single SQL statement: either both the bearer and its immutable restrictive scope
      // exist, or neither exists. A partially configured pass is never usable.
      const rows=await sql`WITH created AS (
        INSERT INTO oauth_tokens
          (token_hash,client_id,default_account,accounts,mode,profile,listing,kind,expires_at)
        SELECT ${hashToken(pass)}, ${'rtc-'+passId}, a.login, ARRAY[a.login], 'preview',
          'read_only','compact','pass',${expiresAt}
        FROM gh_accounts a WHERE a.login=${account} AND a.is_scratch=TRUE
          AND a.production_enabled=FALSE AND a.account_type='Organization'
          AND a.installation_status='active' AND a.repository_selection='all'
        RETURNING token_hash,client_id
      ), scoped AS (
        INSERT INTO rtc_pass_scopes(token_hash,areas,allow_writes,production_access,money_limit_cents,rate_limit_per_minute)
        SELECT token_hash,ARRAY['server','meta'],FALSE,FALSE,0,${rateLimitPerMinute} FROM created
        RETURNING token_hash
      ) SELECT created.client_id FROM created JOIN scoped USING(token_hash)`;
      return rows[0]?.client_id??null;
    },
    /**
     * Owner-only issuance of a scoped service pass. One statement: the bearer, its legacy read-only scope row (so an older server
     * still treats it as read-only), and its grant exist together or not at all. The account must have an active installation;
     * a production pass also needs production turned on for that account. `grant` comes from validateGrant in src/rtc/pass-scope.js.
     */
    async createRtcPassGrant({pass,passId,account,expiresAt,grant}) {
      if(!/^rtc_pass_[A-Za-z0-9_-]{43}$/.test(pass)||!/^[a-f0-9]{24}$/.test(passId)||
        typeof account!=='string'||!account||!(expiresAt instanceof Date)||
        !Number.isFinite(expiresAt.getTime())||expiresAt<=new Date()||
        expiresAt>new Date(Date.now()+(grant?.forHub===true?365:30)*86400000)||!grant||
        !['read_only','everyday','full'].includes(grant.profile)||!['preview','production'].includes(grant.mode)||
        !Number.isInteger(grant.ratePerMinute)||grant.ratePerMinute<1||grant.ratePerMinute>600||
        !Number.isSafeInteger(grant.moneyLimitCents)||grant.moneyLimitCents<0)
        throw new TypeError('Invalid RTC pass grant or expiry.');
      const rows=await sql`WITH created AS (
        INSERT INTO oauth_tokens
          (token_hash,client_id,default_account,accounts,mode,profile,listing,kind,expires_at)
        SELECT ${hashToken(pass)}, ${'rtc-'+passId}, a.login, ARRAY[a.login], ${grant.mode},
          ${grant.profile},'compact','pass',${expiresAt}
        FROM gh_accounts a WHERE a.login=${account} AND a.installation_status='active'
          AND (${grant.mode==='preview'} OR a.production_enabled=TRUE)
        RETURNING token_hash,client_id
      ), legacy AS (
        INSERT INTO rtc_pass_scopes(token_hash,areas,allow_writes,production_access,money_limit_cents,rate_limit_per_minute)
        SELECT token_hash,ARRAY['server','meta'],FALSE,FALSE,0,${grant.ratePerMinute} FROM created
        RETURNING token_hash
      ), granted AS (
        INSERT INTO rtc_pass_grants(token_hash,profile,mode,areas,repos,allow_writes,allow_access_changes,money_limit_cents,for_hub)
        SELECT token_hash,${grant.profile},${grant.mode},${grant.areas}::text[],${grant.repos}::text[],
          ${grant.allowWrites},${grant.allowAccessChanges},${grant.moneyLimitCents},${grant.forHub===true} FROM created
        RETURNING token_hash
      ) SELECT created.client_id FROM created JOIN legacy USING(token_hash) JOIN granted USING(token_hash)`;
      return rows[0]?.client_id??null;
    },
    /** Unknown, expired and revoked are distinct but no token bytes are returned. */
    async getRtcPass(pass) {
      if(!/^rtc_pass_[A-Za-z0-9_-]{43}$/.test(pass))return null;
      const rows=await sql`SELECT t.client_id,t.default_account,t.accounts,t.mode,t.profile,t.listing,
        t.expires_at,t.revoked_at,s.areas,s.allow_writes,s.production_access,s.money_limit_cents,
        s.rate_limit_per_minute,
        g.token_hash IS NOT NULL AS has_grant,g.areas AS grant_areas,g.repos AS grant_repos,
        g.allow_writes AS grant_allow_writes,g.allow_access_changes AS grant_allow_access_changes,
        g.money_limit_cents AS grant_money_limit_cents,g.for_hub AS grant_for_hub
        FROM oauth_tokens t JOIN rtc_pass_scopes s ON s.token_hash=t.token_hash
        LEFT JOIN rtc_pass_grants g ON g.token_hash=t.token_hash
        WHERE t.token_hash=${hashToken(pass)} AND t.kind='pass'`;
      const row=rows[0];
      if(!row)return null;
      const {has_grant,grant_areas,grant_repos,grant_allow_writes,grant_allow_access_changes,grant_money_limit_cents,grant_for_hub,...rest}=row;
      return has_grant?{...rest,grant:{areas:grant_areas,repos:grant_repos,allow_writes:grant_allow_writes,
        allow_access_changes:grant_allow_access_changes,money_limit_cents:grant_money_limit_cents,for_hub:grant_for_hub}}:rest;
    },
    async revokeRtcPass(passId) {
      if(!/^[a-f0-9]{24}$/.test(passId))throw new TypeError('Invalid pass identifier.');
      const rows=await sql`UPDATE oauth_tokens SET revoked_at=now()
        WHERE client_id=${'rtc-'+passId} AND kind='pass' AND revoked_at IS NULL
        RETURNING client_id`;
      return rows.length===1;
    },
    /**
     * Atomic per-pass budget across serverless instances, never a process counter. The limit is read from the pass's own
     * scope row inside the same statement that counts the call, so a changed limit applies at once and a read-then-update
     * race cannot admit extra calls. A pass without a scope row gets the 120 per minute default.
     */
    async consumeRtcPassRate(pass) {
      if(!/^rtc_pass_[A-Za-z0-9_-]{43}$/.test(pass))
        throw new TypeError('Invalid RTC pass rate check.');
      const hash=hashToken(pass);
      const rows=await sql`INSERT INTO rtc_pass_rate (token_hash,window_start,hit_count)
        VALUES (${hash},now(),1)
        ON CONFLICT (token_hash) DO UPDATE SET
          window_start=CASE WHEN rtc_pass_rate.window_start<=now()-interval '1 minute'
            THEN now() ELSE rtc_pass_rate.window_start END,
          hit_count=CASE WHEN rtc_pass_rate.window_start<=now()-interval '1 minute'
            THEN 1 ELSE rtc_pass_rate.hit_count+1 END
        RETURNING hit_count,
          COALESCE((SELECT rate_limit_per_minute FROM rtc_pass_scopes WHERE token_hash=${hash}),120) AS allowed`;
      return rows[0].hit_count<=rows[0].allowed;
    },
    async getAccessToken(accessToken) {
      if (typeof accessToken !== 'string' || !accessToken) return null;
      const rows = await sql`SELECT client_id, default_account, accounts, mode, profile, listing, kind, expires_at
        FROM oauth_tokens WHERE token_hash = ${hashToken(accessToken)} AND expires_at > now() AND revoked_at IS NULL AND kind = 'connector'`;
      const row = rows[0];
      if (!row) return null;
      // "Last used" for the connections list, at most once a minute per token; a failure here never fails the request.
      await sql`UPDATE oauth_tokens SET last_used_at = now() WHERE token_hash = ${hashToken(accessToken)} AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')`.catch(() => {});
      return { client_id: row.client_id, kind: row.kind, expires_at: row.expires_at, ...connectionSettings(row) };
    },

    /** Every live connector login and service pass, newest first, without any token or hash. */
    async listConnections() {
      const rows = await sql`SELECT t.client_id, c.data->>'client_name' AS client_name, t.kind, t.default_account, t.accounts, t.mode, t.profile, t.listing,
          t.expires_at, t.last_used_at, t.created_at, COALESCE(g.areas, s.areas) AS pass_areas, g.repos AS pass_repos,
          COALESCE(g.allow_writes, s.allow_writes) AS pass_allow_writes, g.allow_access_changes AS pass_allow_access_changes,
          COALESCE(g.mode = 'production', s.production_access) AS pass_production_access, g.money_limit_cents AS pass_money_limit,
          s.rate_limit_per_minute AS pass_rate_limit
        FROM oauth_tokens t LEFT JOIN oauth_clients c ON c.client_id = t.client_id
        LEFT JOIN rtc_pass_scopes s ON s.token_hash = t.token_hash AND t.kind = 'pass'
        LEFT JOIN rtc_pass_grants g ON g.token_hash = t.token_hash AND t.kind = 'pass'
        WHERE t.kind IN ('connector','pass') AND t.revoked_at IS NULL AND t.expires_at > now() ORDER BY t.created_at DESC`;
      return rows.map((r) => ({ client_id: r.client_id, client_name: r.client_name ?? null, kind: r.kind, default_account: r.default_account, accounts: r.accounts ?? [], mode: r.mode, profile: r.profile,
        listing: r.listing, expires_at: r.expires_at, last_used_at: r.last_used_at ?? null, created_at: r.created_at,
        ...(r.kind === 'pass' ? { pass: { areas: r.pass_areas ?? [], repos: r.pass_repos ?? null, allow_writes: r.pass_allow_writes === true, allow_access_changes: r.pass_allow_access_changes === true, production_access: r.pass_production_access === true, spend_allowance_cents: r.pass_money_limit == null ? 0 : Number(r.pass_money_limit), rate_limit_per_minute: r.pass_rate_limit ?? null } } : {}) }));
    },
    /** Owner setup-page connection inventory: an expired access bearer remains usable through
     * its live refresh credential. This endpoint never returns bearer or refresh material. */
    async listUpgradeableConnections() {
      const rows = await sql`SELECT t.client_id, c.data->>'client_name' AS client_name, t.kind,
          t.default_account, t.accounts, t.mode, t.profile, t.listing, t.expires_at, t.created_at
        FROM oauth_tokens t LEFT JOIN oauth_clients c ON c.client_id = t.client_id
        WHERE t.kind = 'connector' AND t.revoked_at IS NULL
          AND (t.expires_at > now() OR t.refresh_hash IS NOT NULL)
        ORDER BY t.created_at DESC`;
      return rows.map((r) => ({ client_id: r.client_id, client_name: r.client_name ?? null,
        kind: r.kind, default_account: r.default_account, accounts: r.accounts ?? [],
        mode: r.mode, profile: r.profile, listing: r.listing, expires_at: r.expires_at,
        created_at: r.created_at }));
    },
    /** Switches off every live token of one connector login. Returns how many were switched off. */
    async revokeConnection(clientId) {
      const rows = await sql`UPDATE oauth_tokens SET revoked_at = now() WHERE client_id = ${clientId} AND kind IN ('connector','pass') AND revoked_at IS NULL RETURNING token_hash`;
      return rows.length;
    },
    /** "Add an account later without reconnecting": every live connector login gains these accounts (up to ten per
     * connection). A connection that may make changes gains only accounts whose changes are switched on, so it never
     * silently covers an account in a weaker state. Returns how many logins changed. */
    async addAccountsToConnections(logins) {
      const wanted = [...new Set((Array.isArray(logins) ? logins : []).map((l) => String(l).toLowerCase()))]
        .filter((l) => /^[a-z0-9][a-z0-9-]{0,38}$/.test(l));
      if (!wanted.length) return 0;
      const ready = (await sql`SELECT lower(login) AS login, production_enabled, credential_kind, allow_changes FROM gh_accounts
        WHERE lower(login) = ANY(${wanted}::text[]) AND (installation_status = 'active' OR credential_kind = 'master')`);
      // An extra place always joins (its own gate keeps every change refused until the person allows changes for that place).
      const places = new Set(ready.filter((r) => r.credential_kind === 'master').map((r) => r.login));
      const all = ready.map((r) => r.login), changes = ready.filter((r) => (r.credential_kind === 'master' || r.production_enabled === true)).map((r) => r.login);
      const rows = await sql`SELECT token_hash, accounts, mode, profile, client_id FROM oauth_tokens
        WHERE kind = 'connector' AND revoked_at IS NULL AND (expires_at > now() OR refresh_hash IS NOT NULL)`;
      let changed = 0;
      for (const row of rows) {
        const have = (row.accounts ?? []).map((a) => String(a).toLowerCase());
        // Extra places only join the person's own multi-account (public sign-in) connections, never a single-account signed client.
        const add = (row.mode === 'production' && row.profile !== 'full' ? changes : all).filter((l) => !have.includes(l) && (!places.has(l) || String(row.client_id ?? '').startsWith('pcl_')));
        const next = [...(row.accounts ?? []), ...add].slice(0, 10);
        if (next.length === (row.accounts ?? []).length) continue;
        await sql`UPDATE oauth_tokens SET accounts = ${next}::text[] WHERE token_hash = ${row.token_hash} AND revoked_at IS NULL`;
        changed++;
      }
      return changed;
    },
    /** "Read-only" switch for all of this store's live connector logins (refreshable ones included).
     * Read-only uses the read_only profile, which refuses every change tool, plus preview mode. Allowing changes again
     * restores the full profile; production mode returns where every account has an active provider connection.
     * Returns how many logins changed. */
    async setConnectionsReadOnly(readOnly) {
      if (readOnly === true) {
        const rows = await sql`UPDATE oauth_tokens SET mode = 'preview', profile = 'read_only'
          WHERE kind = 'connector' AND revoked_at IS NULL AND (expires_at > now() OR refresh_hash IS NOT NULL) RETURNING token_hash`;
        return rows.length;
      }
      if (readOnly !== false) return 0;
      const rows = await sql`UPDATE oauth_tokens t SET profile = 'full',
          mode = CASE WHEN cardinality(t.accounts) > 0 AND NOT EXISTS (SELECT 1 FROM unnest(t.accounts) acct WHERE NOT EXISTS (
            SELECT 1 FROM gh_accounts a WHERE lower(a.login) = lower(acct) AND (a.credential_kind = 'master' OR a.installation_status = 'active')))
            THEN 'production' ELSE 'preview' END
        WHERE t.kind = 'connector' AND t.revoked_at IS NULL AND (t.expires_at > now() OR t.refresh_hash IS NOT NULL)
        RETURNING token_hash`;
      return rows.length;
    },
    /** Changes the default account of one connector login's live tokens (the account must already be in each token's list). Returns how many changed. */
    async setConnectionDefaultAccount(clientId, login) {
      const rows = await sql`UPDATE oauth_tokens SET default_account = ${login} WHERE client_id = ${clientId} AND kind = 'connector' AND revoked_at IS NULL AND ${login} = ANY(accounts) RETURNING token_hash`;
      return rows.length;
    },
    /** Atomically upgrade the owner's already-authorized, single-account FULL/PREVIEW connector.
     * A mixed-client grant or disconnected/expired credential fails closed; old production/scratch preferences do not restrict a full owner.
     * No access or refresh token changes, and refresh preserves the upgraded row mode.
     */
    async upgradeConnectionProductionMode(clientId, account) {
      if (typeof clientId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(clientId) ||
          typeof account !== 'string' || !/^[A-Za-z0-9-]{1,39}$/.test(account)) return 0;
      const rows = await sql`UPDATE oauth_tokens SET mode = 'production'
        WHERE client_id = ${clientId} AND kind = 'connector' AND revoked_at IS NULL
          AND mode = 'preview' AND profile = 'full'
          AND lower(default_account) = lower(${account}) AND accounts = ARRAY[${account}]::text[]
          AND (expires_at > now() OR refresh_hash IS NOT NULL)
          AND EXISTS (SELECT 1 FROM gh_accounts a WHERE lower(a.login) = lower(${account})
            AND (
              (a.credential_kind = 'app' AND a.installation_status = 'active' AND a.installation_id IS NOT NULL)
              OR (a.credential_kind = 'fine_grained' AND a.fine_grained_enc IS NOT NULL
                AND (a.fine_grained_expires_at IS NULL OR a.fine_grained_expires_at > now()))))
          AND NOT EXISTS (SELECT 1 FROM oauth_tokens other
            WHERE other.client_id = ${clientId} AND other.kind = 'connector' AND other.revoked_at IS NULL
              AND (other.expires_at > now() OR other.refresh_hash IS NOT NULL)
              AND (other.mode <> 'preview' OR other.profile <> 'full'
                   OR lower(other.default_account) <> lower(${account}) OR other.accounts <> ARRAY[${account}]::text[]))
        RETURNING token_hash`;
      return rows.length;
    },
    /** Change-log rows, newest first. Previews (dry runs) are left out unless asked for. */
    async listChanges({ repo = null, tool = null, account = null, accounts = null, since = null, includePreviews = false, limit = 20 } = {}) {
      const only = Array.isArray(accounts) ? accounts.map((a) => String(a).toLowerCase()) : null;
      const max = Math.min(Math.max(Number.isInteger(limit) ? limit : 20, 1), 100);
      const rows = await sql`SELECT * FROM change_log
        WHERE (${repo}::text IS NULL OR lower(repo) = lower(${repo})) AND (${tool}::text IS NULL OR tool = ${tool}) AND (${account}::text IS NULL OR lower(account) = lower(${account})) AND (${only}::text[] IS NULL OR lower(account) = ANY(${only}::text[]))
          AND (${since}::timestamptz IS NULL OR at >= ${since}::timestamptz) AND (${includePreviews === true} OR dry_run = FALSE) ORDER BY id DESC LIMIT ${max}`;
      return rows.map((r) => ({ ...changeView(r), accessWidening: r.access_widening === true }));
    },

    async getTokenByRefreshToken(refreshToken) {
      if (typeof refreshToken !== 'string' || !refreshToken) return null;
      const rows = await sql`SELECT client_id, default_account, accounts, mode, profile, listing
        FROM oauth_tokens WHERE refresh_hash = ${hashToken(refreshToken)} AND revoked_at IS NULL AND kind = 'connector'`;
      const row = rows[0];
      return row ? { client_id: row.client_id, ...connectionSettings(row) } : null;
    },

    /**
     * One atomic UPDATE on the same row, for the same client only: a refresh credential works once even when two requests
     * race, and every connection setting stays on the row it was issued with (nothing is copied from a default).
     */
    async rotateRefreshToken({ refreshToken, clientId, accessToken, newRefreshToken, ttlSeconds = 3600 }) {
      if (typeof refreshToken !== 'string' || !refreshToken || !clientId) return null;
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
      const rows = await sql`UPDATE oauth_tokens SET token_hash = ${hashToken(accessToken)}, prev_refresh_hash = refresh_hash, rotated_at = now(), refresh_hash = ${hashToken(newRefreshToken)},
        expires_at = ${expiresAt}, last_used_at = NULL
        WHERE refresh_hash = ${hashToken(refreshToken)} AND client_id = ${clientId} AND revoked_at IS NULL AND kind = 'connector'
        RETURNING client_id, default_account, accounts, mode, profile, listing`;
      const row = rows[0];
      if (!row) {
        // An already-used refresh token shown again: someone kept a copy. End that whole sign-in (access and refresh both stop).
        // Within a minute of the rotation it is just two refreshes racing from the same app: refused, but the sign-in lives.
        await sql`UPDATE oauth_tokens SET revoked_at = now()
          WHERE prev_refresh_hash = ${hashToken(refreshToken)} AND client_id = ${clientId} AND revoked_at IS NULL AND kind = 'connector'
            AND rotated_at < now() - interval '60 seconds'`;
        return null;
      }
      return { client_id: row.client_id, ...connectionSettings(row) };
    },

    async revokeAccessToken(accessToken) {
      if (typeof accessToken !== 'string' || !accessToken) return false;
      const rows = await sql`UPDATE oauth_tokens SET revoked_at = now()
        WHERE token_hash = ${hashToken(accessToken)} AND revoked_at IS NULL RETURNING token_hash`;
      return rows.length > 0;
    },

    async recordLoginAttempt(ip) {
      const rows = await sql`INSERT INTO login_attempts (ip, success) VALUES (${ip}, FALSE) RETURNING id`;
      return rows[0].id;
    },

    async markLoginAttemptSucceeded(id) {
      await sql`UPDATE login_attempts SET success = TRUE WHERE id = ${id}`;
    },

    async countRecentFailedLogins(ip, minutes = 15) {
      const rows = await sql`SELECT count(*)::integer AS count FROM login_attempts
        WHERE ip = ${ip} AND success = FALSE AND attempted_at > now() - ${minutes} * interval '1 minute'`;
      return rows[0].count;
    },

    // ---- GitHub Apps, accounts and credentials (A-5a). Values named *_enc are ciphertext made by src/github/credentials.js. ----

    /** Stores (or replaces) the GitHub App returned by the manifest flow. Secrets arrive already encrypted. */
    async saveApp({ id, slug, ownerLogin, ownerType, clientId, clientSecretEnc, privateKeyEnc, webhookSecretEnc, permissions }) {
      await sql`INSERT INTO gh_apps (id, slug, owner_login, owner_type, client_id, client_secret_enc, private_key_enc, webhook_secret_enc, permissions)
        VALUES (${id}, ${slug}, ${ownerLogin}, ${ownerType}, ${clientId}, ${clientSecretEnc}, ${privateKeyEnc}, ${webhookSecretEnc}, ${JSON.stringify(permissions ?? {})}::jsonb)
        ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, owner_login = EXCLUDED.owner_login, owner_type = EXCLUDED.owner_type,
          client_id = EXCLUDED.client_id, client_secret_enc = EXCLUDED.client_secret_enc, private_key_enc = EXCLUDED.private_key_enc,
          webhook_secret_enc = EXCLUDED.webhook_secret_enc, permissions = EXCLUDED.permissions`;
    },
    /** The full App row (ciphertext included) for the credential layer, or null. */
    async getApp(id) {
      const rows = await sql`SELECT id, slug, owner_login, owner_type, client_id, client_secret_enc, private_key_enc, webhook_secret_enc, permissions
        FROM gh_apps WHERE id = ${id}`;
      return rows[0] ? { ...rows[0], id: Number(rows[0].id) } : null;
    },

    /**
     * Adds an account or updates its identity. Only the fields passed change; `production_enabled`, `spend_limit_cents`,
     * credentials and the default flag of an existing account are never touched here. The first account becomes the default.
     */
    async upsertAccount({ login, accountId, accountType, label, credentialKind = 'app', appId = null, isScratch = false }) {
      // The same GitHub account may already be stored with different capital letters (an extra place added with a master token
      // as "Acme-Co", now connecting through the App as "acme-co"). One account is one row: update that row in place and keep its
      // stored spelling, instead of failing on the unique account number. A genuinely different name is still refused.
      const same = await sql`SELECT login FROM gh_accounts WHERE account_id = ${accountId} AND login <> ${login} AND lower(login) = lower(${login}) LIMIT 1`;
      if (same[0]) {
        await sql`UPDATE gh_accounts SET account_type = ${accountType}, label = ${label}, credential_kind = ${credentialKind},
          app_id = COALESCE(${appId}, app_id) WHERE login = ${same[0].login}`;
        return;
      }
      await sql`INSERT INTO gh_accounts (login, account_id, account_type, label, credential_kind, app_id, is_scratch, is_default)
        VALUES (${login}, ${accountId}, ${accountType}, ${label}, ${credentialKind}, ${appId}, ${isScratch},
          NOT EXISTS (SELECT 1 FROM gh_accounts WHERE is_default))
        ON CONFLICT (login) DO UPDATE SET account_type = EXCLUDED.account_type, label = EXCLUDED.label,
          credential_kind = EXCLUDED.credential_kind, app_id = COALESCE(EXCLUDED.app_id, gh_accounts.app_id)`;
    },
    /** One account's full row (ciphertext included) for the credential layer, or null. */
    async getAccount(login) {
      const rows = await sql`SELECT * FROM gh_accounts WHERE lower(login) = lower(${login})`;
      return rows[0] ? { ...rows[0], account_id: Number(rows[0].account_id), app_id: rows[0].app_id == null ? null : Number(rows[0].app_id),
        installation_id: rows[0].installation_id == null ? null : Number(rows[0].installation_id) } : null;
    },
    /**
     * GOD-5: adds an extra place (master token) or widens its repository list. Never touches a row of any other kind.
     * `repo` null = the whole owner. Changes start off. Returns the row, or null when the login belongs to a connected account.
     */
    async upsertExtraPlace({ login, accountId, accountType, repo = null }) {
      const rows = await sql`INSERT INTO gh_accounts (login, account_id, account_type, label, credential_kind, is_default, allow_changes, allowed_repos)
        VALUES (${login}, ${accountId}, ${accountType}, ${login}, 'master', FALSE, FALSE, ${repo ? [repo] : null}::text[])
        ON CONFLICT (login) DO UPDATE SET
          allowed_repos = CASE WHEN ${repo === null} THEN NULL
            WHEN gh_accounts.allowed_repos IS NULL THEN NULL
            ELSE (SELECT array_agg(DISTINCT r) FROM unnest(gh_accounts.allowed_repos || ARRAY[${repo ?? ''}]::text[]) AS r) END
        WHERE gh_accounts.credential_kind = 'master'
        RETURNING login, allowed_repos, allow_changes`;
      return rows[0] ?? null;
    },
    /** GOD-5: switch changes on or off for one extra place. Returns whether a place was changed. */
    async setPlaceChanges(login, on) {
      const rows = await sql`UPDATE gh_accounts SET allow_changes = ${on === true} WHERE lower(login) = lower(${login}) AND credential_kind = 'master' RETURNING login`;
      return rows.length === 1;
    },
    /** GOD-5: remove one extra place, or only `repo` from its list (the place goes when its list becomes empty). */
    async removeExtraPlace(login, repo = null) {
      const row = (await sql`SELECT allowed_repos FROM gh_accounts WHERE lower(login) = lower(${login}) AND credential_kind = 'master'`)[0];
      if (!row) return { removed: false, whole: false };
      if (repo && row.allowed_repos?.length) {
        const left = row.allowed_repos.filter((r) => r.toLowerCase() !== String(repo).toLowerCase());
        if (left.length === row.allowed_repos.length) return { removed: false, whole: false };
        if (left.length) {
          await sql`UPDATE gh_accounts SET allowed_repos = ${left}::text[] WHERE lower(login) = lower(${login}) AND credential_kind = 'master'`;
          return { removed: true, whole: false };
        }
      }
      await sql`DELETE FROM gh_accounts WHERE lower(login) = lower(${login}) AND credential_kind = 'master'`;
      return { removed: true, whole: true };
    },
    /** GOD-5: take a login out of every live connector login (the default falls back to the first account left). */
    async removeAccountFromConnections(login) {
      const who = String(login).toLowerCase();
      const rows = await sql`SELECT token_hash, accounts, default_account FROM oauth_tokens
        WHERE kind = 'connector' AND revoked_at IS NULL AND (expires_at > now() OR refresh_hash IS NOT NULL)`;
      let changed = 0;
      for (const row of rows) {
        const have = row.accounts ?? [];
        const next = have.filter((a) => String(a).toLowerCase() !== who);
        if (next.length === have.length || !next.length) continue;
        const def = String(row.default_account ?? '').toLowerCase() === who ? next[0] : row.default_account;
        await sql`UPDATE oauth_tokens SET accounts = ${next}::text[], default_account = ${def} WHERE token_hash = ${row.token_hash} AND revoked_at IS NULL`;
        changed++;
      }
      return changed;
    },
    /** Every account without any ciphertext: safe to show on the setup page and in tool results. */
    async listAccounts() {
      const rows = await sql`SELECT login, account_type, label, credential_kind, app_id, installation_id, repository_selection,
          installation_status, installation_permissions, user_login, (user_token_enc IS NOT NULL) AS has_user_token, user_token_expires_at,
          (fine_grained_enc IS NOT NULL) AS has_fine_grained, fine_grained_last4, (classic_enc IS NOT NULL) AS has_classic, classic_scopes,
          classic_last4, (package_enc IS NOT NULL) AS has_package, package_scopes, package_actor, package_expires_at, plan_name, production_enabled, spend_limit_cents, spend_limit_explicit, is_default, is_scratch, checked_at, allow_changes, allowed_repos
        FROM gh_accounts ORDER BY is_default DESC, login`;
      return rows.map((r) => ({ ...r, app_id: r.app_id == null ? null : Number(r.app_id), installation_id: r.installation_id == null ? null : Number(r.installation_id) }));
    },
    /** Records the installation of an account's App (from the installation callback or a webhook). */
    async setInstallation(login, { installationId, repositorySelection, permissions, status }) {
      const rows = await sql`UPDATE gh_accounts SET installation_id = ${installationId}, repository_selection = ${repositorySelection},
        installation_permissions = ${JSON.stringify(permissions ?? {})}::jsonb, installation_status = ${status}, checked_at = now()
        WHERE lower(login) = lower(${login}) RETURNING login`;
      return rows.length === 1;
    },
    async setInstallationStatus(login, status) {
      const rows = await sql`UPDATE gh_accounts SET installation_status = ${status}, checked_at = now() WHERE lower(login) = lower(${login}) RETURNING login`;
      return rows.length === 1;
    },
    /** Stores Chris's user authorization of the App (8-hour token, 6-month refresh token), both already encrypted. */
    async setUserAuthorization(login, { userLogin, tokenEnc, tokenExpiresAt, refreshEnc, refreshExpiresAt }) {
      const rows = await sql`UPDATE gh_accounts SET user_login = ${userLogin}, user_token_enc = ${tokenEnc}, user_token_expires_at = ${tokenExpiresAt},
        user_refresh_enc = ${refreshEnc}, user_refresh_expires_at = ${refreshExpiresAt},
        user_refresh_claim = NULL, user_refresh_claim_expires_at = NULL WHERE lower(login) = lower(${login}) RETURNING login`;
      return rows.length === 1;
    },
    /** One-use token refresh is leased atomically across server instances. */
    async claimUserRefresh(login, { expectedTokenEnc, claimId, at, expiresAt }) {
      const rows = await sql`UPDATE gh_accounts SET user_refresh_claim = ${claimId},
        user_refresh_claim_expires_at = ${expiresAt}
        WHERE lower(login) = lower(${login}) AND user_token_enc = ${expectedTokenEnc}
          AND user_refresh_enc IS NOT NULL
          AND (user_refresh_claim IS NULL OR user_refresh_claim_expires_at <= ${at})
        RETURNING login`;
      return rows.length === 1;
    },
    /** Only the exact winning claim can replace encrypted authorization. */
    async finishUserRefresh(login, { expectedTokenEnc, claimId, userLogin, tokenEnc, tokenExpiresAt, refreshEnc, refreshExpiresAt }) {
      const rows = await sql`UPDATE gh_accounts SET user_login = ${userLogin}, user_token_enc = ${tokenEnc},
        user_token_expires_at = ${tokenExpiresAt}, user_refresh_enc = ${refreshEnc},
        user_refresh_expires_at = ${refreshExpiresAt}, user_refresh_claim = NULL,
        user_refresh_claim_expires_at = NULL
        WHERE lower(login) = lower(${login}) AND user_token_enc = ${expectedTokenEnc}
          AND user_refresh_claim = ${claimId} RETURNING login`;
      return rows.length === 1;
    },
    async releaseUserRefreshClaim(login, claimId) {
      const rows = await sql`UPDATE gh_accounts SET user_refresh_claim = NULL, user_refresh_claim_expires_at = NULL
        WHERE lower(login) = lower(${login}) AND user_refresh_claim = ${claimId} RETURNING login`;
      return rows.length === 1;
    },
    async clearUserAuthorizationIfClaim(login, expectedTokenEnc, claimId) {
      const rows = await sql`UPDATE gh_accounts SET user_login = NULL, user_token_enc = NULL,
        user_token_expires_at = NULL, user_refresh_enc = NULL, user_refresh_expires_at = NULL,
        user_refresh_claim = NULL, user_refresh_claim_expires_at = NULL
        WHERE lower(login) = lower(${login}) AND user_token_enc = ${expectedTokenEnc}
          AND user_refresh_claim = ${claimId} RETURNING login`;
      return rows.length === 1;
    },
    async clearUserAuthorizationIfCurrent(login, expectedTokenEnc) {
      const rows = await sql`UPDATE gh_accounts SET user_login = NULL, user_token_enc = NULL,
        user_token_expires_at = NULL, user_refresh_enc = NULL, user_refresh_expires_at = NULL,
        user_refresh_claim = NULL, user_refresh_claim_expires_at = NULL
        WHERE lower(login) = lower(${login}) AND user_token_enc = ${expectedTokenEnc}
          AND user_refresh_claim IS NULL RETURNING login`;
      return rows.length === 1;
    },
    async clearUserAuthorization(login) {
      await sql`UPDATE gh_accounts SET user_login = NULL, user_token_enc = NULL, user_token_expires_at = NULL, user_refresh_enc = NULL,
        user_refresh_expires_at = NULL, user_refresh_claim = NULL, user_refresh_claim_expires_at = NULL WHERE lower(login) = lower(${login})`;
    },
    async setFineGrainedToken(login, { enc, last4, expiresAt = null }) {
      const rows = await sql`UPDATE gh_accounts SET fine_grained_enc = ${enc}, fine_grained_last4 = ${last4}, fine_grained_expires_at = ${expiresAt}, additional_credential_proofs = additional_credential_proofs - 'F'
        WHERE lower(login) = lower(${login}) RETURNING login`;
      return rows.length === 1;
    },
    async setClassicToken(login, { enc, scopes, last4 }) {
      const rows = await sql`UPDATE gh_accounts SET classic_enc = ${enc}, classic_scopes = ${scopes}, classic_last4 = ${last4}, additional_credential_proofs = additional_credential_proofs - 'K'
        WHERE lower(login) = lower(${login}) RETURNING login`;
      return rows.length === 1;
    },
    async setPackageToken(login, { enc, scopes, actor, expiresAt = null }) {
      const rows = await sql`UPDATE gh_accounts SET package_enc = ${enc}, package_scopes = ${scopes},
        package_actor = ${actor}, package_expires_at = ${expiresAt}, additional_credential_proofs = additional_credential_proofs - 'P'
        WHERE lower(login) = lower(${login}) RETURNING login`;
      return rows.length === 1;
    },
    async clearClassicToken(login) {
      const rows=await sql`UPDATE gh_accounts SET classic_enc=NULL,
        classic_scopes=NULL,classic_last4=NULL,
        additional_credential_proofs=additional_credential_proofs-'K'
        WHERE lower(login)=lower(${login}) AND classic_enc IS NOT NULL RETURNING login`;
      return rows.length===1;
    },
    async clearFineGrainedToken(login) {
      const rows=await sql`UPDATE gh_accounts SET fine_grained_enc=NULL,
        fine_grained_last4=NULL,fine_grained_expires_at=NULL,
        additional_credential_proofs=additional_credential_proofs-'F'
        WHERE lower(login)=lower(${login}) AND fine_grained_enc IS NOT NULL RETURNING login`;
      return rows.length===1;
    },
    async clearPackageToken(login) {
      const rows = await sql`UPDATE gh_accounts SET package_enc = NULL, package_scopes = NULL,
        package_actor = NULL, package_expires_at = NULL, additional_credential_proofs = additional_credential_proofs - 'P' WHERE lower(login) = lower(${login}) RETURNING login`;
      return rows.length === 1;
    },
    /** Bind a provider-verified human to the CURRENT encrypted optional
     * credential only. This never mints/reads a token or verifies an API
     * permission by itself. A concurrent token replacement loses the CAS.
     * JSON is allowlisted by the caller and validated here too.
     */
    async bindAdditionalCredentialProof({login,kind,expectedCipher,proof}) {
      if (!['F','P','K'].includes(kind) ||
          typeof login!=='string' || !/^[a-z0-9-]{1,39}$/i.test(login) ||
          typeof expectedCipher!=='string' || expectedCipher.length<12 ||
          !proof || proof.version!==1 || proof.kind!==kind ||
          proof.host!=='github.com' ||
          !Number.isSafeInteger(proof.actorId) || proof.actorId<=0 ||
          !Number.isSafeInteger(proof.accountId) || proof.accountId<=0 ||
          proof.scope!=='legacy-owner' ||
          typeof proof.fingerprint!=='string' || !/^[a-f0-9]{64}$/.test(proof.fingerprint) ||
          createHash('sha256').update(expectedCipher).digest('hex')!==proof.fingerprint ||
          !['identity-only','identity-and-capability-readback'].includes(proof.verification) ||
          (proof.verification==='identity-and-capability-readback' &&
            !((kind==='K'&&proof.operation==='GET /notifications'&&
              proof.resource==='user/'+proof.actorId&&
              Array.isArray(proof.scopes)&&proof.scopes.includes('notifications')) ||
              (kind==='P'&&proof.operation==='GET /orgs/{org}/packages'&&
              proof.resource==='org/'+proof.accountId&&
              Array.isArray(proof.scopes)&&proof.scopes.includes('read:packages')))))
        throw new TypeError('Verified additional credential evidence is invalid.');
      const payload=JSON.stringify({
        version:1,kind,host:'github.com',actorId:proof.actorId,
        accountId:proof.accountId,scope:'legacy-owner',
        fingerprint:proof.fingerprint,verification:proof.verification,
        operation:proof.verification==='identity-and-capability-readback'?proof.operation:null,
        resource:proof.verification==='identity-and-capability-readback'?proof.resource:null,
        scopes:proof.verification==='identity-and-capability-readback'?proof.scopes:[],
        expiresAt:proof.expiresAt??null
      });
      const rows=await sql`UPDATE gh_accounts
        SET additional_credential_proofs=jsonb_set(
          additional_credential_proofs,ARRAY[${kind}],${payload}::jsonb)
        WHERE lower(login)=lower(${login}) AND account_id=${proof.accountId}
          AND (CASE ${kind} WHEN 'F' THEN fine_grained_enc
            WHEN 'P' THEN package_enc WHEN 'K' THEN classic_enc ELSE NULL END)=${expectedCipher}
        RETURNING login`;
      return rows.length===1;
    },
    /** Public metadata only, never a credential or a capability grant. */
    async additionalCredentialProofs(login) {
      if(typeof login!=='string'||!/^[a-z0-9-]{1,39}$/i.test(login))return {};
      const rows=await sql`SELECT additional_credential_proofs AS proofs
        FROM gh_accounts WHERE lower(login)=lower(${login})`;
      return rows[0]?.proofs??{};
    },
    async setAccountPlan(login, planName) {
      await sql`UPDATE gh_accounts SET plan_name = ${planName}, checked_at = now() WHERE lower(login) = lower(${login})`;
    },

    /** A cached installation token for this scope if it has more than five minutes left, else null. */
    async getInstallationToken(installationId, scopeKey) {
      const rows = await sql`SELECT token_enc, expires_at FROM gh_installation_tokens
        WHERE installation_id = ${installationId} AND scope_key = ${scopeKey} AND expires_at > now() + interval '5 minutes'`;
      return rows[0] ? { token_enc: rows[0].token_enc, expires_at: new Date(rows[0].expires_at) } : null;
    },
    async putInstallationToken(installationId, scopeKey, tokenEnc, expiresAt) {
      await sql`INSERT INTO gh_installation_tokens (installation_id, scope_key, token_enc, expires_at)
        VALUES (${installationId}, ${scopeKey}, ${tokenEnc}, ${expiresAt})
        ON CONFLICT (installation_id, scope_key) DO UPDATE SET token_enc = EXCLUDED.token_enc, expires_at = EXCLUDED.expires_at`;
      await sql`DELETE FROM gh_installation_tokens WHERE ctid IN (SELECT ctid FROM gh_installation_tokens WHERE expires_at < now() LIMIT 100)`;
    },
    async deleteInstallationTokens(installationId) {
      await sql`DELETE FROM gh_installation_tokens WHERE installation_id = ${installationId}`;
    },

    /** A pending setup step (manifest or user authorization) keyed by an unguessable state; used once, expires. */
    async createSetupState({ state, purpose, accountHint = null, codeVerifierEnc = null, ttlSeconds = 3600 }) {
      if (!SETUP_PURPOSES.includes(purpose)) throw new TypeError('Unknown setup purpose.');
      if (typeof state !== 'string' || state.length < 32) throw new TypeError('A setup state must be an unguessable string.');
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
      await sql`INSERT INTO setup_states (state, purpose, account_hint, code_verifier_enc, expires_at)
        VALUES (${state}, ${purpose}, ${accountHint}, ${codeVerifierEnc}, ${expiresAt})`;
    },
    /** Atomic: returns the state's data once and deletes it, or null if unknown, used, expired or for another purpose. */
    async consumeSetupState(state, purpose) {
      if (typeof state !== 'string' || !state) return null;
      const rows = await sql`DELETE FROM setup_states WHERE state = ${state} AND purpose = ${purpose} AND expires_at > now()
        RETURNING account_hint, code_verifier_enc`;
      return rows[0] ? { account_hint: rows[0].account_hint, code_verifier_enc: rows[0].code_verifier_enc } : null;
    },

    /** Atomic: consumes the newest unexpired state of a purpose for one account hint (the owner confirming a request a tool made). */
    async consumeSetupStateByHint(purpose, accountHint) {
      if (typeof accountHint !== 'string' || !accountHint) return null;
      const rows = await sql`DELETE FROM setup_states WHERE state = (SELECT state FROM setup_states WHERE purpose = ${purpose}
          AND lower(account_hint) = lower(${accountHint}) AND expires_at > now() ORDER BY expires_at DESC LIMIT 1)
        RETURNING account_hint`;
      return rows[0] ? { account_hint: rows[0].account_hint } : null;
    },
    /** Whether an unexpired state of that purpose exists for the account hint (does not consume it). */
    async hasPendingSetupState(purpose, accountHint) {
      const rows = await sql`SELECT 1 FROM setup_states WHERE purpose = ${purpose} AND lower(account_hint) = lower(${accountHint}) AND expires_at > now() LIMIT 1`;
      return rows.length === 1;
    },

    /** A waiting request for the owner to type a secret on the setup page. `scope` says where it goes; the value is never stored. */
    async createSecretRequest({ id, account, scope, connection = null, ttlSeconds = 1800 }) {
      if (typeof id !== 'string' || id.length < 32) throw new TypeError('A secret request id must be an unguessable string.');
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
      await sql`INSERT INTO secret_entry_requests (id, account, scope, mode, connection, expires_at)
        VALUES (${id}, ${account}, ${JSON.stringify(scope)}::jsonb, 'setup-page', ${connection}, ${expiresAt})`;
    },
    /** The request if it is still waiting (not used, not expired), without using it. */
    async getSecretRequest(id) {
      if (typeof id !== 'string' || !id) return null;
      const rows = await sql`SELECT id, account, scope, expires_at FROM secret_entry_requests WHERE id = ${id} AND completed_at IS NULL AND expires_at > now()`;
      return rows[0] ? { id: rows[0].id, account: rows[0].account, scope: rows[0].scope, expires_at: rows[0].expires_at } : null;
    },
    /** Atomic: marks a waiting request used and returns it, or null (unknown, used, expired). Two submissions cannot both win. */
    async claimSecretRequest(id) {
      if (typeof id !== 'string' || !id) return null;
      const rows = await sql`UPDATE secret_entry_requests SET completed_at = now() WHERE id = ${id} AND completed_at IS NULL AND expires_at > now()
        RETURNING id, account, scope`;
      return rows[0] ? { id: rows[0].id, account: rows[0].account, scope: rows[0].scope } : null;
    },
    /** Puts a claimed request back (GitHub refused the secret), so the owner can try again until it expires. */
    async releaseSecretRequest(id) {
      await sql`UPDATE secret_entry_requests SET completed_at = NULL WHERE id = ${id}`;
    },

    /** An owner setting (JSON), or null. Settings hold names and numbers, never a credential. */
    async getSetting(key) {
      const rows = await sql`SELECT value FROM server_settings WHERE setting = ${key}`;
      return rows[0] ? rows[0].value : null;
    },
    async setSetting(key, value) {
      if (typeof key !== 'string' || !/^[a-z][a-z0-9_.]{0,62}$/.test(key)) throw new TypeError('A setting key is lowercase words.');
      await sql`INSERT INTO server_settings (setting, value, updated_at) VALUES (${key}, ${JSON.stringify(value)}::jsonb, now())
        ON CONFLICT (setting) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
    },
    /** The protected list, sorted. `kind` is 'repo' (target `owner/name`, lowercase) or 'installation' (an installation number or `*` for all of this server's own Apps). */
    async listProtectedResources() {
      const rows = await sql`SELECT kind, target, level, reason, updated_at FROM protected_resources ORDER BY kind, target`;
      return rows.map(normalizeProtected);
    },
    /** Adds or changes one entry. Only the setup page calls this. */
    async saveProtectedResource({ kind, target, level, reason }) {
      const entry = checkProtected({ kind, target, level, reason });
      await sql`INSERT INTO protected_resources (kind, target, level, reason, updated_at) VALUES (${entry.kind}, ${entry.target}, ${entry.level}, ${entry.reason}, now())
        ON CONFLICT (kind, target) DO UPDATE SET level = EXCLUDED.level, reason = EXCLUDED.reason, updated_at = now()`;
      return entry;
    },
    /** Removes one entry; true when something was removed. Only the setup page calls this. */
    async removeProtectedResource(kind, target) {
      const rows = await sql`DELETE FROM protected_resources WHERE kind = ${kind} AND target = ${String(target).toLowerCase()} RETURNING target`;
      return rows.length === 1;
    },
    /** Inserts the starting list once ever (a flag in `server_settings`), so an entry the owner later removes stays removed. Returns true when it seeded. */
    async seedProtectedResources(entries) {
      if ((await this.getSetting(PROTECTED_SEEDED_KEY)) === true) return false;
      for (const raw of entries) {
        const e = checkProtected(raw);
        await sql`INSERT INTO protected_resources (kind, target, level, reason) VALUES (${e.kind}, ${e.target}, ${e.level}, ${e.reason}) ON CONFLICT (kind, target) DO NOTHING`;
      }
      await this.setSetting(PROTECTED_SEEDED_KEY, true);
      return true;
    },

    /** Sets an account's monthly spend limit in cents. Returns false when the account is unknown. Raising it is done only by the setup page. */
    async setSpendLimitCents(login, cents) {
      if (!Number.isSafeInteger(cents) || cents < 0 || cents > 100000000) throw new TypeError('The spend limit is a whole number of cents from 0 to 1,000,000 dollars.');
      const rows = await sql`UPDATE gh_accounts SET spend_limit_cents = ${cents}, spend_limit_explicit = TRUE
        WHERE lower(login) = lower(${login}) RETURNING login`;
      return rows.length === 1;
    },
    /** Cents this account's real (not preview) changes have committed since `since`: everything sent except a change GitHub definitely rejected. In-flight and uncertain ones count. */
    async sumSpendCents(account, since, connection = null) {
      const rows = await sql`SELECT COALESCE(SUM(spend_cents), 0) AS total FROM change_log
        WHERE lower(account) = lower(${account}) AND (${connection}::text IS NULL OR connection = ${connection}) AND dry_run = FALSE AND spend_cents > 0 AND at >= ${new Date(since).toISOString()}::timestamptz AND summary NOT LIKE 'REJECTED:%'`;
      return Number(rows[0].total);
    },

    /** IN-06: owner-controlled scratch flag. Enabling is constrained by current stored installation and production safety. */
    async setScratchAccount(login, enabled) {
      if (typeof enabled !== 'boolean') throw new TypeError('Scratch state must be a boolean.');
      const rows = await sql`UPDATE gh_accounts SET is_scratch = ${enabled}
        WHERE lower(login) = lower(${login}) AND (
          ${enabled} = FALSE OR
          (account_type = 'Organization' AND credential_kind = 'app' AND app_id IS NOT NULL
           AND installation_id IS NOT NULL AND installation_status = 'active'
           AND repository_selection = 'all' AND production_enabled = FALSE))
        RETURNING login`;
      return rows.length === 1;
    },
    /** Turns production on or off for one account. Returns false when the account is unknown. Used only by the setup page (on) and the disable tool (off). */
    async setProductionEnabled(login, enabled) {
      const rows = await sql`UPDATE gh_accounts SET production_enabled = ${enabled === true} WHERE lower(login) = lower(${login}) RETURNING login`;
      return rows.length === 1;
    },

    async addOneTimeSecret({ id, account = null, kind, ciphertext, expiresAt }) {
      await sql`INSERT INTO one_time_secrets (id, account, kind, ciphertext, expires_at) VALUES (${id}, ${account}, ${kind}, ${ciphertext}, ${expiresAt})`;
      await sql`DELETE FROM one_time_secrets WHERE ctid IN (SELECT ctid FROM one_time_secrets WHERE expires_at < now() LIMIT 100)`;
    },
    /** Atomic delete-and-return: two callers can never both read a single-view secret. */
    async consumeOneTimeSecret(id) {
      const rows = await sql`DELETE FROM one_time_secrets WHERE id = ${id} AND expires_at > now() AND viewed_at IS NULL
        RETURNING account, kind, ciphertext`;
      return rows[0] || null;
    },

    /**
     * Claims the next write slot for an installation in one atomic statement, so two server instances can never both
     * write in the same second (A9). The slot is the later of "now" and the previous claim's end; each claim reserves
     * `spacingMs` after it. Returns `{ waitMs }` (how long the caller must wait before writing) or `null` when that
     * wait would exceed `maxWaitMs` (nothing is reserved then).
     */
    async claimWriteSlot(installationKey, { spacingMs = 1000, maxWaitMs = 5000 } = {}) {
      if (typeof installationKey !== 'string' || !installationKey) throw new TypeError('claimWriteSlot needs an installation key.');
      const spacing = spacingMs / 1000;
      const maxWait = maxWaitMs / 1000;
      const rows = await sql`INSERT INTO gh_write_slots (installation_key, next_write_at)
        VALUES (${installationKey}, now() + make_interval(secs => ${spacing}::float8))
        ON CONFLICT (installation_key) DO UPDATE
          SET next_write_at = GREATEST(gh_write_slots.next_write_at, now()) + make_interval(secs => ${spacing}::float8)
          WHERE gh_write_slots.next_write_at <= now() + make_interval(secs => ${maxWait}::float8)
        RETURNING (EXTRACT(EPOCH FROM (next_write_at - make_interval(secs => ${spacing}::float8) - now())) * 1000)::float8 AS wait_ms`;
      return rows[0] ? { waitMs: Math.max(0, Math.round(rows[0].wait_ms)) } : null;
    },

    // ---- Change log (B-1). Rows hold plain-language summaries and small before/after facts, never a credential. ----

    /** Writes a finished row (a preview, a refusal, an audit line). Returns its id. */
    async recordChange(change) {
      const c = normalizeChange(change);
      if (c.dryRun === false && c.requestKey) throw new TypeError('A real write is recorded with claimChange.');
      const rows = await sql`INSERT INTO change_log (account, repo, mode, connection, tool, target, summary, before, after, dry_run, confirmed,
          production, access_widening, notifies, spend_cents, request_key, github_request_id, inverse)
        VALUES (${c.account}, ${c.repo}, ${c.mode}, ${c.connection}, ${c.tool}, ${c.target}, ${c.summary}, ${c.before}::jsonb, ${c.after}::jsonb, ${c.dryRun},
          ${c.confirmed}, ${c.production}, ${c.accessWidening}, ${c.notifies}, ${c.spendCents}, ${c.requestKey}, ${c.githubRequestId}, ${c.inverse}::jsonb)
        RETURNING id`;
      return Number(rows[0].id);
    },

    /**
     * Claims a request key for one real write. Exactly one caller gets `{ claimed: true, id }` (the unique index decides, so
     * two server instances cannot both); every other caller gets the existing row so it can report a replay.
     */
    /** Atomic insert-or-lease claim for a sequential write plan.
     * Concurrent callers cannot both run: only one holds the active lease;
     * older completed receipts and uncertain steps are immutable and replay-safe.
     */
    async claimWriteBatch({key,connection,account,intentHash,lease}) {
      if (![key,intentHash].every(v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)) ||
          !connection||!account||typeof lease!=='string'||lease.length>80)
        throw new TypeError('A batch claim needs scoped identities and a stable SHA-256 intent.');
      const created=await sql`INSERT INTO gh_write_batches
        (batch_id,connection,account,intent_hash,status,lease_id,lease_until)
        VALUES (${key},${connection},${account},${intentHash},'running',${lease},now()+interval '120 seconds')
        ON CONFLICT (batch_id) DO NOTHING RETURNING batch_id`;
      if(created.length)return {claimed:true,status:'running',items:[]};
      const rows=await sql`SELECT connection,account,intent_hash,status,items,lease_until
        FROM gh_write_batches WHERE batch_id=${key}`;
      const current=rows[0];
      if(!current||current.connection!==connection||current.account!==account)
        return {claimed:false,status:'denied',items:[]};
      if(current.intent_hash!==intentHash)return {claimed:false,status:'conflict',items:[]};
      if(['complete','uncertain'].includes(current.status))
        return {claimed:false,status:current.status,items:current.items};
      const resumed=await sql`UPDATE gh_write_batches
        SET lease_id=${lease},lease_until=now()+interval '120 seconds',status='running',updated_at=now()
        WHERE batch_id=${key} AND connection=${connection} AND account=${account}
          AND intent_hash=${intentHash} AND status IN ('running','partial')
          AND (lease_until IS NULL OR lease_until<=now())
        RETURNING items`;
      if(resumed.length)return {claimed:true,status:'running',items:resumed[0].items};
      return {claimed:false,status:'in_progress',items:[]};
    },
    /** Save each pre-send intent and post-readback receipt under the SAME
     * connection/account/active lease. Failure prevents the next write.
     */
    async saveWriteBatch({key,connection,account,lease,items,status}) {
      if(!['running','partial','complete','uncertain'].includes(status) ||
          !Array.isArray(items)||items.length>20)throw new TypeError('Invalid batch outcome.');
      const json=JSON.stringify(items);
      if(json.length>50000)throw new TypeError('Batch receipts exceed safe bound.');
      const end=status!=='running';
      const rows=await sql`UPDATE gh_write_batches SET items=${json}::jsonb,
        status=${status},lease_id=CASE WHEN ${end} THEN NULL ELSE lease_id END,
        lease_until=CASE WHEN ${end} THEN NULL ELSE lease_until END,
        updated_at=now()
        WHERE batch_id=${key} AND connection=${connection} AND account=${account}
          AND lease_id=${lease} AND lease_until>now() AND status='running'
        RETURNING batch_id`;
      return rows.length===1;
    },

    async claimChange(change) {
      const c = normalizeChange({ ...change, dryRun: false, confirmed: null });
      if (!c.requestKey) throw new TypeError('claimChange needs a request key.');
      const rows = await sql`INSERT INTO change_log (account, repo, mode, connection, tool, target, summary, before, after, dry_run, confirmed,
          production, access_widening, notifies, spend_cents, request_key, github_request_id, inverse)
        VALUES (${c.account}, ${c.repo}, ${c.mode}, ${c.connection}, ${c.tool}, ${c.target}, ${c.summary}, ${c.before}::jsonb, NULL, FALSE,
          NULL, ${c.production}, ${c.accessWidening}, ${c.notifies}, ${c.spendCents}, ${c.requestKey}, NULL, NULL)
        ON CONFLICT (request_key) WHERE dry_run = FALSE AND request_key IS NOT NULL DO NOTHING
        RETURNING id`;
      if (rows[0]) return { claimed: true, id: Number(rows[0].id) };
      const existing = await sql`SELECT id, at, summary, confirmed, after, github_request_id FROM change_log
        WHERE request_key = ${c.requestKey} AND dry_run = FALSE LIMIT 1`;
      return { claimed: false, existing: existing[0] ? changeView(existing[0]) : null };
    },

    /** Completes a claimed row once GitHub answered and the read-back was compared. `releaseKey` frees the request key after a definitive rejection so a corrected retry is not mistaken for a replay. */
    async finishChange(id, { summary, before, after, confirmed, githubRequestId = null, inverse = null, releaseKey = false, actedAs = null }) {
      const rows = await sql`UPDATE change_log SET summary = ${summary}, acted_as = ${['you', 'app', 'mixed'].includes(actedAs) ? actedAs : null}, before = COALESCE(${before === undefined ? null : JSON.stringify(before)}::jsonb, before),
          after = ${after === undefined ? null : JSON.stringify(after)}::jsonb, confirmed = ${confirmed}, github_request_id = ${githubRequestId},
          inverse = ${inverse ? JSON.stringify(inverse) : null}::jsonb, request_key = CASE WHEN ${releaseKey === true} THEN NULL ELSE request_key END
        WHERE id = ${id} RETURNING id`;
      return rows.length === 1;
    },

    /** One row by id, or null. */
    async getChange(id) {
      const rows = await sql`SELECT * FROM change_log WHERE id = ${id}`;
      return rows[0] ? changeView(rows[0]) : null;
    },

    /** Records GitHub's rate headers for an account and resource so every instance sees a block (A9). */
    async recordRateState({ account, resource, remaining = null, resetAt = null, blockedUntil = null }) {
      await sql`INSERT INTO gh_rate_state (account, resource, remaining, reset_at, blocked_until, updated_at)
        VALUES (${account}, ${resource}, ${remaining}, ${resetAt}, ${blockedUntil}, now())
        ON CONFLICT (account, resource) DO UPDATE SET remaining = EXCLUDED.remaining, reset_at = EXCLUDED.reset_at,
          blocked_until = EXCLUDED.blocked_until, updated_at = now()`;
    },

    /** The recorded rate state, or null. `blocked_until` is only reported while it is still in the future. */
    async getRateState(account, resource) {
      const rows = await sql`SELECT remaining, reset_at, CASE WHEN blocked_until > now() THEN blocked_until END AS blocked_until
        FROM gh_rate_state WHERE account = ${account} AND resource = ${resource}`;
      return rows[0] ? { remaining: rows[0].remaining, reset_at: rows[0].reset_at, blocked_until: rows[0].blocked_until } : null;
    },

    /** The cached body and ETag for a polled read, or null (rows older than 24 hours are ignored). */
    async getEtag(account, urlKey) {
      const rows = await sql`SELECT etag, body FROM gh_etag_cache
        WHERE account = ${account} AND url_key = ${urlKey} AND stored_at > now() - interval '24 hours'`;
      return rows[0] ? { etag: rows[0].etag, body: rows[0].body } : null;
    },

    /** Stores an ETag and body (bodies over 256 KB are not kept) and deletes up to 100 expired rows. */
    async putEtag(account, urlKey, etag, body) {
      const json = JSON.stringify(body ?? null);
      if (Buffer.byteLength(json) > ETAG_BODY_LIMIT_BYTES) {
        await sql`DELETE FROM gh_etag_cache WHERE account = ${account} AND url_key = ${urlKey}`;
        return false;
      }
      await sql`INSERT INTO gh_etag_cache (account, url_key, etag, body, stored_at)
        VALUES (${account}, ${urlKey}, ${etag}, ${json}::jsonb, now())
        ON CONFLICT (account, url_key) DO UPDATE SET etag = EXCLUDED.etag, body = EXCLUDED.body, stored_at = now()`;
      await sql`DELETE FROM gh_etag_cache WHERE ctid IN (
        SELECT ctid FROM gh_etag_cache WHERE stored_at < now() - interval '24 hours' LIMIT 100)`;
      return true;
    },

    /** The accounts the login page offers. `production_enabled` decides whether production mode may be offered. */
    async listAccountsForLogin() {
      return await sql`SELECT login, label, production_enabled, is_default FROM gh_accounts WHERE credential_kind <> 'master' ORDER BY is_default DESC, login`;
    }
  };
}
