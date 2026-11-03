// GIT-REMOTE-1 (owner decision 2026-11-02, "Build option 2"): this service's own domain works as a
// normal git address. One call gives a coding agent a one-time setup command; after it, plain
// `git clone https://<origin>/git/<owner>/<repo>.git`, `git pull` and `git push` work for any
// repository this connection can reach (App installations, collaborator repositories, extra places).
// The person's GitHub credentials never leave the server: git sends a short-lived session key that is
// stored only as a hash, bound to this connection + one repository + one access level, expires on its
// own and can be revoked on My connection. See src/git-remote/*.js and docs/pr-cards/GIT-REMOTE-1.md.
import { defineGithubWrite } from './define-github-write.js';
import { authorizeNativeRepo, callNativeWorker } from '../native-git/client.js';
import { workerUrl, workerKey } from '../native-git/protocol.js';
import { nativeWorkerPublicKey } from '../native-git/signing.js';
import { blockedNote, fitDigest } from '../native-git/relay.js';
import { publicOrigin } from '../core/http.js';
import { rootAllocationDb } from '../playground/index.js';
import { CODE_TTL_MS, indexKey, keyLifetime, newExchangeCode, sha256 } from '../git-remote/keys.js';

const safe = (message, safeCode, extra = {}) => Object.assign(new TypeError(message), { safeMessage: true, safeCode, ...extra });
const OWNER = { type: 'string', minLength: 1, maxLength: 39, pattern: '^[A-Za-z0-9-]+$' };
const REPO = { type: 'string', minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9_.-]+$' };
/** Measured locally (docs/pr-cards/GIT-REMOTE-1.md): fine through the relay; Vercel's proxy is the limit. */
export const PUSH_NOTE = 'Pushes up to 100 MiB each. Through this domain a single push of more than about 20 MB may be cut off by the hosting proxy; for huge binary files use github_git_workspace_upload (chunked) or push in smaller commits.';

/** The setup command: stores the key for this one address only (no other git host or helper sees it) and never prints it. */
export function setupCommand(origin, code, remoteUrl) {
 const scope = `credential.${origin}`;
 return `git config --global --replace-all ${scope}.helper '' && git config --global --add ${scope}.helper 'store --file="$HOME/.git-credentials-robinson"' && git config --global ${scope}.useHttpPath true` +
  ` && K="$(curl -fsS --proto =https --max-redirs 0 --data-urlencode 'code=${code}' ${origin}/git-remote/exchange)" && printf '%s\\n' "$K" | git credential approve && unset K && echo "git remote ready: ${remoteUrl}"`;
}

async function readyCheck(c, a) {
 if (c.connection?.pass === true || c.connection?.kind === 'pass') throw safe('A git remote session key belongs to a connector sign-in, not a service pass. Use github_repo_download and github_repo_change with this pass.', 'git_remote_pass');
 try { workerUrl(c.env); if (c.env?.NATIVE_GIT_WORKER_KEY) workerKey(c.env.NATIVE_GIT_WORKER_KEY); else nativeWorkerPublicKey(c.env); publicOrigin(c.env); }
 catch { throw safe('The git remote is not configured on this service yet. Use github_repo_download and github_repo_change meanwhile.', 'git_remote_unconfigured'); }
 const cap = await callNativeWorker(c, { action: 'capabilities' });
 if (cap.git_remote !== 'v1') throw safe('The native Git worker must be updated before the git remote works. Use github_repo_download and github_repo_change meanwhile.', 'native_worker_update_required');
 const repo = await authorizeNativeRepo(c, a.owner ?? c.connection.default_account, a.repo);
 const [owner, name] = String(repo.full_name).split('/');
 const access = a.access ?? 'read';
 if (access === 'write' && repo.permissions && repo.permissions.push === false) throw safe(`GitHub says this connection can read ${repo.full_name} but not push to it. Ask for access "read", or ask the repository owner for write access.`, 'git_remote_no_push');
 const lifetime = await keyLifetime(c.db);
 if (a.hours !== undefined && a.hours > lifetime.maxHours) throw safe(`A session key lasts at most ${lifetime.maxHours} hours.`, 'git_remote_hours');
 return { owner, repo: name, access, hours: a.hours ?? lifetime.defaultHours, default_branch: repo.default_branch ?? null };
}

async function createKey(c, before) {
 const { id, code } = newExchangeCode();
 const at = (c.now ?? Date.now)();
 const expiresAt = new Date(at + before.hours * 3600000), codeExpiresAt = new Date(at + CODE_TTL_MS);
 // The root index names only which database holds the row (this tenant, or the owner's own).
 await rootAllocationDb(c).setSetting(indexKey(id), { kind: 'git-remote-index', id, scope: c.db.playgroundScope ?? { legacy: true } });
 await c.db.createGitRemoteKey({ id, connection: c.connection.client_id, owner: before.owner, repo: before.repo, access: before.access, codeHash: sha256(code), codeExpiresAt, expiresAt });
 return { key_id: id, code, owner: before.owner, repo: before.repo, access: before.access, expires_at: expiresAt.toISOString(), code_expires_at: codeExpiresAt.toISOString() };
}
const view = row => row ? { key_id: row.id, owner: row.owner, repo: row.repo, access: row.access, state: row.revoked_at ? 'revoked' : row.exchanged_at ? 'active' : 'awaiting_setup',
 expires_at: new Date(row.expires_at).toISOString(), setup_shown_once: true } : null;

function present(c, after, response) {
 if (typeof response?.code !== 'string') return { ...after, next: 'The setup command is shown only once. Call github_git_remote_setup again with a fresh requestKey for a new one.' };
 const origin = publicOrigin(c.env), remoteUrl = `${origin}/git/${response.owner}/${response.repo}.git`;
 return { ...after, remote_url: remoteUrl, command: setupCommand(origin, response.code, remoteUrl),
  then: `git clone ${remoteUrl}   (or, in an existing clone: git remote set-url origin ${remoteUrl}); then git pull / git push as usual`,
  code_expires_at: response.code_expires_at, platforms: 'The same command works on Linux and macOS (sh, curl, git). It stores the key in ~/.git-credentials-robinson for this address only.',
  ...(response.access === 'write' ? { push_note: PUSH_NOTE } : {}), if_blocked: blockedNote(remoteUrl),
  revoke: `Cancel it any time on My connection (${origin}/connection). It expires on its own at ${response.expires_at}.`,
  next: 'Run command within 10 minutes (it works once; the key is never printed). Do not publish the command. Refusals come back as git "remote:" lines with a next step.' };
}
const essentials = shaped => shaped?.command
 ? fitDigest({ command: shaped.command, remote_url: shaped.remote_url, expires_at: shaped.expires_at, if_blocked: blockedNote(shaped.remote_url, { short: true }), next: 'Run command within 10 minutes, then git clone remote_url. Do not publish it.' }, ['next', 'expires_at'])
 : shaped?.next ? fitDigest({ next: shaped.next }) : null;

const setup = defineGithubWrite({
 name: 'github_git_remote_setup', area: 'git', audience: ['B', 'O', 'Op'],
 description: 'Use plain git clone/pull/push on this service\'s domain: returns a one-time setup command that stores a short-lived key for one repository.',
 guidance: 'For coding agents with a shell: instead of upload/apply/commit calls, use normal git. Call with owner, repo and access (read: clone/fetch/pull; write: also push) and optional hours (default 8, at most 24). Run the returned command once within 10 minutes: it swaps the one-time code for a session key straight into git\'s credential store for this one address (never printed). Then `git clone <remote_url>` (or set it as origin) and use git as usual. Works for every repository this connection can reach, including collaborator repositories and extra places. Pushes go through the same checks as github_git_workspace_run push (branch rules and protected branches on GitHub, content protection, change log, Act as me attribution); a refusal shows as git "remote:" lines with a next step. ' + PUSH_NOTE + ' The key works only for this repository and access, expires on its own and can be cancelled on My connection. If the sandbox cannot reach the domain, add that one domain to its network allowlist once (for Claude: the Capabilities / network access allowed-domains setting).',
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
