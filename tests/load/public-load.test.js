// LAUNCH-1 part B: a LOCAL-ONLY load test of the public sign-in. N simulated people (default 50, LOAD_PEOPLE) each register an
// app, sign in, approve, swap the code for tokens and call github_whoami five times at once. Everything runs against the real
// api/ handlers, a fake GitHub and a throwaway localhost PostgreSQL: it can never reach production, GitHub or the internet.
// Run with `npm run test:load` (or `node scripts/load-test-public.mjs`). Prints p50/p95 latency, errors and database row counts;
// the script turns that line into docs/launch/load-test-result.json, which the PUB-7 readiness report reads.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('@neondatabase/serverless', async () => { const h = await import('../browser/harness.js'); return { neon: () => h.fakeNeon() }; });
import { ORIGIN, startWorld } from '../browser/setup.js';
import { runPublicLoad } from './public-load-run.js';

const PEOPLE = Math.min(Math.max(Number.parseInt(process.env.LOAD_PEOPLE ?? '50', 10) || 50, 1), 500);
const AT_ONCE = Math.min(Math.max(Number.parseInt(process.env.LOAD_CONCURRENCY ?? '10', 10) || 10, 1), 50);
const CALLS = 5;
let world;
beforeAll(async () => {
  // Never aim this at a real service: the only origin it knows is the fake one the harness serves.
  if (process.env.LOAD_TARGET_ORIGIN && process.env.LOAD_TARGET_ORIGIN !== ORIGIN) throw new Error('The load test only runs against the local fake service.');
  world = await startWorld();
  // The sign-up caps are for real life; this test measures the service, not the caps.
  process.env.GITHUB_PUBLIC_MAX_CLIENTS = '100000'; process.env.GITHUB_PUBLIC_MAX_OPEN_FLOWS = '100000';
});
afterAll(async () => { await world?.close(); });

describe('public sign-in under load (local fake only)', () => {
  it(`${PEOPLE} people sign in and call github_whoami ${CALLS} times each, at ${AT_ONCE} at a time`, async () => {
    const report = await runPublicLoad(world, { people: PEOPLE, atOnce: AT_ONCE, calls: CALLS });
    console.log('LOAD-TEST-RESULT ' + JSON.stringify(report));
    expect(report.first_errors).toEqual([]);
    expect(report.errors).toBe(0);
    expect(report.sign_in.n).toBe(PEOPLE);
    expect(report.whoami_calls.n).toBe(PEOPLE * CALLS);
  });
});
