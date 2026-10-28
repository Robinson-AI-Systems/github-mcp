# Native Git capability through the GitHub MCP

Status: design proposed 2026-10-28 in response to the owner's request for actual direct full Git capability. Not implemented, installed or deployed. This extends the active [authority/parity plan](AUTHORITY-PARITY-2026-10-28.md); it must not be counted as delivered by existing GitHub git-data API tools or the wiki's isomorphic-git adapter.

## Observable outcome

A user can open an isolated repository workspace and perform actual native Git operations through the MCP: clone/fetch, branches/tags/remotes, logs/diffs/blame, staging/commits, push/pull, merge/rebase/cherry-pick/revert, reset/clean/stash, worktrees and bisect. Binary data, large repositories, shallow history and operation continuation are first-class. Conflicts remain real workspace state with inspect/resolve/continue/abort operations; never a generic error or fabricated success. GitHub API tools stay useful alongside Git, including issues, reviews, CI and settings.

## Architecture

Use the existing Vercel MCP as the authenticated control plane and an isolated native-Git worker as the execution plane. Persistent clones do not live in a Vercel request's temporary filesystem. Owner clarification 2026-10-28: Dokploy and its server belong to a friend. The owner permits Dokploy as the initial worker host, provided the worker is easy to move later. It is not the long-term production trust or availability boundary. Production worker compute, storage, billing, access and recovery must be controlled by Robinson AI Systems in its own provider account. Do not provision a paid service or new plan as an implementation side effect. Worker runtime, durable storage, CPU/disk/concurrency and cleanup costs must be measured and documented before activation.

Cost requirement: use short-lived isolated managed workers in a Robinson-controlled account, explicitly stop them after checkpointing, and retain encrypted state in Robinson-controlled durable storage. Prefer no warm pool initially. Compare actual provider minimum plan, running memory/CPU, snapshots/storage, transfer and control-plane costs before activation. A stopped worker is different from a running idle worker; no unconditional $0 idle claim. The initial Dokploy adapter must export complete state and use the same worker protocol, so moving to Robinson-controlled managed execution does not change MCP tools, workspace identity or user connections.

Each workspace is owned by authenticated tenant + principal + provider connection + exact repository and has an opaque ID, expiry and lease. Every operation revalidates current provider connection, repository scope, revocation, read/write grant and lease. Cached data cannot outlive permission checks. A workspace identifier or company membership alone grants no access. Same-user multiple connections do not implicitly inherit each other's grants.

Worker images pin native Git and supporting libraries; run without host mounts, host credentials or host privileges. A credential broker supplies narrowly bound temporary authentication only for the authorized GitHub remote operation. Git output/config/error text and environment dumps never expose credentials. Repository hooks, credential helpers, filters and submodules must not execute in a credential-bearing host process. Handle optional hooks/filters/LFS/submodules in isolated jobs with explicit network and credential boundaries, rather than silently claiming full support.

Use process argv, never shell interpolation. Validate remote origins and redirects, paths within workspace roots, repository object identities and user-selected expected remote heads. Preserve GitHub's permissions/rules/billing refusals; do not recreate protected-branch, spend or production policy in the worker. Enforce chosen read-only connections and owner-issued delegate restrictions.

## Typed tool surface

| Family | Operations |
| --- | --- |
| Workspace | open/clone, inspect/status, list, export, close/dispose, renew lease |
| Objects/history | log, show, diff, blame, refs, rev-parse, ls-tree, cat-file with complete bounded retrieval |
| Index/commits | inspect/edit files including binary, add/restore/reset index, commit/amend, inspect result |
| Network | fetch, pull, push, remote configuration and refs; explicit expected-head leases where selected |
| History changes | merge, rebase, cherry-pick, revert, reset, clean, stash; preview optional, current owner instruction executes |
| Multi-step work | inspect conflict files/index stages, supply resolutions, continue/abort, worktrees, bisect |

Prefer a finite family of typed tools plus discoverable commands; do not expose a host shell and call it Git support. Advanced native Git subcommands may be added with exact argument/credential/result contracts. Inventory unsupported flags/capabilities honestly, with repository/local-Git guidance where worker support is unavailable. No blanket 'full Git' claim before those capabilities are verified.

## Transaction and recovery model

Journal requested local and remote effects with immutable intent keys. Serialize workspace mutations using leases while allowing safe independent reads. Before network writes record actor, remote and expected refs; after execution verify remote refs independently. A transport failure may have pushed: inspect remote state before retrying. Never replay a push, merge commit, cherry-pick or rebase blindly.

Return exact commit/ref identities and resumable conflict/operation states. Large output uses complete byte windows or protected artifacts; no silent text loss. Workspace export excludes credentials and sensitive Git config. Cleanup expires resource leases and deletes only the exact run-owned workspace, never a provider repository.

## Delivery and acceptance

1. Worker protocol and isolated native-Git harness, using temporary local bare repositories and fake credential broker. Validate clone/status/log/diff/binary/complete retrieval and cross-tenant denial.
2. Index/commit/fetch/push lifecycle with leases, expected remote head, revoked grant and ambiguous push recovery. Provider-shaped fixture tests; no real paid/destructive tests inferred.
3. Merge/rebase/cherry-pick/revert conflict inspection, resolution, continuation and abort; reset/clean/stash/worktrees/bisect. Test actual Git processes, not mocked command success.
4. GitHub integration with genuine enrolled authorization, provider refusals, secret hygiene and real run-owned disposable repository acceptance. Existing provider rate signals and all delegated restrictions remain effective.
5. Deployment on Robinson-controlled approved infrastructure, resource/cost measurement, recovery after worker restart, and direct-client acceptance. No activation until the concrete deployment is ready and actually authorized.
6. LFS/submodules/signing/hook/filter support gets explicit capability and credential decisions. Until implemented, provide local setup/commands and accurately named limitations.

Release acceptance must include the actual native Git version/image, worker source and MCP source, commands exercised, workspace/remote before-and-after refs, provider identity and cleanup. API-only commits, green parser tests or a design document do not establish native Git delivery.

## Scale architecture — required beyond the initial deployment

Owner clarification 2026-10-28: a single development/early-user host is not the long-term solution. Keep the worker protocol independent of Dokploy or any particular cloud. Do not put a fixed worker URL or local-disk assumption into public tool arguments or stored workspace identity.

- **Control plane:** MCP authentication/authorization, workspace metadata, operation journal and small tool responses stay separate from Git execution. Every job receives a narrowly signed tenant/workspace/operation lease, not the control plane's master credentials.
- **Durable queue:** accept jobs durably, return a resumable operation ID, and dispatch with fair scheduling and backpressure. Reads and independent workspaces can proceed concurrently; mutable operations within one workspace require the same exclusive lease and generation check. Service CPU/disk limits protect this service's own capacity; they do not add GitHub account policy.
- **Autoscaling isolated workers:** scale the pool from queue age, active leases and resource pressure. Workers can scale to zero; optional warm capacity trades a standing compute charge for shorter cold starts. Use a portable worker image and scheduler adapter: a managed runtime in a Robinson-controlled account; optional friend-hosted development adapter only. Provider selection and prices remain unchosen, not fabricated.
- **Durable workspace state:** encrypted, access-controlled snapshots/object storage preserve the complete workspace state needed for index, stash, uncommitted files and interrupted conflicts. Shared repository-object caches accelerate hydration but must not expose private objects across tenants or grants. Local worker disk is a cache, never the only copy. No credentials, helper secrets or signed provider URLs enter snapshots.
- **Crash-safe checkpoints:** snapshot at stable operation boundaries with monotonically versioned metadata. Atomically commit the journal/checkpoint reference and release the lease. An expired lease does not prove a remote push failed: independently inspect GitHub refs before rescheduling. Preserve conflict/rebase/bisect state so a replacement worker can continue or abort it.
- **Isolation and operations:** enforce tenant-scoped broker grants, revocation, separate job processes, bounded output, audited cleanup, and per-tenant resource observations. Instrument queue latency, execution time, cold starts, snapshot hydration/upload, disk pressure, provider throttles, failures and cost per operation. Never log secret-bearing Git output.

### Idle and scale costs

Scaling workers to zero can remove worker compute charges, depending on the selected runtime. Durable storage, snapshots, queue/control-plane/database services and transfer may still be billed while no Git job runs. A configured warm pool has an explicit standing cost. A friend-hosted development container does not establish production cost, isolation or availability. Lifecycle policies, cache eviction and incremental snapshots must be benchmarked before claiming low multi-user costs; there is no verified dollar estimate yet.

### Scale acceptance

Before broad rollout, load-test multiple tenants and repositories with actual native Git, small/large/binary histories, long-lived conflict states and concurrent users. Prove fair queueing, per-workspace serialization, revocation during queueing/execution, worker crash recovery, safe remote-write reconciliation, tenant-cache isolation and complete cleanup. Measure cold/warm latency and storage/transfer/compute usage at target concurrency; document the capacity, service cost and bottleneck. Scale-out must preserve the public MCP contract and authority model, not require users to re-create their connections.

Owner priority clarification (2026-10-28): audit remediation and deployed MCP verification take precedence over native Git expansion. Initial Dokploy execution is acceptable with a portable image/protocol and durable export. Native Git work is not counted toward closing the audit findings.
