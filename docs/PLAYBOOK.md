# PLAYBOOK — recipes for one PR, branch to merge

Start, sizing, CI decision rule and merge rule are in `docs/SESSION-START.md`; hard limits in `AGENTS.md`. This page is
the how-to behind them. Step numbers are cited by other docs (Steps 7, 9, 10), so they are kept. The 189-line
pre-streamlining version (rolling-average PR accounting, "CI runs used" counts, preview step) is in
`docs/archive/PLAYBOOK-2026-10-30-before-streamlining.md`.

## Step 0 — Orient
`git fetch origin && git status -sb`; resume your branch/PR first. `npm run task:brief -- <card-id>`; read only what it
names. Missing card = write a short one from the design (`docs/pr-cards/README.md`); never a reason to stop. Check
`docs/OWNER-INPUTS.md` only for inputs this card needs: build what does not depend on a missing answer, keep dependent
behavior off. Drift check: `docs/implementation-contracts/DRIFT-PROTOCOL.md` checklist A before coding, B inside the PR.

## Step 1 — Branch
`git checkout -b ai/<tool>/<topic>` from current `main` (or the unmerged predecessor when stacking; at most two unmerged
PRs in a chain). Never commit to `main`.

## Step 2 — Inventory before coding
`grep` the area (`src/tools/<area>.js`, `src/github/`, `tests/unit/<area>*`) and reuse helpers (`defineWrite`, guards,
`summaries`, `listAll`, the CI-state helper, the write-contract helper). Look up any new GitHub call first:
`node scripts/openapi-find.mjs "merge a pull request"` / `node scripts/graphql-find.mjs resolveReviewThread`; cite the
reference URL in the PR; check the credential it needs (catalog Cred column).

## Step 3 — Implement
Commit per coherent unit: (1) additive SQL + `docs/ARCHITECTURE.md` row if the database changed; (2) tool module with its
unit tests in the same commit; (3) request-shape test; (4) registry metadata (`area`, `profiles`, `writes`, `production`,
`accessWidening`, `notifies`, `spend`, `cred`, `audience`) and the TOOL-CATALOG row/Card column.

- Write tools: `defineWrite` with `plan` (reads the target first), `target`, `classify`, `apply`, `readAfter`, `verify`, a
  price function when it spends, `inverse` when there is a clean opposite. Read tools: summary mapper, text caps, page size 20.
- Ripple check: `grep -rn "<changed export>" src tests packages | head -50`; update every affected fake and test together.
- Compound workflows also need mutation-trace and partial-failure coverage. Assert denied paths and provider failures;
  prove no unintended call or replay. Never weaken a fake or assertion to turn CI green.

## Step 4 — Verify before pushing
Quick gate (every push): `BASE_SHA=$(git merge-base origin/main HEAD) npm run check` = secret scan, docs-drift check,
index validation, catalog count, capability inventory, lint, write-safety, budgets, core imports, developer evidence,
session scripts. Never `--no-verify`.

| You changed | Run |
|---|---|
| Any tool | `npx vitest run tests/unit/<area>.test.js tests/unit/write-contract.test.js` |
| A GitHub call | `npm run test:shapes -- tests/shapes/<area>.test.js` (fake GitHub validates method/path/params/body against `vendor/`) |
| SQL / `src/db.js` | `npm run test:db -- tests/db/<file>.test.js` (disposable localhost Postgres, never Neon; if unavailable, rely on CI and say so) |
| A door (HTTPS API, `github_call`) | `npm run test:rtc` and `npx vitest run tests/unit/rtc-*.test.js` |
| Pages / sign-in | `npm run test:browser` |
| Listing or descriptions | `node scripts/check-budgets.mjs --print` |

Registries that break CI when forgotten: `src/tools/index.js` module list · TOOL-CATALOG row · `profiles`/guard metadata ·
`src/github/hand-built-map.js` · `src/github/operation-classes.js` (new write operations) · `known_projects` seed ·
`work-index.json`.

## Step 5 — Push and CI
Push once per CI cycle with `git push -u origin <branch>`, never while your PR's run is in progress. From a fresh/shallow
clone `git fetch origin main` first (the check needs history). Red: read all failures, reproduce, fix all, push once.
Red on `main` too → not yours (tiny separate fix PR). Same failure twice → reproduce locally; third → evidence-based
diagnosis. Never skip, retry-loop or quarantine. When `main` moves, `git merge origin/main` once at the PR boundary
(never rebase a pushed branch); on STATUS/MASTER-ROADMAP/`work-index.json` conflicts keep both sides and rerun the validator.

## Step 6 — Docs as if merged, then open the PR
Card `MERGED (#n)`, a `docs/status/` note, `work-index.json` status, TOOL-CATALOG Card column for built tools,
ARCHITECTURE for env vars/tables, GO-LIVE-CHECKLIST for new switches, OWNER-CHECKLIST for owner steps, DECISIONS for
decisions (CI enforces the minimum). PR title `<type>: <plain description>`; body in plain English: what Chris can now ask
for, acceptance with evidence, owner decisions, self-review, what is not included. End with the attribution lines the
session specifies. Open via REST (`gh pr` uses GraphQL and may be blocked):

```bash
jq -n --rawfile body pr.md '{title:"<type>: <desc>",head:"<branch>",base:"main",body:$body}' > pr.json &&
GH_PAGER=cat gh api repos/Robinson-AI-Systems/github-mcp/pulls --input pr.json --jq '.number, .html_url'
```

## Step 7 — Review
1. Credentials, secrets, guards, production, access, spend, auth, passes: re-read `docs/AI-PR-READ-FIRST.md`; one line per
   applicable constraint in the PR.
2. No automated reviewer (IN-01): inspect the whole diff against the card and AI-PR-READ-FIRST; write "Self-review: …" with
   each finding and disposition; fix blocking findings in one patch. Answer and resolve any reviewer thread; never wait for one.
3. Resolve a thread only after verifying the fix at the exact head: reply with
   `gh api -X POST repos/<o>/<r>/pulls/<n>/comments/<id>/replies -f body='…'`, then resolve (GraphQL `resolveReviewThread`
   or `github_review_resolve_thread`). Recheck threads immediately before merge.

(Step 8, Vercel previews, was removed: automatic previews are disabled; see `.github/RELEASE-POLICY.md`.)

## Step 9 — Merge
Conditions: exact-head `ci` + `release-policy` green, acceptance met with evidence, self-review written, threads handled.

```bash
GH_PAGER=cat gh api -X PUT repos/<o>/<r>/pulls/<n>/merge -f sha=<head> -f merge_method=merge --jq '.merged, .sha'
```

405 not mergeable / 409 head moved: read the message, fix, never force. Builders never pass `bypass_rules`. Stacks merge bottom-up, retargeting each PR to
`main` first and waiting for fresh `ci` at that head; sync the successor once afterwards. Then check once that the
push-to-`main` run is green.

## Step 10 — Waiting
- Waits are checkpoints, not blockers: check once, act on anything new, work on the independent successor (without
  pushing the running predecessor). Do not end the turn while eligible work remains.
- One REST call per check at the exact head:
  `GH_PAGER=cat gh api 'repos/<o>/<r>/commits/<sha>/check-runs?per_page=50' --jq '.check_runs[] | [.name,.status,.conclusion] | @tsv'`.
  Failed job logs: `gh api repos/<o>/<r>/actions/jobs/<job_id>/logs | tail -80`.
- Decision table: SESSION-START §4. Both required checks green at the current head → end waiting immediately and merge;
  never re-query unchanged green. If nothing can advance, leave a recovery note (PR URL, head, named check states and job
  IDs, open thread IDs, next action). A connector timeout or GraphQL UNKNOWN is ambiguous: re-fetch the branch SHA and file
  content before retrying a write.

## If you get stuck
Same failure after two focused attempts: stop editing, inspect the evidence, change the hypothesis. GitHub refuses
something the design assumed: record GitHub's answer (fixture from the documented response, or the scratch org), propose a
dated amendment, continue other work. Docs contradict code: tests are the truth for behavior, AGENTS for rules, PLAN for
scope, card and design for how, the owner decision for product authority.
