# PG-STUCK-1 — Stuck Playground runtimes are replaced; retries and status reads do not keep them alive

## Request (2026-11-02)

Requested in the build session of 2026-11-02 after live investigation: five Playground allocations for one repository,
created 2026-10-30/31, were stuck in `deploying`/`attaching`/`allocated` (two with Dokploy `composeStatus: error`), never
reached cleanup, and their native workspaces' idle leases kept being renewed while the owner's agent retried attaches.

## Outcome and acceptance

Outcome: a Playground runtime that cannot make progress is recognised, removed (keeping the person's workspace) and
replaced or reported plainly, and an agent that keeps checking or retrying cannot keep it alive forever. Accepted when the
sweep-threshold, error-compose, replacement, failure-cap, plain-answer, lease-activity and close tests below pass and
`ci` + `release-policy` are green at the exact head.

## Design

- **Stuck rule** (`src/playground/stuck.js`): pre-attached phases `creating`…`attaching` on a shared pool; reason
  `runtime_failed_to_start` (provider `error`, immediate) or `runtime_stuck` (no `progressAt` change for
  `PLAYGROUND_STUCK_AFTER_MINUTES`, default 45, 15–1440). Every allocation/attachment save stamps `progressAt`; older rows
  fall back to `createdAt`. Device placements are excluded (they have their own lifecycle).
- **Marking** sets `cleanupRequested`, `cleanupReason`, `runtimeOnly: true`, `failedStarts+1`. `ensureAllocation` never
  advances a marked row (no redeploy of a broken compose) and marks an `error` deploy itself.
- **Sweep** (`sweepAllocations`): marks stuck bootstrap rows instead of retrying them, then disposes the runtime only
  (releases an unfinished transfer lock; never closes the native workspace unless its own authority says cleanup).
- **Replacement**: `ensureAllocation` on a disposed row of an open workspace builds a fresh row under the same key
  (fresh plan and compose, next transfer attempt, size and `failedStarts` kept). `provisionAllocation` /
  `recoverAllocation` do removal then provisioning for `github_playground_workspace` provision and attach and for
  `github_playground_run`. 3 failed starts in a row → `playground_runtime_failed`, plainly worded, nothing created.
- **Plain answers**: attach on a starting runtime is `not_applied` ("still starting… read allocation, not another attach");
  on a marked runtime it names provision; read `allocation` reports `runtime_failed` with the next call.
- **Lease activity**: `callNativeWorker` defaults `inspect` to non-renewing (full repository state kept); Playground
  runtime calls and the open readback renew explicitly. DECISIONS 2026-11-02.
- **Close**: `github_git_workspace_close` waits (bounded ~20 s) for runtime deletion, else answers "still being deleted,
  call again with the same arguments" (key released); an unconfirmed close resumes on the same requestKey.

## Tests

`tests/unit/playground-stuck.test.js`, `tests/unit/native-git-lease-activity.test.js`, two run tests in
`tests/unit/playground-run.test.js`; existing write-contract suites for `github_playground_workspace`,
`github_playground_run`, `github_git_workspace_close` and the native tools still pass through every door.

## Drift check

Builds on PLAY-1 / FLEET-6 allocation and attachment claims unchanged (same provider operations, ownership checks,
compare-and-set discipline and disposal proof); no GitHub request, credential, permission or database schema change. New:
the stored `progressAt`/`runtimeOnly`/`failedStarts` fields on the existing allocation setting, one protected operator
setting with a default, non-renewing status inspects, and a resumable close.
