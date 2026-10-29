import { redact } from './util.js';
import { isOwnerConnection } from '../core/authority.js';
// Ordinary full-owner merges rely on GitHub's repository rules and permissions.
// An optional expectedHeadSha is checked and sent to GitHub for race detection.
// Restricted profiles and requested merge-when-green automation retain their
// explicit checks. Deliberate bypass is disclosed/journaled as the actual person;
// GitHub decides whether that credential can bypass the applicable rule.
import { graphql } from '../github/client.js';
import { ciState } from '../github/ci-state.js';
import { defineGithubWrite } from './define-github-write.js';
import { missing, octo, ownerOf, refusal, slug } from './github-write.js';
import { productionReason } from './production-guard.js';
import { actAsFor, OVERRIDE_ARGS, overrideSummaryPrefix } from '../github/act-as.js';
import { overrideLine, planOf, planOverride, rememberPlan, ruleRefusal } from './rule-override.js';

const OWNER = { type: 'string', maxLength: 39, description: 'GitHub account (default: the connection\'s default account)' };
const REPO = { type: 'string', minLength: 1, maxLength: 100 };
const PR = { type: 'integer', minimum: 1, description: 'Pull request number' };
const HEAD = { type: 'string', minLength: 40, maxLength: 40, description: 'The exact head commit you read and whose checks passed' };
const METHOD = { type: 'string', enum: ['merge', 'squash', 'rebase'], description: 'Default merge (a merge commit)' };
const TITLE = { type: 'string', maxLength: 256, description: 'Merge commit title' };
const MESSAGE = { type: 'string', maxLength: 5000, description: 'Merge commit message' };
const short = (sha) => String(sha ?? '').slice(0, 7);
const target = (args, ctx) => ({ owner: ownerOf(args, ctx), repo: args.repo, scope: 'repo' });
const label = (t, n) => `pull request #${n} in ${slug(t.owner, t.repo)}`;

/** Reads the pull request and, when it is open, whether its required checks are green at the head, and whether the base is production. */
async function readPlan(args, ctx, t, { checks = true } = {}) {
  const octokit = await octo(ctx, t.owner);
  const pr = await missing(async () => (await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', { owner: t.owner, repo: t.repo, pull_number: args.number, request: { robinsonAs: 'app' } })).data);
  if (!pr) return { pr: null };
  // GOD-6: acting as the person could skip rules the app cannot; the readable reason comes first (see `blockers`).
  const plan = { ownerDirected: isOwnerConnection(ctx.connection), actsAsYou: (await actAsFor(ctx, { cred: 'I' })).on, pr: { number: pr.number, state: pr.state, merged: pr.merged, draft: pr.draft, mergeable: pr.mergeable, mergeable_state: pr.mergeable_state, head_sha: pr.head?.sha, head: pr.head?.ref, base: pr.base?.ref, node_id: pr.node_id, title: pr.title, auto_merge: pr.auto_merge ?? null } };
  if (checks && pr.state === 'open' && !pr.merged) plan.ci = await ciState(octokit, { owner: t.owner, repo: t.repo, baseBranch: pr.base.ref, headSha: pr.head.sha });
  if (args.overrideRules === true && checks) {
    const approvals = await approvalsAt(octokit, t, pr);
    rememberPlan(args, await planOverride(ctx, args, { owner: t.owner, repo: t.repo, branch: pr.base?.ref ?? null, ci: plan.ci ?? null, approvals }));
  }
  return plan;
}

/** How many people's latest review of this exact head is an approval; null when it could not be read. */
async function approvalsAt(octokit, t, pr) {
  try {
    const reviews = (await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews', { owner: t.owner, repo: t.repo, pull_number: pr.number, per_page: 100, request: { robinsonAs: 'app' } })).data;
    const latest = new Map();
    for (const r of Array.isArray(reviews) ? reviews : []) if (r.state !== 'COMMENTED' && r.user?.login) latest.set(r.user.login, r);
    return [...latest.values()].filter((r) => r.state === 'APPROVED' && r.commit_id === pr.head?.sha).length;
  } catch { return null; }
}

const CLEAN_STATES = ['clean', 'unstable', 'has_hooks'];

/** Plain-language reasons this pull request must not be merged now (empty = go ahead). */
export function blockers(plan, args, { override = false } = {}) {
  const { pr, ci } = plan;
  if (!pr) return [`There is no pull request #${args.number}.`];
  if (pr.merged) return ['It is already merged.'];
  if (pr.state !== 'open') return ['It is closed. Reopen it first.'];
  const out = [];
  // Asked to skip the rules but not allowed to: say no, rather than quietly merging the ordinary way.
  const asked = planOf(args);
  if (asked?.refuse) out.push(`Cannot skip the rules: ${asked.refuse}`);
  if ((args.expectedHeadSha !== undefined || !plan.ownerDirected) && pr.head_sha !== args.expectedHeadSha) out.push(`New commits arrived: the head is now ${short(pr.head_sha)}, not ${short(args.expectedHeadSha)}. The checks you saw are out of date; read the pull request again.`);
  if (plan.ownerDirected) return out; // GitHub applies its own draft, checks and rules policy.
  if (pr.draft) out.push('It is a draft. Mark it ready for review first.');
  if (pr.mergeable === false) out.push(`GitHub says it cannot be merged (${pr.mergeable_state ?? 'conflicts'}). Update the branch or resolve conflicts first.`);
  if (override) return out; // the person is skipping the rules on purpose: the preview lists which, GitHub decides
  if (plan.actsAsYou === true && !CLEAN_STATES.includes(pr.mergeable_state)) {
    out.push(!pr.mergeable_state || pr.mergeable_state === 'unknown'
      ? 'GitHub is still working out whether this can be merged; read the pull request again in a moment.'
      : `GitHub's rules for ${pr.base} are not met yet (for example a required review). Acting as you could skip them, so it is not merged.`);
  }
  if (!ci || ci.green === null) out.push(`The checks could not be verified (${(ci?.errors ?? ['unknown']).join('; ')}), so it is not merged.`);
  else if (!ci.green) out.push(`Required checks are not green at ${short(pr.head_sha)}: ${ci.problems.join('; ')}.`);
  return out;
}

const productionOf = async (ctx, t, plan) => ({ production: plan.pr ? await productionReason(ctx, { ...t, ref: plan.pr.base }) : null });
const PROPS = { owner: OWNER, repo: REPO, number: PR, expectedHeadSha: HEAD, method: METHOD, title: TITLE, message: MESSAGE, ...OVERRIDE_ARGS };
const mergeBody = (args) => ({ sha: args.expectedHeadSha, merge_method: args.method ?? 'merge', ...(args.title ? { commit_title: args.title } : {}), ...(args.message ? { commit_message: args.message } : {}) });
const afterPr = (ctx, t, number) => missing(async () => (await (await octo(ctx, t.owner)).request('GET /repos/{owner}/{repo}/pulls/{pull_number}', { owner: t.owner, repo: t.repo, pull_number: number })).data);

// GOD-6: with `overrideRules` (own login, preview, confirm) the merge is sent as the person through GitHub's background merge with its
// own `bypass_rules` option; checks and review rules become lines of the preview instead of refusals. GitHub decides whether the person
// may skip them. This is the ONLY place the server sends that option.
const overriding = (args) => planOf(args)?.use === true;
const overrideText = (args, line) => {
  const plan = planOf(args);
  if (!plan) return line;
  if (plan.refuse || !plan.use) return redact(`${overrideLine(plan)} ${line}`).slice(0, 1000);
  return redact(`${overrideSummaryPrefix(plan.reason)}${line}. ${overrideLine(plan)}`).slice(0, 1000);
};
export function mergeCheckSummary(before) {
  const ci = before?.ci;
  if (!ci || ci.green === null || !Array.isArray(ci.checks)) return 'CI status unknown';
  if (!ci.checks.length) return 'CI: no checks reported';
  const counts = { successful: 0, failed: 0, pending: 0, unknown: 0 };
  for (const check of ci.checks) {
    const bucket = check.state === 'success' ? 'successful'
      : ['failure', 'error'].includes(check.state) ? 'failed'
        : ['pending', 'queued', 'in_progress', 'waiting', 'requested'].includes(check.state) ? 'pending' : 'unknown';
    counts[bucket]++;
  }
  return 'CI: ' + Object.entries(counts).map(([state, count]) => `${count} ${state}`).join(', ');
}

async function sendAsync({ args, ctx, before, target: t }, bypass) {
  const why = blockers(before, args, { override: bypass });
  if (why.length) throw refusal(why.join(' '), 409);
  const c = bypass ? { ...ctx, forceMe: true } : ctx;
  try {
    return await (await octo(c, t.owner)).request('PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge-async', { owner: t.owner, repo: t.repo, pull_number: args.number, ...mergeBody(args), merge_action: 'direct_merge', ...(bypass ? { bypass_rules: true } : {}) });
  } catch (error) {
    // A merge for this pull request is already pending: GitHub answers 409 with that request; report it instead of failing.
    if (error?.status === 409 && error?.response?.data?.status === 'pending') return { status: 202, data: error.response.data, headers: error.response.headers ?? {} };
    throw (bypass ? ruleRefusal(error, before.pr.base) : null) ?? error;
  }
}
const asyncAfter = async ({ args, ctx, target: t, response }) => ({ result: response.data, pr: await afterPr(ctx, t, args.number) });
const asyncVerify = ({ after, response }) => {
  const status = response?.data?.status;
  if (status === 'merged') return after?.pr?.merged === true;
  return status === 'pending' || status === 'enqueued';
};
const asyncPresent = ({ after, response }) => ({ status: response.data.status, ...(response.data.details?.uuid ? { uuid: response.data.details.uuid } : {}), ...(response.data.status === 'failed' ? { reason: response.data.details?.message } : {}),
  merged: after?.pr?.merged === true, html_url: after?.pr?.html_url, ...(response.data.status === 'pending' ? { note: 'GitHub is merging in the background; read the pull request again for the result.' } : {}) });

const prMerge = defineGithubWrite({
  name: 'github_pr_merge', area: 'pr', audience: ['B'],
  description: 'Merge a PR at the expected head under GitHub permissions and repository rules; optional deliberate override.',
  properties: PROPS, required: ['repo', 'number'],
  declarations: { production: 'when-target', confirm: 'always' },
  target,
  read: (args, ctx, t) => readPlan(args, ctx, t),
  classify: ({ ctx, target: t, before }) => productionOf(ctx, t, before),
  summarize: ({ args, before, target: t }) => {
    const bypass = overriding(args);
    const why = blockers(before, args, { override: bypass });
    const line = why.length ? `Cannot merge ${label(t, args.number)}: ${why.join(' ')}` : `Merge ${label(t, args.number)} (${before.pr.head} into ${before.pr.base}) at expected PR head ${short(args.expectedHeadSha ?? before.pr.head_sha)} with ${args.method ?? 'merge'}; ${bypass ? 'rules skipped on purpose' : mergeCheckSummary(before)}`;
    return overrideText(args, line);
  },
  apply: async (input) => {
    const { args, ctx, before, target: t } = input;
    if (overriding(args)) return sendAsync(input, true);
    const why = blockers(before, args);
    if (why.length) throw refusal(why.join(' '), 409);
    return (await octo(ctx, t.owner)).request('PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge', { owner: t.owner, repo: t.repo, pull_number: args.number, ...mergeBody(args) });
  },
  readAfter: (input) => (overriding(input.args) ? asyncAfter(input) : afterPr(input.ctx, input.target, input.args.number)),
  verify: (input) => (overriding(input.args) ? asyncVerify(input) : input.after?.merged === true && input.response?.data?.merged === true),
  inverse: () => null,
  present: (input) => (overriding(input.args) ? { ...asyncPresent(input), rules_overridden: planOf(input.args).skipped } : ({ number: input.after?.number, merged: input.after?.merged, merge_commit: input.response?.data?.sha, base: input.after?.base?.ref, html_url: input.after?.html_url }))
});

const prMergeAsync = defineGithubWrite({
  name: 'github_pr_merge_async', area: 'pr', audience: ['B'],
  description: 'Request a background merge at the expected head; GitHub decides eligibility and reports merged or pending.',
  properties: PROPS, required: ['repo', 'number'],
  declarations: { production: 'when-target', confirm: 'always' },
  target,
  read: (args, ctx, t) => readPlan(args, ctx, t),
  classify: ({ ctx, target: t, before }) => productionOf(ctx, t, before),
  summarize: ({ args, before, target: t }) => {
    const bypass = overriding(args);
    const why = blockers(before, args, { override: bypass });
    return overrideText(args, why.length ? `Cannot merge ${label(t, args.number)}: ${why.join(' ')}` : `Merge ${label(t, args.number)} in the background at expected PR head ${short(args.expectedHeadSha ?? before.pr.head_sha)} with ${args.method ?? 'merge'}; ${bypass ? 'rules skipped on purpose' : mergeCheckSummary(before)}`);
  },
  apply: (input) => sendAsync(input, overriding(input.args)),
  readAfter: asyncAfter,
  verify: asyncVerify,
  inverse: () => null,
  present: (input) => ({ ...asyncPresent(input), ...(overriding(input.args) ? { rules_overridden: planOf(input.args).skipped } : {}) })
});

const ENABLE = 'mutation($input: EnablePullRequestAutoMergeInput!) { enablePullRequestAutoMerge(input: $input) { pullRequest { number } } }';
const DISABLE = 'mutation($input: DisablePullRequestAutoMergeInput!) { disablePullRequestAutoMerge(input: $input) { pullRequest { number } } }';
const METHODS = { merge: 'MERGE', squash: 'SQUASH', rebase: 'REBASE' };

const prSetAutoMerge = defineGithubWrite({
  name: 'github_pr_set_auto_merge', area: 'pr', audience: ['B'],
  description: 'Turn auto-merge on (GitHub merges when its own rules pass, only at the head you name) or off.',
  properties: { owner: OWNER, repo: REPO, number: PR, enabled: { type: 'boolean', description: 'true = turn on, false = turn off' }, expectedHeadSha: HEAD, method: METHOD, title: TITLE, message: MESSAGE },
  required: ['repo', 'number', 'enabled'],
  declarations: { production: 'when-target', confirm: 'always' },
  target: (args, ctx) => { if (args.enabled && !args.expectedHeadSha) throw new TypeError('To turn auto-merge on, give expectedHeadSha: the head commit you read.'); return target(args, ctx); },
  read: (args, ctx, t) => readPlan(args, ctx, t, { checks: false }),
  classify: ({ args, ctx, target: t, before }) => (args.enabled ? productionOf(ctx, t, before) : {}),
  summarize: ({ args, before, target: t }) => {
    if (!before.pr) return `There is no pull request #${args.number} in ${slug(t.owner, t.repo)}`;
    if (!args.enabled) return `Turn auto-merge off for ${label(t, args.number)}`;
    if (before.pr.head_sha !== args.expectedHeadSha) return `Cannot turn auto-merge on: the head is now ${short(before.pr.head_sha)}, not ${short(args.expectedHeadSha)}`;
    return `Turn auto-merge on for ${label(t, args.number)}: GitHub will merge it with ${args.method ?? 'merge'} at ${short(args.expectedHeadSha)} once its own rules pass`;
  },
  apply: async ({ args, ctx, before, target: t }) => {
    if (!before.pr) throw refusal(`There is no pull request #${args.number}.`, 404);
    if (before.pr.merged || before.pr.state !== 'open') throw refusal(`Pull request #${args.number} is not open.`);
    const octokit = await octo(ctx, t.owner);
    if (!args.enabled) return { data: await graphql(octokit, DISABLE, { input: { pullRequestId: before.pr.node_id } }) };
    if (before.pr.head_sha !== args.expectedHeadSha) throw refusal(`New commits arrived: the head is ${short(before.pr.head_sha)}, not ${short(args.expectedHeadSha)}. Read the pull request again.`, 409);
    return { data: await graphql(octokit, ENABLE, { input: { pullRequestId: before.pr.node_id, expectedHeadOid: args.expectedHeadSha, mergeMethod: METHODS[args.method ?? 'merge'], ...(args.title ? { commitHeadline: args.title } : {}), ...(args.message ? { commitBody: args.message } : {}) } }) };
  },
  readAfter: ({ args, ctx, target: t }) => afterPr(ctx, t, args.number),
  verify: ({ args, after }) => !!after && (args.enabled ? !!after.auto_merge : !after.auto_merge),
  inverse: ({ args, target: t }) => (args.enabled ? { tool: 'github_pr_set_auto_merge', args: { owner: t.owner, repo: t.repo, number: args.number, enabled: false } } : null),
  present: ({ args, after }) => ({ number: after?.number, auto_merge: !!after?.auto_merge, enabled: args.enabled })
});

const all = [prMerge, prMergeAsync, prSetAutoMerge];
export const tools = all.map((d) => d.tool);
export const handlers = Object.fromEntries(all.map((d) => [d.tool.name, d.handler]));
