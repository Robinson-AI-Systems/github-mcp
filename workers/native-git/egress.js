// WORKER-RESOLV-GUARD-1: the worker's own timed resolver/egress check.
// The 2026-11-11 failures: the PC worker is host-networked, so its resolver is whatever
// /etc/resolv.conf Docker captured when the container started. Twice in one morning the
// container started before WSL had populated the host resolver file, captured an empty
// one, and then could not resolve github.com at all — while every health signal, being
// loopback-only, kept reporting healthy. This monitor is the missing signal: from inside
// the worker's own network, it resolves the two names the worker exists to reach, each
// with an explicit timeout, on a short interval, and reports the verdict (with the round
// trip time) in signed capabilities, so github_server_status can say "down" when the
// worker answers but cannot resolve. A verdict is only ever as old as one interval; an
// untimed "it answered eventually" is never treated as a pass.
import { resolve4 } from 'node:dns/promises';

export const EGRESS_NAMES = Object.freeze(['github.com', 'api.github.com']);
export const EGRESS_PROBE_TIMEOUT_MS = 2500;
export const EGRESS_PROBE_INTERVAL_MS = 30000;

/** One name, timed: resolves to { ok, ms }; a hang past timeoutMs is a failure, never a wait. */
async function timedResolve(resolve4Impl, name, timeoutMs) {
  const start = performance.now();
  let timer;
  const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('egress probe timed out')), timeoutMs); timer.unref?.(); });
  try {
    const addresses = await Promise.race([resolve4Impl(name), limit]);
    return { ok: Array.isArray(addresses) && addresses.length > 0, ms: Math.round(performance.now() - start) };
  } catch {
    return { ok: false, ms: Math.round(performance.now() - start) };
  } finally { clearTimeout(timer); }
}

/**
 * Background resolver monitor. report() returns the latest verdict:
 * { status: 'unknown' } until the first probe completes, then
 * { status: 'ok' | 'down', ms, names: { <name>: 'ok' | 'down' }, checked_at }.
 * 'unknown' is deliberately neutral: callers must not fail a worker that has not probed yet.
 */
export function createEgressMonitor({ names = EGRESS_NAMES, timeoutMs = EGRESS_PROBE_TIMEOUT_MS, intervalMs = EGRESS_PROBE_INTERVAL_MS, resolve4Impl = resolve4, now = Date.now } = {}) {
  let latest = { status: 'unknown', ms: null, names: {}, checked_at: null };
  let inFlight = null;
  let timer = null;
  const probeNow = () => {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const start = performance.now();
      const results = await Promise.all(names.map(async (name) => [name, await timedResolve(resolve4Impl, name, timeoutMs)]));
      latest = {
        status: results.every(([, r]) => r.ok) ? 'ok' : 'down',
        ms: Math.round(performance.now() - start),
        names: Object.fromEntries(results.map(([name, r]) => [name, r.ok ? 'ok' : 'down'])),
        checked_at: new Date(now()).toISOString()
      };
      return latest;
    })().finally(() => { inFlight = null; });
    return inFlight;
  };
  return {
    probeNow,
    report: () => latest,
    start() { if (!timer) { void probeNow(); timer = setInterval(() => { void probeNow(); }, intervalMs); timer.unref?.(); } },
    stop() { if (timer) clearInterval(timer); timer = null; }
  };
}
