import { redact } from './content-protection.js';
import { isOwnerConnection } from '../core/authority.js';
// GOD-6 "Act as me". With a master token added and the switch on, every GitHub call is made with the person's own token, so
// GitHub records the person (not the Robinson GitHub MCP app). This module decides WHEN that happens (actAsFor), records who
// acted (createActorLog), keeps branch rules from being skipped by accident (mustUseAppForBranch) and lets an owner or admin
// skip them on purpose (overrideAllowed, OVERRIDE_ARGS). Every "me" fact is per person (their numeric GitHub id), never per
// tenant: a tenant can hold several people. No token ever passes through here; only whether to use one.
import { scopeCovered } from './personal-cred.js';
import { formatDenver } from './errors.js';

const whole = (text, fallback, max) => {
  const n = Number(text ?? fallback);
  return Number.isSafeInteger(n) && n >= 0 && n <= max ? n : fallback;
};
const off = (reason = null, quiet = false) => ({ on: false, reason, quiet });
const dayOf = (iso) => { try { return formatDenver(new Date(iso)); } catch { return redact(String(iso)).slice(0, 10); } };

/** Every setting the answer depends on, read once per tool call (`ctx.actAsCache` is made by the dispatcher). */
async function factsFor(ctx, subject) {
  const holder = ctx.actAsCache;
  if (holder?.facts?.subject === subject) return holder.facts;
  const read = async (key) => (typeof ctx.db?.getSetting === 'function' ? ctx.db.getSetting(key).catch(() => null) : null);
  // Independent, read-only evidence may overlap. None of these selects grants
  // extra authority; a fresh provider request still enforces actual credentials.
  const [rate, act, rejected, override] = await Promise.all([
    typeof ctx.db?.getRateState === 'function' ? ctx.db.getRateState(`~me:${subject}`, 'core').catch(() => null) : null,
    read(`act_as_me.${subject}`),
    read(`master_rejected_at.${subject}`),
    read(`rule_override.${subject}`)
  ]);
  const facts = { subject, act, rejected, override, rate };
  if (holder) holder.facts = facts;
  return facts;
}
/** Forget what was read (after a rejection is saved, so the very next request already sees it). */
export function forgetActAs(ctx) { if (ctx?.actAsCache) ctx.actAsCache.facts = null; }

/**
 * Does this request act as the person?
 * @returns {Promise<{ on: true, subject: string, login: string|null, scopes: string[] } | { on: false, reason: string|null }>}
 *   `reason` is shown to the person when the app is used although they added a master token; null when God mode is simply off.
 */
export async function actAsFor(ctx, { cred = 'I', scope, masterStatus = undefined } = {}) {
  if (cred !== 'I' && cred !== 'U') return off();
  if (masterStatus === undefined && typeof ctx.credentials?.masterStatus !== 'function') return off();
  // A caller that just obtained masterStatus in this SAME tool invocation can
  // reuse that evidence, never across requests or after token changes.
  const status = masterStatus === undefined
    ? await ctx.credentials.masterStatus().catch(() => null)
    : masterStatus;
  if (status?.expired === true) return off(`your master token expired on ${dayOf(status.expires_at)}; add a new one on My connection`);
  if (status?.enrolled !== true || !status.subject) return off();
  if (ctx.connection?.profile === 'read_only') return off('read-only connections always use the app', true);
  if (ctx.connection?.pass === true) return off('service passes always use the app', true);
  if (scope?.permissions || scope?.repositories?.length || scope?.repository_ids?.length)
    return off('this tool asks for a narrowed token, which only the app can have');
  if (!scopeCovered(status.scopes, 'repo')) return off('your master token does not have the repo permission');
  const facts = await factsFor(ctx, status.subject);
  if (facts.act === 'off' && !(isOwnerConnection(ctx.connection) && ctx.forceMe === true)) return off('Act as me is off on My connection', true);
  if (facts.rejected) return off('GitHub rejected your master token; add a new one on My connection');
  const reserve = whole(ctx.env?.GITHUB_PERSONAL_RATE_RESERVE ?? process.env.GITHUB_PERSONAL_RATE_RESERVE, 100, 5000);
  const rate = facts.rate;
  if (!isOwnerConnection(ctx.connection) && rate && rate.remaining !== null && rate.remaining !== undefined && Number(rate.remaining) <= reserve) {
    const reset = rate.reset_at ? new Date(rate.reset_at).getTime() : null;
    const now = (ctx.now ?? Date.now)();
    if (reset === null || reset > now) return off(`your own GitHub allowance is nearly used up until ${reset === null ? 'it resets' : formatDenver(new Date(reset))}`);
  }
  return { on: true, subject: status.subject, login: status.login ?? null, scopes: status.scopes ?? [] };
}

/** Who acted during one top-level tool call (a workflow's nested calls share it). `summary()` is null when nothing was sent. */
export function createActorLog() {
  const rows = [];
  return {
    record({ as, note = null, viaUser = false }) { rows.push({ as: as === 'you' ? 'you' : 'app', note, viaUser: viaUser === true }); },
    summary() {
      if (!rows.length) return null;
      const you = rows.filter((r) => r.as === 'you').length;
      const as = you === 0 ? 'app' : you === rows.length ? 'you' : 'mixed';
      const notes = [...new Set(rows.map((r) => r.note).filter(Boolean))].slice(0, 3);
      return { as, notes, viaUser: rows.every((r) => r.as === 'app' && r.viaUser) };
    }
  };
}

/** The words shown in a result: who GitHub recorded. */
export function actingAsText(summary, login) {
  if (summary.as === 'you') return login ? `${login} (you)` : 'you';
  if (summary.as === 'mixed') return login ? `${login} (you); some steps by the app` : 'you; some steps by the app';
  if (summary.viaUser) return login ? `${login} (you, through the app)` : 'you, through the app';
  return 'Robinson GitHub MCP app';
}

/** `{ acting_as, acting_as_note? }` for a result. Reads the person's login once if it was never saved. */
export async function actingAsFor(ctx, summary) {
  let login = null;
  if (summary.as !== 'app' || summary.viaUser) {
    const status = typeof ctx.credentials?.masterStatus === 'function' ? await ctx.credentials.masterStatus().catch(() => null) : null;
    if (status?.subject) login = await loginFor(ctx, status.subject, status.login ?? null);
  }
  const note = redact(summary.notes.join('; ')).slice(0, 300);
  return { acting_as: actingAsText(summary, login), ...(note ? { acting_as_note: note } : {}) };
}

/** The person's login: saved at enrollment; when missing, read once with their token and saved. */
export async function loginFor(ctx, subject, known = null) {
  if (known) return known;
  if (ctx.actAsCache?.login) return ctx.actAsCache.login;
  try {
    const { githubFor } = await import('./client.js');
    const octokit = await githubFor({ ...ctx, actor: undefined }, { owner: ctx.connection.default_account, cred: 'M' }); // looking up the login is not an action on GitHub
    const login = (await octokit.request('GET /user')).data?.login;
    if (typeof login === 'string' && login) {
      await ctx.db.setSetting(`master_login.${subject}`, login).catch(() => {});
      if (ctx.actAsCache) ctx.actAsCache.login = login;
      return login;
    }
  } catch { /* the result then says "you" */ }
  return null;
}

// ---- Branch rules (card step 6) -----------------------------------------------------------------------------------------

const ALWAYS_APP_MUTATIONS = ['mergePullRequest', 'mergeBranch', 'createCommitOnBranch', 'updateRef', 'updateRefs', 'createRef', 'deleteRef', 'updatePullRequestBranch'];
const seg = (value) => { try { return decodeURIComponent(value ?? ''); } catch { return ''; } };
const headName = (ref) => { const m = /^(?:refs\/)?heads\/(.+)$/.exec(String(ref ?? '')); return m ? m[1] : null; };

/**
 * Which change does this request make to a branch or tag? `null` when it is not one of the kinds that branch rules guard.
 * @returns {null | { always: true, why: string } | { branch: string | null, pull: number | null }} `branch: null` = the default branch
 */
export function branchChange({ method, pathname, options = {}, query = '' }) {
  const parts = pathname.split('/').map(seg);
  if (pathname.startsWith('/graphql')) {
    const doc = String(query ?? '');
    return ALWAYS_APP_MUTATIONS.some((n) => new RegExp(`\\b${n}\\b`).test(doc)) ? { always: true, why: 'a branch or pull-request mutation' } : null;
  }
  if (parts[1] !== 'repos' || !parts[2] || !parts[3]) return null;
  const rest = parts.slice(4);
  if (rest[0] === 'releases') return { always: true, why: 'a release' };
  if (rest[0] === 'git' && rest[1] === 'tags' && method === 'POST') return { always: true, why: 'a tag' };
  if (rest[0] === 'git' && rest[1] === 'refs') {
    if (method === 'POST') { const name = headName(options.ref); return name ? { branch: name, pull: null } : { always: true, why: 'a tag or other reference' }; }
    const name = headName(rest.slice(2).join('/'));
    return name ? { branch: name, pull: null } : { always: true, why: 'a tag or other reference' };
  }
  if (rest[0] === 'contents' && (method === 'PUT' || method === 'DELETE')) return { branch: options.branch ?? null, pull: null };
  if (rest[0] === 'merges' && method === 'POST') return { branch: options.base ?? null, pull: null };
  if (rest[0] === 'merge-upstream' && method === 'POST') return { branch: options.branch ?? null, pull: null };
  if (rest[0] === 'branches' && rest[2] === 'rename' && method === 'POST') return { branch: rest[1], pull: null };
  if (rest[0] === 'pulls' && /^[1-9][0-9]*$/.test(rest[1] ?? '') && ['merge', 'merge-async', 'update-branch'].includes(rest[2]) && ['PUT', 'POST'].includes(method)) return { branch: null, pull: Number(rest[1]) };
  return null;
}

/**
 * Called by the client for a write that would be sent as the person. `true`-ish answer = send it with the app instead (with a
 * note). A read that fails counts as "has rules". `read(route, params)` makes a request with the app (or, for an extra place
 * that has no app, with the master token: reading is harmless).
 * @returns {Promise<null | { note: string, branch: string|null, always?: boolean }>}
 */
export async function mustUseAppForBranch({ method, pathname, options, query, owner, repo, read }) {
  const change = branchChange({ method, pathname, options, query });
  if (!change) return null;
  if (change.always) return { note: `${change.why} always comes from the app`, branch: null, always: true };
  let branch = change.branch;
  try {
    if (change.pull) branch = (await read('GET /repos/{owner}/{repo}/pulls/{pull_number}', { owner, repo, pull_number: change.pull })).data?.base?.ref ?? null;
    if (!branch) branch = (await read('GET /repos/{owner}/{repo}', { owner, repo })).data?.default_branch ?? null;
    if (!branch) return { note: 'the branch could not be worked out, so this change was made by the app', branch: null };
    let protectedBranch = false;
    try { protectedBranch = (await read('GET /repos/{owner}/{repo}/branches/{branch}', { owner, repo, branch })).data?.protected === true; } catch (error) { if (error?.status !== 404) throw error; }
    let rules = [];
    try { rules = (await read('GET /repos/{owner}/{repo}/rules/branches/{branch}', { owner, repo, branch })).data; } catch (error) { if (error?.status !== 404) throw error; }
    if (protectedBranch || (Array.isArray(rules) && rules.length)) return { note: `branch rules apply to ${branch}, so this change was made by the app`, branch };
    return null;
  } catch {
    return { note: 'the branch rules could not be read, so this change was made by the app', branch };
  }
}

// ---- Deliberate override by an owner or admin (card step 6b) ------------------------------------------------------------

/** Added to the input schema of the tools that may skip branch rules on purpose. */
export const OVERRIDE_ARGS = Object.freeze({
  overrideRules: { type: 'boolean', description: 'Skip this branch\'s rules for this one change, only if GitHub lets your own login do so. Needs overrideReason and confirm; the preview lists what is skipped.' },
  overrideReason: { type: 'string', minLength: 10, maxLength: 200, description: 'Why the rules are being skipped (required with overrideRules). Recorded in the change log.' }
});

/**
 * Is this change allowed to skip branch rules? Returns `{ ok: true, subject, login }` or `{ ok: false, message }` (plain words).
 * Only the person's own GitHub login can be on a bypass list; the app never is. GitHub itself still decides.
 */
export async function overrideAllowed(ctx, args) {
  if (!isOwnerConnection(ctx.connection) && (typeof args?.overrideReason !== 'string' || args.overrideReason.trim().length < 10)) return { ok: false, message: 'Say why you are overriding the rules (overrideReason, 10 to 200 characters).' };
  const me = await actAsFor(isOwnerConnection(ctx.connection) ? { ...ctx, forceMe: true } : ctx, { cred: 'I' });
  if (!me.on) return { ok: false, message: 'Only your own GitHub login can skip branch rules; add your master token and turn Act as me on.' + (me.reason ? ` (Right now: ${me.reason}.)` : '') };
  const facts = await factsFor(ctx, me.subject);
  if (!isOwnerConnection(ctx.connection) && facts.override === 'off') return { ok: false, message: 'Overriding branch rules is off on My connection.' };
  if (!isOwnerConnection(ctx.connection) && ctx.connection?.mode !== 'production') return { ok: false, message: 'Overriding rules needs a production connection.' };
  return { ok: true, subject: me.subject, login: me.login };
}

/**
 * What would be skipped on this branch, in plain words, read with the app. Never throws.
 * @returns {Promise<string[]>}
 */
export async function skippedRules(octokitApp, { owner, repo, branch, ci = null, approvals = null }) {
  const lines = [];
  const rules = await octokitApp.request('GET /repos/{owner}/{repo}/rules/branches/{branch}', { owner, repo, branch, request: { robinsonAs: 'app' } })
    .then((r) => (Array.isArray(r.data) ? r.data : [])).catch((e) => (e?.status === 404 ? [] : null));
  if (rules === null) lines.push('branch rules: could not be read');
  for (const rule of rules ?? []) {
    const p = rule.parameters ?? {};
    if (rule.type === 'pull_request') lines.push(`${p.required_approving_review_count ?? 1} required approval${(p.required_approving_review_count ?? 1) === 1 ? '' : 's'}${approvals !== null ? ` (${approvals} given)` : ''}`);
    else if (rule.type === 'required_status_checks') lines.push(`required checks${ci?.problems?.length ? ` (${ci.problems.slice(0, 3).join('; ')})` : ''}`);
    else lines.push(String(rule.type).replace(/_/g, ' '));
  }
  const protection = await octokitApp.request('GET /repos/{owner}/{repo}/branches/{branch}/protection', { owner, repo, branch, request: { robinsonAs: 'app' } })
    .then((r) => r.data).catch((e) => (e?.status === 404 ? null : 'unreadable'));
  if (protection === 'unreadable') lines.push('branch protection: could not be read');
  else if (protection) {
    const n = protection.required_pull_request_reviews?.required_approving_review_count;
    if (n) lines.push(`branch protection: ${n} required approval${n === 1 ? '' : 's'}`);
    if (protection.required_status_checks) lines.push('branch protection: required checks');
    if (protection.enforce_admins?.enabled) lines.push('branch protection: applies to admins');
    if (!n && !protection.required_status_checks && !protection.enforce_admins?.enabled) lines.push('branch protection');
  }
  return lines;
}

export const overrideSummaryPrefix = (reason) => `OVERRIDE (${redact(String(reason)).replace(/\s+/g, ' ').slice(0, 200)}): `;
