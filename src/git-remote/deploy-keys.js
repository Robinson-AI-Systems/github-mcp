// GIT-SSH-LEG-1: the broker's deploy-key steps for the worker's SSH leg (src/git-remote/api.js, op=key). Every call goes
// through the shared GitHub client with the same credential the push itself uses (the app, or the person with "Act as
// me"). Only keys whose title matches PUSH_KEY_TITLE exactly are ever removed, so nobody else's deploy keys are touched.
// Each add and each removal is its own change-log row marked as an access change (who, which repository, which key).

/** Kept in step with workers/native-git/github-ssh.js (the worker makes the title; this side only checks it). */
export const PUSH_KEY_TITLE = /^GitHub Unleashed push [a-f0-9]{12} \(auto-removed\)$/;
export const pushKeyTitle = id => `GitHub Unleashed push ${id} (auto-removed)`;
export const STALE_KEY_MS = 15 * 60000;
export const KEY_JOURNAL_TOOL = 'github_git_remote_deploy_key';

/** A plain OpenSSH ed25519 public key (type and 32-byte key, nothing else). */
export function validPublicKey(text) {
 const m = /^ssh-ed25519 ([A-Za-z0-9+/]{68})$/.exec(String(text ?? ''));
 if (!m) return false;
 const blob = Buffer.from(m[1], 'base64');
 return blob.length === 51 && blob.readUInt32BE(0) === 11 && blob.subarray(4, 15).toString('latin1') === 'ssh-ed25519' && blob.readUInt32BE(15) === 32;
}

/** Why GitHub refused to add the key, in plain words; the push then goes over HTTPS. */
export function addRefusal(error) {
 const status = Number(error?.status ?? 0);
 const text = JSON.stringify(error?.response?.data ?? error?.message ?? '').toLowerCase();
 if (/deploy keys? (are|is) (disabled|not allowed)|disabled for this repository|deploy_keys/.test(text)) return "this organization's policy turns deploy keys off";
 if (status === 403 || status === 404) return 'the credential this push uses cannot add deploy keys to this repository (GitHub needs Administration write)';
 if (status === 422) return 'GitHub did not accept the temporary deploy key';
 return `GitHub did not add the temporary deploy key${status ? ` (status ${status})` : ''}`;
}

const as = actedAs => ({ request: { robinsonAs: actedAs === 'you' ? 'me' : 'app' } });

/** Adds the public key as a write deploy key on exactly owner/repo. */
export async function addPushKey(gh, { owner, repo, publicKey, id, actedAs }) {
 const { data } = await gh.request('POST /repos/{owner}/{repo}/keys', { owner, repo, title: pushKeyTitle(id), key: publicKey, read_only: false, ...as(actedAs) });
 if (!Number.isSafeInteger(data?.id)) throw Object.assign(new Error('no key id'), { status: 0 });
 return { keyId: data.id, title: pushKeyTitle(id) };
}

async function getKey(gh, owner, repo, keyId, actedAs) {
 try { return (await gh.request('GET /repos/{owner}/{repo}/keys/{key_id}', { owner, repo, key_id: keyId, ...as(actedAs) })).data; }
 catch (error) { if (Number(error?.status) === 404) return null; throw error; }
}

/**
 * Removes one of this service's push keys and reads back that it is gone. A key that is already gone counts as removed;
 * a key with any other title is refused (never deleted).
 */
export async function removePushKey(gh, { owner, repo, keyId, actedAs }) {
 const key = await getKey(gh, owner, repo, keyId, actedAs);
 if (!key) return { removed: true, already: true, title: null };
 if (!PUSH_KEY_TITLE.test(String(key.title ?? ''))) return { removed: false, refused: 'not one of this service\'s temporary push keys' };
 try { await gh.request('DELETE /repos/{owner}/{repo}/keys/{key_id}', { owner, repo, key_id: keyId, ...as(actedAs) }); }
 catch (error) { if (Number(error?.status) !== 404) throw error; }
 const after = await getKey(gh, owner, repo, keyId, actedAs);
 return { removed: after === null, already: false, title: key.title };
}

/** Removes this service's push keys on owner/repo older than 15 minutes (leftovers of pushes whose removal failed). */
export async function sweepPushKeys(gh, { owner, repo, now, actedAs, max = 300 }) {
 const keys = [];
 for (let page = 1; page <= Math.ceil(max / 100); page++) {
  const { data } = await gh.request('GET /repos/{owner}/{repo}/keys', { owner, repo, per_page: 100, page, ...as(actedAs) });
  keys.push(...(Array.isArray(data) ? data : []));
  if (!Array.isArray(data) || data.length < 100) break;
 }
 const stale = keys.filter(k => PUSH_KEY_TITLE.test(String(k.title ?? '')) && Number.isSafeInteger(k.id) && now - Date.parse(k.created_at) > STALE_KEY_MS);
 const removed = [], failed = [];
 for (const k of stale) {
  try { (await removePushKey(gh, { owner, repo, keyId: k.id, actedAs })).removed ? removed.push(k) : failed.push(k); } catch { failed.push(k); }
 }
 return { removed: removed.map(k => ({ id: k.id, title: k.title })), failed: failed.map(k => ({ id: k.id, title: k.title })) };
}
