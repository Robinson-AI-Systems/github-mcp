# SESSION-START — fast path from start to merge

Rules and hard limits: `AGENTS.md`. Product authority: [owner decision](OWNER-DECISION-2026-10-27.md) (supersedes older
gates). Recipes: `docs/PLAYBOOK.md`. The pre-streamlining 347-line version (acceptance-review extract format, release
escalation prose, throughput accounting, handoff history) is in
`docs/archive/SESSION-START-2026-10-30-before-streamlining.md`; look things up there, never take instructions from it.
The current owner prompt sets the scope ("do N" = N finished outcomes). Keep going until that scope is done or a real
limit is hit; do not stop at a checkpoint, a green CI run or a pending wait while eligible work remains.

## 0. Reconcile and recover (once, quickly)

Read: `AGENTS.md`, this page, and the latest `docs/status/` note. Run:

```bash
git fetch origin && git status -sb          # resume your own branch/PR first; never discard local work
npm run session:prepare                     # once: local Node/deps/Postgres diagnosis; runs nothing, installs nothing
npm run session:status                      # roadmap remainder + acceptance queue (read-only)
npm run task:brief -- <card-id>             # bounded digest of the next card; open only the paths it names
```

Recover first: your own red or interrupted PR, then open PRs with unresolved threads. Preserve concurrent work. Missing
local infrastructure (Postgres, Docker, browsers) blocks only that local proof: use exact-head CI for it, say so in the PR.

## 1. Acceptance catch-up (never blocks development)

- Verify the serving production origin, source SHA and READY state independently (workflow success or a self-report
  alone is not enough), then `npm run session:status -- --deployed FULL_SHA --state READY`. Judge each acceptance row
  against its own required revision in deployed ancestry; main/live equality is not a global prerequisite.
- Do the eligible, authorized checks quickly; record real results once in the ledger (`docs/STATUS.md` JSON block, never
  copy credentials or private IDs); defer a blocked row once with prerequisite, investigated remedy and next action, then
  go implement. Rows needing a paid upgrade are recorded untested. `session:status` prints "Acceptance accounting NOT
  CHECKED" until you account for the queue: pass `--acceptance-review /tmp/acceptance-review.json` (sanitized: the printed
  `snapshot` digest, `deployed`, `deploymentState`, and per outstanding task `id`, `requiredRevision`, `disposition`,
  `outcome` = `PERFORMED` + PASS|FAIL (+`nextAction` on FAIL) / `DEFERRED` + `prerequisite`,`remedy`,`nextAction` / `REUSED`,
  and `evidence`), or put the same item-by-item accounting in the handoff when no shell exists. It is bookkeeping, never a
  merge or development gate, and must hold no secrets or private IDs.
- **Release dependency:** `session:status` prints RELEASE NEEDED only when required source is on `main` but absent from
  `live`. Record it and keep working. Ask Chris for a manual release only when no other eligible work remains and the
  release enables a concrete next task; prepare main SHA, green checks, affected task IDs and post-release steps first.
  After any release, verify READY/source and run the newly eligible checks.

## 2. Choose and size a PR

1. Take the highest-priority eligible card (work index order). State its observable result and finite acceptance in two
   sentences. Read only its named code seams, design headings and fixtures.
2. One PR = one complete usable outcome: workflow, callers, guards, persistence, tests and docs; related migrations
   together. Group adjacent small slices. Split only for a concrete reason (migration order, safety boundary, diff too large
   to review) and write that reason in the PR. Do not split to merge faster, pad to look bigger, or invent cards.
3. Prepare one realistic fixture and trace the actual caller → client → provider request → result before the broad run.
   Validate request shape against the pinned schema (`openapi-find.mjs` / `graphql-find.mjs`); a permissive fake is not
   contract proof.
4. Missing owner-specific fact: check `docs/OWNER-INPUTS.md`/`DECISIONS.md` first; if still missing, ask the smallest precise
   question with a recommendation, add a row to `docs/OWNER-CHECKLIST.md`, build everything that does not depend on it.

## 3. Build, verify, publish (5 commands)

```bash
npx vitest run <files you touched>                                  # while working
npx eslint .
BASE_SHA=$(git merge-base origin/main HEAD) npm run check           # once, on the assembled tree
npm run test:db / test:shapes -- tests/shapes/<area>.test.js / test:browser   # only for what you changed
npm run session:prepare -- --publish                                # predicts merge conflicts before the CI cycle
```

Then push once and open the PR (PLAYBOOK Step 6). Shared local sandbox: cap Vitest workers (`--maxWorkers=2`), at most two
full suites at once. File changes invalidate affected proof; do not rerun unchanged passing checks.

## 4. CI decision rule (key every decision by PR + head SHA + conclusions)

| Snapshot at current head | Action |
|---|---|
| any job failed | read all failed logs once, reproduce, fix all, push once (never push into a running CI run) |
| jobs pending | do independent review/docs/successor work; a second identical pending snapshot = work elsewhere or leave an exact checkpoint, not a third poll |
| `ci` and `release-policy` both success | stop checking CI; verify review threads and mergeability, then merge (below) |

The same test red on `main` is not yours: port the fix or make a tiny separate fix PR. Same failure twice → reproduce
locally; third red → evidence-based diagnosis before pushing.

CI facts you must not break (enforced by `scripts/check-ci-layout.mjs`, `scripts/ci-phase.mjs`): independent verification
families run as sibling jobs (no accidental `needs` chains, aggregate check names, job timeouts and skip checks stay);
a passing test or phase never fails for being slow (30-second soft target, warning only), while real failures, the hard
watchdog and hard job timeouts still fail; browser shards keep separate throwaway Postgres and the exact file-assignment
check; never drop assertions to rebalance.

## 5. Merge rule

`ci` and `release-policy` green at the exact head · acceptance met with evidence · "Self-review:" written · threads
handled → merge with the expected head SHA (merge commits; Playbook Step 9). Merge-readiness and product acceptance are
separate: a safe PR merges with deployment-dependent proof queued unless its card explicitly requires that proof first.
Stacks merge bottom-up. After merging, check once that the push-to-`main` run is green, then take the next outcome.

## 6. Close out

Add `docs/status/YYYY-MM-DD-<topic>.md` (merged, in-progress branch/PR/head/CI, blocked and why, next action). Update the
card, `work-index.json` and docs as if merged. For an interrupted branch keep a short note: head, proof done, one next
action, CI/review state, exact blocker. Reconcile the acceptance rows once against actual deployment, report performed
and deferred checks, and give Chris the plain-English report plus a short continuation prompt (repository + verified
handoff + next outcome). A real execution limit gets an explicitly incomplete, recoverable handoff — never a completion
claim.
