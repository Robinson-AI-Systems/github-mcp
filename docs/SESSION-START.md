# SESSION-START — reconcile, accept released work, implement, close out

> **2026-10-28 feedback-sweep handoff:** All ten GitHub MCP agent-feedback issues #427–#436 are independently `closed/completed`. Final source PRs #441, #442 and #443 are merged with exact-head `ci` and `release-policy` success and no blocking review threads; #440 delivered #430/#436 only, #442 separately delivered #435. C-16 adds explicit `github_write_batch`; owner documentation, `docs/STATUS.md`, `docs/ROADMAP.md` and the C-16 work-index entry now reflect merger. No live release or client acceptance was performed. Resume only other separately approved roadmap/release tasks, never re-open these as incomplete solely because historic plan paragraphs are time-stamped snapshots.

> **2026-10-23:** pick the next card from `docs/designs/FINISH-PLAN.md` §2 (batch FIN). Smaller models follow
> `docs/pr-cards/SOL-GUIDE.md`; the rest of this file is the detailed procedure behind it.

## Autonomous execution contract

“Do N bundles” authorizes continuing the full documented process without routine
permission stops: reconcile → perform eligible acceptance → implement → verify →
review/merge → cleanup/handoff → next outcome until N and eligible obligations are
satisfied. Checkpoints preserve progress; they do not end otherwise feasible work.

On a terminal failure, diagnose and repair; on green CI, handle reviews and merge
when authorized. During pending CI, do useful independent scoped work, then recheck
at a meaningful transition. Repeated unchanged results require a different action,
not a busy loop. Never silently stop or imply background execution after a turn ends.

Before a blocker can justify stopping, identify its exact error/evidence, investigate
its cause, check already-recorded decisions and attempt authorized remedies. Isolate
one blocked operation and continue independently eligible work. If nothing authorized
can proceed, explain to the owner: what is blocked, why, what was tried, what specific
input/permission/resource or fix you believe would unblock it, and your recommended
next action. Ask genuinely missing owner input promptly while independent work proceeds.
An actual execution limit gets an explicit incomplete recoverable checkpoint, never
a completion claim. Preserve every real safety, spending, release and approval gate.


## Scope of a session (simplified 2026-10-22)

The current owner prompt sets the scope ("do N bundles" means N substantial finished outcomes, nothing more).
There is no standing quota, no line-count or subsection-count target, and no "zero credit for partial work" rule.
Those figures in older cards and `npm run session:bundle` output are advisory planning aids; the full text of the
retired rules is in `docs/archive/SESSION-START-2026-10-22-before-simplification.md`.

- Pick the highest-priority eligible card, state its observable result and finite acceptance, and build the
  coherent piece that delivers it. Split a card that is too large for one safe, reviewable PR into independently
  useful PRs; merge each when its own acceptance is met. Do not hold finished work as a long draft.
- Do not invent features, cards or sub-cards to reach a number, and do not relabel work to change a count.
- Acceptance (real-account checks) runs when its prerequisite exists and is recorded once in the existing ledger; a
  blocked row never stops development or merges. When code work is exhausted, a session may be spent on genuinely new
  acceptance evidence; a repeated permission-denied probe, audit or reused pass is not progress.
- Every real safety, spending, release and approval gate in `AGENTS.md` still applies.


## 0. Reconcile and recover

Read the governing instructions and the current permanent handoff, not historical
status entries as new work. Verify actual main, live, the READY production revision,
open/unfinished PRs, exact-head CI and unresolved reviews. Preserve concurrent work.
Recover your interrupted/red PR first; inspect all failures and batch their remedies.

**Prepare once, then implement.** Run `npm run session:prepare` during startup to
consolidate local Node/dependency, container-memory and disposable-Postgres route
diagnosis. It runs no tests, installs nothing and grants no provider authority.
Use an existing supported runner/required exact-head CI for unavailable local modes;
missing local infrastructure blocks only that local proof. Preserve normal CI.
Do not keep cycling production build flags, substitute a dev-server result, provision
paid capacity, or ask the owner to perform a task the authorized runner can do.


## 1. Catch up released work before new implementation

Fetch main/live refs and independently verify the actual serving production origin,
source SHA and READY state. Workflow success, branch equality or a service self-report
alone is insufficient. Run `npm run session:status -- --deployed FULL_SHA --state READY`
with those observations, or use the same ledger and exact GitHub compare/deployment
evidence manually when no shell is available. The command is read-only: it does not
execute acceptance, release software or authorize provider operations.

Acceptance never blocks development (owner, 2026-10-22): do the eligible checks quickly, record deferrals once, then move on to implementation and merges.

Evaluate EACH outstanding check against its required revision in deployed ancestry.
Main/live equality is never a global acceptance prerequisite. Perform every currently
eligible authorized check before selecting new implementation; recheck BLOCKED rows
against current decisions and attempt authorized remedies. Defer only the affected
check with its exact missing prerequisite, investigated remedy and next action.
Missing history means fetch/compare that revision; it does not mean “not released.”
Preserve valid evidence until relevant changes invalidate it. Reading the queue or
observing a release is not acceptance execution. Preserve fixture and cleanup gates.

Reconcile all outstanding queue rows, including rows hidden by an output limit, in
the existing ledger/handoff. Before new implementation and final reporting, validate
that accounting with `npm run session:status -- --deployed FULL_SHA --state READY
--acceptance-review /tmp/acceptance-review.json`. This temporary sanitized extract
is not a second ledger and must not contain secrets, provider bodies or private IDs.
It contains the printed `snapshot` digest, `deployed`, `deploymentState`, and `tasks`; every outstanding task needs
`id`, `requiredRevision`, current planner `disposition`, `outcome` and `evidence`.
Use `PERFORMED` with `result: PASS|FAIL` (and `nextAction` for FAIL), or `DEFERRED`
with `prerequisite`, `remedy` and `nextAction`. Existing recorded passes need no
retyping; optional `REUSED` entries reference their evidence. The checker requires a verified READY deployed revision and rejects
omissions or changes to any queue field via the snapshot digest; it cannot attest evidence truth or grant permission.
Without a shell, put the same item-by-item accounting in the permanent handoff.
Record actual results in the existing ledger; rerun the extract after ledger changes.
An inaccessible deployment/evidence source requires investigation and a specific
checkpoint, not fake observations or a project-wide stop.

Recheck at observed releases/configuration changes, after meaningful merges, and
before final handoff. A scheduled, delayed, recovery or separately authorized manual
release uses the same per-check procedure. Follow the checked release policy; never
initiate a release just to finish a development bundle.

### Recognize and escalate a release dependency — owner October 15

After independently verifying deployed READY/source and fetching required history,
identify each check whose required source is on reviewed main but absent from live.
`session:status` emits RELEASE NEEDED only for that confirmed source gap; unknown
history requires investigation, and source already in live requires deployment/build
follow-up rather than another release. Other permission/fixture gates remain separate.

Record a confirmed release dependency when discovered, then continue ALL other
eligible authorized project work: implementation, original-criterion reconciliation,
checks against already-deployed behavior, repairs, reviews, safe merges, cleanup and
required records, in their existing order. **Do not request a manual release while
any of that can still proceed.** Reaching N or having main ahead of live is insufficient.

Only when no other eligible authorized work remains, AND release would enable at
least one concrete next completion task, request the owner's manual-release approval
in the active chat. Prepare the exact main SHA, required green checks/reviews,
source/live/deployed comparison, affected task IDs, any other non-release blockers,
standard checked release route and post-deployment acceptance steps BEFORE asking.
Explain that all independent work is exhausted, what becomes executable after release,
and whether waiting for the scheduled release would satisfy the same dependency.
Do not call release the sole blocker when permissions/fixtures/sign-off are also missing.

Do N bundles and permission to ask are NOT release approval. Preserve frequency and
checked promotion policy; use its authorized manual route only after explicit owner
approval for that concrete target. Recheck new main/configuration/owner answers for
newly eligible work rather than waiting in a loop. After an authorized release,
verify actual serving READY/source and immediately reassess/run newly eligible
acceptance; never stop at a green release workflow alone.

## 1a. Choose a substantial outcome

Read the authoritative work index/roadmap and the highest-priority eligible card.
State its observable result and finite acceptance before editing. Read only its named
code seams, design sections and fixtures; reuse existing helpers and task/packet tools.
Group compatible adjacent roadmap slices into a complete usable workflow,
including callers, real integration and tests. Plan a suitable coherent PR
around 400–800 changed production lines plus tests; this is advisory and not a
reason to pad a smaller valid outcome or fragment a larger one. Explicitly
list included slice IDs and acceptance criteria before writing code. Larger
cohesive PRs require extra integration/risk/verification coverage. Preserve actual
migration ordering, risk isolation and every business/security/financial decision gate.
Do not revisit passing hardening without a demonstrated defect or approved requirement.

## 2. Finish the current roadmap outcome

Use the approved order, active card/packet and parent outcome from actual main.
Before coding, turn that outcome's remaining engineering into one finite checklist:
provider/domain behavior, callers/registry/doors or UI, failure/denial/replay paths,
fixtures and integration proof. Reuse the card; do not create another roadmap.
Complete that eligible integration before selecting later dependent units.
Helper completion, PR numbering and easier tickets do not establish outcome completion.

Investigate technical problems and inherited reviews in this unit; batch authorized
remedies rather than carrying implementable fixes as external acceptance. If an
essential owner-specific policy, fact or permission is missing, check recorded decisions
first, then ask the smallest precise question now with a recommendation and consequences.
Pause only its dependent path, record the answer and resume the same outcome/session.
Research public provider contracts independently; do not ask the owner to resolve them.
Where existing gates permit, continue safe configurable implementation while actual
activation/provider/professional acceptance remains separately restricted. Never invent
approval, widen permissions or mark unimplemented code as waiting for a release.

At handoff, name the same unfinished outcome unless its eligible engineering has proof.
Move to independent work only when the roadmap permits it; preserve genuine execution
limits, risk boundaries, approval gates and the existing release acceptance queue.

## 3. Build, verify, publish

Use focused behavioral tests/lint at meaningful seams while developing. Local commits
are recovery points, not reasons to run the entire suite or push after every small edit.
Before publishing the coherent tree, run all existing mandatory checks and applicable
unit/database/provider-shape/browser gates once. File changes invalidate affected proof.
On a shared LOCAL sandbox runner, cap Vitest workers (for example `--maxWorkers=2`) and
run at most two full suites concurrently; preserve the same test selectors/coverage.
Batch known CI/review fixes; inspect all failed jobs before the next correction push.
While CI waits, advance the approved immediate successor; at most two unmerged PRs.
Follow existing REST/Sandbox fallbacks if local execution is unavailable; report actual
Actions evidence honestly. Merge only exact-head green checks plus required reviews.
**CI action transition:** once both required exact-head checks are green, stop checking them and finish review-thread disposition plus expected-head merge immediately. Two identical pending snapshots require independent work or an exact checkpoint, not repeated queries (PLAYBOOK Step 10 / AGENTS anti-stall table).


**Parallel CI is a maintained contract.** Independent verification families run as
sibling jobs; only actual setup/migration/seed and within-scenario state dependencies
remain ordered. Separate SQL jobs get separate disposable databases. Local shared
sandbox worker limits do NOT serialize isolated GitHub jobs. Preserve each existing
required aggregate check name, all family results, immutable dependency pins,
assertions, skip checks and read-only/no-secret rules. The CI layout guard rejects
accidental family chains, missing aggregate inputs, collapsed/serialized matrices
and missing/increased job timeouts. Do not add `needs` merely to save an install.

**Owner decision 2026-10-27: passing tests never fail just for a slow phase.**
Use `scripts/ci-phase.mjs` with a **30-second soft target** for each test/check
phase. Preserve measured timing/result in an Actions job summary and a 14-day
retained per-job JSONL artifact; emit a GitHub warning on a passing overrun.
Passing beyond 30 seconds remains green and must not trigger a timing-only
retry. Actual test failures, signals, hard watchdog and hard job timeouts
**still fail**. Three independent browser jobs have separate throwaway Postgres
services, a maximum 3-minute hard job timeout, and a mandatory exact file
assignment check. When warnings recur across runs, rebalance isolated browser
files or other test cohorts without dropping assertions. Compare total end-to-end
critical-path CI wall time separately from the test execution phases, since
hosted runner startup and image pulls are variable. A 30-second entire green
CI run is an aspirational goal, not an invented SLA.

### First-pass validation and review

Use the existing selected card/packet as ONE consumer checklist throughout the
bundle: changed symbol/contract -> actual callers -> persistence/provider -> full
fixture -> positive/denied/recovery proof -> focused command. Resolve original
requirements and recorded owner decisions once at the relevant revision; revisit
only changed boundaries or new failure evidence. No repeated whole-repo audit.
Prepare a complete realistic fixture early (identities/roles, required fields, exact
amounts/IDs, state transitions and recovery). Exercise the smallest existing route
through the actual handler/form control before the broad publication cycle. A
reference fake's success does not prove the actual service adapter; validate the
pinned boundary, method/args/receipt shape and real adapter together.

At the stable local pre-publication checkpoint, run
`npm run session:prepare -- --publish`: it fetches current main and predicts textual
merge conflicts without moving your branch/worktree. Resolve conflicts and review
changed shared contracts/fixtures BEFORE spending a publication CI cycle. A clean
prediction is not semantic compatibility or permission to merge. Reconcile again
only when main/your relevant inputs actually change, not in a status-check loop.
Batch independent reads, collect all completed failures, make one related correction,
and consolidate existing documentation once before publication. Use small job/status
metadata while CI is pending; inspect failed logs after completion. Reuse valid
evidence and record exact phases/timings where observable, with overlaps/unknown
time explicit rather than invented coding or idle durations.

- Trace inputs through the actual caller, helper/client, provider request and result.
  Verify method, path/version, scopes, query/body fields, pagination and response shape
  against the pinned schema/SDK or cited current provider contract **before** adapting
  fixtures. Test the captured outbound request; a permissive fake is not contract proof.
- Reuse realistic fixtures with required fields and relationships. Assert meaningful
  results, denied paths and applicable provider failures/ambiguous writes; prove no
  unintended call or replay. Never weaken a fake/assertion just to turn CI green.
- Search changed exports and data shapes for affected callers, fakes, DB adapters,
  catalogs and tests; update them together. Run existing repository/index/schema/catalog
  validators plus the affected behavioral tests before the full publication gates.
- Review the complete diff against the card and applicable security guide before
  opening the PR. Inspect inherited unresolved findings and all current review threads;
  record each fix or evidence-backed disposition under the repository's review rules.
  A reply alone does not resolve a finding; recheck reviews immediately before merge.
- When CI fails, collect every completed failing job/annotation and trace the root
  cause before one correction push. Reproduce with the smallest relevant existing
  command; retain a regression test for an actual behavioral defect. A repeated failure
  requires new diagnostic evidence, not another speculative fixture edit.

Record exact commands, results and unavailable checks truthfully in the PR. REST-only
sessions still inspect contracts, fixtures and the full diff before publication, then
use required exact-head Actions evidence for execution they cannot perform locally.
Do not invent commands, relax coverage or merge gates, or rerun unchanged passing checks
unless changes or new evidence invalidate them. Live proof remains in the release queue.

Use `npm run check`, affected unit tests and `npm run test:shapes --
tests/shapes/<area>.test.js` for GitHub calls. Verify REST parameters/GraphQL
documents against the vendored contract; DB changes also need `test:db`.

**PR merge readiness and product acceptance are separate.** A safe implementation PR
may merge with deployment-dependent proof queued, when all pre-merge gates pass and
no explicit card/owner rule requires that proof before merge. Keep such a milestone
IN_PROGRESS/awaiting acceptance. An explicit pre-merge gate still blocks that PR; move
to independently eligible work. Never mark code/CI as deployed or real-provider proof.

## 4. Maintain one release acceptance queue

The marked JSON block in the authoritative status ledger is the running queue, not a
second roadmap. Preserve existing card IDs/evidence and reconcile older open obligations
into it before declaring the catch-up complete. Keep each task's priority, exact minimum
reviewed source revision, procedure, prerequisites, gates, last evidence and disposition.
`dependsOn` names acceptance tasks that must have recorded genuine PASSED evidence;
source implementation dependencies remain in the existing work index. Split broad seed
rows into exact scenario rows as fixtures/revisions are reconciled. No fake pass entries.
After every meaningful merge, add any new deployment-dependent checks in that PR; pin
its source commit, never a guessed future merge SHA. After a release, execute cleared
checks only when that source is in deployed ancestry. If a permitted squash/rebase
removed the pin, reconcile it to the independently verified merged implementation
commit before handoff; never mark it passed or repin to unrelated code.
Execute cleared checks promptly, record sanitized read/write/denial/readback/cleanup proof, and retain
failed/uncertain fixture recovery tasks. New changes, rollback, authorization or environment
changes reopen affected proof. NEVER copy credentials/private fixture IDs into the queue.

## 5. Checkpoint and finish

Before reporting session completion, reconcile the acceptance queue again against
actual deployment and finish its accounting above. Report performed checks/results,
reused proof and each deferred check's exact prerequisite/remedy/next action, alongside
bundle outcomes, subsection IDs, merged PRs, checks/reviews and cleanup. Update existing
status/cards/index and the permanent merged-PR handoff. Reaching N bundles or pushing
a checkpoint does not complete the session while eligible obligations remain.
An actual execution limit requires an explicit incomplete, recoverable handoff.


**Remaining-work visibility.** Run `npm run session:status` for current
roadmap counts and unfinished IDs in approved order alongside the separate
release acceptance queue. Counts describe the existing index/ledger's coarse
units; counts do not establish completed subsections or live acceptance.
Record actual completed slices and remaining engineering in existing cards
and handoffs; never promote an incomplete card to improve the numbers.
Follow the designated roadmap order rather than the milestone in an old handoff.

At each PR handoff record production additions/deletions (excluding tests,
docs, generated files, fixtures and formatting), completed slice IDs and
acceptance evidence. Evaluate 400–800 production lines and 2–5 complete batch subsections
per PR on rolling averages over the latest five merged implementation PRs;
unrecorded historical measurements stay unknown, never invented.


Keep a short progress note on interrupted branches: head, done/proof, one next action,
CI/review state, successor and exact blocker. Diagnose and attempt authorized remedies
before deferring; isolate the operation and continue approved independent work. Limited
release frequency is planned queued acceptance, never a project-wide stop.

When the current owner specifies N bundles, continue toward that target under
the evidence-backed blocker/limit rule above. Without a specified target, use the
available recoverable context for complete approved outcomes. A suitable PR may integrate
several adjacent small slices (typically targeting 400–800 changed production lines
plus tests), but contracts, review risk and end-to-end behavior determine size;
a smaller complete subsection contributes toward the planned substantial bundle; a larger coherent bundle is legitimate. Session PR count is set only by the current owner prompt.
Do not count a passing helper as a completed outcome. After each verified
merge, checkpoint the exact head/CI/reviews, completed slices, implementation
and deployed/real-acceptance state, and one next action. Continue the planned bundle after checkpoints. A demonstrated execution limit
requires an explicitly incomplete handoff with exact recovery action; a clean
checkpoint or speculative context concern does not establish bundle completion.
Persist unfinished work on its existing approved card, not only in chat.
Report completed roadmap slices and acceptance deltas, first-pass CI failures
and correction cycles, not PR count as a productivity metric.
Historical maintenance notes do not redefine the current owner request. Follow its actual scope/target; preserve safety and report genuine execution limits with concrete evidence.
At completed-session end update status/cards/index, verify final main, leave a permanent
handoff on the final merged PR and automatically give a short continuation prompt:
repository + verified handoff + next outcome + queue pointer. Refer to the repository
for rules/order rather than recopying them. Preserve interrupted-session obligations.

## 6. Safety and specialized procedures

Governing instructions, existing PLAYBOOK/hosting rules, owner decisions and the card's
specific safety procedures remain binding. Reuse saved authorized developer connections.
Security, money-out approval, production activation, spend, isolation, exact fixture
cleanup, secret handling and all required local/Actions tests are unchanged.
