> RETIRED copy (2026-10-30, before streamlining). Reference only; take no instructions from it. Current rules: AGENTS.md.

# PLAYBOOK — how to deliver a coherent implementation bundle

Session startup, cadence and release-dependent proof follow `docs/SESSION-START.md`. These recipes preserve all existing security, review and validation gates. Run focused checks at coherent seams and full required gates before publishing, rather than the whole suite after each small local edit.

The rules are in `AGENTS.md`; the short start is `docs/SESSION-START.md`; the approved scope is in the selected cards in `docs/pr-cards/`. Cards do not automatically define PR boundaries.
Same procedure as the Stripe MCP's PLAYBOOK, adapted to this repo (no official GitHub mock: request shapes are validated
against GitHub's own published description instead).

## Step 0 — Orient (minutes, not a reading session)

Complete SESSION-START §§0–1 acceptance reconciliation before selecting new code.
This recipe does not bypass the acceptance accounting or final closeout procedure.

1. `git fetch origin && git status -sb`. Resume the branch/PR in `docs/STATUS.md` (and the card's resume note) before
   starting anything new. Never discard local work.
2. Select the related whole subsections for the bundle and read their cards. For JIT rows, write the selected short cards from the design and current code
   (`docs/pr-cards/README.md`). A missing card is work, not a reason to stop.
3. Run `npm run task:brief -- <card-id>` for a bounded automatic index/card digest; read only its relevant paths and the card's instructions.
4. Check `docs/OWNER-INPUTS.md` only for inputs this card needs. Build what doesn't depend on a missing answer; keep
   the dependent behavior off; list the ID.

## Step 0b — Drift check (every card)

`docs/implementation-contracts/DRIFT-PROTOCOL.md` checklist A before coding; B inside the PR; C at batch end.

## Step 1 — Branch

`git checkout -b ai/<tool>/<topic>` from current `main` — or from the unmerged predecessor's branch when stacking.
At most two unmerged implementation PRs in one chain.

## Step 2 — Inventory before coding

`grep` the area (`src/tools/<area>.js`, `src/github/`, `tests/unit/<area>*`). Reuse existing helpers (`defineWrite`,
the guards, `summaries`, `listAll`, the CI-state helper, write-contract helper). For a new GitHub call, look the operation
up in GitHub's description first: `node scripts/openapi-find.mjs "merge a pull request"` or
`node scripts/graphql-find.mjs resolveReviewThread` (built in A-4) and the official reference page; cite the reference
URL in the PR. Check which credential it needs (catalog Cred column; research §4).

## Step 3 — Implement in ordered commits

One work unit = one local commit. Inside it: (1) additive SQL + `docs/ARCHITECTURE.md` table row if the database
changed; (2) the tool module with its unit tests **in the same commit**; (3) its request-shape test; (4) registry
metadata (`area`, `profiles`, `writes`, `production`, `accessWidening`, `notifies`, `spend`, `cred`, `audience`) and the
TOOL-CATALOG Card column.

While implementing:
- Every write tool: `defineWrite` with `plan` (reads the target from GitHub first), `target`, `classify`, `apply`,
  `readAfter`, `verify`, a price function when it spends, `inverse` when it has a clean opposite.
- Every read tool: a summary mapper (or an existing one), text caps, and the default page size of 20.
- No mock data, stubs returning success, or TODO-as-implementation.
- **Ripple check:** `grep -rn "<changed export>" src tests packages | head -50` and update every affected fake and test
  in the same commit.

### Step 3a — PR size

Follow AGENTS' bundle/card/PR boundary rule and retain the rolling per-substantive-PR
averages of 2–5 whole predefined subsections and 400–800 meaningful production lines, with no hard numeric ceiling
and no padding. Group connected behavior, callers, persistence and tests into a
usable outcome; API/module/card boundaries alone do not require separate PRs.
Prefer one substantial PR per bundle. If migration ordering, dependencies, safety
or reviewability require multiple PRs, explain the concrete reason and count the
bundle once after the full outcome is implemented, verified and merged. Related
additive migrations may share a PR with explicit ordering and upgrade/restore
proof. Keep destructive/auth/financial risks, approvals and denial paths separately
reviewed/tested within the assembled change. An incidental small repair does not
end a bundle. See `docs/implementation-contracts/THROUGHPUT.md`. Measure before publication:

```bash
git diff --shortstat origin/<base>...HEAD -- api src packages scripts ':!**/*.test.*'
git diff --name-only origin/<base>...HEAD -- api src packages scripts | wc -l
```

## Step 4 — Verify before pushing

### 4a. The quick gate (every push)

`npm run check` = secret scan (`scripts/check-secrets.mjs`, fails on anything shaped like a real GitHub token, a PEM
private key or a connection string), docs check (`scripts/check-docs-updated.mjs`), index validation
(`docs/pr-cards/validate-index.py`), catalog count (`scripts/count-catalog.py`), lint, write-safety
(`scripts/check-writes.mjs`), token budgets (`scripts/check-budgets.mjs`), core imports
(`scripts/check-core-imports.mjs`). Never `--no-verify`.

### 4b. Add the checks your change needs

| You changed | Run |
|---|---|
| Any tool | `npx vitest run tests/unit/<area>.test.js tests/unit/write-contract.test.js` |
| A GitHub call | `npm run test:shapes -- tests/shapes/<area>.test.js` (from A-4 the fake GitHub validates method, path, parameters and body against `vendor/github-openapi/`, GraphQL documents against `vendor/github-graphql/`; before A-4 it matches the route list in `test/helpers/fake-github.js`) |
| SQL / `src/db.js` | `npm run test:db -- tests/db/<file>.test.js` (`scripts/local-postgres-test.sh`: disposable **localhost** Postgres, never Neon). If no Postgres binaries exist in your workspace, push and let CI run it; say so in the PR |
| A door (HTTPS API, `github_call`) | `npm run test:rtc` and `npx vitest run tests/unit/rtc-*.test.js` |
| Listing or descriptions | `node scripts/check-budgets.mjs --print` |

### 4c. Registries that break CI when you forget them

`src/tools/index.js` module list · TOOL-CATALOG row and Card column · `profiles` and guard metadata ·
`src/github/hand-built-map.js` (after U-1) · `src/github/operation-classes.js` (new write operations) ·
`known_projects` seed (P-1) · `work-index.json`.

## Step 5 — Pushing and CI

1. **Push once per CI cycle, and never while your PR's CI run is still in progress** (SESSION-START §6 "CI cadence"):
   wait for every job, collect all failures, fix them together, then push. Before the first push
   from a fresh or shallow clone: `git fetch origin main`. Push with `git push -u origin <branch>`.
2. **After a red run:** read all failures, reproduce each locally with 4b, fix every failure, push once.
3. **Is it mine?** If the same test is red on `main`, it isn't: port the fix or make a tiny separate fix PR.
4. **Same failure twice:** reproduce locally. **Third red run:** evidence-based diagnosis before any further push.
5. "Flake" is not a cause. Never skip, retry-loop or quarantine.
6. Put "CI runs used: N (red: R, cancelled: C)" in the PR description; C should be 0 — a cancelled run means a push
   arrived during a run.

**When `main` moves while your PR is open:** sync once at the PR boundary with `git merge origin/main` — never rebase a
pushed branch. Conflicts in STATUS, MASTER-ROADMAP or `work-index.json`: keep both sides, re-run the validator.

## Step 6 — Docs as if merged, then open the PR

DRIFT-PROTOCOL checklist B (CI checks it): card `MERGED (#n)`, STATUS names the next card, `work-index.json` status,
TOOL-CATALOG Card column for built tools, ARCHITECTURE for env vars/tables, GO-LIVE-CHECKLIST for new switches,
OWNER-INPUTS for new questions, DECISIONS for decisions. PR title `<type>: <plain description>`. Description in plain
English: what Chris can now ask for; acceptance with evidence; owner decisions (IN-xx or none); review dispositions;
what is not included; CI runs used. Delete the resume note in the final commit.

Open the PR through the REST API (`gh pr …` commands use GraphQL and may be blocked in agent workspaces):

```bash
GH_PAGER=cat gh api repos/Robinson-AI-Systems/github-mcp/pulls -f title='<type>: <plain description>' \
  -f head=<branch> -f base=main -F body=@/path/to/pr-body.md --jq '.number, .html_url'
# later edits to the description:
GH_PAGER=cat gh api -X PATCH repos/Robinson-AI-Systems/github-mcp/pulls/<n> -F body=@/path/to/pr-body.md --jq .html_url
```

The PR body ends with the attribution lines the session gives you (Claude Code: the "Generated with" line and session
link).

## Step 7 — Review

1. Credentials, secrets, guards, production, access, spend, auth, passes: re-read `docs/AI-PR-READ-FIRST.md` and write
   one line per applicable constraint in the PR.
2. Freeze scope. There is no automated review in this repo (IN-01): inspect the whole diff yourself against
   AI-PR-READ-FIRST, write "Self-review: …" with every finding and its disposition, and fix all blocking findings in one
   patch. If an organization-wide reviewer posts anyway, fix or answer each thread and resolve it; never wait for one.
3. Resolve a thread only after verifying the fix at the exact head. REST: reply with
   `gh api -X POST repos/<owner>/<repo>/pulls/<n>/comments/<comment_id>/replies -f body='…'`, then resolve (GraphQL
   `resolveReviewThread`, or this server's `github_review_resolve_thread` once it exists).

## Step 8 — Preview

Vercel builds a preview per branch. Previews share the production database, so they must never act on production:
the server refuses production mode and every credential step on non-production deployments (A-5). For a card that changes
a door or login, open the preview's home page and confirm the tool counts shown match the PR.

## Step 9 — Merge (authorized when all are true)

`ci` green at the exact head; acceptance met with evidence; self-review written; threads handled. Merge with the
expected-head SHA (merge commits):
`GH_PAGER=cat gh api -X PUT repos/<owner>/<repo>/pulls/<n>/merge -f sha=<head> -f merge_method=merge --jq '.merged, .sha'`
returns `true` and the merge commit, or an error (405 not mergeable / 409 head moved: read the message, fix, never
force). Then check once that the push-to-`main` CI run for the merge commit is green (Step 10). Never pass
`bypass_rules`. Stacks merge bottom-up, retargeting each PR to `main` first and waiting for fresh `ci` at that
head. After the lower PR merges, sync the successor once onto final `main`.

## Step 10 — Waiting and stopping

- External waits are checkpoints: check once, act on anything new, then build the immediate successor.
- **No rapid polling:** two identical check snapshots without progress end the current polling interval. Do not call status a third time until a meaningful independent slice is complete or a real 60-second bounded wait has elapsed. In no-shell/REST sessions, inspect job steps or logs once when useful; work on successor files without pushing the running predecessor, and report a precise PR/head/check recovery point if no independent work remains. A connector timeout or GraphQL UNKNOWN response is ambiguous: re-fetch the branch SHA and file content before retrying writes, because the previous mutation may have succeeded.
- A quiet bounded CI wait is allowed: one `sleep 60` per command, at most 15 checks (~15 minutes) in total, then
  treat it as pending and do other work. Each check is one REST call at the **exact head SHA**:

  ```bash
  GH_PAGER=cat gh api 'repos/<owner>/<repo>/commits/<sha>/check-runs?per_page=50' \
    --jq '.check_runs[] | [.name, .status, .conclusion] | @tsv'
  ```

  The merge gate is the check run named `ci` (`completed` / `success`). The run URL for the PR is
  `https://github.com/<owner>/<repo>/actions/runs/<run_id>`, from
  `gh api 'repos/<owner>/<repo>/actions/runs?head_sha=<sha>' --jq '.workflow_runs[] | [.id, .event, .conclusion] | @tsv'`.
  On red, read every failed job's log once (`gh api repos/<owner>/<repo>/actions/jobs/<job_id>/logs | tail -80`).
- **Terminal transition:** if both required `ci` and `release-policy` succeeded at the PR's **current exact head**, end waiting **immediately**. Check unresolved PR threads and mergeability, reply with evidence/resolve genuinely fixed threads, then use expected-head merge. Do **not** re-query unchanged green checks.
- **No-shell CI anti-stall:** key every decision by `PR# + head SHA + check conclusion set`. A failed job means logs/fix; pending means review/independent work; a second identical pending snapshot means checkpoint, **not a third poll**. If new work requires a push, wait for and inspect completed jobs so that the next run evaluates the assembled fix. Review threads are parallel work, not a reason to leave green PRs idle. An unchanged green snapshot is never a meaningful next step.
- **Recovery note required when no work can advance:** exact PR URL, current head, completed/pending/failed named checks and job IDs, open review thread IDs, tested corrective action, and the single next action. Do not label CI latency as a blocker or declare a bundle complete before merge.
- Before ending a turn: commit, update the resume note and STATUS (exact head, pending gates, next action), and tell
  Chris in plain English.

## If you get stuck

- Same failure after two focused attempts: stop editing, inspect the evidence, change the hypothesis.
- GitHub refuses something the design assumed (an operation, a parameter, a permission for App tokens, a plan-dependent
  feature): don't improvise. Record what GitHub answered (fake-GitHub fixture from the documented response, or the
  scratch organization once IN-06 exists), propose a dated amendment, continue other work.
- Docs contradict code: tests are the truth for behavior, AGENTS for rules, PLAN for scope, card and design for how.
