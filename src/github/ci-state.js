// "Are the required checks green at this exact commit?" (BATCH-E E1). One helper, shared by github_pr_get, github_pr_merge and the CI
// tools of Batch G. The required checks are the union of the base branch's ruleset `required_status_checks` rules and classic branch
// protection; each is matched with the head commit's check runs (the latest run per name, and the app when the rule names one) and its
// commit statuses. Result per check: success | failure | pending | missing. Nothing is guessed: a read that fails is reported, and
// the overall answer is then "unknown", never green.

/** Every check run at a commit (up to 500), page by page; the response wraps the list in `check_runs`. */
async function allCheckRuns(octokit, params) {
  const runs = [];let complete=false;
  for (let page = 1; page <= 5; page += 1) {
    const { data } = await octokit.request('GET /repos/{owner}/{repo}/commits/{ref}/check-runs', { ...params, filter: 'all', per_page: 100, page });
    runs.push(...(data.check_runs ?? []));
    if ((data.check_runs ?? []).length < 100 || (Number.isInteger(data.total_count)&&runs.length>=data.total_count)) {complete=true;break;}
  }
  return {items:runs,complete};
}

/** Every check run at the commit, briefly, with how long each took (owner feedback 2026-11-09: confirm a green result is real). */
export function runBriefs(runs, max = 40) {
  const secs = (a, b) => { const x = Date.parse(a ?? ''), y = Date.parse(b ?? ''); return Number.isFinite(x) && Number.isFinite(y) && y >= x ? Math.round((y - x) / 1000) : null; };
  return (runs ?? []).slice(0, max).map((r) => ({ name: r.name, status: r.status, conclusion: r.conclusion ?? null, seconds: secs(r.started_at, r.completed_at), app: r.app?.slug ?? null }));
}

// Moved here from the check tools so merge decisions and waiting use one definition of "no CI will ever run".
export const NO_CI_AFTER_MS = 120000;
export const NONE_RAN_AFTER_MS = 10 * 60 * 1000;
export async function runsNoCi(octokit, p, headSha, now, committedAt) {
  try {
    const [workflows, suites, commit] = await Promise.all([
      octokit.request('GET /repos/{owner}/{repo}/actions/workflows', { ...p, per_page: 1 }),
      octokit.request('GET /repos/{owner}/{repo}/commits/{ref}/check-suites', { ...p, ref: headSha, per_page: 50 }),
      committedAt ? null : octokit.request('GET /repos/{owner}/{repo}/commits/{ref}', { ...p, ref: headSha })]);
    const date = Date.parse(committedAt ?? commit?.data?.commit?.committer?.date ?? '');
    // GitHub creates an empty, permanently queued suite for every installed app with checks access (this App, coding
    // agents); only a suite that started or holds a check run means checks are coming.
    const list = suites.data?.check_suites ?? [];
    const live = list.filter((x) => x.status !== 'queued' || (x.latest_check_runs_count ?? 0) > 0).length;
    if (live > 0 || (suites.data?.total_count ?? 0) > list.length || !Number.isFinite(date)) return null;
    if (workflows.data?.total_count === 0 && now - date > NO_CI_AFTER_MS) return 'no_ci';
    // Workflows exist but none ran for this commit long after it was made (e.g. manual-only workflows): none are coming.
    if (now - date > NONE_RAN_AFTER_MS) return 'none_ran';
    return null;
  } catch { return null; }
}

const PASSING = new Set(['success', 'neutral', 'skipped']);
const FAILING = new Set(['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure', 'stale']);

import { isPlanLimit } from './plan-limit.js';

async function tryRead(fn) {
  try { return { ok: true, data: await fn() }; } catch (error) {
    return { ok: false, status: error?.status ?? null, planLimited: isPlanLimit(error) };
  }
}

/** Required checks as `[{ context, appId }]` from rulesets and classic protection; `errors` lists reads that failed for a reason other than "none". */
export async function requiredChecks(octokit, { owner, repo, branch }) {
  const found = new Map();
  const errors = [];
  const notes = [];const sources=[];let strict=false;
  const add = (context, appId) => { if(appId===-1)appId=null; const key = `${context}\n${appId ?? ''}`; if (!found.has(key)) found.set(key, { context, appId: appId ?? null }); };
  // These two policy views are independent; preserve the order of their
  // diagnostics while avoiding an extra provider round trip on every PR read.
  const [rules, classic] = await Promise.all([
    tryRead(async () => (await octokit.request('GET /repos/{owner}/{repo}/rules/branches/{branch}', { owner, repo, branch })).data),
    tryRead(async () => (await octokit.request('GET /repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks', { owner, repo, branch })).data)
  ]);
  if (rules.ok) {
    for (const rule of Array.isArray(rules.data) ? rules.data : []) {
      if (rule.type === 'required_status_checks') {
        strict ||= rule.parameters?.strict_required_status_checks_policy===true;
        sources.push({source:'ruleset',ruleset_id:rule.ruleset_id??null,name:rule.ruleset_name??null,strict:rule.parameters?.strict_required_status_checks_policy===true});
        for (const c of rule.parameters?.required_status_checks ?? []) add(c.context, c.integration_id);
      }
    }
  } else if (rules.planLimited) notes.push(`rules are not available for this repository on its GitHub plan, so none can require checks on ${branch}`);
  else errors.push(`rules for ${branch} could not be read${rules.status ? ` (HTTP ${rules.status})` : ''}`);
  if (classic.ok) {
    strict ||= classic.data.strict===true;sources.push({source:'classic branch protection',strict:classic.data.strict===true});
    if (Array.isArray(classic.data.checks) && classic.data.checks.length) for (const c of classic.data.checks) add(c.context, c.app_id);
    else for (const context of classic.data.contexts ?? []) add(context, null);
  } else if (classic.planLimited) notes.push(`branch protection is not available for this repository on its GitHub plan, so none can require checks on ${branch}`);
  else if (classic.status !== 404) errors.push(`classic protection for ${branch} could not be read${classic.status ? ` (HTTP ${classic.status})` : ''}`);
  return { required: [...found.values()], errors, notes,strict_up_to_date:errors.length?null:strict,policy_sources:sources };
}

const latestRun = runs => {
  // CheckRun has no created_at in the pinned provider schema. An unstarted
  // matching run cannot safely inherit an older success: report pending until
  // GitHub supplies a state that establishes its outcome.
  const unstarted=runs.find(r=>r.status!=='completed'&&!r.started_at);
  if(unstarted)return unstarted;
  return runs.reduce((best,r)=>!best||new Date(r.started_at??0)>new Date(best.started_at??0)||
    (r.started_at===best.started_at&&r.id>best.id)?r:best,null);
};

function runState(run) {
  if (run.status !== 'completed') return 'pending';
  if (PASSING.has(run.conclusion)) return 'success';
  return FAILING.has(run.conclusion) ? 'failure' : 'pending';
}
const statusState = (s) => ({ success: 'success', failure: 'failure', error: 'failure', pending: 'pending' }[s] ?? 'pending');

/**
 * @returns {Promise<{ notes: string[], green: boolean|null, known: boolean, basis: 'required'|'all-checks', checks: Array<{ context: string, state: string, source: string }>, problems: string[], errors: string[] }>}
 *   `green` is true only when everything counted is `success`; null when it could not be worked out.
 */
export async function ciState(octokit, { owner, repo, baseBranch, headSha, now = Date.now(), committedAt = null }) {
  const p = { owner, repo };
  // All four independent GitHub reads begin together. Required-check policy
  // and check-run pagination still retain their own ordering, and no failure
  // can turn an unknown check into green. No cached evidence is reused for merge.
  const [policy, runsRead, statusesRead] = await Promise.all([
    requiredChecks(octokit, { owner, repo, branch: baseBranch }),
    tryRead(() => allCheckRuns(octokit, { ...p, ref: headSha })),
    tryRead(async () => (await octokit.request('GET /repos/{owner}/{repo}/commits/{ref}/status', { ...p, ref: headSha })).data.statuses ?? [])
  ]);
  const { required, errors, notes,strict_up_to_date,policy_sources } = policy;
  if (!runsRead.ok) return { green: null, known: false, basis: 'required', checks: [], problems: [], notes, errors: [...errors, 'the check runs at this commit could not be read'] };
  const runs = runsRead.data.items;
  if(!runsRead.data.complete)errors.push('check-run inventory exceeded its bound; required state is incomplete');
  const statuses = statusesRead.ok ? statusesRead.data : null;
  if (!statusesRead.ok) errors.push('the commit statuses could not be read');

  const evaluate = ({ context, appId }) => {
    const matching = runs.filter((r) => r.name === context && (appId == null || r.app?.id === appId));
    const run = latestRun(matching);
    if (run) return { context, state: runState(run), source: 'check run', started_at: run.started_at ?? null, completed_at: run.completed_at ?? null };
    // A required check may be reported as a commit STATUS rather than a check run (the review-gate
    // pattern: a workflow posts the status). GitHub's own merge box satisfies the requirement from
    // the combined status for that exact context, so read it the same way — also when the rule
    // names the reporting app: the status API exposes no app identity to match against, and
    // skipping the status reported a present check as "missing" (G4/G11, live on appliance-desk
    // PR #842, 2026-11-04: ruleset app 15368, combined status carried the context from that app).
    const status = (statuses ?? []).find((s) => s.context === context);
    return status ? { context, state: statusState(status.state), source: 'status', updated_at: status.updated_at ?? null,
      ...(appId != null ? { required_app_id: appId, note: 'Reported as a commit status; GitHub exposes no app identity for statuses, so the state is the combined-status state for this exact context — the same evidence GitHub\'s merge box uses for this requirement.' } : {}) }
      : { context, state: 'missing', source: 'none',observed_sha:headSha,required_app_id:appId??null,reason:appId!=null&&runs.some(r=>r.name===context)?'same-name check exists under another app':'required check not observed on this exact SHA' };
  };

  let checks; let basis;
  if (required.length) { checks = required.map(evaluate); basis = 'required'; } else {
    // Nothing is marked required: stay careful and require every check that exists at this commit to pass.
    basis = 'all-checks';
    const names = [...new Set(runs.map((r) => r.name))];
    checks = [...names.map((context) => evaluate({ context, appId: null })), ...(statuses ?? []).filter((s) => !names.includes(s.context)).map((s) => ({ context: s.context, state: statusState(s.state), source: 'status' }))];
  }
  const problems = checks.filter((c) => c.state !== 'success').map((c) => `${c.context}: ${c.state}`);
  // Owner feedback 2026-11-12 (PenPal #68/#69): with nothing marked required, "every check that exists" was judged before a
  // just-pushed workflow had created its check runs, so a fast check that had already passed made the commit look green and
  // the merge went through before the tests started. Workflow RUNS exist before their jobs' check runs do: when any workflow
  // run at this exact commit is still queued or running, or ended badly, the commit is not green yet.
  if (basis === 'all-checks' && checks.length) {
    const wf = await tryRead(async () => (await octokit.request('GET /repos/{owner}/{repo}/actions/runs', { ...p, head_sha: headSha, per_page: 50 })).data.workflow_runs ?? []);
    if (!wf.ok && wf.status === 404) {
      // Actions is off for this repository (or the route is absent): no workflow run can be pending.
    } else if (!wf.ok) {
      if (wf.planLimited) notes.push('workflow runs are not readable on this plan; only the check runs that have reported were judged');
      else errors.push(`the workflow runs at this commit could not be read${wf.status ? ` (HTTP ${wf.status})` : ''}`);
    } else {
      for (const w of wf.data) {
        const name = w.name ?? w.path ?? `workflow run ${w.id}`;
        if (w.status !== 'completed') problems.push(`workflow "${name}": ${w.status ?? 'pending'} (its checks have not all reported yet)`);
        else if (FAILING.has(w.conclusion)) problems.push(`workflow "${name}": ${w.conclusion}`);
      }
    }
  }
  if (!checks.length) {
    // A repository with nothing required, no commit statuses and no GitHub Actions workflow at all can never report a check, so
    // "wait for CI" would last forever. GitHub's own merge box allows such a merge. Only a successful read that proves zero
    // workflows counts; a failed read or any existing workflow keeps the careful "not reported yet" answer.
    // Same proof the waiting tool uses: zero workflows, no live check suite, and a commit old enough that CI would have started.
    const none = basis === 'all-checks' && !errors.length && (statuses ?? []).length === 0
      ? await runsNoCi(octokit, p, headSha, now, committedAt) : null;
    if (none === 'no_ci' || none === 'none_ran') {
      notes.push(none === 'no_ci'
        ? 'This repository has no required checks and no GitHub Actions workflows, so no check can ever report; there is nothing to wait for. Review, conflict and threads are still enforced.'
        : 'This repository has no required checks, and none of its workflows ran for this commit in the ten minutes since it was made (for example they are manual-only or do not run on pull requests), so none is coming; there is nothing to wait for. Review, conflict and threads are still enforced.');
      return { green: errors.length ? null : true, known: errors.length === 0, basis: 'no-checks-configured', no_ci_reason: none, checks, problems: [], notes, errors, strict_up_to_date, policy_sources, all_runs: [] };
    }
    problems.push('no checks have reported on this commit yet; CI usually starts within a minute of a push (github_check_wait waits for it)');
  }
  // Any read that failed means the answer is unknown, never green.
  return { green: errors.length ? null : problems.length === 0, known: errors.length === 0, basis, checks, problems, notes, errors,strict_up_to_date,policy_sources, all_runs: runBriefs(runs) };
}
