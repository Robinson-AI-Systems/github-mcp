// FLEET-2 follow-up: use the runtime image published for this server's own commit.
// The "Publish runtime image" workflow tags each release `<commit sha>`. When the
// operator has not pinned PLAYGROUND_IMAGE, a new allocation asks the public
// registry (anonymously) for the exact digest of that tag and pins `repo@digest` in
// its plan. Any failure (not published yet, private, registry down) returns null and
// the allocation builds from source exactly as before. Only public, anonymous reads;
// no credential ever goes to the registry.
// FLEET-2: the same workflow also publishes `<commit sha>-slim` (no Chromium or
// PostgreSQL) for small jobs; ask for it with `variant: 'slim'`.
const REPO = /^ghcr\.io\/[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9][a-z0-9._-]{0,99}$/;
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const ACCEPT = 'application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.v2+json';
const found = new Map(); // positive results only: a tag's digest never changes once published

export const IMAGE_VARIANTS = Object.freeze(['full', 'slim']);
export async function resolvePrebuiltImage(env = {}, {fetch: fetchImpl = globalThis.fetch, timeoutMs = 5000, variant = 'full'} = {}) {
  if (env.PLAYGROUND_IMAGE) return null; // an operator pin always wins (and is used as-is)
  const repo = env.PLAYGROUND_IMAGE_REPOSITORY, sha = env.PLAYGROUND_BUILD_SOURCE_SHA ?? env.VERCEL_GIT_COMMIT_SHA;
  if (!REPO.test(repo ?? '') || !SHA.test(sha ?? '') || typeof fetchImpl !== 'function' || !IMAGE_VARIANTS.includes(variant)) return null;
  const tag = variant === 'slim' ? sha + '-slim' : sha;
  const cacheKey = repo + ':' + tag;
  if (found.has(cacheKey)) return found.get(cacheKey);
  const path = repo.slice('ghcr.io/'.length);
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const tokenResponse = await fetchImpl(`https://ghcr.io/token?scope=repository:${path}:pull`, {signal, redirect: 'error'});
    if (tokenResponse.status !== 200) return null;
    const token = (await tokenResponse.json())?.token;
    if (typeof token !== 'string' || !token || token.length > 8192) return null;
    const manifest = await fetchImpl(`https://ghcr.io/v2/${path}/manifests/${tag}`, {method: 'HEAD', signal, redirect: 'error', headers: {Authorization: 'Bearer ' + token, Accept: ACCEPT}});
    const digest = manifest.headers?.get?.('docker-content-digest');
    if (manifest.status !== 200 || !DIGEST.test(digest ?? '')) return null;
    const image = `${repo}@${digest}`;
    found.set(cacheKey, image);
    return image;
  } catch { return null; }
}
export const _resetPrebuiltImageCache = () => found.clear();
