// The body of the LOCAL-ONLY load test (LAUNCH-1 B, PUB-7): N simulated people each register an app, sign in, approve, swap the
// code for tokens and call github_whoami several times at once, through the real api/ handlers, the fake GitHub and a throwaway
// localhost PostgreSQL (the browser harness's startWorld()). Shared by tests/load/public-load.test.js (the full run) and the small
// smoke run in tests/browser/launch-pages.test.js. It only knows the harness's fake origin and never reaches GitHub or the internet.
import { performance } from 'node:perf_hooks';
import { ORIGIN, appFinishes, appStartsSignIn } from '../browser/setup.js';

const percentile = (sorted, p) => (sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] * 10) / 10 : null);
const summary = (values) => { const s = [...values].sort((a, b) => a - b); return { n: s.length, p50_ms: percentile(s, 50), p95_ms: percentile(s, 95), max_ms: percentile(s, 100) }; };
const form = (fields) => new URLSearchParams(fields).toString();

/** @returns {Promise<object>} the report: people, at_once, calls_per_person, timings, errors and database row counts. */
export async function runPublicLoad(world, { people = 50, atOnce = 10, calls = 5, prefix = 'load-', firstId = 900000 } = {}) {
  if (!world || typeof world.call !== 'function') throw new Error('The load test needs the local harness world.');
  const signIn = async (index) => {
    const gh = world.github;
    const person = gh.addPerson({ login: prefix + index, id: firstId + index, authorized: true });
    gh.install(person, person.login);
    const started = await appStartsSignIn(world, { name: 'Load test ' + index });
    const url = new URL(started.url);
    const step1 = await world.call({ method: 'GET', path: url.pathname + url.search });
    if (!step1.headers.location) throw new Error('authorize gave ' + step1.status + ' ' + step1.text.slice(0, 160).replace(/\s+/g, ' '));
    const state = new URL(step1.headers.location).searchParams.get('state');
    const code = 'loadcode' + prefix + index + Math.random().toString(36).slice(2);
    gh.state.codes.set(code, person);
    const step2 = await world.call({ method: 'GET', path: '/api/github/user-callback?code=' + code + '&state=' + encodeURIComponent(state) });
    const handle = /name="handle" value="([^"]+)"/.exec(step2.text)?.[1];
    if (step2.status !== 200 || !handle) throw new Error('approve page not shown (' + step2.status + ')');
    const step3 = await world.call({ method: 'POST', path: '/api/oauth/authorize', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: ORIGIN },
      body: form({ step: 'approve', handle, choice: 'approve' }) });
    const link = /href="([^"]*oauth\/callback[^"]*)"/.exec(step3.text)?.[1]?.replaceAll('&amp;', '&');
    if (step3.status !== 200 || !link) throw new Error('approve failed (' + step3.status + ')');
    const back = new URL(link);
    return appFinishes(world, started, { code: back.searchParams.get('code'), state: back.searchParams.get('state') });
  };
  const whoami = async (accessToken) => {
    const headers = { authorization: 'Bearer ' + accessToken, accept: 'application/json, text/event-stream', 'content-type': 'application/json' };
    const init = await world.call({ method: 'POST', path: '/api/mcp', headers, body: { jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'load-test', version: '1' } } } });
    if (init.status !== 200) throw new Error('initialize ' + init.status);
    const session = init.headers['mcp-session-id'];
    const res = await world.call({ method: 'POST', path: '/api/mcp', headers: { ...headers, ...(session ? { 'mcp-session-id': session } : {}) },
      body: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'github_whoami', arguments: {} } } });
    if (res.status !== 200 || !res.text.includes(prefix)) throw new Error('whoami ' + res.status);
  };

  const signInMs = [], callMs = [], errors = [];
  let next = 0;
  const started = performance.now();
  // One person goes first on their own: the very first request creates the database tables, which in real life already exist.
  // (Many first-ever requests creating the same tables at once is a test-only artifact of starting from an empty database.)
  const first = next++;
  const t0 = performance.now();
  const firstTokens = await signIn(first);
  signInMs.push(performance.now() - t0);
  await whoami(firstTokens.access_token);
  callMs.push(performance.now() - t0);
  for (let i = 1; i < calls; i++) { const t = performance.now(); await whoami(firstTokens.access_token); callMs.push(performance.now() - t); }
  const worker = async () => {
    for (;;) {
      const index = next++;
      if (index >= people) return;
      try {
        const t1 = performance.now();
        const tokens = await signIn(index);
        signInMs.push(performance.now() - t1);
        await Promise.all(Array.from({ length: calls }, async () => {
          const t2 = performance.now();
          try { await whoami(tokens.access_token); callMs.push(performance.now() - t2); } catch (error) { errors.push('call: ' + error.message); }
        }));
      } catch (error) { errors.push('sign-in: ' + error.message); }
    }
  };
  await Promise.all(Array.from({ length: atOnce }, worker));
  const seconds = Math.round((performance.now() - started) / 100) / 10;
  const count = async (table) => Number((await world.pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n);
  return {
    people, at_once: atOnce, calls_per_person: calls, total_seconds: seconds,
    sign_in: summary(signInMs), whoami_calls: summary(callMs), errors: errors.length, first_errors: errors.slice(0, 3),
    database_rows: { tenants: await count('gh_tenants'), identities: await count('gh_tenant_identities'), public_clients: await count('gh_public_clients') },
    note: 'Fake GitHub and a throwaway local database: these numbers show how our own code behaves under load, not what Vercel or Neon will charge or how fast they are.'
  };
}
