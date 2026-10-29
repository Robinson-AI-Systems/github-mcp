// PUB-3 PRIVATE capacity budget for independently authenticated tenant schemas.
// Owner legacy connections are intentionally outside this runtime. The limits
// defend shared infrastructure, not which GitHub capabilities a customer can
// authorize or the developer's separate zero-spend restrictions.
import { createHash } from 'node:crypto';

export const TENANT_RUNTIME_LIMITS = Object.freeze({
  mcpClientPerMinute: 120,
  mcpTenantPerMinute: 600,
  oauthClientPerMinute: 30,
  oauthTenantPerMinute: 150,
  jobsClientPerDay: null,
  jobsTenantPerDay: null,
  resultMaxBytes: 256 * 1024,
  resultsClientBytesPerDay: 8 * 1024 * 1024,
  resultsTenantBytesPerDay: 40 * 1024 * 1024,
  jobMaxTtlMinutes: 1440,
  resultMaxTtlSeconds: 86400,
  // Active-item admission caps, independent of daily byte/request budgets.
  jobsClientPending: 8,
  jobsTenantPending: 64,
  resultsClientActive: 100,
  resultsTenantActive: 400
});

// Optional PRIVATE tenant-owner runtime policy. Defaults preserve current
// source behavior; changes persist only inside that tenant's isolated schema.
// The shared hosting/provider budgets remain independent of customer spend.
const CONFIG_FIELDS = Object.freeze({
  mcpClientPerMinute: 600,
  mcpTenantPerMinute: 6000,
  oauthClientPerMinute: 300,
  oauthTenantPerMinute: 1500,
  resultsClientBytesPerDay: 80 * 1024 * 1024,
  resultsTenantBytesPerDay: 400 * 1024 * 1024,
  jobsClientPending: 80,
  jobsTenantPending: 640,
  resultsClientActive: 1000,
  resultsTenantActive: 4000
});
// Retired stored overrides are accepted for upgrade compatibility, never enforced.
const RETIRED_JOB_QUOTAS = new Set(['jobsClientPerDay','jobsTenantPerDay']);
const CONFIG_KEY = 'private_runtime_limits';
export function validateTenantRuntimePolicy(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).some(k => !Object.hasOwn(CONFIG_FIELDS,k) && !RETIRED_JOB_QUOTAS.has(k)))
    throw new TypeError('Invalid private tenant capacity policy.');
  const merged = { ...TENANT_RUNTIME_LIMITS };
  for (const [key, val] of Object.entries(value)) {
    if (RETIRED_JOB_QUOTAS.has(key)) {
      if (val!==null && (!Number.isSafeInteger(val) || val<1)) throw new TypeError('Invalid retired job quota setting.');
      continue;
    }
    if (!Number.isSafeInteger(val) || val < 1 || val > CONFIG_FIELDS[key])
      throw new TypeError('Private tenant capacity policy has an invalid limit.');
    merged[key] = val;
  }
  for (const [perClient, perTenant] of [
    ['mcpClientPerMinute','mcpTenantPerMinute'],
    ['oauthClientPerMinute','oauthTenantPerMinute'],
    ['resultsClientBytesPerDay','resultsTenantBytesPerDay'],
    ['jobsClientPending','jobsTenantPending'],
    ['resultsClientActive','resultsTenantActive']
  ]) if (merged[perClient] > merged[perTenant])
    throw new TypeError('Tenant capacity must not be lower than its per-client budget.');
  return Object.freeze(merged);
}
export async function readTenantRuntimePolicy(sql) {
  const rows = await sql`SELECT value FROM server_settings WHERE setting=${CONFIG_KEY}`;
  if (rows.length > 1) throw new Error('Private tenant policy storage is inconsistent.');
  return validateTenantRuntimePolicy(rows[0]?.value ?? {});
}
/** Call ONLY after the private setup has confirmed real owner authority.
 * This store API never grants that authority merely by having a tenant ID. */
export async function saveTenantRuntimePolicy(sql, limits) {
  const policy = validateTenantRuntimePolicy(limits);
  const overrides = Object.fromEntries(Object.keys(CONFIG_FIELDS).map(k=>[k,policy[k]]));
  await sql`INSERT INTO server_settings(setting,value,updated_at)
    VALUES(${CONFIG_KEY},${JSON.stringify(overrides)}::jsonb,now())
    ON CONFLICT (setting) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`;
  return policy;
}

const allowedKinds = new Set(['mcp', 'oauth', 'result']);
const allowedEvents = new Set(['mcp', 'oauth', 'job', 'result', 'provider', 'refresh']);
const allowedOutcomes = new Set(['ok', 'refused', 'throttled', 'error']);
const bound = (number, low, high) => Number.isSafeInteger(number) && number >= low && number <= high;
const bucketFor = ms => ms < 100 ? 'lt100ms' : ms < 500 ? 'lt500ms' : ms < 2000 ? 'lt2s' : 'gte2s';
const digest = value => createHash('sha256').update(value).digest('hex').slice(0, 24);

export class TenantCapacityError extends Error {
  constructor(operation, waitSeconds) {
    super('The private tenant is temporarily busy. Retry after the indicated interval.');
    this.name = 'TenantCapacityError';
    this.operation = operation;
    this.retryAfterSeconds = waitSeconds;
  }
}

/** Execute only on a TENANT-BOUND connection after exact search_path has been
 * independently verified. Non-public provisioning/migration owns DDL; no MCP
 * request is permitted to create or silently migrate tables at runtime. */
export async function initTenantRuntimeSchema(sql) {
  await sql`CREATE TABLE IF NOT EXISTS gh_tenant_budget_windows (
    scope TEXT NOT NULL CHECK (length(scope) BETWEEN 2 AND 80),
    window_start TIMESTAMPTZ NOT NULL,
    used BIGINT NOT NULL CHECK (used >= 0),
    expires_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (scope, window_start)
  )`;
  // An inner PL/pgSQL exception subtransaction rolls back BOTH counter claims
  // when either limit would be exceeded. Without this, a client over its
  // burst cap could reserve all shared tenant slots and starve other clients.
  await sql`CREATE OR REPLACE FUNCTION gh_claim_tenant_capacity(
    tenant_scope TEXT, client_scope TEXT, window_kind TEXT,
    window_seconds INTEGER, amount_to_claim BIGINT,
    max_tenant BIGINT, max_client BIGINT
  ) RETURNS TABLE (tenant_used BIGINT, client_used BIGINT)
  LANGUAGE plpgsql SECURITY INVOKER AS $body$
  DECLARE t BIGINT;
  DECLARE c BIGINT;
  DECLARE at_time TIMESTAMPTZ;
  BEGIN
    IF window_kind NOT IN ('minute','day') OR amount_to_claim < 1
      OR max_client < 1 OR max_tenant < max_client
      OR window_seconds NOT IN (60,86400) THEN
      RETURN;
    END IF;
    at_time:=date_trunc(window_kind,now());
    BEGIN
      INSERT INTO gh_tenant_budget_windows (scope,window_start,used,expires_at)
        SELECT tenant_scope,at_time,amount_to_claim,
          at_time+make_interval(secs=>window_seconds)
        WHERE amount_to_claim<=max_tenant
        ON CONFLICT(scope,window_start) DO UPDATE
          SET used=gh_tenant_budget_windows.used+EXCLUDED.used
          WHERE gh_tenant_budget_windows.used+EXCLUDED.used<=max_tenant
        RETURNING used INTO t;
      IF t IS NULL THEN RAISE EXCEPTION 'quota refused' USING ERRCODE='P0001'; END IF;
      INSERT INTO gh_tenant_budget_windows (scope,window_start,used,expires_at)
        SELECT client_scope,at_time,amount_to_claim,
          at_time+make_interval(secs=>window_seconds)
        WHERE amount_to_claim<=max_client
        ON CONFLICT(scope,window_start) DO UPDATE
          SET used=gh_tenant_budget_windows.used+EXCLUDED.used
          WHERE gh_tenant_budget_windows.used+EXCLUDED.used<=max_client
        RETURNING used INTO c;
      IF c IS NULL THEN RAISE EXCEPTION 'quota refused' USING ERRCODE='P0001'; END IF;
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
      RETURN;
    END;
    tenant_used:=t;
    client_used:=c;
    RETURN NEXT;
  END $body$`;
  await sql`CREATE INDEX IF NOT EXISTS gh_tenant_budget_expiry
    ON gh_tenant_budget_windows (expires_at)`;
  // Atomic active-resource reservations. A fresh PostgreSQL transaction
  // serializes the claim and COUNT; no pooled session locks or stale snapshots.
  // Even if the underlying create subsequently fails, the reservation expires
  // at its bounded TTL (failed creates are released best-effort).
  await sql`CREATE TABLE IF NOT EXISTS gh_tenant_storage_slots (
    kind TEXT NOT NULL CHECK (kind IN ('job','result')),
    client_key TEXT NOT NULL CHECK (length(client_key)=24),
    resource_id TEXT NOT NULL CHECK (length(resource_id) BETWEEN 20 AND 80),
    expires_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY(kind,resource_id)
  )`;
  await sql`CREATE INDEX IF NOT EXISTS gh_tenant_storage_expiry
    ON gh_tenant_storage_slots (expires_at)`;
  await sql`CREATE OR REPLACE FUNCTION gh_claim_tenant_storage_slot(
    slot_kind TEXT, slot_client TEXT, slot_id TEXT, ttl_seconds INTEGER,
    tenant_cap INTEGER, client_cap INTEGER
  ) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY INVOKER AS $body$
  DECLARE t INTEGER; c INTEGER;
  BEGIN
    IF slot_kind NOT IN ('job','result') OR length(slot_client)<>24
       OR length(slot_id)<20 OR length(slot_id)>80
       OR ttl_seconds<1 OR ttl_seconds>86400
       OR client_cap<1 OR tenant_cap<client_cap THEN RETURN FALSE; END IF;
    PERFORM pg_advisory_xact_lock(hashtext(current_schema()), hashtext(slot_kind));
    SELECT count(*) INTO t FROM gh_tenant_storage_slots
      WHERE kind=slot_kind AND expires_at>now();
    SELECT count(*) INTO c FROM gh_tenant_storage_slots
      WHERE kind=slot_kind AND client_key=slot_client AND expires_at>now();
    IF t>=tenant_cap OR c>=client_cap THEN RETURN FALSE; END IF;
    INSERT INTO gh_tenant_storage_slots(kind,client_key,resource_id,expires_at)
      VALUES(slot_kind,slot_client,slot_id,now()+make_interval(secs=>ttl_seconds))
      ON CONFLICT(kind,resource_id) DO UPDATE SET
        client_key=EXCLUDED.client_key,expires_at=EXCLUDED.expires_at
      WHERE gh_tenant_storage_slots.expires_at<=now();
    RETURN FOUND;
  END $body$`;
  await sql`CREATE INDEX IF NOT EXISTS gh_tenant_storage_expiry
    ON gh_tenant_storage_slots (expires_at)`;
  await sql`CREATE TABLE IF NOT EXISTS gh_tenant_runtime_metrics (
    hour TIMESTAMPTZ NOT NULL,
    event TEXT NOT NULL CHECK (event IN ('mcp','oauth','job','result','provider','refresh')),
    outcome TEXT NOT NULL CHECK (outcome IN ('ok','refused','throttled','error')),
    latency_bucket TEXT NOT NULL CHECK (latency_bucket IN ('lt100ms','lt500ms','lt2s','gte2s')),
    count BIGINT NOT NULL DEFAULT 0 CHECK (count >= 0),
    PRIMARY KEY(hour,event,outcome,latency_bucket)
  )`;
}

export async function claimTenantBudget(sql, { operation, clientId, amount = 1,
  tenantMax, clientMax, window = 'minute' }) {
  if (!allowedKinds.has(operation) || typeof clientId !== 'string' ||
      !clientId || clientId.length > 256 || !bound(amount, 1, 50 * 1024 * 1024) ||
      !bound(tenantMax, 1, 1000000000) || !bound(clientMax, 1, tenantMax) ||
      !['minute','day'].includes(window)) throw new TypeError('Invalid tenant capacity request.');
  const length = window === 'minute' ? 60 : 86400;
  const clientScope = operation + ':client:' + digest(clientId);
  const tenantScope = operation + ':tenant';
  // The PostgreSQL function uses row-level UPSERT serialization plus an
  // exception subtransaction. Both counters commit or both roll back.
  const at = window === 'minute' ? 'minute' : 'day';
  const rows=await sql`SELECT tenant_used,client_used FROM gh_claim_tenant_capacity(
    ${tenantScope},${clientScope},${at},${length},${amount},${tenantMax},${clientMax})`;
  if (rows.length!==1) throw new TenantCapacityError(operation,length);
  return { allowed: true, clientUsed: Number(rows[0].client_used), tenantUsed: Number(rows[0].tenant_used) };
}

export async function admitTenantMcp(sql, clientId) {
  const policy=await readTenantRuntimePolicy(sql);
  return claimTenantBudget(sql, { operation: 'mcp', clientId,
    clientMax: policy.mcpClientPerMinute, tenantMax: policy.mcpTenantPerMinute });
}
export async function admitTenantOAuth(sql, clientId) {
  const policy=await readTenantRuntimePolicy(sql);
  return claimTenantBudget(sql, { operation: 'oauth', clientId,
    clientMax: policy.oauthClientPerMinute, tenantMax: policy.oauthTenantPerMinute });
}

/** Measurements are aggregate, per-tenant SQL namespace, and contain only
 * fixed event/outcome/latency classes: no tokens, repository text, URL, user
 * identity, client IDs or untrusted exception messages. Never block cleanup
 * or leak credentials if telemetry storage is temporarily unavailable. */
export async function recordTenantMetric(sql, { event, outcome, durationMs }) {
  if (!allowedEvents.has(event) || !allowedOutcomes.has(outcome) ||
      !Number.isFinite(durationMs) || durationMs < 0)
    throw new TypeError('Tenant metric must use fixed nonsecret fields.');
  const latency = bucketFor(durationMs);
  await sql`INSERT INTO gh_tenant_runtime_metrics (hour,event,outcome,latency_bucket,count)
    VALUES (date_trunc('hour',now()),${event},${outcome},${latency},1)
    ON CONFLICT (hour,event,outcome,latency_bucket) DO UPDATE
      SET count=gh_tenant_runtime_metrics.count+1`;
  // Opportunistic bounded cleanup amortizes database IO instead of issuing
  // extra delete queries for every request. Private pilot admin revocation
  // performs explicit cleanup; no paid cron/database feature is enabled.
  if (Math.random() < 1/128) await purgeExpiredTenantRuntime(sql).catch(()=>{});
}

/**
 * C-8: a bounded, per-HTTP-request counter. The GitHub response never waits
 * on a telemetry upsert; the caller awaits one tenant-scoped flush in its
 * request-finally, including error/refusal responses. Never keep this globally
 * or attach user-provided paths, URLs, subjects, bodies or exception text.
 */
export function createTenantMetricBuffer(sql, { now = Date.now, random = Math.random } = {}) {
  if (typeof sql !== 'function' || typeof now !== 'function' || typeof random !== 'function')
    throw new TypeError('Tenant metric buffer needs a scoped SQL function and clock.');
  const counts = new Map();
  return {
    record({ event, outcome, durationMs }) {
      if (!allowedEvents.has(event) || !allowedOutcomes.has(outcome) ||
          !Number.isFinite(durationMs) || durationMs < 0)
        throw new TypeError('Tenant metric must use fixed nonsecret fields.');
      const hour = new Date(Math.floor(now() / 3600000) * 3600000).toISOString();
      const latency_bucket = bucketFor(durationMs);
      const key = [hour,event,outcome,latency_bucket].join('|');
      const old = counts.get(key);
      counts.set(key, { hour, event, outcome, latency_bucket, count: (old?.count ?? 0) + 1 });
    },
    async flush() {
      if (counts.size === 0) return 0;
      const records = [...counts.values()];
      counts.clear();
      // Bound the data to a small number of category/bucket/hour
      // combinations. One query preserves every individual event's count.
      await sql`INSERT INTO gh_tenant_runtime_metrics(hour,event,outcome,latency_bucket,count)
        SELECT item.hour::timestamptz,item.event,item.outcome,item.latency_bucket,item.count
        FROM jsonb_to_recordset(${JSON.stringify(records)}::jsonb)
          AS item(hour text,event text,outcome text,latency_bucket text,count bigint)
        ON CONFLICT (hour,event,outcome,latency_bucket) DO UPDATE
          SET count=gh_tenant_runtime_metrics.count+EXCLUDED.count`;
      if (random() < 1/128) await purgeExpiredTenantRuntime(sql).catch(() => {});
      return records.reduce((total,row) => total + row.count, 0);
    }
  };
}

/** Observe provider transport success/refusal/failure WITHOUT recording URLs,
 * GitHub IDs, authorization headers, response bodies or exception text.
 * Telemetry problems never alter a provider's returned result/error. */
export function withTenantProviderMetrics(sql, fetchImpl, { buffer = null } = {}) {
  if (typeof sql !== 'function' || typeof fetchImpl !== 'function' ||
      (buffer !== null && typeof buffer.record !== 'function'))
    throw new TypeError('Private provider transport requires a tenant database and fetch.');
  return async (...args) => {
    const started=Date.now();
    let outcome='error';
    try {
      const response=await fetchImpl(...args);
      outcome=response?.ok===true ? 'ok' : 'refused';
      return response;
    } finally {
      const metric={event:'provider',outcome,durationMs:Math.max(0,Date.now()-started)};
      if (buffer) {
        // A request-scoped buffer has no DB await on the GitHub critical path.
        try { buffer.record(metric); } catch { /* telemetry never changes the provider result */ }
      } else {
        // Existing OAuth/other consumers keep synchronous persistence unless
        // they also have a request-finally that can guarantee a flush.
        await recordTenantMetric(sql,metric).catch(()=>{});
      }
    }
  };
}

export async function purgeExpiredTenantRuntime(sql) {
  const buckets = await sql`DELETE FROM gh_tenant_budget_windows WHERE ctid IN (
    SELECT ctid FROM gh_tenant_budget_windows WHERE expires_at < now()
      ORDER BY expires_at LIMIT 200) RETURNING scope`;
  const metrics = await sql`DELETE FROM gh_tenant_runtime_metrics WHERE ctid IN (
    SELECT ctid FROM gh_tenant_runtime_metrics
      WHERE hour < date_trunc('hour',now())-interval '24 hours'
      ORDER BY hour LIMIT 200) RETURNING event`;
  const slots=await sql`DELETE FROM gh_tenant_storage_slots WHERE ctid IN (
    SELECT ctid FROM gh_tenant_storage_slots WHERE expires_at < now()
      ORDER BY expires_at LIMIT 200) RETURNING kind`;
  return { budgetRows: buckets.length, metricRows: metrics.length, slotRows: slots.length };
}

/** Reserve an active job/result slot atomically across multiple instances.
 * A client can only release its own hashed reservation; expired slots never
 * count as live. Application-side payload validation happens first. */
export async function reserveTenantStorage(sql, kind, clientId, resourceId, ttlSeconds) {
  if (!['job','result'].includes(kind) || typeof clientId!=='string' ||
      !clientId || clientId.length>256 || typeof resourceId!=='string' ||
      resourceId.length<20 || resourceId.length>80 ||
      !bound(ttlSeconds,1,86400)) throw new TypeError('Invalid tenant storage reservation.');
  const clientKey=digest(clientId);
  const policy=await readTenantRuntimePolicy(sql);
  const clientMax=kind==='job'?policy.jobsClientPending:policy.resultsClientActive;
  const tenantMax=kind==='job'?policy.jobsTenantPending:policy.resultsTenantActive;
  const rows=await sql`SELECT gh_claim_tenant_storage_slot(${kind},${clientKey},
    ${resourceId},${ttlSeconds},${tenantMax},${clientMax}) AS admitted`;
  if(rows.length!==1||rows[0].admitted!==true)
    throw new TenantCapacityError(kind,ttlSeconds);
}
export async function releaseTenantStorage(sql,kind,clientId,resourceId) {
  if (!['job','result'].includes(kind) || typeof clientId!=='string' ||
      typeof resourceId!=='string') return;
  await sql`DELETE FROM gh_tenant_storage_slots
    WHERE kind=${kind} AND resource_id=${resourceId} AND client_key=${digest(clientId)}`;
}

/** Facade scopes existing job/result store capacity to THIS tenant. Original
 * owner db and original GitHub write/approval gates are preserved verbatim. */
export function withTenantStorageLimits(db, sql, clientId) {
  if (!db || typeof db.createJob !== 'function' || typeof db.putResult !== 'function')
    throw new TypeError('Tenant capacity needs an existing isolated result/job store.');
  return {
    ...db,
    async createJob(input) {
      if (!bound(input?.ttlMinutes ?? 1440,1,TENANT_RUNTIME_LIMITS.jobMaxTtlMinutes))
        throw new TenantCapacityError('job',86400);
      // Job creation has no daily quota. Keep live-slot admission and TTL
      // checks independent of the number of jobs previously created.
      if (typeof input?.id!=='string' || !/^job_[0-9a-f]{16}$/.test(input.id) ||
          typeof input.connection!=='string' || !input.connection ||
          typeof input.owner!=='string' || !input.owner ||
          typeof input.kind!=='string' || !input.kind)
        throw new TypeError('Invalid tenant job request.');
      await reserveTenantStorage(sql,'job',clientId,input.id,(input.ttlMinutes??1440)*60);
      try {
        return await db.createJob(input);
      } catch(error) {
        await releaseTenantStorage(sql,'job',clientId,input.id).catch(()=>{});
        throw error;
      }
    },
    async finishJob(id,connection,detail) {
      const finished=await db.finishJob(id,connection,detail);
      if(finished) await releaseTenantStorage(sql,'job',clientId,id).catch(()=>{});
      return finished;
    },
    async putResult(input) {
      if (!bound(input?.ttlSeconds ?? 86400,1,TENANT_RUNTIME_LIMITS.resultMaxTtlSeconds))
        throw new TenantCapacityError('result',86400);
      let encoded;
      try { encoded=JSON.stringify(input?.body); } catch { throw new TypeError('Result is not valid JSON.'); }
      if (typeof encoded !== 'string') throw new TypeError('Result is not valid JSON.');
      const bytes=Buffer.byteLength(encoded);
      if (!bound(bytes,1,TENANT_RUNTIME_LIMITS.resultMaxBytes))
        throw new TenantCapacityError('result',86400);
      if(typeof input?.handle!=='string' || !/^res_[A-Za-z0-9_-]{20,64}$/.test(input.handle) ||
          typeof input.connection!=='string' || !input.connection)
        throw new TypeError('Invalid tenant result handle or connection.');
      await reserveTenantStorage(sql,'result',clientId,input.handle,input.ttlSeconds??86400);
      try {
        const policy=await readTenantRuntimePolicy(sql);
        await claimTenantBudget(sql,{operation:'result',clientId,amount:bytes,window:'day',
          clientMax:policy.resultsClientBytesPerDay,
          tenantMax:policy.resultsTenantBytesPerDay});
        return await db.putResult(input);
      } catch(error) {
        await releaseTenantStorage(sql,'result',clientId,input.handle).catch(()=>{});
        throw error;
      }
    }
  };
}
