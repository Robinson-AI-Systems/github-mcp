import { isOwnerConnection } from '../core/authority.js';
// Self-protection and project ownership (B3). Two rules the write layer runs on every change, before anything is sent:
//   1. The protected list (`protected_resources`): this server's own repository and the other Robinson servers are `pr-only`
//      (only the pull-request conveyor works, merges only at an exact head SHA); the hub's relay, the frozen old toolkit and every
//      installation of this server's own GitHub Apps are `locked` (no write at all). The list is edited only on the setup page;
//      no argument, pass or profile can change or skip it.
//   2. Project ownership: a project profile (Batch P) may name refs its own automation manages (Appliance Desk's `live`). A write
//      to such a ref is refused with the owning workflow's name unless the caller passes `outsideProject: true`, which still asks
//      for confirmation. A profile's `agentMay` list lets the project's own agent steps through the normal guards.
// Both rules fail closed: if the list cannot be read, the change is refused. Reads are never blocked.
import { matchesAny } from './production-guard.js';

/** The starting list (IN-08 defaults, answered by "I approve the plans"). Put in the database once; the owner edits it on the setup page. */
export const PROTECTED_SEED = Object.freeze([
  ...['github-mcp', 'stripe-mcp', 'google-workspace-mcp', 'robinsons-toolkit-hub', 'vercel-mcp', 'neon-mcp'].map((name) => Object.freeze({
    kind: 'repo', target: `robinson-ai-systems/${name}`, level: 'pr-only', reason: name === 'github-mcp' ? 'this server itself' : 'a Robinson server, built through this server\'s pull-request tools' })),
  ...['robinsons-toolkit-relay', 'robinsons-toolkit-mcp'].map((name) => Object.freeze({
    kind: 'repo', target: `robinson-ai-systems/${name}`, level: 'locked', reason: name === 'robinsons-toolkit-relay' ? 'the hub\'s relay' : 'the frozen old toolkit' })),
  Object.freeze({ kind: 'installation', target: '*', level: 'locked', reason: 'this server\'s own GitHub Apps; nothing may remove repositories from, suspend or delete them' })
]);

/** What a `pr-only` repository allows: the normal pull-request conveyor, and only away from the default and protected branches. */
export const PR_ONLY_TOOLS = Object.freeze(new Set([
  'github_branch_create', 'github_branch_delete', 'github_branch_rename', 'github_branch_merge',
  'github_content_put_file', 'github_content_delete_file', 'github_content_push_files', 'github_content_edit_files', 'github_content_commit_git_data', 'github_git_update_ref',
  'github_pr_create', 'github_pr_update', 'github_pr_set_draft', 'github_pr_close', 'github_pr_update_branch', 'github_pr_stack_manage',
  'github_review_create', 'github_review_submit', 'github_review_dismiss', 'github_review_reply', 'github_review_resolve_thread', 'github_review_request_reviewers',
  'github_issue_create', 'github_issue_update', 'github_issue_lock', 'github_issue_comment', 'github_issue_edit_comment', 'github_issue_set_labels',
  'github_issue_set_assignees', 'github_issue_set_sub_issue', 'github_issue_set_dependency', 'github_issue_react', 'github_commit_comment',
  'github_label_save', 'github_label_delete', 'github_label_sync',
  'github_actions_rerun', 'github_actions_dispatch', 'github_actions_cancel_run', 'github_actions_approve_fork_run', 'github_check_create_run', 'github_check_update_run', 'github_status_create',
  'github_workflow_open_pr', 'github_workflow_review_threads', 'github_workflow_rerun_failed_ci', 'github_workflow_cleanup_branches'
]));

/** The only tools that may merge into a `pr-only` repository's default branch, and only with the exact head the caller read. */
export const MERGE_TOOLS = Object.freeze(new Set(['github_pr_merge', 'github_pr_merge_async', 'github_workflow_merge_when_green']));
const SHA = /^[0-9a-f]{40}$/i;

/** What a profile's `agentMay` entries mean, by tool. Nothing else is ever allowed on an owned ref without `outsideProject`. */
export const AGENT_OPERATION = Object.freeze({
  github_branch_create: 'create-from-default',
  github_content_put_file: 'commit-files', github_content_push_files: 'commit-files', github_content_edit_files: 'commit-files', github_content_commit_git_data: 'commit-files'
});

/** Tools that touch a project-owned ref add this argument; the guard reads it, the tool does not. */
export const OUTSIDE_PROJECT = Object.freeze({ outsideProject: Object.freeze({ type: 'boolean', description: 'Allow a change to a ref the project\'s own automation manages (still asks first)' }) });

const BY = 'protected resource';
const OWNED_BY = 'project ownership';

/** The list the guards use: seeded once, then whatever the owner has on the setup page. */
export async function protectedList(db) {
  await db.seedProtectedResources(PROTECTED_SEED);
  return db.listProtectedResources();
}

const repoKey = (target) => (target?.owner && target?.repo ? `${target.owner}/${target.repo}`.toLowerCase() : null);

/** Which entries apply to this target. */
export function matchingEntries(entries, target, ownInstallationIds = []) {
  const repo = repoKey(target);
  const installation = target?.installation == null ? null : String(target.installation);
  return entries.filter((e) => (e.kind === 'repo' && repo !== null && e.target === repo)
    || (e.kind === 'installation' && installation !== null && (e.target === installation || (e.target === '*' && ownInstallationIds.map(String).includes(installation)))));
}

const describe = (e) => (e.kind === 'repo' ? e.target : `GitHub App installation ${e.target === '*' ? '(one of this server\'s own)' : e.target}`);

/** The decision for one change against the list: null (carry on) or `{ refuse, by }`. */
export function protectionVerdict({ entries, ownInstallationIds = [], name, args = {}, target, classification }) {
  const hits = matchingEntries(entries, target, ownInstallationIds);
  const locked = hits.find((e) => e.level === 'locked');
  if (locked) return { refuse: `${describe(locked)} is protected and locked (${locked.reason}). This server changes nothing there. Only the owner can change the list, on the setup page.`, by: BY };
  const prOnly = hits.find((e) => e.level === 'pr-only');
  if (!prOnly) return null;
  const where = describe(prOnly);
  const rule = `${where} is protected (pr-only: ${prOnly.reason}). Only the pull-request routine is allowed there`;
  if (MERGE_TOOLS.has(name)) {
    return SHA.test(String(args.expectedHeadSha ?? '')) ? null : { refuse: `${rule}: a merge needs expectedHeadSha, the exact 40-character head the checks passed on.`, by: BY };
  }
  if (!PR_ONLY_TOOLS.has(name)) return { refuse: `${rule}, and "${name}" is not part of it (branches, commits, pull requests, reviews, checks, issues and merging on green).`, by: BY };
  if (classification?.production) return { refuse: `${rule}, and this change touches production (${classification.production}). Land it through a pull request instead.`, by: BY };
  return null;
}

/** Project ownership for one change: null, `{ refuse, by }`, or `{ confirm }` when the caller said `outsideProject`. */
export function ownershipVerdict({ profile, name, args = {}, target, before=null }) {
  const ref = target?.ref;
  if (!profile || typeof ref !== 'string' || !Array.isArray(profile.ownedRefs)) return null;
  const owned = profile.ownedRefs.find((o) => o && typeof o.pattern === 'string' && matchesAny(ref, [o.pattern]));
  if (!owned) return null;
  const operation = AGENT_OPERATION[name];
  if (operation && Array.isArray(owned.agentMay) && owned.agentMay.includes(operation)) {
    // P-1: "create-from-default" is not permission to branch from an
    // arbitrary tag, SHA, or another ref. The write's independently read
    // before state must prove the exact default branch and source SHA.
    if(operation !== 'create-from-default' ||
       (before?.defaultBranch && before.from === before.defaultBranch &&
        before.sha && before.sha === before.defaultBranchSha))return null;
  }
  const who = `"${ref}" is managed by ${owned.managedBy}${owned.note ? ` (${owned.note})` : ''}`;
  if (args.outsideProject === true) return { confirm: `${who}. You said this change is outside the project's own routine, so it needs your confirmation.` };
  return { refuse: `${who}. Changes there belong to that workflow. If you really mean to do this outside the project's routine, send outsideProject: true (it will still ask first).`, by: OWNED_BY };
}

/** The gate for `src/tools/gates.js`. A list or profile that cannot be read refuses the change (the layer turns a throw into a refusal). */
export function protectedResourceGate() {
  return async ({ name, args, ctx, target, classification, before }) => {
    if (isOwnerConnection(ctx.connection)) return null;
    const entries = await protectedList(ctx.db);
    const ownInstallationIds = entries.some((e) => e.kind === 'installation' && e.target === '*')
      ? (await ctx.db.listAccounts()).filter((a) => a.credential_kind === 'app' && a.installation_id != null).map((a) => a.installation_id)
      : [];
    const refused = protectionVerdict({ entries, ownInstallationIds, name, args, target, classification });
    if (refused) return refused;
    const repo = repoKey(target);
    const profile=repo
      ? (typeof ctx.profileFor==='function'
        ? await ctx.profileFor(target.owner,target.repo)
        : (typeof ctx.db.profileForRepository==='function'
          ? await ctx.db.profileForRepository(target.owner,target.repo)
          : null))
      : null;
    // A missing store is not a neutral absence of profile: a production
    // service must not skip safeguards due to an unavailable DB contract.
    if(repo && typeof ctx.profileFor!=='function' &&
      typeof ctx.db.profileForRepository!=='function')
      return {refuse:'Project policy store unavailable; no repository write may proceed.',by:'project ownership'};
    return ownershipVerdict({ profile, name, args, target, before });
  };
}
