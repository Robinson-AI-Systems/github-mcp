# 2026-11-01 — Medium default runtime, worktree relink fix, clearer "nothing started" result

**Live proof (release `c58402425e37`, operator pool):** workspace `job_b62b25c92c1574d9`, runtime `medium`. Open
(`medium-proof-open-1`) → provision (`-provision-1..3`) → attach first refused cleanly ("runtime not reachable yet,
nothing was transferred", `medium-proof-attach-1`), retried a minute later and attached (`medium-proof-attach-2`) →
`npm ci` exit 0 and `vitest run tests/unit`: 10,632 passed, 1 failed, 404 s (`medium-proof-build-1`). The failure was
`native-git-snapshot.test.js` (Git 2.39 in the runtime; also fails locally on Git 2.43, passes on CI's newer Git).

**Changes in this PR:**
- Medium is the built-in default size for `runtime: auto` (`src/playground/sizing.js`); `PLAYGROUND_DEFAULT_SIZE`
  still overrides it.
- Worktree relink: after moving a workspace to another root, older Git (`worktree repair`) left linked worktrees
  pointing at the old location when it still existed, so `selectWorktree` refused them ("belongs to a different
  repository"). `workers/native-git/snapshot.js` now rewrites both link files itself, then runs repair. The existing
  snapshot test is the regression test; it now passes on Git 2.43.
- Write core: an apply failure flagged `noOperationStarted` is reported as `status: not_applied`,
  `reason_code: no_operation_started`, `no_change_sent: true`, and its request key is released — previously it said
  "uncertain / may or may not have applied" even though nothing was sent.

**Next:** release; then re-run the medium workspace's snapshot test after release to confirm on the runtime's Git.

## Follow-up: public runtime image, automatic per-release pinning

Package made public 2026-11-01 ~15:46 UTC (Vivienne, on Chris's approval). Verified anonymously from runtime
`job_53992f936c324d46`: before `401/403`, after `200` (digest `sha256:f1ca90e0…`, tag `10de14e4…`, an older commit — not
pinned). Change: publish after every release + server-side lookup of the serving commit's image. First real use: the next
release (the workflow builds that commit's image; the following new allocations pull it instead of building).
