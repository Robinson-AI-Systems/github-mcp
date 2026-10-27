import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

test('nested browser files are inventoried and fail until assigned to a CI shard',()=>{
  const root = mkdtempSync(join(tmpdir(), 'browser-coverage-'));
  try {
    mkdirSync(join(root, 'oauth'), { recursive: true });
    writeFileSync(join(root, 'sign-in.test.js'), '');
    writeFileSync(join(root, 'oauth', 'new.test.js'), '');
    writeFileSync(join(root, 'oauth', 'helper.js'), '');
    const paths = actualBrowserSpecs(root);
    assert.deepEqual(paths, ['tests/browser/oauth/new.test.js', 'tests/browser/sign-in.test.js']);
    assert.throws(()=>validateBrowserShards({'sign-in':['tests/browser/sign-in.test.js']},paths),/missing/);
  } finally { rmSync(root, { recursive:true, force:true }); }
});
