# Playground operations (operator reference)

How the Playground runtime is hosted, configured, provisioned and cleaned up. Agent-facing use is in
[CODING-WORKSPACES](CODING-WORKSPACES.md); future multi-host design in [RUNTIME-FLEET](designs/RUNTIME-FLEET-2026-11-01.md).
Values below were checked against code on 2026-11-01.

Split of responsibilities: **Vercel** runs the MCP (the only caller of the Dokploy API), **Neon** holds all allocation
state, **Dokploy** runs the containers. The control plane never accepts a runtime URL or provider credential from a
caller. Executors never get a Docker socket, host PID/filesystem mount or orchestration credential. Containers are not
hypervisor VMs.

## Settings (protected, Vercel project)

| Setting | Default | Meaning |
|---|---|---|
| `PLAYGROUND_POOLS` | — | **Several shared pools (FLEET-4):** JSON list of `{id, origin, keyEnv, project, environment, ingress, serverId?, weight?}`. Each API key lives in its own protected setting named by `keyEnv` (never in the list). `serverId` places allocations on a specific server of a multi-server Dokploy. New allocations are spread by weight (rendezvous hashing; weight 0 = drain: no new work); every allocation keeps the pool it started on, and removing a pool that still has allocations refuses their operations instead of moving them. Without this setting the legacy variables below form one pool, `default` |
| `PLAYGROUND_DOKPLOY_ORIGIN`, `PLAYGROUND_DOKPLOY_API_KEY`, `PLAYGROUND_DOKPLOY_PROJECT_ID`, `PLAYGROUND_DOKPLOY_ENVIRONMENT_ID` | — | The legacy single Dokploy target (pool `default`). Dokploy has no project-scoped key, so the code pins and re-checks project/environment/source/resource ownership before every mutation. Changing them later refuses existing allocations rather than moving them |
| `PLAYGROUND_INGRESS_IPV4` | — | The host's **inbound** address (operator value; currently the friend's server). Allocation hosts become `ras-pg-<id>-<a-b-c-d>.sslip.io` |
| `PLAYGROUND_IMAGE` *or* `PLAYGROUND_BUILD_SOURCE_SHA` | serving `VERCEL_GIT_COMMIT_SHA` | Immutable `…@sha256:` image, or a 40-hex commit to build from the public repository. A prebuilt image digest makes new runtimes start much faster than a per-allocation build. The **Publish runtime image** workflow builds and smoke-tests `ghcr.io/robinson-ai-systems/github-mcp-runtime:<live commit>` after every release (it runs on the release job's completion, because pushes made with the workflow token start no workflows) or on demand, skipping commits already published. Pinning by hand is optional: see `PLAYGROUND_IMAGE_REPOSITORY` |
| `PLAYGROUND_IMAGE_REPOSITORY` | — (`vercel.json` sets `ghcr.io/robinson-ai-systems/github-mcp-runtime`) | Public registry repository holding images tagged by release commit. With no `PLAYGROUND_IMAGE`, a new allocation anonymously looks up `<repository>:<serving commit>` and pins `repository@sha256:…`; missing/private/unreachable → build from source as before |
| `PUBLIC_BASE_URL` | `https://github.robinsonaisystems.com` | Control origin baked into plans (lifecycle callback, preview) |
| `PLAYGROUND_RESOURCE_MODE` | `verified` (`vercel.json` sets `best_effort`) | See resource modes |
| `PLAYGROUND_CPU_CPUS`, `PLAYGROUND_MEMORY_BYTES` | 8, 8 GiB | Whole-allocation ceilings (0.2–8 CPU, 512 MiB–8 GiB) |
| `PLAYGROUND_DEFAULT_SIZE` | `medium` | Size class used for `runtime: auto` (`small`, `medium`, `large`) |
| `PLAYGROUND_MIN_HOST_MEMORY_BYTES`, `PLAYGROUND_MIN_HOST_DISK_BYTES`, `PLAYGROUND_MAX_HOST_PRESSURE` | 512 MiB, 1 GiB, 0.9 | Host admission thresholds when a capacity feed exists |
| `PLAYGROUND_TELEMETRY_URL`, `PLAYGROUND_TELEMETRY_PUBLIC_KEY` | — | Signed capacity/enforcement feed. **Setting the URL turns best-effort off**: every workspace then needs signed enforcement records |
| `PLAYGROUND_ADMISSION`, `PLAYGROUND_ENFORCEMENT` | — | Static compatibility observations used only when no feed is configured; enforcement rows expire within 4 h |
| `PLAYGROUND_STORAGE_DRIVER`/`_OPTIONS`, `PLAYGROUND_NETWORK_DRIVER`/`_OPTIONS` | — | Optional operator quota/egress drivers (verified mode) |
| `PLAYGROUND_WARM_RUNTIMES` | `auto` | Warm-runtime gate (FLEET-7): `auto` lets the coded gate decide; `off` drains every warm image holder at the next sweep. Any other value counts as off |
| `PLAYGROUND_WARM_MIN_ALLOCATIONS_PER_HOUR`, `PLAYGROUND_WARM_ALLOCATIONS_PER_IMAGE`, `PLAYGROUND_WARM_MAX_IMAGES` | 6, 6, 2 | Demand needed (new pool runtimes per hour averaged over the last 24 h), runtimes per hour per extra warm image, and the most images kept warm per pool (0–3). See [warm runtimes](#warm-runtimes-fleet-7-2026-11-01) |
| `PLAYGROUND_WARM_MIN_HOST_MEMORY_BYTES`, `PLAYGROUND_WARM_MIN_HOST_DISK_BYTES`, `PLAYGROUND_WARM_MAX_HOST_PRESSURE`, `PLAYGROUND_WARM_DISK_PER_IMAGE_BYTES` | 8 GiB, 50 GB, 0.5, 6 GB | Fresh host headroom needed before anything is kept warm, and the disk one warm image is assumed to take. Stricter than allocation admission on purpose. An invalid value turns warm runtimes off |
| `PLAYGROUND_STUCK_AFTER_MINUTES` | 45 | **Stuck runtimes (PG-STUCK-1):** a shared-pool runtime that has not reached `attached` and made no provisioning or attachment progress for this many minutes (whole minutes, 15–1440; anything else means 45) is removed by the sweep, keeping the person's workspace. A provider deployment in `error` is removed at once |
| `PLAYGROUND_ALLOCATIONS` | — | Legacy manual `{workspace_id,binding,origin}` list; managed allocations use stored records |

Set inside each allocation by the plan (never by hand): `CODING_WORKSPACE_BINDING`, `CODING_CONTROL_PUBLIC_KEY`,
`CODING_IDLE_TIMEOUT_MS` (= the Git workspace's idle window, default 14,400,000 ms), `CODING_LIFECYCLE_URL`,
`CODING_EGRESS_PROXY` (must be `http://ingress:3128`), `CODING_PUBLIC_ORIGIN`, `CODING_CONTROL_ORIGIN`,
`CODING_STORAGE_ROOT`, `CODING_AUTHORITY_GRACE_MS` (300000), `CODING_CACHE_ROOT` (own machines only: shared package cache), `CODING_PREVIEW_PORTS` (default 3001, 4173, 5173, 8000, 8080; 3000 and 5432 always excluded), the
broker's `NATIVE_GIT_SINGLE_*` values, and the gateway's `EGRESS_BLOCKED_HOSTS`/`EGRESS_BLOCKED_ADDRESSES`. The manager
container gets `PLAYGROUND_SWEEP_URL` and a derived `PLAYGROUND_SWEEP_KEY`.

## Placement: people's own machines first

Every person who signs in can add computers or servers they control from My connection
([setup guide](../tools/playground-device/README.md)). The host agent only checks in **outward**
(`POST /api/fleet/checkin`, long-poll ≤ 20 s; `POST /api/fleet/report`), signed with the device key the person approved.
The control plane leaves signed orders in that person's tenant database (`fleet_q.*`/`fleet_m.*` rows): `readiness`,
`allocation_up`/`allocation_down` (the same compose plan as below, gateway published on 127.0.0.1 only), `relay` (an
already-signed `/v1/coding` or `/v1/workspace` request, forwarded unchanged), `terminate`. Device origins look like
`https://d<device>-<binding>.fleet.invalid/` and can never be resolved, so they only ever travel by relay.

- **Placement order:** the person's own `ready` machines that checked in within 90 s and have room (≥ 1 CPU, 1.5 GB free
  memory, 10 GB free disk; the size class is capped to ¾ of the machine), then the operator pools (`PLAYGROUND_POOLS`,
  spread by weight), then Git-only. People who only use their own machines need no shared pool at all.
- **Liveness:** commands need a check-in within 90 s; the runtime's own heartbeat does not depend on the agent, so a slow
  check-in never stops running work. A revoked machine's runtimes stop on their next heartbeat.
- **Revocation:** bumps the device generation; the next check-in gets a `terminate` order; the agent deletes every runtime
  and attests absence; then the machine is refused (410). Cleanup evidence on a person's own machine is labelled
  `device_attested`.
- **Caches (FLEET-5):** each machine keeps two Docker volumes shared by all of its owner's runtimes:
  `ras-cache-deps-<device>` (mounted at `/cache`; commands get `NPM_CONFIG_CACHE`, `YARN_CACHE_FOLDER`, `PNPM_STORE_DIR`,
  `PIP_CACHE_DIR`, `XDG_CACHE_HOME` under it) and `ras-cache-git-<device>` (the broker's Git object cache, so a repeat
  attachment downloads only new objects; capped at 20 GB, then rebuilt; attached repositories never depend on it).
  Stopping a runtime keeps them; revoking the machine or `agent.mjs leave` deletes them. Shared-pool runtimes have no
  cross-runtime cache (different people share those hosts).
- Endpoints answer only on the production deployment with the public-connect tenant mode enabled (same gate as pairing).

## Right-sized runtimes

Every allocation has a **size class**, chosen when it is first queued (`github_git_workspace_open.runtime`) or provisioned
(`github_playground_workspace` `size`):

| Class | Whole allocation | Executor gets roughly |
|---|---|---|
| `small` | 2 CPU / 2 GiB | 1.4 CPU / 1.4 GiB |
| `medium` | 4 CPU / 4 GiB | 3.4 CPU / 2.9 GiB |
| `large` | 8 CPU / 8 GiB | 7.4 CPU / 6.4 GiB |

The broker takes min(0.5 CPU, ¼) and min(1.5 GiB, ¼ memory), the gateway min(0.1 CPU, ⅛) and min(128 MiB, ⅛), and the
executor's 1 GiB `/tmp` counts against its memory. A class is a **ceiling that only lowers** the protected
`PLAYGROUND_CPU_CPUS`/`PLAYGROUND_MEMORY_BYTES` and fresh host headroom; it never raises them or reserves anything. The
class is stored on the allocation and fixed for its life (plan-hash stability); rows created before classes existed keep
their exact original plan. `runtime: none` queues nothing. Since 2026-11-01 the default (`runtime: auto`, `PLAYGROUND_DEFAULT_SIZE` unset) is
`medium`: a live medium runtime installed this repository and ran its full unit suite (10,632 of 10,633 passed; the one
failure was the worktree-relink bug fixed in the same change) in 404 s. Set `PLAYGROUND_DEFAULT_SIZE=large` to restore
the original 8 CPU / 8 GiB size.

### Slim image for small jobs (FLEET-2, 2026-11-01)

The publish workflow builds two tags per released commit: `<sha>` (full: Chromium for Playwright and PostgreSQL for the
disposable test database) and `<sha>-slim` (the same supervisor/runtime code without them; Dockerfile target `slim`; the
full `runtime` target is slim plus those two). Each tag is skipped when it already exists. A **new** allocation's image
is chosen by a gate in code (`src/playground/runtime-variant.js`):

- slim only when the size is `small` **and** the repository's own files show no browser/database signals:
  `package.json` dependencies/devDependencies naming playwright, @playwright/test, puppeteer, cypress, pg, postgres,
  prisma, @prisma/client, typeorm, sequelize or knex; a `docker-compose`/`compose` file mentioning postgres; or
  `requirements.txt`/`pyproject.toml` mentioning psycopg, selenium or playwright. The files are read through the native
  Git worker; an unreadable or oversized file counts as a signal (full image).
- otherwise the full image. Missing slim tag → full image → source build (the original fallback).
- an operator pin (`PLAYGROUND_IMAGE`, or a pool's own image) is always used as-is and disables the choice.

The allocation stores `runtimeImage` `{variant: slim|full|source_build|operator_pinned, reason, signals}`, and
`github_playground_read` operation `allocation` shows it as `runtime_image`. Existing allocations keep their plan.

### Run-at-commit and the upsize hint (FLEET-2)

`github_playground_run` opens a Git-only workspace at a branch, tag or 40-character SHA (a SHA is checked out with a hard
reset and read back; unreachable commits end as `ref_unavailable`), sizes it (`auto`: small without signals, medium with
a database or an unreadable file, large with browser tests), queues the allocation (own machines first, then the pool),
provisions and attaches it, runs argv once, keeps the exit code and last 4 KB of log, then disposes the allocation and
the workspace. Its state machine (`playground_run.<hash>` setting: opening → provisioning → starting → running →
disposing → done) advances for about 40 s per call; a repeat call with the same arguments and requestKey continues (a
write-layer replay; nothing starts twice). The workspace idle lease is the command timeout plus 30 minutes, so an
abandoned run is removed by the existing expiry sweep.

When a command ends by `SIGKILL` (or a shell's 137) that the supervisor did not send (not cancel, timeout, log limit or
stop) and the container's cgroup `memory.events` `oom_kill` counter rose during it, the runtime records
`reason: out_of_memory`. `github_playground_read` status, `github_playground_execute` and `github_playground_run` then add
`upsize: {next_size, hint}` (small → medium → large; on large: split the job). Reading the counter is best effort; when it
is unreadable the old reasons are kept.

### Warm runtimes (FLEET-7, 2026-11-01)

**What it is.** A warm runtime is a tiny **image holder**: a one-service compose (`ras-pg-warm-<16 hex>`, 0.05 CPU,
64 MiB, `network_mode: none`, read-only, UID 1000, all capabilities dropped, `restart: no`) whose only job is to keep the
exact digest-pinned runtime image on the pool's host, so a new workspace's own containers start without downloading it.
It has no environment variables, volumes, networks, ports, domains, binding labels, keys or credentials. No allocation
ever adopts, binds to or reuses a holder: every workspace still gets its own fresh, single-use, per-binding allocation
(plan, volumes, networks, lease and cleanup unchanged). Its name contains `warm`, so it can never match an allocation
(`ras-pg-<32 hex>`). Source builds are not warmed (only digest-pinned images).

**When it is used (the gate, `src/playground/warm-runtimes.js`).** Evaluated per pool by every cleanup sweep:

1. Demand: new pool runtimes in the last 24 h (stored allocation index, disposed ones included, people's own computers
   excluded) divided by 24 must reach `PLAYGROUND_WARM_MIN_ALLOCATIONS_PER_HOUR` (6/hour = 144 a day). Below that it is
   off and no telemetry, registry or Dokploy call is made.
2. Fresh host headroom: the same signed capacity observation allocations use (`PLAYGROUND_TELEMETRY_URL`, or a static
   `PLAYGROUND_ADMISSION`), at most 60 s old and for this pool's project, must show at least 8 GiB free memory, 50 GB
   free disk and pressure ≤ 0.5 (settings above). No fresh reading = off.
3. Size: `min(MAX_IMAGES, ceil(demand per hour ÷ ALLOCATIONS_PER_IMAGE), images in use, holders already warm + whole
   6 GB images that fit above the free-disk minimum)`. Images are the operator pin, or the published `full`/`slim` tags
   ranked by how many new runtimes used each.

When the gate stops wanting a holder (demand fell, headroom shrank or went stale, setting `off`, image changed with a
new release) the sweep drains it: stop → every container exited → delete → independent absence readback, then the record
is removed. Every transition is a compare-and-set on the root setting `playground_warm`, written before the provider
call; at most one holder is created per sweep; a lost create is recovered from exact inventory (dropped only if it never
appears within 10 minutes); a holder whose source changed is never stopped or deleted; a holder of a removed pool is
preserved and reported pending. Revocation and tenant removal have nothing to revoke in a holder (it holds no authority).

**Seeing the decision.** `github_playground_read` operation `capabilities` or `availability` **without** a
`workspace_id` returns `warm_runtimes {enabled, reason, pools[{pool, enabled, target_images, demand_per_hour}],
warm_images[{pool, variant, phase}], never_bound}` in plain words. The sweep response carries `warm {enabled, running,
pending}`.

**Today (defaults, one small shared host, best effort without a capacity feed):** off: demand is a handful of runtimes a
day and there is no fresh host measurement. No spend, no extra containers.

## Lifecycle

```
requested → (waiting_resources) → creating → created → exposing → exposed → deploying → allocated
          → attaching → attached → [execute/read/cancel] → cleanup_requested → stopped → deleting → disposed
```

- **Who advances it:** an agent call (`github_playground_workspace` `setup` — which chooses provision, replace, attach or resume itself — or `provision`/`attach`/`resume`/`dispose`) or the
  **project manager** — a tiny compose (`ras-pg-manager-…`, 0.1 CPU / 128 MiB) created automatically by the first
  provision, which POSTs `/api/playground/sweep` every 30 s with its derived sweep key. Each sweep handles up to 50 rows
  in a ~20 s budget. The manager holds only a cleanup/re-check capability; it cannot bypass authorization or read volumes.
- **Create:** raw Dokploy compose with four services (`initialize`, `broker`, `coding`, `ingress`), four volumes
  (broker, files, git, execution) and private networks; the provider-assigned `appName` is read back and pinned; two
  HTTPS domains (`/` and `/v1/workspace`, `internalPath=/`, `stripPath=false`) go only to the gateway. Every transition is a
  Neon compare-and-set; a lost create is recovered from exact inventory, never by creating another stack.
- **Attach (lean, FLEET-6):** the source worker seals only what GitHub lacks — refs, index and config, a Git bundle of
  local-only commits, stash and staged blobs, and changed/untracked files — and the controller relays it in encrypted
  256 KiB pages to the allocation's broker. The broker, given a short-lived repository-scoped app token, fetches the
  remote commits by exact SHA from GitHub into a scratch repository, moves the objects in, unbundles, rebuilds tracked files
  from the index, lays the changed files on top and verifies every object is present (`rev-list --objects --all`). Long
  fetches continue in the background across sweeps. The 100 MiB / 100,000-file / no-symlink bound now applies only to the
  copied local changes. Shallow workspaces, linked worktrees and in-progress merge/rebase/cherry-pick/revert/bisect fall
  back to the full copy (whole workspace ≤ 100 MiB). Routing switches only after generation, ancestry, uncommitted state and
  mount evidence match.
- **Run:** the controller signs a 60 s claim and calls the gateway; the executor checks binding/purpose/expiry.
- **Heartbeat:** every 30 s the runtime sends a signed heartbeat (executor → broker → `/api/playground/lifecycle`); the
  controller re-checks grant, pass, job and network and answers with a 60 s lease. A **signed denial** (revoked grant,
  expired job, lost membership) stops the runtime at once. If the control plane is **unreachable** (network or
  Vercel/Neon trouble) the runtime retries every 10 s; no new command starts once the last lease expires, but commands
  already running keep going for a bounded grace (`CODING_AUTHORITY_GRACE_MS`, default 5 minutes, at most 15) before
  the whole runtime stops (`restart: no`; files are preserved and `resume` brings it back). The lease is never extended.
- **Cleanup:** revoked/expired authority, idle expiry or `dispose` → stop, verify every container exited, delete the
  compose with its four volumes, read back absence, then close the exact source Git workspace. A delete acknowledgement
  alone is never proof. Dokploy refuses volume reads (HTTP 401) to project keys: with no operator feed configured, disposal
  completes once the compose and every container are independently gone and records
  `cleanupEvidence: compose_and_containers_absent_volume_read_forbidden`, `volumesVerified: false` (issue #509); with a feed
  configured, its signed observation is still required.
- **Startup:** the runtime's first heartbeats go through the broker, which starts in parallel. Until the first signed
  answer the runtime keeps retrying for up to 3 minutes (no command can start without a lease) instead of exiting; a
  forged or tampered first answer still stops it. Attach reports "not reachable yet" (retryable, nothing transferred)
  while the runtime or its HTTPS address is still coming up.
- **Stuck or failed runtimes (PG-STUCK-1):** every saved step stamps `progressAt`. A shared-pool runtime in a pre-attached
  phase (`creating` … `attaching`) whose provider deployment reports `error`, or that made no progress for
  `PLAYGROUND_STUCK_AFTER_MINUTES` (default 45), is marked `cleanupRequested` with `cleanupReason`
  (`runtime_failed_to_start` / `runtime_stuck`) and `runtimeOnly: true`, then stopped and deleted exactly like any
  disposal; an unfinished transfer's source lock is released. **Only the runtime goes:** the native Git workspace (files,
  lease, job) is kept and never closed by this. A marked runtime is never redeployed. The next `provision`, `attach` or
  `github_playground_run` step creates a fresh compose under the same allocation key (new transfer attempt, size and
  failure history kept). After 3 runtimes in a row fail to start for one workspace, no new one is started automatically
  and the answer says so; a successful attach resets the count. Why 45 minutes: each healthy step (image pull or source
  build, deploy, HTTPS name, a transfer window) finishes in minutes, so 45 minutes without any step advancing is far past
  normal, while a broken runtime no longer holds host memory for days.
- **What extends a workspace's idle lease:** real work only — Git operations, Git reads (log, diff, refs, files), uploads,
  downloads, and Playground commands/status/logs. Status inspects (`github_git_workspace_read` status, replays of open or
  download, run progress checks, write preflights and readbacks) and refused or rejected calls do not (DECISIONS
  2026-11-02).

## Resource modes

**best_effort** (production): allocations are created without a capacity feed. Admission still refuses on measured
pressure. Execution requires: the exact managed, attached allocation; matching provider project/environment/origin;
the pinned runtime identity; read-only Git mount; a current signed heartbeat; and an **independent converted-compose
readback** proving the executor is only on its private internal network with no published ports or host networking
(Dokploy adds shared networks to services that have domains, so the raw plan alone is not proof). The gateway alone gets
domains and is checked field by field (UID 1000, read-only, no volumes, no ports, dropped capabilities). Availability
reports configured limits, unknown storage quota and `resourceGuarantees:false`.

**verified**: commands need fresh signed enforcement evidence (feed or static `PLAYGROUND_ENFORCEMENT`) plus runtime
cgroup readback within those maxima; anything smaller than 8 CPU / 8 GiB / 150 GB reports `constrained`. Built-in
local/bridge drivers are not accepted as quota/egress enforcement; an operator driver name is not proof either. All four
volumes must share the binding's one aggregate quota — four separate 150 GB quotas would break the workspace total.

**Network:** new plans (`dedicated-ingress-v2`) route downloads through the gateway proxy (public IPv4, ports 80/443,
DNS pinned per connection, private/metadata/admin/control addresses denied, no IPv6). Older `dedicated-internal-v1`
allocations stay offline.

## Signed telemetry feed (optional)

`PLAYGROUND_TELEMETRY_URL` is a fixed HTTPS URL without query or credentials. A GET returns ≤ 16 KiB JSON signed
byte-for-byte in `x-robinson-telemetry-signature` (`ed25519:` + base64url) by the operator's sensor, whose private key
never enters this service or any container. 5 s fetch timeout; no redirects; no stale fallback after a failure.

```json
{
  "purpose":"robinson-playground-capacity/v1",
  "project":"OPERATOR_PROJECT",
  "observedAt":1793318400000,
  "availableCpuCpus":8,
  "availableMemoryBytes":8589934592,
  "availableDiskBytes":10737418240,
  "pressure":0.1,
  "allocations":[
    {
      "workspace_id":"job_0123456789abcdef",
      "binding":"EXACT_64_HEX_BINDING",
      "observedAt":1793318400000,
      "expiresAt":1793318460000,
      "isolation":true,
      "termination":true,
      "repositoryAttached":true,
      "cpuCpus":8,
      "memoryBytes":8589934592,
      "storageQuotaBytes":150000000000
    }
  ]
}
```

Shapes only, not real observations. Capacity observations expire after 60 s. Fresh `availableCpuCpus`/`availableMemoryBytes`
shrink queued, never-created plans; existing allocations are never touched. The sensor must measure real per-workspace
controls, not infer them from YAML.

### Scoped cleanup proof when volume reads are forbidden

Dokploy returns 401 for volume/server inspection with this project's key. Instead of widening access, the sensor can
send one replacement record for the workspace:

```json
{
  "workspace_id":"job_0123456789abcdef",
  "binding":"EXACT_64_HEX_BINDING",
  "observedAt":1793318400000,
  "expiresAt":1793318460000,
  "cleanup":{
    "composeId":"EXACT_OWNED_COMPOSE",
    "composeAbsent":true,
    "containersAbsent":true,
    "volumesAbsent":["EXACT_FILES_VOLUME","EXACT_GIT_VOLUME","EXACT_BROKER_VOLUME","EXACT_EXECUTION_VOLUME"]
  }
}
```

The service checks signature, project, exact binding/compose, all four expected volume names and a ≤ 60 s lease, and still
requires its own view of compose absence and an empty container inventory. Applies only to 401/403 inspection denial.

## Preview

Interactive previews use a one-use private entry page (valid 60 s) and a signed, port-bound browser session (300 s)
with HttpOnly, Secure, Strict cookies over HTTP and WebSocket. App assets and hot reload do not renew inactivity; real Git
or command activity does. Entry URLs are private capabilities — never publish them. The text preview read (`preview`
operation) is loopback GET only: ≤ 2 MiB textual body, 5 s deadline, 32 KiB windows pinned by `expectedBodyHash`, no
redirects, cookies or compressed bodies.

## Known limits

- **Network address pools.** Each shared-pool allocation adds private networks, and a Docker host's address pool can run
  out (it did once, owner checklist item 3). Spread load with `PLAYGROUND_POOLS`, use `runtime: none` and smaller classes,
  or let people run on their own machines.
- **Startup is slow for small jobs:** per-allocation build (without `PLAYGROUND_IMAGE`), four services, new TLS
  certificate, multi-sweep attachment. FLEET-2 added the slim image and run-at-commit; FLEET-7 keeps runtime images warm only under measured demand.
- **No resize:** change size by finishing work, disposing, and opening a new workspace with another class.
- **No verified backup** of runtime volumes exists; under the 2026-10-30 owner decision it is optional future work.

## Verification boundaries

Unit/transport tests, exact-head image CI, merged source, deployed matching worker/MCP revisions and authenticated
disposable acceptance are separate evidence. The multi-container image scenario covers Chromium private entry, secure
cookies, app/API/WebSocket traffic, anonymous denial, shared edits, read-only Git metadata, UID 1000, a daemonized child,
container termination and exact volume absence; its heartbeat-free fixture is not live revocation proof. Full
current-grant/browser/lifecycle acceptance on the real host is still required before PLAY-1 is complete. Earlier wording
of this page is in git history; incident notes are in `docs/status/2026-10-30-playground-*.md`.
