// PUB-7: the saved result of the local-only load test (scripts/load-test-public.mjs → docs/launch/load-test-result.json), which the
// launch readiness report reads. Numbers and fixed words only: no error text, no logins, no tokens, no addresses but the fake one.
export const LOAD_RESULT_KIND = 'robinson-github-mcp-load-test';
export const LOAD_TARGET = 'local fake service: real api/ handlers, fake GitHub, throwaway local PostgreSQL';
const SHA = /^[0-9a-f]{40}$/;
const timing = (t) => ({ n: Number(t?.n) || 0, p50_ms: t?.p50_ms ?? null, p95_ms: t?.p95_ms ?? null, max_ms: t?.max_ms ?? null });

/** Turns the test's LOAD-TEST-RESULT report into the committed record (drops `first_errors`, which is free text). */
export function loadTestRecord(report, { ranAt = new Date().toISOString(), commit = null } = {}) {
  if (!report || typeof report !== 'object') throw new TypeError('No load-test report to save.');
  return {
    kind: LOAD_RESULT_KIND, version: 1, ran_at: ranAt, source_commit: SHA.test(String(commit ?? '')) ? commit : null, target: LOAD_TARGET,
    people: Number(report.people), at_once: Number(report.at_once), calls_per_person: Number(report.calls_per_person),
    total_seconds: Number(report.total_seconds), errors: Number(report.errors),
    sign_in: timing(report.sign_in), whoami_calls: timing(report.whoami_calls),
    database_rows: { tenants: Number(report.database_rows?.tenants) || 0, identities: Number(report.database_rows?.identities) || 0,
      public_clients: Number(report.database_rows?.public_clients) || 0 },
    note: 'Our own code under load on one machine. Not Vercel or Neon speed or price, and not a test of the live service.'
  };
}

/** Minimums the readiness report asks of a saved run. */
export const LOAD_MINIMUM = Object.freeze({ people: 50, atOnce: 10, maxAgeDays: 90 });

/** @returns {{ ok: boolean, problems: string[] }} whether a saved record is a usable, recent, error-free run. */
export function checkLoadRecord(record, { now = Date.now() } = {}) {
  const problems = [];
  if (!record || record.kind !== LOAD_RESULT_KIND || record.version !== 1) return { ok: false, problems: ['no saved load-test result'] };
  if (record.target !== LOAD_TARGET) problems.push('the saved run was not against the local fake service');
  if (!(record.people >= LOAD_MINIMUM.people)) problems.push(`only ${record.people} simulated people (need ${LOAD_MINIMUM.people})`);
  if (!(record.at_once >= LOAD_MINIMUM.atOnce)) problems.push(`only ${record.at_once} at once (need ${LOAD_MINIMUM.atOnce})`);
  if (record.errors !== 0) problems.push(`${record.errors} errors in the saved run`);
  if (record.sign_in?.n !== record.people || record.whoami_calls?.n !== record.people * record.calls_per_person) problems.push('the saved run did not finish every sign-in and call');
  const at = Date.parse(record.ran_at);
  if (!Number.isFinite(at)) problems.push('the saved run has no date');
  else if (now - at > LOAD_MINIMUM.maxAgeDays * 86400000) problems.push(`the saved run is older than ${LOAD_MINIMUM.maxAgeDays} days`);
  return { ok: problems.length === 0, problems };
}
