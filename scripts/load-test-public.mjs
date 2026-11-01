#!/usr/bin/env node
// LAUNCH-1 / PUB-7: runs the local-only load test of the public sign-in (tests/load/public-load.test.js) on a throwaway local
// PostgreSQL and saves the numbers to docs/launch/load-test-result.json (read by `npm run launch:readiness`).
// Usage: node scripts/load-test-public.mjs [--people 50] [--at-once 10] [--no-save]
// It refuses to run against anything but the local fake service: a LOAD_TARGET_ORIGIN or --origin that is not the fake is an error.
// It never uses a real credential: the harness's fake GitHub hands out fake tokens.
import { spawnSync, execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadTestRecord } from '../src/launch/load-result.js';

export const FAKE_ORIGIN = 'https://connect.example.test';
/** Parses and checks the arguments; throws a plain-words error for anything that is not a local run. */
export function loadArgs(argv, env = {}) {
  const flag = (name, fallback) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : fallback; };
  const origin = flag('origin', env.LOAD_TARGET_ORIGIN);
  if (origin && origin !== FAKE_ORIGIN) throw new Error('Refusing: this load test only runs against the local fake service, never against ' + origin + '.');
  const people = flag('people', env.LOAD_PEOPLE ?? '50');
  const atOnce = flag('at-once', env.LOAD_CONCURRENCY ?? '10');
  if (!/^\d{1,3}$/.test(people) || !/^\d{1,2}$/.test(atOnce)) throw new Error('--people and --at-once must be whole numbers.');
  return { people, atOnce, save: !argv.includes('--no-save') };
}

async function main() {
  let opts;
  try { opts = loadArgs(process.argv.slice(2), process.env); } catch (error) { console.error(error.message); process.exit(2); }
  const run = spawnSync('bash', ['scripts/local-postgres-test.sh', '--reporter=verbose'], {
    stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8',
    env: { ...process.env, VITEST_CONFIG: 'vitest.load.config.js', LOAD_PEOPLE: opts.people, LOAD_CONCURRENCY: opts.atOnce, LOAD_TARGET_ORIGIN: '' }
  });
  const line = String(run.stdout ?? '').split('\n').find((l) => l.startsWith('LOAD-TEST-RESULT '));
  if (!line) { console.log(String(run.stdout ?? '').split('\n').slice(-30).join('\n')); process.exit(run.status || 1); }
  const report = JSON.parse(line.slice('LOAD-TEST-RESULT '.length));
  console.log(JSON.stringify(report, null, 2));
  if (opts.save && run.status === 0) {
    let commit = null;
    try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { commit = null; }
    const record = loadTestRecord(report, { commit });
    writeFileSync(new URL('../docs/launch/load-test-result.json', import.meta.url), JSON.stringify(record, null, 2) + '\n');
    console.log('Saved docs/launch/load-test-result.json');
  }
  process.exit(run.status ?? 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
