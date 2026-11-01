import {afterEach, describe, expect, it} from 'vitest';
import {resolvePrebuiltImage, _resetPrebuiltImageCache} from '../../src/playground/prebuilt-image.js';

const SHA = 'c'.repeat(40), DIGEST = 'sha256:' + 'd'.repeat(64), REPO = 'ghcr.io/example-org/runtime';
const env = {PLAYGROUND_IMAGE_REPOSITORY: REPO, VERCEL_GIT_COMMIT_SHA: SHA};
function registry({tokenStatus = 200, manifestStatus = 200, digest = DIGEST, throws = false} = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({url, init});
    if (throws) throw new Error('network down');
    if (url.startsWith('https://ghcr.io/token')) return {status: tokenStatus, json: async () => ({token: 'anon-pull-token'})};
    return {status: manifestStatus, headers: {get: k => (k === 'docker-content-digest' ? digest : null)}};
  };
  return {fetch, calls};
}
afterEach(() => _resetPrebuiltImageCache());

describe('resolvePrebuiltImage', () => {
  it('pins the published digest of this exact commit using only anonymous registry reads', async () => {
    const r = registry();
    expect(await resolvePrebuiltImage(env, {fetch: r.fetch})).toBe(`${REPO}@${DIGEST}`);
    expect(r.calls[0].url).toBe('https://ghcr.io/token?scope=repository:example-org/runtime:pull');
    expect(r.calls[0].init.headers).toBeUndefined();
    expect(r.calls[1]).toMatchObject({url: `https://ghcr.io/v2/example-org/runtime/manifests/${SHA}`, init: {method: 'HEAD'}});
    expect(r.calls[1].init.headers.Authorization).toBe('Bearer anon-pull-token');
  });
  it('remembers a found digest and asks the registry only once', async () => {
    const r = registry();
    await resolvePrebuiltImage(env, {fetch: r.fetch}); await resolvePrebuiltImage(env, {fetch: r.fetch});
    expect(r.calls).toHaveLength(2);
  });
  it('falls back to a source build (null) when the image is missing, private, malformed or unreachable', async () => {
    for (const opts of [{manifestStatus: 404}, {tokenStatus: 401}, {digest: 'sha256:short'}, {throws: true}]) {
      _resetPrebuiltImageCache();
      expect(await resolvePrebuiltImage(env, {fetch: registry(opts).fetch})).toBeNull();
    }
  });
  it('never looks anything up when an operator pin exists or the settings are not usable', async () => {
    const r = registry();
    expect(await resolvePrebuiltImage({...env, PLAYGROUND_IMAGE: `${REPO}@${DIGEST}`}, {fetch: r.fetch})).toBeNull();
    expect(await resolvePrebuiltImage({VERCEL_GIT_COMMIT_SHA: SHA}, {fetch: r.fetch})).toBeNull();
    expect(await resolvePrebuiltImage({...env, PLAYGROUND_IMAGE_REPOSITORY: 'docker.io/evil/x'}, {fetch: r.fetch})).toBeNull();
    expect(await resolvePrebuiltImage({...env, VERCEL_GIT_COMMIT_SHA: 'main'}, {fetch: r.fetch})).toBeNull();
    expect(r.calls).toHaveLength(0);
  });
});
