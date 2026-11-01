// CAP-6 (owner-approved 2026-11-01, docs/designs/GATED-EXPANSION-2026-11-01.md item 9): the runner, larger-runner,
// merge-queue and Copilot tool families are offered only to accounts that actually have the feature. The answer is
// discovered from GitHub itself, kept briefly per connection and account, and always explained in plain words.
//
// Three states per family and account:
//   on      GitHub showed the feature (the tools are listed and run normally);
//   off     GitHub showed the feature is absent (the tools are hidden, and a call by name is refused with the reason);
//   unknown GitHub could not be asked (permission missing, outage, timeout): the tools are hidden from listings with the
//           reason, but a call by name still runs and GitHub itself decides. A gate never invents an answer.
// A gate never turns anything on, raises spend or widens access: it only decides what is offered.
import { githubFor, graphql } from './client.js';

export const FEATURE_CACHE_MS = 10 * 60 * 1000;
const PROBE_TIMEOUT_MS = 4000;
const CACHE_LIMIT = 1000;
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

/** The gated families. Membership is by tool name, so a new tool in a family is gated without another list to edit. */
export const FEATURE_FAMILIES = Object.freeze({
  runners: Object.freeze({ title: 'Self-hosted runners', match: (n) => n.startsWith('github_runner_') }),
  larger_runners: Object.freeze({ title: 'GitHub-hosted larger runners', match: (n) => n.startsWith('github_hosted_runner_') }),
  merge_queue: Object.freeze({ title: 'Merge queue', match: (n) => n.startsWith('github_merge_queue_') }),
  copilot: Object.freeze({ title: 'Copilot', match: (n) => n.startsWith('github_copilot_') || n === 'github_review_request_copilot' })
});
export const FAMILY_NAMES = Object.freeze(Object.keys(FEATURE_FAMILIES));

/** The family a tool belongs to, or null for an ungated tool. */
export function familyOf(name) {
  if (typeof name !== 'string') return null;
  return FAMILY_NAMES.find((key) => FEATURE_FAMILIES[key].match(name)) ?? null;
}

const cache = new Map();
/** Tests only: forget every cached answer. */
export function clearFeatureCache() { cache.clear(); }

const on = (reason) => ({ state: 'on', reason });
const off = (reason) => ({ state: 'off', reason });
const unknown = (reason) => ({ state: 'unknown', reason });
const statusOf = (error) => (Number.isInteger(error?.status) ? error.status : null);
const permissionWords = (what) => `GitHub refused to show ${what} to this connection (it may lack the GitHub App permission for it), so the tools are hidden from lists; calling one by name still works and GitHub decides.`;
const unreachable = (what) => `GitHub could not be asked about ${what} just now, so the tools are hidden from lists; calling one by name still works and GitHub decides.`;

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { timeout: true })), ms); timer.unref?.(); })
  ]);
}

async function probeRunners(gh, login, type) {
  if (type !== 'Organization') return on('Self-hosted runners can be added to any repository of a personal account.');
  try {
    const d = (await gh.request('GET /orgs/{org}/actions/runners', { org: login, per_page: 1 })).data;
    const n = Number.isInteger(d?.total_count) ? d.total_count : null;
    return on(`GitHub answered the organization's self-hosted runner list${n === null ? '' : ` (${n} runner${n === 1 ? '' : 's'})`}.`);
  } catch (error) {
    const s = statusOf(error);
    if (s === 404) return off(`GitHub has no self-hosted runner list for ${login} (it answered "not found"), so the runner tools are hidden.`);
    if (s === 401 || s === 403) return unknown(permissionWords('the self-hosted runners'));
    return unknown(unreachable('self-hosted runners'));
  }
}

async function probeLargerRunners(gh, login, type) {
  if (type !== 'Organization') return off('Larger GitHub-hosted runners exist only for organizations on a GitHub Team or Enterprise plan; this is a personal account.');
  try {
    const d = (await gh.request('GET /orgs/{org}/actions/hosted-runners', { org: login, per_page: 1 })).data;
    const n = Number.isInteger(d?.total_count) ? d.total_count : null;
    return on(`GitHub answered the organization's larger-runner list${n === null ? '' : ` (${n} pool${n === 1 ? '' : 's'})`}.`);
  } catch (error) {
    const s = statusOf(error);
    if (s === 404 || s === 422) return off(`GitHub reports no larger GitHub-hosted runners for ${login} (they need a GitHub Team or Enterprise plan), so those tools are hidden.`);
    if (s === 401 || s === 403) return unknown(permissionWords('larger runners'));
    return unknown(unreachable('larger runners'));
  }
}

const MERGE_QUEUE_PROBE = 'query($login: String!) { organization(login: $login) { repositories(first: 25, isArchived: false, orderBy: { field: PUSHED_AT, direction: DESC }) { nodes { name mergeQueue { id } } } } }';
async function probeMergeQueue(gh, login, type) {
  if (type !== 'Organization') return off('GitHub offers merge queues only for repositories owned by an organization; this is a personal account.');
  try {
    const nodes = (await graphql(gh, MERGE_QUEUE_PROBE, { login }))?.organization?.repositories?.nodes;
    if (!Array.isArray(nodes)) return unknown(unreachable('merge queues'));
    const queued = nodes.filter((r) => r?.mergeQueue?.id).map((r) => String(r.name));
    if (queued.length) return on(`A merge queue is turned on in ${queued.slice(0, 5).join(', ')}${queued.length > 5 ? ` and ${queued.length - 5} more` : ''}.`);
    return off(`None of the ${nodes.length} most recently pushed repositories of ${login} has a merge queue on its default branch (a branch ruleset "Require merge queue" turns one on), so the merge-queue tools are hidden.`);
  } catch (error) {
    const s = statusOf(error);
    if (s === 401 || s === 403) return unknown(permissionWords('merge queues'));
    return unknown(unreachable('merge queues'));
  }
}

const COPILOT_BOT = 'copilot-swe-agent';
const COPILOT_USER_PROBE = 'query($login: String!) { user(login: $login) { repositories(first: 1, ownerAffiliations: [OWNER], orderBy: { field: PUSHED_AT, direction: DESC }) { nodes { name suggestedActors(capabilities: [CAN_BE_ASSIGNED], first: 5, loginNames: "copilot-swe-agent") { nodes { login } } } } } }';
async function probeCopilot(gh, login, type) {
  try {
    if (type === 'Organization') {
      const d = (await gh.request('GET /orgs/{org}/copilot/billing', { org: login })).data;
      const seats = Number.isInteger(d?.seat_breakdown?.total) ? d.seat_breakdown.total : null;
      return on(`Copilot ${typeof d?.plan_type === 'string' ? d.plan_type : ''} is active for ${login}${seats === null ? '' : ` (${seats} seat${seats === 1 ? '' : 's'})`}.`.replace('Copilot  is', 'Copilot is'));
    }
    const repo = (await graphql(gh, COPILOT_USER_PROBE, { login }))?.user?.repositories?.nodes?.[0];
    if (!repo) return off('This personal account has no repository where Copilot could be offered, so the Copilot tools are hidden.');
    const found = (repo.suggestedActors?.nodes ?? []).some((a) => String(a?.login).toLowerCase() === COPILOT_BOT);
    return found
      ? on(`Copilot's coding agent can be assigned in ${repo.name}, so this account has Copilot.`)
      : off(`Copilot's coding agent is not offered in ${repo.name} (your most recently pushed repository), so this account shows no active Copilot plan and the Copilot tools are hidden.`);
  } catch (error) {
    const s = statusOf(error);
    if (type === 'Organization' && (s === 404 || s === 422)) return off(`${login} has no Copilot Business or Enterprise plan, so the Copilot tools are hidden.`);
    if (s === 401 || s === 403) return unknown(permissionWords('Copilot'));
    return unknown(unreachable('Copilot'));
  }
}

const PROBES = { runners: probeRunners, larger_runners: probeLargerRunners, merge_queue: probeMergeQueue, copilot: probeCopilot };

const cacheKey = (connection, login) => `${connection?.client_id ?? connection?.pass_id ?? 'connection'}|${String(login).toLowerCase()}`;

/**
 * The decision for every family on one connected account, cached for FEATURE_CACHE_MS.
 * @param {object} ctx `{ connection, db, credentials, fetch?, now?, env? }`, the same context a read tool gets
 */
export async function decideAccount(ctx, login, { refresh = false } = {}) {
  const now = (ctx.now ?? Date.now)();
  const key = cacheKey(ctx.connection, login);
  const hit = cache.get(key);
  if (!refresh && hit && hit.expires > now) return hit.value;
  let type = null;
  try { type = (await ctx.db?.getAccount?.(login))?.account_type ?? null; } catch { type = null; }
  let gh = null;
  try { gh = await githubFor({ ...ctx, budgetMs: PROBE_TIMEOUT_MS }, { owner: login }); } catch { gh = null; }
  const entries = await Promise.all(FAMILY_NAMES.map(async (family) => {
    if (!gh) return [family, unknown('No GitHub credential for this account could be used to check, so the tools are hidden from lists; calling one by name still works and GitHub decides.')];
    try { return [family, await withTimeout(PROBES[family](gh, login, type), PROBE_TIMEOUT_MS)]; }
    catch { return [family, unknown(unreachable(FEATURE_FAMILIES[family].title.toLowerCase()))]; }
  }));
  const value = Object.freeze({ account: login, type, checked_at: new Date(now).toISOString(), families: Object.freeze(Object.fromEntries(entries)) });
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
  cache.set(key, { expires: now + FEATURE_CACHE_MS, value });
  return value;
}

/** Decisions for every account of the connection. */
export async function decideConnection(ctx, { refresh = false, accounts } = {}) {
  const list = (accounts ?? ctx.connection?.accounts ?? []).filter((a) => typeof a === 'string' && LOGIN.test(a)).slice(0, 25);
  return Promise.all(list.map((login) => decideAccount(ctx, login, { refresh })));
}

/**
 * Which of `tools` a connection is offered. A gated tool is offered when its family is on for at least one of the
 * connection's accounts. `hidden` explains every family that was taken out, per account.
 */
export async function offeredTools(ctx, tools) {
  const gated = new Set(tools.map((t) => familyOf(t.name)).filter(Boolean));
  if (!gated.size) return { tools, hidden: [] };
  const decisions = await decideConnection(ctx);
  const offered = new Set([...gated].filter((family) => decisions.some((d) => d.families[family]?.state === 'on')));
  const hidden = [...gated].filter((family) => !offered.has(family)).map((family) => ({
    family, title: FEATURE_FAMILIES[family].title,
    accounts: decisions.map((d) => ({ account: d.account, state: d.families[family]?.state ?? 'unknown', reason: d.families[family]?.reason ?? null }))
  }));
  return { tools: tools.filter((t) => { const f = familyOf(t.name); return !f || offered.has(f); }), hidden };
}

/** The same registry with only the offered tools, for a listing door. Handlers are unchanged. */
export async function offeredRegistry(registry, ctx) {
  const { tools } = await offeredTools(ctx, registry.tools);
  return tools.length === registry.tools.length ? registry : { ...registry, tools };
}

/**
 * A call to a gated tool on an account where GitHub showed the feature is absent is refused with the reason.
 * Unknown answers never refuse (GitHub itself decides). Returns null when the call may go ahead.
 */
export async function featureRefusal(ctx, name, args = {}) {
  const family = familyOf(name);
  if (!family) return null;
  const owner = String(args.owner ?? args.org ?? ctx.connection?.default_account ?? '');
  if (!(ctx.connection?.accounts ?? []).some((a) => String(a).toLowerCase() === owner.toLowerCase())) return null; // the tool's own account check answers
  const decision = await decideAccount(ctx, owner);
  const answer = decision.families[family];
  if (answer?.state !== 'off') return null;
  return { family, title: FEATURE_FAMILIES[family].title, account: owner, reason: answer.reason,
    message: `${FEATURE_FAMILIES[family].title} tools are not offered for ${owner}: ${answer.reason} Nothing was sent. Run github_feature_families with refresh: true after turning the feature on.` };
}
