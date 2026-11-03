// GIT-REMOTE-1: the two small function endpoints behind the git remote.
//
//  POST /git-remote/exchange  (code=rgc_…)  — swaps a one-time, ten-minute code for a fresh session key
//    exactly once and answers in `git credential` format, so the issued command pipes it straight into
//    `git credential approve` and the key is never printed. Only the key's SHA-256 is stored.
//  POST /api/git-remote?op=broker           — called by the native Git worker with the signed claim that
//    Routing Middleware issued for one Git request. It re-checks the key and its connection, re-checks
//    the repository with GitHub, and for a push runs the same guard gates and journal as
//    github_git_workspace_run push, then returns a GitHub credential for that one request (short-lived,
//    repository-scoped App token for fetches; the push uses the same credential choice as the native
//    push, so "Act as me" attribution is kept). Each claim step works once (nonce).
//    op=report closes the push's change-log row with the outcome the worker observed on GitHub.
//    phase=renew (GIT-DIRECT-1) mints a fresh credential for the next batch of a very large push whose
//    change-log row is still open.
//  POST /api/git-remote?op=authorize        — GIT-DIRECT-1: the native worker's direct git host asks
//    here, signed by the worker key pinned at setup, whether one Git request may be served. It sends
//    the session key's id and SHA-256 (never the key); the answer is the same signed claim Routing
//    Middleware forwards on the domain door, plus the stored per-push limit.
import { createPublicKey, verify as verifySignature } from 'node:crypto';
import { CODE_PREFIX, GIT_USERNAME, checkKey, liveConnection, newSessionKey, openKeyScope, parseSecret, remotePath, sha256 } from './keys.js';
import { publicOrigin, paramsOf } from '../core/http.js';
import { GITHUB_PUSH_LIMIT_BYTES, REMOTE_REPORT_GRACE_MS, verifyRemoteClaim } from '../native-git/protocol.js';
import { nativeWorkerPublicKey } from '../native-git/signing.js';
import { authorizeGitRequest } from './authorize.js';
import { directHostOf } from '../native-git/pool-config.js';
import { noteStray } from '../native-git/pool-audience.js';
import { DIRECT_HEADER, DIRECT_SKEW_MS, DIRECT_WORKER_KEY, cleanOrigin, directPayload } from './wire.js';

const plain = (res, status, message) => { res.statusCode = status; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(message + '\n'); };
const json = (res, status, value) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(value)); };
const NEW_CODE = 'Ask your AI to call github_git_remote_setup again and run the new command within 10 minutes.';

/** POST /git-remote/exchange */
export async function exchange(req, res, { env = process.env, openScope = openKeyScope, now = Date.now } = {}) {
 if (req.method !== 'POST') return plain(res, 405, 'Send the setup code with POST (the command from github_git_remote_setup does this).');
 let code; try { code = paramsOf(req).code; } catch { code = null; }
 const parsed = parseSecret(code, CODE_PREFIX);
 if (!parsed) return plain(res, 400, `That is not a setup code. ${NEW_CODE}`);
 let scope; try { scope = await openScope(parsed.id, { env }); } catch { return plain(res, 503, 'The service could not finish setup right now. Run the same command again in a minute.'); }
 if (!scope) return plain(res, 410, `This setup code is not valid any more. ${NEW_CODE}`);
 const row = await scope.db.getGitRemoteKey(parsed.id);
 if (!row || row.exchanged_at || row.revoked_at || new Date(row.code_expires_at).getTime() <= now()) return plain(res, 410, `This setup code was already used or has expired (each works once, for 10 minutes). ${NEW_CODE}`);
 if (!await liveConnection(scope.db, row, env)) return plain(res, 410, 'The app connection this setup code belongs to has ended. Connect again, then ask for a new code.');
 const key = newSessionKey(parsed.id);
 const done = await scope.db.exchangeGitRemoteCode({ id: parsed.id, codeHash: parsed.hash, keyHash: sha256(key) });
 if (!done) return plain(res, 410, `This setup code was already used or has expired (each works once, for 10 minutes). ${NEW_CODE}`);
 await scope.db.recordGitRemoteUse({ keyId: parsed.id, service: 'exchange', outcome: 'allowed' }).catch(() => {});
 const host = new URL(publicOrigin(env)).host;
 res.statusCode = 200; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
 // `git credential approve` input. The key leaves this service only here, once.
 return res.end(`protocol=https\nhost=${host}\npath=${remotePath(done.owner, done.repo)}\nusername=${GIT_USERNAME}\npassword=${key}\n\n`);
}

const verifierKey = env => env.NATIVE_GIT_WORKER_KEY && !env.NATIVE_GIT_WORKER_KEY.startsWith('ed25519:') ? env.NATIVE_GIT_WORKER_KEY : nativeWorkerPublicKey(env);
const REF = /^refs\/(heads|tags)\/([^\x00-\x20\x7f~^:?*[\\]{1,250})$/;
const SHA = /^[0-9a-f]{40}$/;
export const ZERO = '0'.repeat(40);
function updatesOf(list) {
 if (!Array.isArray(list) || !list.length || list.length > 50) throw new TypeError('A push names 1 to 50 refs.');
 return list.map(u => {
  if (!u || !SHA.test(u.old ?? '') || !SHA.test(u.new ?? '') || !REF.test(u.ref ?? '') || u.ref.includes('..') || u.ref.endsWith('.lock') || u.ref.endsWith('/') || u.ref.includes('//') || u.ref.includes('@{'))
   throw new TypeError('Only branches (refs/heads/…) and tags (refs/tags/…) can be pushed through the git remote.');
  return { old: u.old, new: u.new, ref: u.ref };
 });
}
const nameOf = ref => ref.replace(/^refs\/(heads|tags)\//, '');
const describe = u => `${u.new === ZERO ? 'delete' : u.old === ZERO ? 'create' : 'update'} ${u.ref.startsWith('refs/tags/') ? 'tag' : 'branch'} ${nameOf(u.ref)}`;
export const PUSH_JOURNAL_TOOL = 'github_git_remote_push';
const PUSH_CLASSIFICATION = Object.freeze({ production: 'push changes exact GitHub remote refs; GitHub permissions and repository rules apply', accessWidening: null, notifies: [], spendCents: 0, spendUnknown: false });
// The native push's own declarations (src/tools/native-git.js): the gates see the same tool shape.
const RUN_TOOL = Object.freeze({ name: 'github_git_workspace_run', writes: true, declarations: Object.freeze({ production: 'never', accessWidening: false, notifies: false, spend: false, strictSpend: false, confirm: 'when-needed', cred: 'I', profiles: Object.freeze(['full']) }) });

/** The guard gates of every write, for each pushed ref, exactly as github_git_workspace_run push meets them. */
async function guardPush(ctx, owner, repo, updates, gates) {
 const { isOwnerConnection } = await import('../core/authority.js');
 if (!isOwnerConnection(ctx.connection) && ctx.connection.mode !== 'production')
  return `This push changes production (${PUSH_CLASSIFICATION.production}) and this connection is in preview mode.`;
 for (const u of updates) {
  const target = { owner, repo, ref: nameOf(u.ref), scope: 'repo' };
  const args = { owner, repo, operation: 'push', options: { branch: nameOf(u.ref), ...(u.ref.startsWith('refs/tags/') ? { tag: true } : {}), ...(u.new === ZERO ? { delete: true } : {}) } };
  for (const gate of gates) {
   let verdict; try { verdict = await gate({ tool: RUN_TOOL, name: RUN_TOOL.name, args, ctx, target, before: null, readFailed: false, classification: PUSH_CLASSIFICATION, declarations: RUN_TOOL.declarations }); }
   catch { verdict = { refuse: 'a safety check could not be completed', by: 'guard' }; }
   if (verdict?.refuse) return `${nameOf(u.ref)}: refused by ${verdict.by ?? 'a safety check'}: ${verdict.refuse}`;
   if (verdict?.confirm) return `${nameOf(u.ref)}: this change needs a confirmation the git remote cannot ask for (${verdict.confirm}). Use github_git_workspace_run push for it.`;
  }
 }
 return null;
}

/** POST /api/git-remote?op=broker|report (worker → control plane). */
export async function broker(req, res, { env = process.env, openScope = openKeyScope, now = Date.now, fetchImpl = fetch, gates } = {}) {
 if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
 let body; try { body = paramsOf(req); } catch { return json(res, 400, { error: 'invalid_request' }); }
 const op = req.query?.op === 'report' ? 'report' : 'broker';
 let claim; try { claim = verifyRemoteClaim(String(req.headers?.['x-robinson-git-claim'] ?? ''), verifierKey(env), now(), { graceMs: op === 'report' ? REMOTE_REPORT_GRACE_MS : 0 }); }
 catch (error) { return json(res, 401, { error: 'invalid_claim', message: /expired/.test(error?.message) ? 'This git request took too long; run the git command again.' : 'Invalid git remote claim.' }); }
 const phase = op === 'report' ? 'report' : body.phase;
 if (!['fetch', 'push', 'renew', 'report'].includes(phase) || (phase === 'fetch') !== (claim.step === 'refs') || (phase !== 'fetch' && claim.service !== 'git-receive-pack')) return json(res, 400, { error: 'invalid_phase' });
 const refuse = (message, status = 200) => json(res, status, { allow: false, message });
 let scope; try { scope = await openScope(claim.key, { env, withCredentials: phase !== 'report' }); } catch { return refuse('The service could not check this key right now. Run the git command again in a minute.', 503); }
 if (!scope) return refuse('This git session key is no longer valid. Ask for a new one with github_git_remote_setup.');
 const { db } = scope;
 // Each broker step of one claim works once.
 // Renewals of one push are numbered (at most 26 per push: one per batch).
 const renewal = phase === 'renew' ? (Number.isSafeInteger(body.n) && body.n >= 0 && body.n < 26 ? String.fromCharCode(97 + body.n) : null) : '';
 if (renewal === null) return json(res, 400, { error: 'invalid_phase' });
 if (!await db.recordGitRemoteUse({ keyId: claim.key, service: 'broker.' + phase, outcome: 'started', nonce: `${claim.nonce}.${phase}${renewal}` })) return json(res, 409, { error: 'replayed_claim' });
 const row = await db.getGitRemoteKey(claim.key);
 if (!row || !row.key_hash) return refuse('This git session key is no longer valid. Ask for a new one with github_git_remote_setup.');
 const verdict = checkKey(row, row.key_hash, { service: claim.service, owner: claim.owner, repo: claim.repo, now: now() });
 if (!verdict.ok || row.access !== claim.access) return refuse(verdict.message ?? 'This git session key changed. Ask for a new one with github_git_remote_setup.');
 const connection = await liveConnection(db, row, env);
 if (!connection) return refuse('The app connection this git session key belongs to was disconnected or changed. Connect again, then ask for a new key.');
 const owner = row.owner, repo = row.repo, slug = `${owner}/${repo}`;
 const requestKey = `rmcp_git_remote_${claim.nonce}`;
 if (phase === 'report') {
  const journal = Number(body.journal);
  const change = Number.isSafeInteger(journal) ? await db.getChange(journal) : null;
  if (!change || change.requestKey !== requestKey || change.tool !== PUSH_JOURNAL_TOOL || change.confirmed !== null) return json(res, 409, { error: 'unknown_journal' });
  const outcome = ['applied', 'rejected', 'refused', 'uncertain'].includes(body.outcome) ? body.outcome : 'uncertain';
  let updates; try { updates = updatesOf(body.updates); } catch { updates = []; }
  const reason = typeof body.reason === 'string' ? body.reason.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 300) : null;
  const line = `git push through the git remote to ${slug}: ${updates.map(describe).join(', ') || 'refs'}`;
  await db.finishChange(journal, { summary: `${{ applied: '', rejected: 'REJECTED: ', refused: 'REFUSED: ', uncertain: 'UNCERTAIN: ' }[outcome]}${line}`,
   after: { outcome, updates, ...(reason ? { reason } : {}), remote_verified: body.remoteVerified === true }, confirmed: outcome === 'applied' && body.remoteVerified === true,
   releaseKey: false, actedAs: ['you', 'app'].includes(body.actedAs) ? body.actedAs : null });
  await db.recordGitRemoteUse({ keyId: claim.key, service: 'push.result', outcome: outcome === 'applied' ? 'allowed' : outcome }).catch(() => {});
  return json(res, 200, { recorded: true });
 }
 const { authorizeNativeRepo } = await import('../native-git/client.js');
 const { credentialFor } = await import('../github/client.js');
 const { isOwnerConnection } = await import('../core/authority.js');
 const ctx = { connection, db, credentials: scope.credentials, env, fetch: fetchImpl, now, sleep: ms => new Promise(r => setTimeout(r, ms)) };
 let repoData;
 try { repoData = await authorizeNativeRepo(ctx, owner, repo); }
 catch (error) { await db.recordGitRemoteUse({ keyId: claim.key, service: 'broker.' + phase, outcome: 'refused:github' }).catch(() => {}); return refuse(`GitHub did not confirm access to ${slug} for this connection: ${String(error?.message ?? 'not available').replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 200)}`); }
 const narrowed = !isOwnerConnection(connection) ? { scope: { repositories: [repo] } } : {};
 if (phase === 'fetch') {
  let credential;
  try { const c = await credentialFor(ctx, { owner, ...narrowed }); credential = c.token ?? c.personal?.token; } catch { credential = null; }
  if (typeof credential !== 'string' || !credential) return refuse('GitHub network authorization is unavailable for this repository right now.');
  return json(res, 200, { allow: true, credential, default_branch: typeof repoData.default_branch === 'string' ? repoData.default_branch : null });
 }
 if (phase === 'renew') {
  // Only for a push whose change-log row this claim opened and that is still pending.
  const journal = Number(body.journal);
  const change = Number.isSafeInteger(journal) ? await db.getChange(journal) : null;
  if (!change || change.requestKey !== requestKey || change.tool !== PUSH_JOURNAL_TOOL || change.confirmed !== null) return json(res, 409, { error: 'unknown_journal' });
  if (connection.profile !== 'full') return refuse('This connection cannot push through the git remote (it needs the Full profile).');
  let credential;
  try { const c = await credentialFor(ctx, { owner, ...narrowed }); credential = body.actedAs === 'you' ? c.personal?.token : (c.personal?.token ? null : c.token); } catch { credential = null; }
  if (typeof credential !== 'string' || !credential) return refuse('GitHub network authorization is unavailable for this repository right now (or it changed who the push acts as).');
  return json(res, 200, { allow: true, credential });
 }
 let updates; try { updates = updatesOf(body.updates); } catch (error) { return refuse(error.message); }
 if (connection.profile !== 'full') return refuse('This connection cannot push through the git remote (it needs the Full profile).');
 if (repoData.permissions && repoData.permissions.push === false) return refuse(`GitHub says this connection cannot push to ${slug}.`);
 const { createGates } = await import('../tools/gates.js');
 const refused = await guardPush(ctx, owner, repo, updates, gates ?? createGates());
 const line = `git push through the git remote to ${slug}: ${updates.map(describe).join(', ')}`;
 if (refused) {
  await db.recordChange({ account: owner, repo: slug, mode: connection.mode, connection: connection.client_id, tool: PUSH_JOURNAL_TOOL, target: slug, summary: `REFUSED: ${line}. ${refused}`, dryRun: true, confirmed: false, production: true }).catch(() => {});
  return refuse(refused);
 }
 const { loadScannerPolicy } = await import('../github/scanner-policy.js');
 let policy; try { policy = await loadScannerPolicy(db, owner, repo); } catch { return refuse('The repository scanner settings could not be read, so nothing was pushed.'); }
 let journal;
 try { journal = await db.claimChange({ account: owner, repo: slug, mode: connection.mode, connection: connection.client_id, tool: PUSH_JOURNAL_TOOL, target: slug, summary: `PENDING: ${line}`, before: { updates }, requestKey, production: true }); }
 catch { return refuse('The change could not be recorded, so nothing was pushed.'); }
 if (!journal.claimed) return json(res, 409, { error: 'replayed_claim' });
 let credential, actedAs;
 try { const c = await credentialFor(ctx, { owner, ...narrowed }); credential = c.personal?.token ?? c.token; actedAs = c.personal?.token ? 'you' : 'app'; } catch { credential = null; }
 if (typeof credential !== 'string' || !credential) {
  await db.finishChange(journal.id, { summary: `REJECTED: ${line} (no GitHub credential)`, confirmed: false, releaseKey: true }).catch(() => {});
  return refuse('GitHub network authorization is unavailable for this repository right now; nothing was pushed.');
 }
 return json(res, 200, { allow: true, credential, journal: journal.id, acted_as: actedAs, scanner_policy: { settings: policy.settings, revision: policy.revision } });
}

// ---- GIT-DIRECT-1: the worker's direct git host ------------------------------------------------
export const DIRECT_WORKER_SETTING = 'git_remote.direct_worker';
export const PUSH_LIMIT_SETTING = 'git_remote.push_limit';
const MiB = 1024 * 1024;
export const PUSH_LIMIT_BOUNDS = Object.freeze({ min: 1 * MiB, max: 64 * 1024 * MiB });

/** The stored per-push limit for the direct host (`{ "max_push_bytes": n }`); GitHub's 2 GB when absent. */
export async function pushLimit(root) {
 let stored = null; try { stored = await root.getSetting(PUSH_LIMIT_SETTING); } catch { stored = null; }
 const n = stored?.max_push_bytes;
 return Number.isSafeInteger(n) && n >= PUSH_LIMIT_BOUNDS.min && n <= PUSH_LIMIT_BOUNDS.max ? n : GITHUB_PUSH_LIMIT_BYTES;
}
/** The configured direct origin on this control plane, or null. */
export const directOrigin = env => cleanOrigin(env?.GIT_DIRECT_ORIGIN);

async function rootDb() {
 const { createDb, productionSql } = await import('../db.js');
 return createDb(productionSql());
}
const canonical = b => JSON.stringify([b.id, b.hash, b.owner, b.repo, b.service, b.step]);
const GITISH = { owner: /^[A-Za-z0-9-]{1,39}$/, repo: /^[A-Za-z0-9_.-]{1,100}$/ };

/** POST /api/git-remote?op=authorize (worker's direct host → control plane). */
export async function directAuthorize(req, res, { env = process.env, openScope = openKeyScope, now = Date.now, root } = {}) {
 if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
 const origin = directOrigin(env);
 if (!origin) return json(res, 404, { error: 'direct_host_not_configured' });
 let body; try { body = paramsOf(req); } catch { return json(res, 400, { error: 'invalid_request' }); }
 if (!body || !/^[a-f0-9]{32}$/.test(body.id ?? '') || !/^[a-f0-9]{64}$/.test(body.hash ?? '') || !GITISH.owner.test(body.owner ?? '') || !GITISH.repo.test(body.repo ?? '') || ['.', '..'].includes(body.repo)
  || !['git-upload-pack', 'git-receive-pack'].includes(body.service) || !['refs', 'pack'].includes(body.step)) return json(res, 400, { error: 'invalid_request' });
 // The worker's signature, by the key it reported to this service's signed capabilities call at setup.
 const m = /^(\d{13})\.([a-f0-9]{32})\.([A-Za-z0-9_-]{86})$/.exec(String(req.headers?.[DIRECT_HEADER] ?? ''));
 if (!m || Math.abs(Number(m[1]) - now()) > DIRECT_SKEW_MS) return json(res, 401, { error: 'invalid_worker_signature' });
 let pinned; root = root ?? await rootDb();
 try { pinned = await root.getSetting(DIRECT_WORKER_SETTING); } catch { return json(res, 503, { error: 'unavailable' }); }
 if (pinned?.kind !== 'git-direct-worker' || pinned.origin !== origin || !DIRECT_WORKER_KEY.test(pinned.worker_key ?? '')) return json(res, 401, { error: 'invalid_worker_signature' });
 let good = false;
 try { good = verifySignature(null, directPayload(m[1], m[2], canonical(body)), createPublicKey({ key: Buffer.from(pinned.worker_key.slice(8), 'base64'), format: 'der', type: 'spki' }), Buffer.from(m[3], 'base64url')); } catch { good = false; }
 if (!good) return json(res, 401, { error: 'invalid_worker_signature' });
 // One worker signature serves one request (replays are refused, in the key's own database).
 let scope; try { scope = await openScope(body.id, { env }); } catch { scope = undefined; }
 if (scope && !await scope.db.recordGitRemoteUse({ keyId: body.id, service: 'direct.authorize', outcome: 'started', nonce: `${m[2]}.direct` }).catch(() => false)) return json(res, 409, { error: 'replayed_request' });
 // WORKER-POOL-2 / PUSH-EXIT-1: the direct git host belongs to one pool host, the push exit (GIT_DIRECT_HOST; unset = the
 // primary). A key whose mirror was placed on another pool host is never served there; its remote_url is this domain.
 const exitHost = directHostOf(env);
 if (!exitHost) return json(res, 404, { error: 'direct_host_not_configured' });
 if (scope?.host && scope.host !== exitHost.id) return json(res, 200, { allow: false, status: 403, challenge: false, reason: 'other_host', message: 'This git session key belongs to another worker host, not this direct git host. Use the remote_url github_git_remote_setup returned (this service\'s own domain).' });
 const verdict = await authorizeGitRequest({ parsed: { id: body.id, hash: body.hash }, wanted: { owner: body.owner, repo: body.repo, service: body.service, step: body.step }, env, now, openScope, door: 'direct' });
 if (!verdict.ok) return json(res, 200, { allow: false, status: verdict.status, challenge: verdict.challenge, reason: verdict.reason, message: verdict.message, ...(verdict.retryAfter ? { retry_after: verdict.retryAfter } : {}) });
 if (!verdict.ownerKey && exitHost.audience === 'owner') noteStray(exitHost, 'git_direct'); // a pre-pool key: served, counted
 return json(res, 200, { allow: true, claim: verdict.claim, limits: { push_bytes: await pushLimit(root) } });
}
