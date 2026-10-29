# Full coding workspace expansion — 2026-10-29

Owner authorizes closing the development-environment gaps: dependency installation, arbitrary development commands, TypeScript/Next.js builds and tests, browser tests, development services and disposable PostgreSQL. Target per workspace: up to eight virtual CPUs, eight GiB RAM and150GB persistent storage. Preserve global no-daily-job-quota, measured resource admission, four-hour authorized-inactivity expiry, genuine delegated restrictions and all existing workspaces. No spending or host-wide administration is authorized. Performance superiority requires an actual comparable benchmark, not a specification table.

## Advance implementation plan

1. Build a separately deployable single-workspace execution plane with a fixed immutable identity, Ed25519 control authorization, an unprivileged command user, no provider/orchestrator secrets, durable intent receipts, asynchronous execution, complete paged redacted logs, real exit/signal status, cancellation and process-group cleanup. It must never execute programs in the existing shared Git worker.
2. Package development dependencies and an isolated disposable database; keep preview services private and lifecycle-bound. Validate the exact image with real install/build/test/database/service scenarios and denial/replay/cleanup tests. Report measured cgroup CPU/RAM and filesystem availability without representing shared free disk as an enforced quota.
3. Connect execution to the existing authenticated MCP and native Git lifecycle through a reviewed isolated provisioning/binding/synchronization contract. Arbitrary execution must not gain another tenant's files, GitHub credentials or a privileged host socket. Preserve original jobs/host pins; no implicit in-place migration.
4. Verify project-scoped Dokploy controls, backing-volume quotas and available resources. Provision disposable execution fixtures only after enforcement is demonstrated; then exercise the actual agent path, benchmark the same application/revision against a reference environment, and run exact cleanup before claiming replacement or superiority.

## Observed prerequisites

Current main9acb9a55; actual previously verified hosted runtime ac0d2805. Project Compose read succeeds and latest deployed description independently pins ac0d2805. docker.getServerHealth returned401/UPSTREAM_UNAUTHORIZED for docker; server.allForPermissions returned401 for member. These are genuine missing host-observation permissions, not evidence that the server lacks capacity. No bypass, resource change, restart, existing workspace deletion or purchase was attempted. A named Docker volume is not an independently verified150GB filesystem quota. Underlying storage quota enforcement, usable CPU capacity and the isolation/egress arrangement require project-scoped provisioning support or the host operator's cooperation.

Status: implementation starting. Full coding capabilities and requested per-workspace capacity are NOT deployed or accepted. The prior Git-only acceptance remains valid and separate.

## Source checkpoint

Implemented a separate coding runtime supervisor, binding/purpose-pinned signed HTTP lifecycle, UID-separated commands, durable command/replay/restart receipts, process-group timeout/cancellation, paged baseline-redacted logs with explicit overflow failure, measured cgroup/filesystem reporting and four-hour activity expiry. Added a dedicated Node/Python/build/PostgreSQL/Playwright image and a mandatory real-image CI job. The two pure authorization/capacity unit tests pass; local lint passes. This managed executor cannot chown toUID1000 (EINVAL) and has no Docker binary, so the six real-image scenarios must run through the dedicated existing GitHub Actions route; they have NOT passed locally. No test was replaced with a same-user mock or silently skipped.

The detailed boundary and remaining integration checklist is docs/CODING-WORKSPACES.md. No agent-facing command tool, automatic provisioning, trusted Git synchronization, authenticated preview proxy, revoked-workload termination, host quota enforcement or whole-allocation storage cleanup has been claimed implemented. These remain engineering work in this same approved outcome, independently of operator prerequisites. No resource change, release or serving-source change occurred. The supervisor and application workloads share the requested per-workspace resource allowance; they do not receive separate additive budgets.

## Owner naming and workflow clarification

Owner selected Robinson's Playground for the runtime/sandbox, under Robinson AI Systems, and explicitly clarified GitHub coding workspace first. Opening one workspace should provide the integrated edit/Git/install/build/run/test/preview workflow. Keep the150GB per-workspace storage ceiling, used as needed; CPU/RAM/disk are shared by its entire environment. Public health/authenticated capabilities identify the product without renaming protocol paths or breaking compatibility. PR476 holds the execution-plane source; this is not yet a released, integrated Playground.

## First exact-head image proof

At source b39e35c71906fb5ae862417488115569de57fbf5, required ci40964952751, release-policy40964952558 and dedicated coding image40964952756 all succeeded. The image's six mandatory real scenarios include unprivileged UID separation, actual signed HTTP execution, npm lifecycle/TypeScript/app tests, local PostgreSQL and Playwright Chromium, durable replay/restart, timeout/cancellation, paged logs and inactivity. This supersedes the earlier local-unavailable note only for that exact image/source: it is real container CI proof, not Dokploy deployment or integrated MCP acceptance. Final product naming and concurrent-lease/shutdown hardening require a new exact-head cycle before merge.
