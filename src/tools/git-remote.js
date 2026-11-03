// GIT-REMOTE-1 (owner decision 2026-11-02, "Build option 2"): this service's own domain works as a
// normal git address. One call gives a coding agent a one-time setup command; after it, plain
// `git clone https://<origin>/git/<owner>/<repo>.git`, `git pull` and `git push` work for any
// repository this connection can reach (App installations, collaborator repositories, extra places).
// The person's GitHub credentials never leave the server: git sends a short-lived session key that is
// stored only as a hash, bound to this connection + one repository + one access level, expires on its
// own and can be revoked on My connection. See src/git-remote/*.js and docs/pr-cards/GIT-REMOTE-1.md.
// GIT-DIRECT-1: when GIT_DIRECT_ORIGIN is configured and the worker reports the same direct git host,
// remote_url is on that host (no hosting-proxy limits) and the MCP-domain address is the fallback;
// the credential is stored for both. The worker's reported signing key is pinned for op=authorize.
// GIT-DIRECT-2: when only this service names the direct host (Vercel GIT_DIRECT_ORIGIN) and the worker
// does not yet serve it, the first applied setup sends the worker the signed `direct_configure` action
// ({ origin: GIT_DIRECT_ORIGIN, control: PUBLIC_BASE_URL's origin }) once, reads its capabilities again
// and then pins and uses the direct address. Any failure falls back to this domain with a plain note.
import { defineGithubWrite } from './define-github-write.js';
import { authorizeNativeRepo, callNativeWorker } from '../native-git/client.js';
import { workerUrl, workerKey } from '../native-git/protocol.js';
import { nativeWorkerPublicKey } from '../native-git/signing.js';
import { blockedNote, fitDigest } from '../native-git/relay.js';
import { placeWorkspace, forgetHost } from '../native-git/pool.js';
import { configuredHosts, hostAllowed } from '../native-git/pool-config.js';
import { publicOrigin } from '../core/http.js';
import { rootAllocationDb } from '../playground/index.js';
import { CODE_TTL_MS, indexKey, keyLifetime, newExchangeCode, sha256 } from '../git-remote/keys.js';
import { DIRECT_WORKER_SETTING, directOrigin, pushLimit } from '../git-remote/api.js';
import { DIRECT_WORKER_KEY } from '../git-remote/wire.js';

const safe = (message, safeCode, extra = {}) => Object.assign(new TypeError(message), { safeMessage: true, safeCode, ...extra });
const OWNER = { type: 'string', minLength: 1, maxLength: 39, pattern: '^[A-Za-z0-9-]+$' };
const REPO = { type: 'string', minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9_.-]+$' };
/** Measured live 2026-11-03: without a declared length (git streams packs over 1 MiB in chunked encoding) every push
 *  over ~4 MB got HTTP 502 from the hosting proxy; with http.postBuffer set (git sends Content-Length) 6–25 MB pushed
 *  and 40 MB was cut off. The setup command sets postBuffer for this one address. */
export const PUSH_NOTE = 'Pushes up to about 25 MB each work through this domain (the setup command sets git http.postBuffer for it); larger ones may be cut off by the hosting proxy. For huge binary files use github_git_workspace_upload (chunked) or push in smaller commits.';

const MiB = 1024 * 1024;
const sizeText = n => n >= 1024 * MiB ? `${Math.round(n / (1024 * MiB) * 10) / 10} GB` : `${Math.round(n / MiB)} MB`;
/** GIT-DIRECT-1: pushes through the worker's own git host never pass the hosting proxy. */
export const directPushNote = limit => `Pushes through remote_url (the direct git host) stream to the worker: up to ${sizeText(limit)} each (stored setting git_remote.push_limit); over GitHub's 2 GB limit they are sent on in parts. Files over 100 MB need Git LFS. Through fallback_url pushes up to about 25 MB work.`;

const credentialFor = (origin, file) => `git config --global --replace-all credential.${origin}.helper '' && git config --global --add credential.${origin}.helper 'store --file="${file}"' && git config --global credential.${origin}.useHttpPath true`;
/**
 * The setup command: stores the key for this one address (and the direct git host, when there is one)
 * only — no other git host or helper sees it — and never prints it. With a direct host it runs in a
 * subshell with `set -e` (so the key variable never reaches the person's shell) and loops over both
 * hosts, which keeps it short enough for the always-visible digest.
 */
export function setupCommand(origin, code, remoteUrl, direct = null) {
 const file = '$HOME/.git-credentials-robinson';
 const exchange = `curl -fsS --proto =https --max-redirs 0 --data-urlencode 'code=${code}' ${origin}/git-remote/exchange`;
 if (!direct) return `${credentialFor(origin, file)} && git config --global http.${origin}.postBuffer 209715200` +
  ` && K="$(${exchange})" && printf '%s\\n' "$K" | git credential approve && unset K && echo "git remote ready: ${remoteUrl}"`;
 return `(set -e; S='store --file="${file}"'; for O in ${origin} ${direct}; do git config --global --replace-all credential.$O.helper ''; git config --global --add credential.$O.helper "$S"; git config --global credential.$O.useHttpPath true; done; ` +
  `git config --global http.${origin}.postBuffer 209715200; K="$(${exchange})"; for H in ${new URL(origin).host} ${new URL(direct).host}; do printf '%s\\n' "$K" | sed "s/^host=.*/host=$H/" | git credential approve; done; echo "git remote ready: ${remoteUrl}")`;
}

/** Which domains a sandbox must allow, with a wildcard hint only when both share a parent domain. */
export function networkNote(origin, direct) {
 const a = new URL(origin).hostname, b = new URL(direct).hostname;
 const la = a.split('.').reverse(), lb = b.split('.').reverse(), common = [];
 for (let i = 0; i < Math.min(la.length, lb.length) && la[i] === lb[i]; i++) common.unshift(la[i]);
 const wildcard = common.length >= 2 && common.length < Math.min(la.length, lb.length) ? ` If your AI's allowlist accepts wildcard entries, *.${common.join('.')} covers both (check its documentation first).` : '';
 return `Allow ${a} (the setup command, and every git command through fallback_url) and ${b} (remote_url: large pushes, no hosting-proxy limit) in the sandbox network allowlist (for Claude: the Capabilities / network access allowed-domains setting).${wildcard} With only ${a} allowed, use fallback_url.`;
}

/** The direct host the worker reports, when it is exactly the one this service names (and, when the worker
 *  stored it from this service's own action, asks this service's origin). */
function directFrom(configured, control, offered) {
 if (!configured || offered?.version !== 'v1' || offered.origin !== configured || !DIRECT_WORKER_KEY.test(offered.worker_key ?? '')) return null;
 if (offered.source === 'file' && offered.control !== control) return null;
 return { origin: configured, worker_key: offered.worker_key };
}
const DIRECT_FALLBACK = 'remote_url uses this service\'s own domain for now (pushes up to about 25 MB).';
/**
 * GIT-DIRECT-2: configures the worker's direct git host from this service's settings with the signed
 * `direct_configure` action, then reads the worker's signed capabilities again. Never throws: on any
 * failure the setup falls back to this domain and says why in plain words.
 */
async function configureDirect(c, pending) {
 if (!pending.supported) return { direct: null, note: `The direct git host (${pending.origin}) is set on this service, but the native Git worker must be updated before it can serve it. ${DIRECT_FALLBACK}` };
 try {
  await callNativeWorker(c, { action: 'direct_configure', options: { origin: pending.origin, control: pending.control }, allowWrite: true });
  const cap = await callNativeWorker(c, { action: 'capabilities' });
  const direct = directFrom(pending.origin, pending.control, cap.git_direct);
  if (direct) return { direct, note: null };
  return { direct: null, note: `The native Git worker did not confirm the direct git host ${pending.origin} after it was configured. ${DIRECT_FALLBACK} Call github_git_remote_setup again later.` };
 } catch (error) {
  const reason = error?.safeMessage && typeof error.message === 'string' ? ' ' + error.message.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 300) : '';
  return { direct: null, note: `The native Git worker could not be set up to serve the direct git host ${pending.origin}.${reason} ${DIRECT_FALLBACK}` };
 }
}

async function readyCheck(c, a) {
 if (c.connection?.pass === true || c.connection?.kind === 'pass') throw safe('A git remote session key belongs to a connector sign-in, not a service pass. Use github_repo_download and github_repo_change with this pass.', 'git_remote_pass');
 try { workerUrl(c.env); if (c.env?.NATIVE_GIT_WORKER_KEY) workerKey(c.env.NATIVE_GIT_WORKER_KEY); else nativeWorkerPublicKey(c.env); publicOrigin(c.env); }
 catch { throw safe('The git remote is not configured on this service yet. Use github_repo_download and github_repo_change meanwhile.', 'git_remote_unconfigured'); }
 // WORKER-POOL-1: the key's mirror lives on the first available pool host that serves the git remote (the primary
 // unless it is paused, busy, full or offline); the key stays on that host for its whole life (recorded in its index).
 let host;
 try { host = await placeWorkspace(c, { needs: cap => cap?.git_remote === 'v1', workspace: false }); }
 catch (error) {
  if (error?.safeCode === 'native_worker_update_required') throw safe('The native Git worker must be updated before the git remote works. Use github_repo_download and github_repo_change meanwhile.', 'native_worker_update_required');
  throw error;
 }
 const cap = host.capabilities;
 // The direct host only when this service names it AND the worker (answering this signed call) serves it. It belongs to
 // the primary host (GIT_DIRECT_ORIGIN); a key placed on another host uses this service's own domain.
 const configured = host.role === 'primary' ? directOrigin(c.env) : null, control = publicOrigin(c.env);
 const direct = directFrom(configured, control, cap.git_direct);
 // GIT-DIRECT-2: named here but not (or not this one) served by the worker: the applied setup configures it.
 const pending = configured && !direct ? { origin: configured, control, supported: cap.git_direct_configure === 'v1' } : null;
 // WORKER-POOL-2: a caller who may not use the primary (owner-only) is simply on this service's domain: no note that
 // would name the owner's machine, and never its direct address.
 const away = host.role !== 'primary' && directOrigin(c.env) && hostAllowed(c, configuredHosts(c.env).find(h => h.role === 'primary')) ? `The primary worker is not taking new work just now, so this key uses the ${host.name} host through this service's own domain (no direct git host).` : null;
 const repo = await authorizeNativeRepo(c, a.owner ?? c.connection.default_account, a.repo);
 const [owner, name] = String(repo.full_name).split('/');
 const access = a.access ?? 'read';
 if (access === 'write' && repo.permissions && repo.permissions.push === false) throw safe(`GitHub says this connection can read ${repo.full_name} but not push to it. Ask for access "read", or ask the repository owner for write access.`, 'git_remote_no_push');
 const lifetime = await keyLifetime(c.db);
 if (a.hours !== undefined && a.hours > lifetime.maxHours) throw safe(`A session key lasts at most ${lifetime.maxHours} hours.`, 'git_remote_hours');
 return { owner, repo: name, access, hours: a.hours ?? lifetime.defaultHours, default_branch: repo.default_branch ?? null, direct, host: host.id, ...(away ? { host_note: away } : {}), ...(pending ? { direct_pending: pending } : {}) };
}

async function createKey(c, before) {
 const { id, code } = newExchangeCode();
 let direct = null, served = before.direct, note = before.host_note ?? null;
 // GIT-DIRECT-2: only an applied (confirmed, not dry-run) setup changes the worker's configuration.
 if (!served && before.direct_pending) { ({ direct: served, note } = await configureDirect(c, before.direct_pending)); if (typeof before.host === 'string') forgetHost(c, before.host); }
 if (served) {
  const root = rootAllocationDb(c), pinned = await root.getSetting(DIRECT_WORKER_SETTING).catch(() => null);
  // Pins the worker's public signing key (from its signed capabilities answer) for op=authorize.
  if (pinned?.origin !== served.origin || pinned?.worker_key !== served.worker_key)
   await root.setSetting(DIRECT_WORKER_SETTING, { kind: 'git-direct-worker', origin: served.origin, worker_key: served.worker_key });
  direct = { origin: served.origin, push_bytes: await pushLimit(root) };
 }
 const at = (c.now ?? Date.now)();
 const expiresAt = new Date(at + before.hours * 3600000), codeExpiresAt = new Date(at + CODE_TTL_MS);
 // The root index names only which database holds the row (this tenant, or the owner's own).
 await rootAllocationDb(c).setSetting(indexKey(id), { kind: 'git-remote-index', id, scope: c.db.playgroundScope ?? { legacy: true }, ...(typeof before.host === 'string' ? { host: before.host } : {}) });
 await c.db.createGitRemoteKey({ id, connection: c.connection.client_id, owner: before.owner, repo: before.repo, access: before.access, codeHash: sha256(code), codeExpiresAt, expiresAt });
 return { key_id: id, code, owner: before.owner, repo: before.repo, access: before.access, expires_at: expiresAt.toISOString(), code_expires_at: codeExpiresAt.toISOString(), ...(direct ? { direct } : {}), ...(note ? { direct_note: note } : {}) };
}
const view = row => row ? { key_id: row.id, owner: row.owner, repo: row.repo, access: row.access, state: row.revoked_at ? 'revoked' : row.exchanged_at ? 'active' : 'awaiting_setup',
 expires_at: new Date(row.expires_at).toISOString(), setup_shown_once: true } : null;

function present(c, after, response) {
 if (typeof response?.code !== 'string') return { ...after, next: 'The setup command is shown only once. Call github_git_remote_setup again with a fresh requestKey for a new one.' };
 const origin = publicOrigin(c.env), path = `/git/${response.owner}/${response.repo}.git`, domainUrl = origin + path;
 const direct = response.direct?.origin ?? null, remoteUrl = direct ? direct + path : domainUrl;
 return { ...after, remote_url: remoteUrl, ...(direct ? { fallback_url: domainUrl } : {}), command: setupCommand(origin, response.code, remoteUrl, direct),
  then: `git clone ${remoteUrl}   (or, in an existing clone: git remote set-url origin ${remoteUrl}); then git pull / git push as usual`,
  code_expires_at: response.code_expires_at, platforms: `The same command works on Linux and macOS (sh, curl, git). It stores the key in ~/.git-credentials-robinson for ${direct ? 'these two addresses' : 'this address'} only.`,
  ...(response.access === 'write' ? { push_note: direct ? directPushNote(response.direct.push_bytes) : PUSH_NOTE } : {}), if_blocked: direct ? networkNote(origin, direct) : blockedNote(remoteUrl),
  ...(!direct && typeof response.direct_note === 'string' ? { direct_note: response.direct_note } : {}),
  revoke: `Cancel it any time on My connection (${origin}/connection). It expires on its own at ${response.expires_at}.`,
  next: 'Run command within 10 minutes (it works once; the key is never printed). Do not publish the command. Refusals come back as git "remote:" lines with a next step.' };
}
const essentials = shaped => shaped?.command
 ? fitDigest({ command: shaped.command, remote_url: shaped.remote_url, ...(shaped.fallback_url ? { fallback_url: shaped.fallback_url } : {}), expires_at: shaped.expires_at,
  if_blocked: shaped.fallback_url ? `If remote_url is unreachable, allow ${new URL(shaped.remote_url).hostname} in the sandbox network allowlist or use fallback_url.` : blockedNote(shaped.remote_url, { short: true }), next: 'Run command within 10 minutes, then git clone remote_url. Do not publish it.' }, ['next', 'expires_at', 'if_blocked', 'fallback_url'])
 : shaped?.next ? fitDigest({ next: shaped.next }) : null;

const setup = defineGithubWrite({
 name: 'github_git_remote_setup', area: 'git', audience: ['B', 'O', 'Op'],
 description: 'Use plain git clone/pull/push on this service\'s domain: returns a one-time setup command that stores a short-lived key for one repository.',
 guidance: 'For coding agents with a shell: instead of upload/apply/commit calls, use normal git. Call with owner, repo and access (read: clone/fetch/pull; write: also push) and optional hours (default 8, at most 24). Run the returned command once within 10 minutes: it swaps the one-time code for a session key straight into git\'s credential store for this one address (never printed). Then `git clone <remote_url>` (or set it as origin) and use git as usual. Works for every repository this connection can reach, including collaborator repositories and extra places. Pushes go through the same checks as github_git_workspace_run push (branch rules and protected branches on GitHub, content protection, change log, Act as me attribution); a refusal shows as git "remote:" lines with a next step. ' + PUSH_NOTE + ' The key works only for this repository and access, expires on its own and can be cancelled on My connection. If the sandbox cannot reach the domain, add that one domain to its network allowlist once (for Claude: the Capabilities / network access allowed-domains setting). When the service has a direct git host, remote_url uses it (large pushes, no hosting-proxy limit) and fallback_url is the same repository on this domain.',
 properties: { owner: { ...OWNER, description: 'Repository owner (default: the connection\'s default account).' }, repo: REPO,
  access: { type: 'string', enum: ['read', 'write'], description: 'read = clone, fetch, pull; write = also push (default read).' },
  hours: { type: 'integer', minimum: 1, maximum: 24, description: 'Key lifetime in hours (default 8).' } },
 required: ['repo'], declarations: { production: 'never', confirm: 'when-needed', profiles: ['full'] },
 explain: error => error?.safeMessage ? error.message : 'The git remote key could not be created. Nothing usable was issued; call again.',
 classifyError: error => error?.safeMessage || [400, 401, 403, 404, 409, 422].includes(error?.status) ? 'rejected' : 'uncertain',
 target: (a, c) => ({ owner: a.owner ?? c.connection?.default_account, repo: a.repo, scope: 'repo', kind: 'git-remote' }),
 read: (a, c) => readyCheck(c, a),
 classify: () => ({}), price: () => 0,
 summarize: ({ before: b }) => `Create a ${b.access === 'write' ? 'read-and-push' : 'read-only'} git remote session key for ${b.owner}/${b.repo}, valid ${b.hours} hour(s), revocable on My connection (one-time setup code, 10 minutes)`,
 apply: ({ ctx: c, before }) => createKey(c, before),
 readAfter: async ({ ctx: c, response }) => view(await c.db.getGitRemoteKey(response.key_id)),
 verify: ({ before, after, response }) => after?.key_id === response.key_id && after.state === 'awaiting_setup' && after.owner === before.owner && after.repo === before.repo && after.access === before.access,
 essentials,
 present: ({ ctx: c, after, response }) => present(c, after, response)
});

export const tools = [setup.tool];
export const handlers = { [setup.tool.name]: setup.handler };
