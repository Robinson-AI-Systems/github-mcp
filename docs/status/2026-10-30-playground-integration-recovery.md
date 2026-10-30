# PLAY-1 interrupted integration recovery — 2026-10-30

## Actual state and authorization

The owner explicitly requests completion of automatic allocation, exact repository attachment, interactive private previews and complete allocation lifecycle cleanup, with graceful degradation. Keep Vercel MCP, Neon metadata and project-scoped Dokploy workers. No Vercel Sandbox/Drives, extra paid resources or unrestricted host administration. Existing implementation/checked merge/release authorization persists.

Rechecked through the custom Robinson GitHub MCP on this recovery turn: main and live both point to dd4555857c6e33e0d9b4151841e951831e0f4f4c. Last independently verified serving READY evidence is the PR479 permanent handoff:
https://github.com/Robinson-AI-Systems/github-mcp/pull/479#issuecomment-6512738150
No new independent serving/READY observation was made during this interrupted turn.

PR479 delivered graceful degradation, not the full Playground. PLAY-1 remains IN_PROGRESS. Original acceptance accounting remains 56 recorded passes, 16 required unpassed and 2 optional Hub checks. No new pass is recorded here.

## Exact execution interruption

The supplied development environment is marked unavailable. The first shell call fails before execution with:
> No usable execution environment is available. Wait for an environment to become available before using this tool.

The custom MCP is working. Its native Git workspace status returned ready on main dd455585, generation1, clean. Its Playground availability returned git_only / runtime_unattached, execution_available=false, command_started=false, workspace_preserved=true. Git-only storage cannot read files from the separate unavailable development filesystem. Do not turn the shared Git worker into an arbitrary executor as a recovery shortcut.

The unpublished implementation branch ai/codex/playground-allocation-20261029 is absent remotely (both content-get and branch-get returned404). This recovery branch contains this note only; it is NOT the implementation, does not have implementation CI, and must not be merged/released as if it were the completed outcome.

## Development filesystem recovery

Last local checkout:
`/workspace/scratch/c22b6541ec47/github-playground`

Local branch: `ai/codex/playground-allocation-20261029`, based on dd455585.
Local checkpoint commit: `f5c65eec` (early allocator lifecycle only).
Substantial later code was uncommitted at interruption. Neither the checkpoint nor later files have been verified accessible after the environment became unavailable. Do not claim they are safely published or lost.

On environment restoration, inspect git status/diff and syntax first. The last command rewrote streaming snapshot transfer and finalization locking; its output was truncated, so completion and syntax are unverified. Recover these files before discarding/recreating the checkout. If the environment cannot be restored, reimplement from the approved card and real main; this note is a recovery description, not substitute source or proof.

## Implemented locally before interruption, NOT verified complete/published

The working tree reportedly contains these seams. Inspect their actual contents after recovery:

- src/playground/dokploy.js: pinned Dokploy REST adapter and per-workspace Compose plan; project/environment/exact ownership validation before mutation; bounded requests and sanitized provider errors.
- src/playground/allocations.js: bound CAS lifecycle and allocation provision/recovery/disposal/readback; live records mirrored before provider writes.
- src/playground/attachment.js: encrypted generation-bound broker-to-broker transfer and mount verification, with source mutation freeze during final routing switch.
- src/playground/index.js: root cleanup index and strictly scoped orphan cleanup context, without tenant-to-owner credential fallback.
- src/playground/admission.js: resource-pressure admission; unknown headroom queues work rather than inventing a reservation.
- src/playground/lifecycle.js plus api/playground/lifecycle.js: signed root-identity heartbeat and live tenant, membership, connection, delegated grant, repository and expiry checks.
- src/playground/manager.js plus api/playground/sweep.js and workers/coding-workspace/manager.js: trusted cleanup-only sweeper and bootstrap/provision/attachment progression, no provider/private MCP signing credentials in command stacks.
- src/playground/preview-entry.js plus api/playground/preview.js: one-use private entry handle, protected page redemption and short-lived signed loopback-port browser grant.
- workers/coding-workspace/authority.js: root-private per-runtime identity, signed authority response validation, periodic reauthorization.
- workers/coding-workspace/browser-preview.js: authenticated private HTTP/WebSocket proxy to enabled loopback ports, secure HttpOnly host cookie, no orchestration/provider header forwarding.
- workers/coding-workspace/initialize.js: exact-volume initial ownership setup.
- workers/native-git/attachment.js: internal signed sealed export/import, bounded byte windows, resumable offsets and owned freeze/release.
- workers/native-git/mounts.js: hashed mount fingerprints/read-only observations, not host path disclosure.
- workers/native-git/safe-files.js: O_NOFOLLOW pinned directory handles and bounded regular-file access, defending against symlink races from concurrently executing user code.
- src/db.js and fake DB: bounded root index listing.
- tenancy directory/MCP context: server-authenticated tenant allocation scope.
- src/native-git/client.js and protocol.js: trusted attached broker routing, Ed25519 control binding and hidden attachment actions.
- src/tools/native-git.js: automatic allocation enqueue after clone, allocation metadata on readback and cleanup before workspace close.
- src/tools/playground.js: github_playground_workspace provision/attach/resume/preview/dispose and allocation read.
- CodingRuntime/server: root identity, authority-gated execution, private browser/WS routing, loss/expiry termination of the container process namespace.
- workers/coding-workspace/Dockerfile: broker dependencies and all new runtime files.
- workers/native-git/server.js: dedicated workspace/binding restriction, fixed authority relay, attachment features and repository inspect with renewLease=false.
- workers/native-git/snapshot.js: bounded streaming encrypted source export, mounted receiver import, ancestry/uncommitted files/receipts/worktrees preserved.
- tests/unit/playground-allocations.test.js and registry expectation: initial focused tests only; broad integrated proof is outstanding.

Architecture: one dedicated Git broker and one arbitrary-command container share worktree files. Broker Git metadata is writable only in the broker and mounted read-only in executor; private broker control/credentials never mount into executor. Separate PID namespaces. Source native worker copy/host pin remains preserved until safe full cleanup. Broker gets fixed trusted authority relay, not arbitrary network proxy. Executor uses an internal isolated network.

Planned total memory8192MiB: broker1536MiB, executor6656MiB. CPU8 equivalents: broker0.5, executor7.5. Initialization runs first with512MiB. These are source configuration, not measured host availability or verified storage quota. Four exact named volumes hold files, Git metadata, broker control and execution control. Up to150GB is a ceiling as needed, not purchased/reserved capacity.

## Known engineering fixes to finish before publication

1. Inspect the last snapshot/attachment patch. Streaming source export must preserve exact AES-GCM header/tag/JSON/base64 structure and existing snapshot compatibility. Avoid old full-memory export on a small source worker. Verify source freeze ownership, replay and release; lock must span final source checks and metadata routing switch without permitting lost edits. Source changed/conflict leaves both copies intact and a recoverable state.
2. Make attachment metadata writes atomic. Test interrupted/resumed pages, duplicate pages, digest mismatch, principal/generation mismatch, restart uncertainty and idempotent import. Inspect renewLease=false includeRepository support.
3. Ensure cleanup removes exact source-side transfer artifacts. After verified whole-allocation stop/delete/volume absence, clean the original exact source workspace and finish its native job. Do not accidentally route that final source cleanup through the attached broker; do not delete preserved source copies during ambiguous staging or an ordinary transient recovery.
4. Exposing-domain recovery must independently match BOTH root runtime and /v1/workspace broker routes, not just the coding domain.
5. Manager must start even when the first requested workspace is queued on admission. Existing local logic may initialize it only after admission passes, preventing queued work from progressing.
6. Admission currently reads a protected fresh PLAYGROUND_ADMISSION environment observation. A static env snapshot expires in60seconds; finish a continuously refreshed protected telemetry/observation contract. Do not invent undocumented Dokploy health fields or pretend its401 is resource proof. Unknown availability queues; safe verified smaller allocations can run. Admission must remain resource-based, with no arbitrary job/concurrency quota.
7. Complete the exact operator-supported isolated dependency-egress/network and quota-backed volume observation interface. Do not solve missing enforcement by running arbitrary code on the shared Git worker, adding a privileged Docker socket, host PID/filesystem access or public application ports.
8. Inspect preview security: one-use CAS consumption, current authority/lease, exact Origin/Host, signed port/origin/expiry/nonce binding, reserved-cookie filtering, no provider/control headers, HTTP bounds/abort behavior, real WebSocket expiry and mobile flow. Background assets/HMR must not extend inactivity.
9. Whole runtime termination must actually terminate daemonized descendants via container/allocation termination, not merely process-group cancellation. Read back stopped process state, then deletion and absence of ALL exact owned volumes. Unknown/401/500 provider readback is not proof of absence. compose.stop leaves exited containers; safe stopped states are created/exited/dead, but after delete actual absence must be observed.
10. Current grants/tenant membership must be checked without legacy credential fallback. Definitive revoke/expiry/removed tenant triggers exact cleanup; transient authority transport failure stops command runtime while preserving recoverable files. Cleanup-only capability cannot delete live-authorized workspaces by caller assertion.
11. Finish all nine write-contract checks through handler/dispatcher/github_call for the new lifecycle tool, independently verified readAfter, principal/pass denial and replay. Update callers, registry, catalog counts and docs together.

## Verification still required

Initial allocator tests existed, with fixture admission and manager injection just patched. Their final result was not observed. Do not reuse earlier focused pass counts for the later tree.

Run focused behavioral suites for encrypted snapshot roundtrip, shared mount attachment, source freeze/concurrent Git, symlink escapes, CAS recovery, tenant isolation/current-grant revocation, lifecycle deletion/readback, continuous admission and private browser/WS redemption.

Add and run a real multi-container broker+executor scenario in the dedicated coding image CI. Verify UID1000 commands and edits, real Git ancestry/uncommitted files, source/broker routing, dependency/build/test/browser/PostgreSQL workflow, authority expiry, deliberately daemonized descendants and allocation/volume cleanup. Local Docker was previously absent; use the existing authorized Actions route, preserving all assertions, job parallelism, read-only CI permissions and no-secret requirements.

Assemble the complete coherent workflow before publication. Run actual-base check with BASE_SHA, applicable unit/DB/shapes/browser tests, full diff/security self-review, docs drift/catalog validation. Publish via custom github_content_commit_git_data with exact head/real parent and verified manifest; split commits if its50-file limit requires, not implementation outcomes.

Require exact-head ci, release-policy, native Git image and coding image success; handle reviews then expected-head merge. Use the authorized checked release route. Coordinated worker deployment is genuinely necessary for the new attachment protocol, but preserve all existing volumes, verifier, credentials, unrelated workspaces and host pins.

Recheck actual serving source/READY independently and matching worker provenance. Run disposable authenticated live integrated acceptance through custom MCP, clean ONLY run-owned fixtures, record source/merged/deployed/provider acceptance separately. Safe Git-only fallback is already deployed; it is not proof the full integration works.

## Original obligations retained

Do not restart the completed audit/fleet repairs. Keep external fleet-host installer acceptance, independent encrypted off-host backup/key custody/restore, safe Render retirement, authentic disposable grant/security/provider acceptance, declined budget deletion and optional Hub distinct. Recheck all tenant schemas before retirement. Never revoke a useful grant or shorten another workspace lease to manufacture a test.

## Exact next action

Restore access to the existing development environment and inspect the unpublished checkout/last patch. This interruption requires execution access, not new owner policy approval, credentials in chat or a paid plan change. If restoration is impossible, recover/reimplement source using the custom MCP plus checked Actions from main, explicitly acknowledging that unpublished code could not be recovered.
