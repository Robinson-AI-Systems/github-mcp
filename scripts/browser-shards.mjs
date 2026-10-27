// Exact browser-spec coverage and one disposable-Postgres CI job per file.
// Missing, duplicate, renamed and newly created specs fail CI until assigned.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BROWSER_SHARDS = Object.freeze({
  'sign-in': ['tests/browser/sign-in.test.js'],
  'home-page': ['tests/browser/home-page.test.js'],
  'fair-use': ['tests/browser/fair-use.test.js']
});

export function actualBrowserSpecs(dir = new URL('../tests/browser/', import.meta.url)) {
  // Match vitest.browser.config.js's tests/browser/**/*.test.js, including
  // nested suites. A non-recursive listing can silently drop new coverage.
  const root = dir instanceof URL ? fileURLToPath(dir) : dir;
  const specs = [];
  const walk = (folder, prefix = '') => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const relative = prefix ? prefix + '/' + entry.name : entry.name;
      if (entry.isDirectory()) walk(join(folder, entry.name), relative);
      else if (entry.isFile() && entry.name.endsWith('.test.js'))
        specs.push('tests/browser/' + relative);
    }
  };
  walk(root);
  return specs.sort();
}

export function validateBrowserShards(manifest = BROWSER_SHARDS, actual = actualBrowserSpecs()) {
  const count = new Map();
  for (const [shard, specs] of Object.entries(manifest)) {
    if (!/^[a-z][a-z-]*$/.test(shard) || !Array.isArray(specs) || !specs.length)
      throw new Error('Invalid or empty browser shard: ' + shard);
    for (const path of specs) count.set(path, (count.get(path) ?? 0) + 1);
  }
  const missing = actual.filter(path => !count.has(path));
  const repeated = [...count].filter(([, n]) => n !== 1).map(([path]) => path);
  const extra = [...count.keys()].filter(path => !actual.includes(path));
  if (missing.length || repeated.length || extra.length)
    throw new Error('Browser shard coverage mismatch: ' + JSON.stringify({ missing, repeated, extra }));
  return { shards: Object.keys(manifest).length, testFiles: actual.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const coverage = validateBrowserShards();
    const shard = process.argv[2];
    if (shard === '--check') console.log('Browser coverage OK: ' + JSON.stringify(coverage));
    else if (typeof shard === 'string' && Object.hasOwn(BROWSER_SHARDS, shard)) {
      const result = spawnSync('bash', ['scripts/local-postgres-test.sh', ...BROWSER_SHARDS[shard]], {
        stdio: 'inherit', timeout: 150000,
        env: { ...process.env, VITEST_CONFIG: 'vitest.browser.config.js' }
      });
      process.exitCode = result.error || result.signal ? 1 : result.status ?? 1;
      if (process.exitCode !== 0) console.error('Browser tests failed or timed out in shard ' + shard);
    } else throw new Error('Use --check or shard: ' + Object.keys(BROWSER_SHARDS).join(', '));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
