import { redact } from './util.js';
import { isOwnerConnection } from '../core/authority.js';
// The production guard (B2). A change is "production" when any rule below says so, judged from GitHub's own answers and the
// owner's settings, never from the arguments. A read that fails counts as production: the guard never guesses "safe".
// A tool's `classify` calls `productionReason`; the write layer then refuses the change on a preview connection and always
// asks first on a production one. `productionEnabledGate` additionally requires the account's production switch to be on.
import { githubFor } from '../github/client.js';
import { isPlanLimit } from '../github/plan-limit.js';

/** Names that always count as production (IN-12). The owner can add more on the setup page; these can never be removed. */
export const DEFAULT_PRODUCTION_NAMES = Object.freeze({ environments: Object.freeze(['production', 'prod', 'live']), branches: Object.freeze([]) });
export const PRODUCTION_NAMES_KEY = 'production_names';
const NAME = /^[A-Za-z0-9._/*-]{1,60}$/;
const MAX_NAMES = 20;

/** Cleans a list of names typed by the owner. Returns `{ names }` or `{ error }` in plain words. */
export function cleanNames(input, what) {
  const raw = Array.isArray(input) ? input : String(input ?? '').split(',');
  const names = [...new Set(raw.map((n) => String(n).trim()).filter(Boolean))];
  if (names.length > MAX_NAMES) return { error: `At most ${MAX_NAMES} ${what} names.` };
  const bad = names.find((n) => !NAME.test(n));
  if (bad) return { error: `"${redact(bad).slice(0, 40)}" is not a valid ${what} name (letters, numbers, . _ - / and * only).` };
  return { names };
}

/** The effective names: the built-in ones plus whatever the owner added. */
export async function productionNames(db) {
  const stored = (await db.getSetting(PRODUCTION_NAMES_KEY).catch(() => null)) ?? {};
  const merge = (base, extra) => [...new Set([...base, ...(Array.isArray(extra) ? extra.filter((n) => typeof n === 'string' && NAME.test(n)).slice(0, MAX_NAMES) : [])])];
  return { environments: merge(DEFAULT_PRODUCTION_NAMES.environments, stored.environments), branches: merge(DEFAULT_PRODUCTION_NAMES.branches, stored.branches) };
}

/** A glob with `*` (within one path part), `**` (across parts) and `?`; everything else is literal. */
export function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*') { if (glob[i + 1] === '*') { out += '.*'; i += 1; } else out += '[^/]*'; } else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}
export const matchesAny = (name, globs = []) => globs.some((g) => globToRegExp(g).test(name));
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

/**
 * @param {object} ctx tool context (needs `connection`, `db`, `credentials` for GitHub reads)
 * @param {{ owner: string, repo?: string, ref?: string, environment?: string, scope: string, kind?: string }} target
 *   `kind` says what is touched when it is not a branch: 'tag' | 'release' | 'repo-settings'
 * @param {{ profile?: { productionBranches?: string[], productionEnvironments?: string[] }, names?: object }} [options]
 * @returns {Promise<string|null>} a plain reason when the change is production, else null
 */
export async function productionReason(ctx, target, { profile = {}, names } = {}) {
  if (target.scope === 'org') return 'it changes organization-level settings, secrets, members or webhooks';
  if (target.scope === 'user') return 'it changes a personal account\'s settings';
  if (target.kind === 'tag') return 'it creates, moves or deletes a tag';
  if (target.kind === 'release') return 'it creates, changes or deletes a release';
  if (target.kind === 'repo-settings') return 'it changes repository settings that decide who can reach the code or how it ships';
  // Project profiles are read from the same durable store as the protection gate.
  // A failed lookup cannot make a branch less protected.
  let effectiveProfile=profile;
  if(target.repo && ctx.db?.profileForRepository && !Object.keys(profile).length){
    try{effectiveProfile=(await ctx.db.profileForRepository(target.owner,target.repo))??{};}
    catch{return 'the project policy could not be read, so this change is treated as production';}
  }
  const effective = names ?? await productionNames(ctx.db);
  const slug = `${target.owner}/${target.repo}`;

  if (target.environment) {
    const env = target.environment;
    if (effective.environments.some((n) => same(n, env)) || (effectiveProfile.productionEnvironments ?? []).some((n) => same(n, env))) return `"${env}" is a production environment`;
    try {
      const octokit = await githubFor(ctx, { owner: target.owner });
      const found = (await octokit.request('GET /repos/{owner}/{repo}/environments/{environment_name}', { owner: target.owner, repo: target.repo, environment_name: env })).data;
      const rules = found.protection_rules ?? [];
      if (rules.some((r) => r.type === 'required_reviewers' || r.type === 'wait_timer')) return `the "${env}" environment of ${slug} has required reviewers or a wait timer`;
    } catch (error) {
      if (error?.status !== 404) return `the "${env}" environment of ${slug} could not be checked, so it is treated as production`;
    }
  }

  if (target.ref) {
    const ref = target.ref;
    if (matchesAny(ref, [...effective.branches, ...(effectiveProfile.productionBranches ?? [])])) return `"${ref}" is a branch named as production`;
    let octokit;
    try { octokit = await githubFor(ctx, { owner: target.owner }); } catch { return `${slug} could not be checked, so it is treated as production`; }
    try {
      const repo = (await octokit.request('GET /repos/{owner}/{repo}', { owner: target.owner, repo: target.repo })).data;
      if (repo.default_branch === ref) return `"${ref}" is the default branch of ${slug}`;
    } catch { return `the default branch of ${slug} could not be checked, so it is treated as production`; }
    try {
      const branch = (await octokit.request('GET /repos/{owner}/{repo}/branches/{branch}', { owner: target.owner, repo: target.repo, branch: ref })).data;
      if (branch.protected === true) return `"${ref}" is a protected branch of ${slug}`;
    } catch (error) {
      if (error?.status !== 404) return `"${ref}" of ${slug} could not be checked for protection, so it is treated as production`;
    }
    try {
      const rules = (await octokit.request('GET /repos/{owner}/{repo}/rules/branches/{branch}', { owner: target.owner, repo: target.repo, branch: ref })).data;
      if (Array.isArray(rules) && rules.length) return `a ruleset applies to "${ref}" in ${slug}`;
    } catch (error) {
      // GitHub's exact free-plan answer means this repository cannot hold rulesets; any other failure stays production.
      if (!isPlanLimit(error)) return `the rules for "${ref}" in ${slug} could not be checked, so it is treated as production`;
    }
  }
  return null;
}

/**
 * Gate: on a production connection a production change also needs the account's production switch to be on. Turning the
 * switch off therefore stops every existing production connection at once.
 */
export function productionEnabledGate() {
  return async ({ ctx, target, classification }) => {
    if (isOwnerConnection(ctx.connection)) return null;
    if (!classification.production || ctx.connection.mode !== 'production') return null;
    const account = await ctx.db.getAccount(target.owner);
    if (account?.production_enabled === true) return null;
    // GOD-5: for an extra place (master token) the person's explicit "allow changes" on My connection IS the production
    // authorization; classification, confirmation, protected-resource and spend checks still apply to every change.
    if (account?.credential_kind === 'master' && account.allow_changes === true) return null;
    return { refuse: `Production changes are not turned on for ${target.owner}. Ask Claude to turn them on, then confirm on the setup page.`, by: 'production switch' };
  };
}
