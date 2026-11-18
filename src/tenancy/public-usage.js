// PUB-5 B: fair use and cost protection for the public service. Everything here is numbers only: how many assistant calls and
// real changes each public person made, per UTC day and per hour. No names, tokens, repository text or client ids are stored.
// Settings are plain environment values with a starting value (explained on /limits and in docs/OWNER-CHECKLIST.md).
// The free limits are fair-use limits per person. They are NOT a cap on the number of people.
const optionalWhole = (text) => (text === undefined || text === null || String(text).trim() === '' || /^(none|off|unlimited)$/i.test(String(text).trim())
  ? null : whole(text, null));
const whole = (text, fallback, { min = 1, max = 100000000 } = {}) => {
  const n = Number(text ?? fallback);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : fallback;
};
const SUBJECT = /^[1-9][0-9]{0,18}$/;

/** @param {Record<string,string|undefined>} env */
export function publicUsageLimits(env = process.env) {
  return Object.freeze({
    // LIMITS-MATCH-GITHUB-1 (owner ruling 2026-11-18): no usage limit of ours by default; GitHub's own
    // limits govern. Set these to gate usage (for example, free and paid tiers later). null = no limit.
    callsPerDay: optionalWhole(env.PUBLIC_FREE_CALLS_PER_DAY),
    writesPerHour: optionalWhole(env.PUBLIC_FREE_WRITES_PER_HOUR),
    // Numeric GitHub user ids (logins can be renamed and taken by someone else). Empty by default.
    unlimitedSubjects: Object.freeze(String(env.PUBLIC_UNLIMITED_SUBJECTS ?? '').split(',').map((s) => s.trim()).filter((s) => SUBJECT.test(s))),
    // 0 turns the automatic pause off; the manual switch GITHUB_PUBLIC_NEW_SIGNUPS=paused always works.
    costPauseCents: whole(env.PUBLIC_COST_PAUSE_CENTS, 5000, { min: 0 }),
    inactiveDays: whole(env.PUBLIC_INACTIVE_DAYS, 180, { max: 3650 })
  });
}

const secondsUntilNextUtcMidnight = (now = new Date()) =>
  Math.max(1, Math.ceil((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime()) / 1000));
const secondsUntilNextHour = (now = new Date()) => Math.max(1, 3600 - (now.getUTCMinutes() * 60 + now.getUTCSeconds()));
const group = (n) => Number(n).toLocaleString('en-US');

export const callLimitText = (limit) =>
  `You have reached today's free limit of ${group(limit)} calls. It resets at midnight UTC. See /limits.`;
export const changeLimitText = (limit) =>
  `You have reached this hour's free limit of ${group(limit)} changes. Reading and previews still work. It resets at the top of the hour. See /limits.`;

/** Keeps the tables small without a scheduled job: now and then, a little old data is removed (bounded, amortised). */
async function purgeOld(rootSql) {
  await rootSql`DELETE FROM gh_public_usage_daily WHERE ctid IN (SELECT ctid FROM gh_public_usage_daily
    WHERE day < (now() AT TIME ZONE 'UTC')::date - 400 LIMIT 500)`;
  await rootSql`DELETE FROM gh_public_usage_hourly WHERE ctid IN (SELECT ctid FROM gh_public_usage_hourly
    WHERE hour < now() - interval '48 hours' LIMIT 500)`;
}

/** @param {Function} rootSql shared database, tagged-template style */
export function createPublicUsage(rootSql, limits, { random = Math.random, now = () => new Date() } = {}) {
  const today = () => rootSql`SELECT (now() AT TIME ZONE 'UTC')::date AS d`;
  return Object.freeze({
    limits,
    /** True when this person's numeric GitHub id is on the unlimited list. */
    async isExempt(identityId) {
      if (!limits.unlimitedSubjects.length || typeof identityId !== 'string') return false;
      const rows = await rootSql`SELECT provider_subject FROM gh_tenant_identities WHERE id = ${identityId}::uuid AND provider = 'github'`;
      return rows.length === 1 && limits.unlimitedSubjects.includes(String(rows[0].provider_subject));
    },
    /** Counts `n` assistant calls for today unless that would pass the daily limit. One statement, so it is atomic. */
    async claimCalls(tenantId, { n = 1, exempt = false } = {}) {
      const limit = exempt || limits.callsPerDay === null ? 2147483647 : limits.callsPerDay;
      if (n > limit) return { ok: false, limit, retryAfterSeconds: secondsUntilNextUtcMidnight(now()), message: callLimitText(limit) };
      const rows = await rootSql`INSERT INTO gh_public_usage_daily (day, tenant_id, calls)
        VALUES ((now() AT TIME ZONE 'UTC')::date, ${tenantId}::uuid, ${n})
        ON CONFLICT (day, tenant_id) DO UPDATE SET calls = gh_public_usage_daily.calls + ${n}
          WHERE gh_public_usage_daily.calls + ${n} <= ${limit}
        RETURNING calls`;
      if (random() < 1 / 128) await purgeOld(rootSql).catch(() => {});
      return rows.length === 1 ? { ok: true, used: Number(rows[0].calls), limit }
        : { ok: false, limit, retryAfterSeconds: secondsUntilNextUtcMidnight(now()), message: callLimitText(limit) };
    },
    /** Reserves one real change for this hour unless the free limit is reached. One statement, so parallel calls cannot slip past
     *  the limit. The slot is handed back with `releaseWrite` if the change turns out not to count. Reads and previews never come here. */
    async reserveWrite(tenantId, { exempt = false } = {}) {
      const limit = exempt || limits.writesPerHour === null ? 2147483647 : limits.writesPerHour;
      const rows = await rootSql`INSERT INTO gh_public_usage_hourly (hour, tenant_id, writes) VALUES (date_trunc('hour', now()), ${tenantId}::uuid, 1)
        ON CONFLICT (hour, tenant_id) DO UPDATE SET writes = gh_public_usage_hourly.writes + 1
          WHERE gh_public_usage_hourly.writes + 1 <= ${limit}
        RETURNING writes`;
      return rows.length === 1 ? null
        : { limit, retryAfterSeconds: secondsUntilNextHour(now()), message: changeLimitText(limit) };
    },
    async releaseWrite(tenantId) {
      await rootSql`UPDATE gh_public_usage_hourly SET writes = writes - 1
        WHERE hour = date_trunc('hour', now()) AND tenant_id = ${tenantId}::uuid AND writes > 0`;
    },
    /** Counts one confirmed real change for the day (the hour was already counted when it was reserved). */
    async recordWrite(tenantId) {
      await rootSql`INSERT INTO gh_public_usage_daily (day, tenant_id, writes) VALUES ((now() AT TIME ZONE 'UTC')::date, ${tenantId}::uuid, 1)
        ON CONFLICT (day, tenant_id) DO UPDATE SET writes = gh_public_usage_daily.writes + 1`;
    },
    /** A call that ended in an unexpected error (not a refusal). */
    async recordError(tenantId) {
      await rootSql`INSERT INTO gh_public_usage_daily (day, tenant_id, errors) VALUES ((now() AT TIME ZONE 'UTC')::date, ${tenantId}::uuid, 1)
        ON CONFLICT (day, tenant_id) DO UPDATE SET errors = gh_public_usage_daily.errors + 1`;
    },
    /** "used today: 312 of 5,000" for My connection. */
    async usedToday(tenantId) {
      const rows = await rootSql`SELECT calls FROM gh_public_usage_daily WHERE day = (now() AT TIME ZONE 'UTC')::date AND tenant_id = ${tenantId}::uuid`;
      return { used: rows.length ? Number(rows[0].calls) : 0, limit: limits.callsPerDay };
    },
    /** The hook `createDispatch` takes: counts real changes one by one, even inside a batch. */
    dispatchHook(tenantId, { exempt = false } = {}) {
      return Object.freeze({
        beforeWrite: async () => await this.reserveWrite(tenantId, { exempt }),
        afterWrite: async () => { await this.recordWrite(tenantId); },
        release: async () => { await this.releaseWrite(tenantId); }
      });
    },
    today
  });
}
