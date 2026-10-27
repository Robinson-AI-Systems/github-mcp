import test from 'node:test';
import assert from 'node:assert/strict';
import { BROWSER_SHARDS, actualBrowserSpecs, validateBrowserShards } from './browser-shards.mjs';

test('all three browser spec files are in exactly one required CI shard', () => {
  assert.deepEqual(validateBrowserShards(), { shards: 3, testFiles: 3 });
  assert.deepEqual(Object.keys(BROWSER_SHARDS), ['sign-in', 'home-page', 'fair-use']);
});
test('a newly added spec cannot vanish silently', () => {
  assert.throws(() => validateBrowserShards(BROWSER_SHARDS,
    [...actualBrowserSpecs(), 'tests/browser/new.test.js']), /missing/);
});
test('duplicate, wrong and empty shard manifests fail', () => {
  assert.throws(() => validateBrowserShards({ a: actualBrowserSpecs(), b: actualBrowserSpecs() }), /repeated/);
  assert.throws(() => validateBrowserShards({ a: ['tests/browser/missing.test.js'] }), /missing/);
  assert.throws(() => validateBrowserShards({ a: [] }), /Invalid or empty/);
});
