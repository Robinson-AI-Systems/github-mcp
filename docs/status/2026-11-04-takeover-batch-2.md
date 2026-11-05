# Takeover Batch 2 — status note (2026-11-04, overnight)

Second overnight batch on GitHub Unleashed by Robinson AI Systems, from the Batch 1
inventory (findings G4, G7, G11, G12, G17-remainder, G14-conditional) plus the CAP-7
follow-ons M1–M4. One branch, one PR. G13 stayed excluded (parked on the owner's policy
steer, untouched). CAP-7's grade is untouched; only its follow-on rows moved.

## Landed

- **G4 + G11 — one root cause, proven live, fixed.** `github_pr_get`'s check state
  (`src/github/ci-state.js`) never consulted commit statuses for a required check whose
  branch rule names a reporting app, so a status-posted required check read as "missing"
  while GitHub's combined status carried it. Live proof before the fix, appliance-desk
  PR #842 at head `d86dfe49`: the ruleset requires `review-gate` from app 15368; the
  combined status at that head carries `review-gate` (state failure, posted by that app);
  the tool reported it missing. The same hole is why `github_workflow_merge_when_green`
  "could not see this repo's checks the way the combined-status APIs do" (the #782
  lesson): its proof source is this same computation. Fix: a same-context commit status
  is now read whenever no check run matches — the same evidence GitHub's own merge box
  uses — with check runs still taking precedence and the fail-closed shapes preserved
  (another app's run with no status stays missing; unreadable statuses stay unknown,
  never green). Pinned by `tests/unit/ci-state-status-fallback.test.js` (six tests,
  three of them the failing-first reproduction). Post-release live re-read of PR #842
  (expecting `review-gate: failure`, not `missing`) is the closing proof and is owed.
  The other two G4 sightings are dispositioned, not fixed: the transient "missing"
  ~1 minute after PR creation is GitHub-side registration lag (the re-read guidance in
  the tools already covers it), and the mid-run null checks payload was the G15 defect,
  already fixed in Batch 1.
- **G7 — a cut-off archive download no longer consumes its address.** In
  `workers/native-git/download.js`, archive mode claimed the one-time address on the
  first request, so a fetch that died at 0 bytes (the field failure) burned it and the
  retry got 410. Git mode already served a whole session inside its window; archive
  mode now matches it: the snapshot stays `serving` after a mid-stream disconnect and
  the same address serves until ONE download completes, inside the same session window;
  a completed download still consumes the address (410 after), an over-cap serve still
  ends `failed`, and a retry after the session window still gets 410. Tool guidance and
  result text updated to say so. Two new tests in
  `tests/unit/native-git-download.test.js` (cut-off → retry succeeds → then 410;
  retry after the window → 410); the pre-existing "once" and over-cap tests pass
  unchanged. The related re-census note (the one-time clone address tripping a sandboxed
  agent runtime's injection check) is a caller-runtime behavior, not something this
  server can change; the recorded alternative (server-side snapshot reads / larger
  content windows) already exists as the content tools and is unchanged.
- **G12 — workspace status now surfaces the remote head.** `github_git_workspace_read`
  operation `status` adds `remote: { branch, head, relation: same | different |
  unknown }` read from GitHub at the same moment, plus a `divergence_note` when the
  heads differ, naming the stale-local-ref trap from AR-5b and the cure (fetch, or
  `github_commit_compare`, before branching from a local ref). The remote read never
  fails the status read. One test in `tests/unit/native-git-ergonomics.test.js`
  covers same / different / unreadable.
- **G17 (buildable remainder) — setup replays are no longer silent.**
  `github_git_remote_setup` replays returned the stored read-back with no explanation,
  so a caller who missed the one-time command's first showing retried git against an
  older session's expired key and met git's misleading "could not read Username".
  Now: the key's stored view carries a state-specific next step (never set up /
  already set up / cancelled), and a `refreshReplay` leg re-reads the key's CURRENT
  state on replay (a key exchanged after its first result no longer replays as
  "awaiting_setup") and re-presents it. The exchange endpoint already explained an
  expired code in the same words. Two tests in `tests/unit/git-remote.test.js`.
- **M2 / CAP-8 — `github_deploy_delete` built** (see `docs/pr-cards/CAP-8.md`):
  the deployment family's missing delete leg, with `github_actions_delete_run`'s
  confirmation discipline, an up-front refusal while the latest status is not
  `inactive`, production classification from the record itself, read-back-gone
  verification, and the universal door deferring to it by exact route. Write contract
  green through all doors. Census effect: the route's row moves to
  implemented-unverified (below).
- **M4 — census-ledger tranche landed.** One credential kind decided end-to-end from
  GitHub's authentication contract: an SSH key authenticates Git transport only and is
  unsupported for every REST and GraphQL operation (evidence: GitHub's REST and
  GraphQL authentication references; recorded as a transport-level derivation in
  `src/github/credential-derivation.js`, applied in the census baseline, with
  per-operation reviewed decisions still taking precedence). The census's
  Git-transport rows are untouched. Measured on the deterministic census build:
  **unresolved credential decisions 7,286 → 5,745 (−1,541)**; derived decisions
  4,772 → 6,313; unresolved operation keys 1,184 → 1,183 (the −1 is M2's route);
  implemented-unverified 278 → 279. CAP-1's criterion 2 remains open — this is a
  tranche, not the block.

## Filed, not built (with evidence)

- **M1 / CAP-9** — agent merge configuration (get/update/disable): the pinned-catalog
  check CAP-7 prescribed was run; neither pinned catalog contains these operations,
  so the legs stay MISSING with the check recorded as the evidence and a revisit
  condition (a future re-pin that contains them).
- **M3 / CAP-10** — PR archive/unarchive + revert named tools: the mutations exist in
  the pinned GraphQL schema, but archive/unarchive cannot be verified (the schema
  exposes no readable archived state on a pull request — the universal door's
  recorded refusal reason, re-verified against the pin), and revert's created-PR
  ownership proof is an open design question. Filed with the evidence; buildable
  when the schema grows the readable state, or when the owner directs curation
  anyway (CAP-7's own condition).

## Diagnosed, no code change in this repo

- **G17 push gate (2026-11-04 ~18:25)** — the session-push refusal text ("npm run
  typecheck failed (134). No passing preflight evidence.") and any typecheck
  invocation do not exist in this repository's server or worker code (searched
  `src/` and `workers/`): the gate that ran the appliance-desk typecheck lives in
  that repo's own push machinery and/or the worker host's memory limits, not in
  GitHub Unleashed's code. Nothing here could be fixed without inventing a surface;
  the finding stays open against the gate's owner, and the working route (bench git)
  remains a route-around the findings log already names.
- **G17 workspace-open stalls (2026-10-30)** — the open flow has since gained
  multi-host placement, an explicit `opening` state with poll guidance, and worker
  clone recovery; no further concretely buildable item was identified tonight.
- **G14** — not attempted: no cheap live reproduction of the collab-add 500 presented
  itself, and Batch 1's clean dryRun stands. The card's condition (apply-leg only on
  a live reproduction) was honored by not manufacturing one.

## Discipline record

- Failing tests were written before each fix where a reproduction existed (ci-state,
  download worker, replay wording); the G4/G11 fix also rests on the live read-back
  quoted above. Pre-existing tests are unchanged in behavior; every pre-existing test
  in the touched suites passes as before.
- Verification so far is targeted unit/contract suites on the working VM (quick
  checks); the full `npm run check` for this branch runs on a fleet bench before the
  push, and the PR's own CI is the second full pass. If the bench pass cannot
  complete, this note must be amended to declare the verification degraded before
  merge — a degraded pass does not close this batch.
- The helper client's allowlist (`custom.github-mcp/bin/client.py`) was re-read and
  deliberately left unchanged: nothing tonight needs to call a new tool through it
  (`github_deploy_delete`'s registration is provable via `github_describe_tool`).
