// GIT-SSH-LEG-1 request shapes: the broker's deploy-key steps (add, read, delete, list for the sweep) go to the fake
// GitHub, which validates every request against the vendored OpenAPI description. Keys are made at runtime.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { bareOctokit } from '../../src/github/client.js';
import { addPushKey, removePushKey, sweepPushKeys, pushKeyTitle } from '../../src/git-remote/deploy-keys.js';
import { makeWorld } from '../../test/helpers/write-contract.js';

const publicKey = () => execFileSync('sh', ['-c', `d=$(mktemp -d) && ssh-keygen -q -t ed25519 -N '' -f "$d/k" && cat "$d/k.pub" && rm -rf "$d"`]).toString().trim().split(' ').slice(0, 2).join(' ');

describe('deploy key shapes against the pinned schema', () => {
 it('create, get, delete and list deploy keys are schema-valid', async () => {
  const w = await makeWorld({ mode: 'production', profile: 'full' });
  const now = Date.parse('2026-11-03T12:00:00Z');
  const keys = new Map([[7, { id: 7, title: pushKeyTitle('aaaaaaaaaaaa'), created_at: '2026-11-03T11:00:00Z' }], [8, { id: 8, title: 'someone else', created_at: '2026-11-03T11:00:00Z' }]]);
  const view = k => ({ id: k.id, key: 'ssh-ed25519 AAAA', url: `https://api.github.com/repos/example-org/hello/keys/${k.id}`, title: k.title, verified: true, created_at: k.created_at, read_only: false, added_by: null, last_used: null, enabled: true });
  w.gh.when('POST /repos/{owner}/{repo}/keys').replyWith(req => { const k = { id: 9, title: req.body.title, created_at: '2026-11-03T12:00:00Z' }; keys.set(9, k); return { status: 201, body: view(k) }; });
  w.gh.when('GET /repos/{owner}/{repo}/keys').replyWith(() => ({ status: 200, body: [...keys.values()].map(view) }));
  w.gh.when('GET /repos/{owner}/{repo}/keys/{key_id}').replyWith(req => keys.has(Number(req.params.key_id)) ? { status: 200, body: view(keys.get(Number(req.params.key_id))) } : { status: 404, body: { message: 'Not Found' } });
  w.gh.when('DELETE /repos/{owner}/{repo}/keys/{key_id}').replyWith(req => { keys.delete(Number(req.params.key_id)); return { status: 204, body: null }; });
  const gh = bareOctokit({ token: 'FAKE-installation-token-for-shapes', fetch: w.gh.fetch });
  const added = await addPushKey(gh, { owner: 'example-org', repo: 'hello', publicKey: publicKey(), id: 'bbbbbbbbbbbb', actedAs: 'app' });
  expect(added).toEqual({ keyId: 9, title: pushKeyTitle('bbbbbbbbbbbb') });
  expect(await sweepPushKeys(gh, { owner: 'example-org', repo: 'hello', now, actedAs: 'app' })).toEqual({ removed: [{ id: 7, title: pushKeyTitle('aaaaaaaaaaaa') }], failed: [] });
  expect(await removePushKey(gh, { owner: 'example-org', repo: 'hello', keyId: 9, actedAs: 'app' })).toEqual({ removed: true, already: false, title: pushKeyTitle('bbbbbbbbbbbb') });
  expect(await removePushKey(gh, { owner: 'example-org', repo: 'hello', keyId: 8, actedAs: 'app' })).toMatchObject({ removed: false, refused: expect.any(String) });
  expect([...keys.keys()]).toEqual([8]);
  expect(w.gh.calls.map(c => c.route)).toEqual(expect.arrayContaining(['POST /repos/{owner}/{repo}/keys', 'GET /repos/{owner}/{repo}/keys', 'GET /repos/{owner}/{repo}/keys/{key_id}', 'DELETE /repos/{owner}/{repo}/keys/{key_id}']));
  expect(w.gh.unmatched).toEqual([]);
  expect(w.gh.invalid).toEqual([]);
 });
});
