# PLAY-1 — Robinson's Playground integrated coding workspaces

## Live broker ingress path correction2026-10-30

PR486 checked/released58bee97f; the original manager recovered and a new isolated allocation deployed. Actual converted YAML shows executor only on the internal workspace bridge and gateway only receiving shared ingress; actual gateway/broker/executor containers are healthy. Attachment exposed Dokploy internalPath prefix addition: setting it to the already matched broker path doubles that path. Configure internalPath=/ and stripPath=false, and require the same values before recovering an exposing phase. The exact disposable ingress was corrected/read back and redeployed with volumes preserved; actual broker JSON route readback succeeded and sealed attachment is progressing. Tests cover request shape and refusal of a recovered doubled path. Full workflow/cleanup remain unpassed.

## Live manager JSONB recovery correction2026-10-30

PR485 is checked/released at8ffad0d2. Live provisioning of one disposable native workspace preserved its uncommitted edit but refused before manager dispatch: persisted Postgres JSONB normalizes source/build key order, while provider ownership requires byte-exact regenerated Compose. Reconstruct the original immutable source field order and test nested JSONB normalization across controller changes. Preserve source, exact ownership checks and uncertain-dispatch protection; no replacement manager/allocation or host permission change. Resume the same disposable allocation after checked release; integrated acceptance remains unpassed.

## Trusted ingress and controlled download outcome2026-10-30

Implement a separate credential-free, volume-free gateway as the sole domain target. The executor stays on its exact internal workspace network. Gateway forwards fixed authenticated control/preview destinations, and a peer-restricted HTTP80/HTTPS443 proxy permits public IPv4 dependency downloads with per-connection DNS pinning, private/metadata/admin-address refusal and bounded connections. Commands receive only this fixed proxy configuration. Broker, executor and gateway share the configured allocation CPU/RAM total; storage remains an unverified ceiling. Strict bounded data-only Compose YAML/JSON readback checks actual provider networking and gateway policy before execution. Unsupported serialization fails closed.

Recover the old manager deploying state only with pinned source/ownership, idle provider status and empty deployment history; record a dispatch version before retry so uncertainty never becomes repeated submission. New allocations build from the immutable serving source rather than an obsolete manifest pin. Existing allocations and manager keep their recorded source. Source/unit/image checks and live acceptance remain separate; this outcome must not be marked complete until checked release and authenticated disposable acceptance.

## Live hosting isolation correction2026-10-30

Dokploy converted Compose adds shared/default networks to ingress-target services, including the executor. Preserve optional backups/resource monitoring, but refuse best-effort command admission/resume/authority unless independently read-back converted networking remains exactly private. The emergency release supported JSON only and failed closed for the host's YAML. The successor outcome above implements the gateway and bounded YAML reader; actual live network acceptance remains required. The owned live allocation was stopped/deleted without running commands; Compose/container absence is proven, four-volume absence/source close remain unconfirmed because volume inspection returns401. Do not claim integrated completion or replace this work with an owner approval card.

## Owner-authorized best-effort production outcome2026-10-30

Support protected PLAYGROUND_RESOURCE_MODE=best_effort across allocation, availability, command admission, resume and heartbeat lifecycle without mandatory host resource telemetry or quota assertions. Preserve the existing verified mode, configured-feed failure/known-pressure refusal, exact automatic plan/attachment identity, private internal network, current grants, read-only Git metadata, idempotent commands and strict exact cleanup. Unit/transport tests cover all public execution doors, replay, absent/foreign/tampered identities, lifecycle revocation and provisioning without observations. Source tests and exact-head CI/images do not establish live activation. The default internal-network profile has no dependency-download egress, and the protected backend account credential still needs setup; these remain explicit limitations rather than invented passes.

Owner approval2026-10-29: full coding environments,8CPU equivalents/8GiB RAM/up to150GB disk per workspace; no daily job quota, actual-resource admission and four-hour default inactivity. GitHub coding workspace first. Commands are agent-facing MCP operations, never a human-only UI or new owner confirmation ritual.

## Drift check

PR476 merged a separately deployable, tested execution image; no command tool, automatic allocation, Git data attachment or private preview was exposed. This approved extension is unfinished work; do not recount prior Git/scanner features or claim the original acceptance ledger proves it complete.

## Acceptance

- [ ] Registered execute/read/cancel tools through search/describe/call and all existing doors; actual command status, exit code/signal, complete hash-pinned redacted logs and cross-time replay. Named repository/current principal/pass restrictions and no provider credentials in the executor.
- [ ] Real isolated allocation attached to the exact workspace files, expected source/generation protections and automatic provisioning. Report configured/read-back resources honestly; optional quota/monitoring guarantees are not required for owner-selected best-effort mode. Preserve existing workspaces and host pins.
- [ ] Authenticated development preview and actual dependency/build/test/PostgreSQL/browser workflow through the deployed custom MCP; no bare public application ports.
- [ ] Revocation/expiry stops the entire allocation, exact lifecycle cleanup and no destructive shortening of old leases; independently verify no run-owned process/volume/fixture remains.
- [ ] Test pressure/recovery and benchmark before any superiority claim. Report resource guarantees only when verified; best-effort mode is owner-authorized. No paid increase or host-wide permission expansion. Backup activation/restoration is optional future work under the2026-10-30 owner decision, not an activation or completion gate.

Implementation, source/image proof, merged/deployed source and real acceptance must be reported separately. Current finite command-tool outcome and exact next steps: [connector checkpoint](../status/2026-10-29-playground-connector.md). Infrastructure and remaining integration contract: [Playground](../CODING-WORKSPACES.md).

## Current finite outcome — private agent preview reads

Extend github_playground_read with operation preview: authenticated, exact-bound loopback GET to configured development ports; full-text scanner protection before hash-pinned byte windows, bounded time/body, no forwarded credentials, redirects or public app ports. Tests cover actual signed transport through all three tool doors, authorization denial, pagination/change, failure bounds and a real UID1000 development server in dedicated image CI. This delivers agent text preview reads, not an interactive browser session, automatic allocation, file attachment or whole-allocation disposal. The larger card remains IN_PROGRESS.

## Current finite outcome — graceful resource degradation

Expose availability modes ready/constrained/recovery/git_only through the existing read tool. Require fresh workspace-bound protected enforcement observations plus actual runtime cgroup limits before command admission; absent/unverifiable controls preserve safe Git/GitHub functionality with actionable alternatives. Smaller enforced allocations work within their actual limits. Resource pressure durably records a deferred, never-started intent; only a fresh authorized execute with the same key/arguments can resume it, preserving unknown-result protection, cancellation, restart behavior and leases. No automatic paid runner, branch push, provider change or unsafe execution fallback. Test these paths through real public tools and UID1000 image commands; retain the larger card's unfinished integration.

## Integrated allocation outcome in progress

The current branch assembles project-scoped Dokploy provisioning, encrypted generation-bound repository attachment, authenticated interactive preview entry, current-grant runtime heartbeats and exact allocation cleanup. These are unfinished source until the full write-contract, container, browser and lifecycle suites pass; no source or configuration is claimed as live enforcement. Protected continuous capacity telemetry uses an HTTPS URL and Ed25519 public verifier; failed/stale/foreign/tampered observations keep admission closed. No additional paid provider or shared-worker command fallback is introduced.

The recovered text-preview refusal was measured at361ms event-loop delay versus the250ms default threshold. The in-process fixture now waits for real measured readiness after startup; production limits and explicit pressure tests remain unchanged. The seven focused existing suites passed86 tests. New attachment, signed telemetry, ingress/delete recovery and private browser proxy tests are being added with their real transport/state boundaries.

## Released source and operator follow-through

PR480 merged the integrated source atafeee1ad and the checked release is independently READY, with matching primary Git worker and sealed attachment capability. Exact-head ci/policy/native/coding image gates passed, including actual Chromium entry/app/API/WebSocket, anonymous denial, shared edits, UID1000, daemon namespace termination and four-volume absence. Live provisioning currently refuses before change because protected provider setup is missing; actual quota/isolation support remains independently unverified. Safe Git write/readback and exact owned close passed live. Whole live Playground acceptance remains unpassed.

Follow-through: support fresh signed exact-volume cleanup evidence when project-scoped credentials cannot inspect host volumes, retaining independent project Compose/container absence and all bound ownership checks. Add outgoing heartbeat/current authority/activity-persistence behavioral coverage and retain one acceptance queue. This addresses an observed project-scope contract gap without broad host access or a new owner approval ritual.

## 2026-11-01 — Heartbeat outage grace and background clones (owner-approved)

A transient control-plane failure no longer terminates a runtime: signed denials still stop it at once, while an
unreachable control plane blocks new commands after the last lease expires and gives running commands a bounded grace
(`CODING_AUTHORITY_GRACE_MS`, default 5 min, max 15). Large native clones continue in the background past the 45 s
watchdog. Details and tests: [status note](../status/2026-11-01-runtime-reliability.md). Live acceptance still open.

## 2026-11-01 — Fixes for the live failures in issue #509

Live evidence (#509, and a reproduction the same morning) showed: the runtime container exited at boot because its first
heartbeat raced the broker it is relayed through; the gateway's health check then failed (it forwards to the dead runtime),
so the allocation's address never routed and attach reported "worker could not be reached". Dispose and close then failed
on Dokploy's 401 for volume reads. Fixed: the runtime retries during a 3-minute startup window (forged answers still stop
it), attach reports a retryable "not reachable yet", and best-effort disposal completes on independent compose/container
absence with volumes recorded unverified. Tests: `playground-authority.test.js`, `playground-allocations.test.js`. Live
re-test after release is recorded in the status note.

## 2026-11-01 — Live acceptance run and the fixes it produced

Live on release `c58402425e37`, operator pool, medium runtime `job_211b893572fa67d5` (auto-attached, no manual attach):

| Leg | Result | requestKey |
|---|---|---|
| Cancel a running command | `SIGKILL`, `reason: cancelled`, `process_group_stopped: true`, logs complete (`started\n`) | `play1-accept-cancel-1` |
| Replay the same execute | `status: replayed`, no second command — but it showed the first-start state (`running`) after the cancel → **fixed** (`refreshReplay`) | `play1-accept-cancel-target-1` |
| PostgreSQL workflow | `npm run test:db`: real PostgreSQL in the runtime, 33 files / 264 tests passed, 16 s | `play1-accept-db-1` |
| Browser workflow | `npm run test:browser`: 30 passed, 1 skipped (WebKit engine not in the image; Chromium works), 12 s | `play1-accept-browser-1` |
| Development preview (text) | `operation: preview` port 4173 → HTTP 200, `authenticated-control-loopback`, body exact | — |
| Development preview (browser link) | one-time entry issued (`private`, `one_time`, 300 s session); **not opened** — needs a real browser (agent workspace and runtime cannot reach the public origin, by design) | `play1-accept-preview-entry-2` |
| Memory pressure | a command allocating past the limit made the **whole runtime** exit 137 → **fixed** (command `oom_score_adj` 1000; `memswap_limit` = `mem_limit` for every service) | `play1-accept-pressure-mem-1` |
| Dispose a crashed runtime | `disposed: true`; Dokploy readback shows no containers | `play1-accept-dispose-1` |

Fixes in the same PR: replay reports current state; concurrent attach says "already in progress" (retryable)
instead of "Attachment window differs"; availability waits up to ~6 s for a just-attached runtime's first authority lease;
OOM protection above. Tests: `write-core.test.js` (replay refresh), `playground-attach-concurrency.test.js`,
`playground-authority-startup.test.js`, `playground-sizing.test.js` (swap cap), coding-workspace `smoke.test.js`
(command reads `oom_score_adj` 1000).

## 2026-11-01 — Cleanup sweep kept abandoned workspaces alive

Live, Dokploy project "Github MCP": five allocations from 2026-10-30/31 (phases `deploying`/`allocated`/`attaching`)
never cleaned up; their native jobs were still `pending` with `expires_at` renewed to now + 4 h on every sweep. Cause:
the sweep retries unfinished attaches, and attach's source `inspect` call renewed the workspace lease. Fixed:
`renewLease:false` (test: `playground-attach-concurrency.test.js` "never renews…", fails without the fix). The
manager's inherited runtime `HEALTHCHECK` (port 3000, which the manager never opens) is disabled for the manager, so
"unhealthy" no longer shows falsely (applies when the manager is next recreated). After release the five rows expire
normally (≤ 4 h idle) and the sweep disposes them — that is the live check for this fix. Expiry cleanup of a new
workspace (`job_5369bc0a1bbe5b6f`, 3-minute lease) already passed live: closed and no containers left within ~8 min.

## 2026-11-01 — Attach regression from #516 fixed

See the status note `docs/status/2026-11-01-play1-acceptance.md` (last section).
