// PUB-9: what a person's GitHub fine-grained personal access token can actually do.
// Two sources only: GitHub's answers to a fixed set of harmless reads made with the token when it is added (and again on
// "Re-check"), and GitHub's own published list of the permissions each operation needs for fine-grained tokens (vendored,
// see credential-derivation.js). Nothing here holds, logs or returns a token; callers pass an already-authenticated client.
//
// Recorded permission set (stored in the vault row's `scopes`): `<permission>:read` = a read worked; `<permission>:none` =
// GitHub said "Resource not accessible by personal access token". Anything else (404, feature off, network) is left out:
// unknown is never treated as granted or as missing. Write access cannot be read without writing, so it is learned from
// GitHub's own refusals (`refused`), which are remembered until the person re-checks or replaces the token.
import { createHash } from 'node:crypto';
import { listedFor, listedRoutes } from './credential-derivation.js';

export const FINE_HANDLE = 'finegrained'; // setup-state handle used before the token's owner is known
export const FINE_PREFIX = 'github_pat_';
const NAME = /^[a-z_]+$/;
const ENTRY = /^[a-z_]+:(read|none)$/;
const LEARNED = /^[a-z_]+:(read|write|admin)$/;
const NOT_ACCESSIBLE = /resource not accessible by (?:fine-grained )?personal access token/i;

/**
 * The harmless reads made at enrollment. Every route is a GET that GitHub lists for fine-grained tokens with exactly the
 * named `:read` permission (a unit test checks this against the vendored list). `on`: repo = the sample repository,
 * user = only when the token belongs to the person's own account, org = only when it belongs to an organization.
 * `paged: false` = the pinned description has no per_page for that read.
 */
export const FINE_PROBES = Object.freeze([
  { permission: 'contents', route: 'GET /repos/{owner}/{repo}/commits', on: 'repo' },
  { permission: 'issues', route: 'GET /repos/{owner}/{repo}/issues', on: 'repo' },
  { permission: 'pull_requests', route: 'GET /repos/{owner}/{repo}/pulls', on: 'repo' },
  { permission: 'actions', route: 'GET /repos/{owner}/{repo}/actions/runs', on: 'repo' },
  { permission: 'actions_variables', route: 'GET /repos/{owner}/{repo}/actions/variables', on: 'repo' },
  { permission: 'secrets', route: 'GET /repos/{owner}/{repo}/actions/secrets', on: 'repo' },
  { permission: 'dependabot_secrets', route: 'GET /repos/{owner}/{repo}/dependabot/secrets', on: 'repo' },
  { permission: 'deployments', route: 'GET /repos/{owner}/{repo}/deployments', on: 'repo' },
  { permission: 'repository_hooks', route: 'GET /repos/{owner}/{repo}/hooks', on: 'repo' },
  { permission: 'administration', route: 'GET /repos/{owner}/{repo}/teams', on: 'repo' },
  { permission: 'pages', route: 'GET /repos/{owner}/{repo}/pages', on: 'repo', paged: false },
  { permission: 'statuses', route: 'GET /repos/{owner}/{repo}/commits/{ref}/statuses', on: 'repo' },
  { permission: 'vulnerability_alerts', route: 'GET /repos/{owner}/{repo}/dependabot/alerts', on: 'repo' },
  { permission: 'security_events', route: 'GET /repos/{owner}/{repo}/code-scanning/alerts', on: 'repo' },
  { permission: 'secret_scanning_alerts', route: 'GET /repos/{owner}/{repo}/secret-scanning/alerts', on: 'repo' },
  { permission: 'repository_advisories', route: 'GET /repos/{owner}/{repo}/security-advisories', on: 'repo' },
  { permission: 'emails', route: 'GET /user/emails', on: 'user' },
  { permission: 'followers', route: 'GET /user/followers', on: 'user' },
  { permission: 'keys', route: 'GET /user/keys', on: 'user' },
  { permission: 'gpg_keys', route: 'GET /user/gpg_keys', on: 'user' },
  { permission: 'starring', route: 'GET /user/starred', on: 'user' },
  { permission: 'watching', route: 'GET /user/subscriptions', on: 'user' },
  { permission: 'organization_hooks', route: 'GET /orgs/{org}/hooks', on: 'org' },
  { permission: 'organization_secrets', route: 'GET /orgs/{org}/actions/secrets', on: 'org' },
  { permission: 'organization_actions_variables', route: 'GET /orgs/{org}/actions/variables', on: 'org' }
]);

/** Plain areas for the person: the permission that opens each and the tool families it opens (each prefix is a real tool). */
export const FINE_AREAS = Object.freeze([
  { area: 'Repository details', permission: 'metadata', tools: ['github_repo_get', 'github_repo_list'] },
  { area: 'Code, files, branches and commits', permission: 'contents', tools: ['github_content_*', 'github_branch_*', 'github_commit_*', 'github_release_*'] },
  { area: 'Issues, labels and milestones', permission: 'issues', tools: ['github_issue_*', 'github_label_*', 'github_milestone_*'] },
  { area: 'Pull requests and reviews', permission: 'pull_requests', tools: ['github_pr_*', 'github_review_*'] },
  { area: 'Actions runs and workflows', permission: 'actions', tools: ['github_actions_*'] },
  { area: 'Actions variables', permission: 'actions_variables', tools: ['github_variable_*'] },
  { area: 'Actions secrets (names only)', permission: 'secrets', tools: ['github_secret_list', 'github_secret_set', 'github_secret_delete'] },
  { area: 'Deployments', permission: 'deployments', tools: ['github_deploy_list', 'github_deploy_create', 'github_deploy_set_status'] },
  { area: 'Repository webhooks', permission: 'repository_hooks', tools: ['github_webhook_*'] },
  { area: 'Repository settings and access', permission: 'administration', tools: ['github_repo_update_settings', 'github_deploykey_*'] },
  { area: 'Pages', permission: 'pages', tools: ['github_pages_*'] },
  { area: 'Commit statuses', permission: 'statuses', tools: ['github_check_get_ci_state'] },
  { area: 'Security alerts', permission: 'vulnerability_alerts', tools: ['github_security_*'] }
]);

/** Each GET probe in FINE_PROBES with the parameters for one repository / owner. */
export function probeRequests({ owner, repo, ref, scope }) {
  return FINE_PROBES.filter((p) => p.on === 'repo' ? !!repo : p.on === scope).map((p) => ({
    permission: p.permission, route: p.route,
    params: { ...(p.on === 'repo' ? { owner, repo } : p.on === 'org' ? { org: owner } : {}), ...(p.route.includes('{ref}') ? { ref } : {}),
      ...(p.paged === false ? {} : { per_page: 1 }) }
  })).filter((p) => !p.route.includes('{ref}') || typeof p.params.ref === 'string' && p.params.ref.length > 0);
}

/** How one GitHub answer to a probe is recorded: 'read', 'none' or null (unknown, not recorded). */
export function probeOutcome(status, message) {
  if (status === 200 || status === 304) return 'read';
  if (status === 403 && NOT_ACCESSIBLE.test(String(message ?? ''))) return 'none';
  return null;
}

/**
 * Runs the probes with `request(route, params)` (the shared client, already holding the token) and returns the sorted
 * permission set. `metadata:read` is recorded from the repository read the caller already made.
 */
export async function readFinePermissions(request, { owner, repo = null, ref = null, scope }) {
  const found = new Map([['metadata', 'read']]);
  const probes = probeRequests({ owner, repo, ref, scope });
  for (let i = 0; i < probes.length; i += 6) {
    await Promise.all(probes.slice(i, i + 6).map(async (p) => {
      let outcome = null;
      try { outcome = probeOutcome((await request(p.route, p.params)).status); }
      catch (error) { outcome = probeOutcome(error?.status, error?.response?.data?.message ?? error?.message); }
      if (outcome) found.set(p.permission, outcome);
    }));
  }
  return [...found].map(([name, level]) => `${name}:${level}`).sort();
}

export const validPermissionSet = (scopes) => Array.isArray(scopes) && scopes.length >= 1 && scopes.length <= 80 &&
  scopes.every((x) => typeof x === 'string' && ENTRY.test(x)) && scopes.includes('metadata:read');

// ---- Which operation is this request? ---------------------------------------------------------------------------------

let index = null;
const GREEDY = new Set(['path', 'ref', 'branch', 'subject_digest', 'file_path']);
function routes() {
  if (index) return index;
  index = listedRoutes().map((route) => {
    const [method, path] = route.split(' ');
    const parts = path.split('/').slice(1);
    const last = parts.length - 1;
    const source = parts.map((part, i) => {
      const param = /^\{([a-z_]+)\}$/.exec(part);
      if (!param) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return i === last && GREEDY.has(param[1]) ? '.+' : '[^/]+';
    }).join('/');
    return { route, method, regex: new RegExp('^/' + source + '$'), literal: parts.filter((p) => !p.startsWith('{')).length };
  });
  return index;
}

/** The vendored operation a concrete request is, or null. The most literal match wins ("/issues/comments" over "/issues/{n}"). */
export function operationOf(method, url) {
  let pathname;
  try { pathname = new URL(url, 'https://api.github.com').pathname; } catch { return null; }
  const m = String(method).toUpperCase();
  let best = null;
  for (const r of routes()) if (r.method === m && r.regex.test(pathname) && (!best || r.literal > best.literal)) best = r;
  return best?.route ?? null;
}

const levelRank = { read: 1, write: 2, admin: 3 };
const label = (p) => { const [name, level] = p.split(':'); return `${name.replace(/_/g, ' ')} (${level})`; };

/**
 * Decides one request before it reaches GitHub.
 * @param {{ method: string, url: string, scopes: string[], refused?: string[] }} input
 * @returns {{ allow: true, route: string|null, needs: string[] } | { allow: false, route: string|null, needs: string[], reason: string }}
 */
export function fineDecision({ method, url, scopes = [], refused = [] }) {
  let pathname = '';
  try { pathname = new URL(url, 'https://api.github.com').pathname; } catch { /* refused below */ }
  if (pathname === '/graphql') return { allow: true, route: 'POST /graphql', needs: [] }; // GitHub checks each field itself
  const route = operationOf(method, url);
  const listed = route ? listedFor(route).f : undefined;
  if (!Array.isArray(listed))
    return { allow: false, route, needs: [], reason: 'GitHub does not let fine-grained tokens do this' + (route ? ` (${route})` : '') + '. Install the GitHub App on this account instead, or use another way.' };
  if (!listed.length) return { allow: true, route, needs: [] };
  const has = new Set(scopes);
  const lacking = (need) => {
    const [name, level] = need.split(':');
    if (has.has(`${name}:none`)) return true;
    return refused.some((r) => { const [n, l] = r.split(':'); return n === name && (levelRank[l] ?? 9) <= (levelRank[level] ?? 9); });
  };
  // GitHub's list names every permission involved; several usually mean "any one of these". Refuse only when the token
  // is known to lack all of them: when it is unknown, GitHub decides (and a refusal is then remembered).
  if (listed.every(lacking))
    return { allow: false, route, needs: listed, reason: `Your fine-grained token does not have ${listed.map(label).join(' or ')}. On GitHub open Settings, Developer settings, Fine-grained tokens, edit this token and add that permission, then tap Re-check on My connection.` };
  return { allow: true, route, needs: listed };
}

/** The permissions a GitHub refusal of this request shows the token lacks (for writes: the write-level ones). */
export function refusedBy({ method, url, status, message }) {
  if (status !== 403 || !NOT_ACCESSIBLE.test(String(message ?? ''))) return [];
  const route = operationOf(method, url);
  const listed = route ? listedFor(route).f : undefined;
  return Array.isArray(listed) ? listed.filter((p) => LEARNED.test(p)) : [];
}
/** The per-person, per-owner setting key for what was learned about a token (settings keys are short lowercase words). */
export const fineSettingKey = (name, subject, owner) =>
  `${name}.${subject}.${createHash('sha256').update(String(owner).toLowerCase()).digest('hex').slice(0, 16)}`;
export const validLearned = (list) => Array.isArray(list) && list.length <= 100 && list.every((x) => typeof x === 'string' && LEARNED.test(x));

/** [{ area, reads, changes, tools }] for whoami and My connection. Never includes the token. */
export function fineUnlocks(scopes = [], refused = []) {
  const has = new Set(scopes);
  return FINE_AREAS.map((a) => {
    const reads = has.has(`${a.permission}:read`) ? 'yes' : has.has(`${a.permission}:none`) ? 'no' : 'not checked';
    const changes = reads === 'no' || refused.some((r) => r === `${a.permission}:write` || r === `${a.permission}:admin`) ? 'no'
      : 'GitHub decides on first use';
    return { area: a.area, reads, changes, tools: a.tools };
  });
}

/** The permission set split into plain lists. */
export function finePermissionSummary(scopes = [], refused = []) {
  const named = (level) => scopes.filter((s) => s.endsWith(':' + level)).map((s) => s.split(':')[0]).filter((n) => NAME.test(n));
  return { can_read: named('read'), not_granted: named('none'), changes_refused_by_github: refused.map((r) => r.split(':')[0]),
    changes: 'GitHub does not show a token\'s write permissions; a change is tried once and a refusal is remembered' };
}
