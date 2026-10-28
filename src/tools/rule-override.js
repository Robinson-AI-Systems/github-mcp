import { isOwnerConnection } from '../core/authority.js';
// GOD-6 step 6b: a tool that may skip a branch's rules ON PURPOSE. `overridable(spec, { branchOf })` wraps one write tool:
//  - adds `overrideRules` (+ `overrideReason`) to its arguments;
//  - while previewing, checks the person may override (own login, switch on, production connection, a reason), reads with the
//    app which rules would be skipped and puts them, in plain words, in the preview (the change log keeps "OVERRIDE (reason): …");
//  - when applying, sends the change as the person (`ctx.forceMe`), and if GitHub itself says no, says so and sends nothing else.
// Without `overrideRules` the tool behaves exactly as before: the app makes the change and the rules hold.
import { githubFor } from '../github/client.js';
import { OVERRIDE_ARGS, overrideAllowed, overrideSummaryPrefix, skippedRules } from '../github/act-as.js';
import { refusal } from './github-write.js';
import { matchingEntries, protectedList } from './protect-guard.js';

const plans = new WeakMap(); // args object -> what was worked out while reading (the same args object reaches every stage)
const RULE_WORDS = /rule|protect|bypass|ruleset|required|review|status check/i;

export const planOf = (args) => plans.get(args) ?? null;
export const rememberPlan = (args, plan) => { plans.set(args, plan); };

/** Works out, for one change, whether the override applies and what it would skip. Never throws. */
export async function planOverride(ctx, args, { owner, repo, branch, ci = null, approvals = null }) {
  if (args.overrideRules !== true) return null;
  const allowed = await overrideAllowed(ctx, args);
  if (!allowed.ok) return { refuse: allowed.message };
  // A repository on the protected list (pr-only or locked) keeps its green-check merge rule: the override never applies there.
  // If the list cannot be read, fail closed.
  const listed = !isOwnerConnection(ctx.connection) && await protectedList(ctx.db).then((entries) => matchingEntries(entries, { owner, repo }).length > 0, () => true);
  if (listed && !isOwnerConnection(ctx.connection)) return { refuse: 'This repository is on the protected list (it moves only through green, exact-head pull requests), so its rules cannot be skipped.' };
  if (!branch) return { refuse: 'Only a branch\'s rules can be skipped this way; this change has no branch.' };
  const octokit = await githubFor({ ...ctx, actor: undefined }, { owner });
  const skipped = await skippedRules(octokit, { owner, repo, branch, ci, approvals }).catch(() => ['branch rules: could not be read']);
  // Local best-effort rule discovery is explanatory, not an authorization veto.
  // GitHub can enforce rules/checks not visible in this inventory. When the
  // owner explicitly requests an override, submit it under their own credential
  // and let GitHub decide; never silently fall back to the regular write path.
  return { use: true, skipped, branch, login: allowed.login, reason: args.overrideReason?.trim() || 'User-directed override' };
}

/** The sentence added to a preview. */
export function overrideLine(plan) {
  if (!plan) return '';
  if (plan.refuse) return `Cannot skip the rules: ${plan.refuse}`;
  if (!plan.use) return 'No rules would be skipped, so the override is not needed.';
  const list = plan.skipped.length ? plan.skipped.join('; ').slice(0, 380)
    : 'No branch rules identified by the available reads; other checks or GitHub policies may still apply';
  return `Requested override on ${plan.branch}: ${list}. GitHub decides whether ${plan.login ?? 'you'} may bypass; nothing is skipped without its approval. Reason: ${plan.reason}.`;
}

/** What GitHub says when it will not let this person skip the rules. */
export function ruleRefusal(error, branch) {
  const status = error?.status;
  if (![403, 405, 409, 422].includes(status) || !RULE_WORDS.test(String(error?.message ?? ''))) return null;
  return refusal(`GitHub does not let you skip the rules on ${branch ?? 'this branch'} (you are not on its bypass list, or the rule cannot be bypassed). Nothing was changed.`, 403);
}

/**
 * @param {object} spec a `defineGithubWrite` spec
 * @param {{ branchOf: (args, target, before) => string|null|Promise<string|null>, extras?: (ctx, args, target, before) => Promise<{ci?: object, approvals?: number|null}> }} options
 */
export function overridable(spec, { branchOf, extras = async () => ({}) }) {
  return {
    ...spec,
    properties: { ...spec.properties, ...OVERRIDE_ARGS },
    read: async (args, ctx, target) => {
      const before = await spec.read(args, ctx, target);
      if (args.overrideRules === true) {
        const branch = await branchOf(args, target, before);
        plans.set(args, await planOverride(ctx, args, { owner: target.owner, repo: target.repo, branch, ...(await extras(ctx, args, target, before).catch(() => ({}))) }));
      }
      return before;
    },
    summarize: (input) => {
      const plan = planOf(input.args);
      const line = spec.summarize(input);
      if (!plan) return line;
      if (plan.refuse || !plan.use) return `${overrideLine(plan)} ${line}`.slice(0, 1000);
      return `${overrideSummaryPrefix(plan.reason)}${line}. ${overrideLine(plan)}`.slice(0, 1000);
    },
    present: (input) => {
      const shown = spec.present(input);
      const plan = planOf(input.args);
      return plan?.use === true && shown && typeof shown === 'object' ? { ...shown, rules_overridden: plan.skipped } : shown;
    },
    apply: async (input) => {
      const plan = planOf(input.args);
      if (!plan) return spec.apply(input);
      if (plan.refuse) throw refusal(plan.refuse, 403);
      if (!plan.use) return spec.apply(input);
      try { return await spec.apply({ ...input, ctx: { ...input.ctx, forceMe: true } }); } catch (error) { throw ruleRefusal(error, plan.branch) ?? error; }
    }
  };
}
