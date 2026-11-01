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
| `PLAYGROUND_DOKPLOY_ORIGIN`, `PLAYGROUND_DOKPLOY_API_KEY`, `PLAYGROUND_DOKPLOY_PROJECT_ID`, `PLAYGROUND_DOKPLOY_ENVIRONMENT_ID` | — | The single Dokploy target. Dokploy has no project-scoped key, so the code pins and re-checks project/environment/source/resource ownership before every mutation. Changing them later refuses existing allocations rather than moving them |
| `PLAYGROUND_INGRESS_IPV4` | — | The host's **inbound** address (operator value; currently the friend's server). Allocation hosts become `ras-pg-<id>-<a-b-c-d>.sslip.io` |
| `PLAYGROUND_IMAGE` *or* `PLAYGROUND_BUILD_SOURCE_SHA` | serving `VERCEL_GIT_COMMIT_SHA` | Immutable `…@sha256:` image, or a 40-hex commit to build from the public repository. A prebuilt image digest makes new runtimes start much faster than a per-allocation build. The **Publish runtime image** workflow builds and smoke-tests `ghcr.io/robinson-ai-systems/github-mcp-runtime` on every release to `live` (or on demand) and writes the digest to pin in its run summary |
| `PUBLIC_BASE_URL` | `https://github.robinsonaisystems.com` | Control origin baked into plans (lifecycle callback, preview) |
| `PLAYGROUND_RESOURCE_MODE` | `verified` (`vercel.json` sets `best_effort`) | See resource modes |
| `PLAYGROUND_CPU_CPUS`, `PLAYGROUND_MEMORY_BYTES` | 8, 8 GiB | Whole-allocation ceilings (0.2–8 CPU, 512 MiB–8 GiB) |
| `PLAYGROUND_DEFAULT_SIZE` | `large` | Size class used for `runtime: auto` (`small`, `medium`, `large`) |
| `PLAYGROUND_MIN_HOST_MEMORY_BYTES`, `PLAYGROUND_MIN_HOST_DISK_BYTES`, `PLAYGROUND_MAX_HOST_PRESSURE` | 512 MiB, 1 GiB, 0.9 | Host admission thresholds when a capacity feed exists |
| `PLAYGROUND_TELEMETRY_URL`, `PLAYGROUND_TELEMETRY_PUBLIC_KEY` | — | Signed capacity/enforcement feed. **Setting the URL turns best-effort off**: every workspace then needs signed enforcement records |
| `PLAYGROUND_ADMISSION`, `PLAYGROUND_ENFORCEMENT` | — | Static compatibility observations used only when no feed is configured; enforcement rows expire within 4 h |
| `PLAYGROUND_STORAGE_DRIVER`/`_OPTIONS`, `PLAYGROUND_NETWORK_DRIVER`/`_OPTIONS` | — | Optional operator quota/egress drivers (verified mode) |
| `PLAYGROUND_ALLOCATIONS` | — | Legacy manual `{workspace_id,binding,origin}` list; managed allocations use stored records |

Set inside each allocation by the plan (never by hand): `CODING_WORKSPACE_BINDING`, `CODING_CONTROL_PUBLIC_KEY`,
`CODING_IDLE_TIMEOUT_MS` (= the Git workspace's idle window, default 14,400,000 ms), `CODING_LIFECYCLE_URL`,
`CODING_EGRESS_PROXY` (must be `http://ingress:3128`), `CODING_PUBLIC_ORIGIN`, `CODING_CONTROL_ORIGIN`,
`CODING_STORAGE_ROOT`, `CODING_AUTHORITY_GRACE_MS` (300000), `CODING_PREVIEW_PORTS` (default 3001, 4173, 5173, 8000, 8080; 3000 and 5432 always excluded), the
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
  memory, 10 GB free disk; the size class is capped to ¾ of the machine), then the operator pool, then Git-only.
- **Liveness:** commands need a check-in within 90 s; the runtime's own heartbeat does not depend on the agent, so a slow
  check-in never stops running work. A revoked machine's runtimes stop on their next heartbeat.
- **Revocation:** bumps the device generation; the next check-in gets a `terminate` order; the agent deletes every runtime
  and attests absence; then the machine is refused (410). Cleanup evidence on a person's own machine is labelled
  `device_attested`.
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
their exact original plan. `runtime: none` queues nothing. Recommendation: set `PLAYGROUND_DEFAULT_SIZE=medium` once a
medium runtime has passed a real build on the host, so small projects stop consuming 8 GiB plans.

## Lifecycle

```
requested → (waiting_resources) → creating → created → exposing → exposed → deploying → allocated
          → attaching → attached → [execute/read/cancel] → cleanup_requested → stopped → deleting → disposed
```

- **Who advances it:** an agent call (`github_playground_workspace` `provision`/`attach`/`resume`/`dispose`) or the
  **project manager** — a tiny compose (`ras-pg-manager-…`, 0.1 CPU / 128 MiB) created automatically by the first
  provision, which POSTs `/api/playground/sweep` every 30 s with its derived sweep key. Each sweep handles up to 50 rows
  in a ~20 s budget. The manager holds only a cleanup/re-check capability; it cannot bypass authorization or read volumes.
- **Create:** raw Dokploy compose with four services (`initialize`, `broker`, `coding`, `ingress`), four volumes
  (broker, files, git, execution) and private networks; the provider-assigned `appName` is read back and pinned; two
  HTTPS domains (`/` and `/v1/workspace`, `internalPath=/`, `stripPath=false`) go only to the gateway. Every transition is a
  Neon compare-and-set; a lost create is recovered from exact inventory, never by creating another stack.
- **Attach:** the controller seals the Git workspace's exact state and relays encrypted 256 KiB pages from the native worker
  to the allocation's broker over several sweeps (≤ 100 MiB raw, ≤ 100,000 files, no symlinks; larger repositories stay
  Git-only and report attachment unavailable). Routing switches only after generation, ancestry, uncommitted state and
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
  alone is never proof.

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

- **One Dokploy target.** All allocations live on one origin/project/environment; there is no server selection. Each
  allocation adds private networks, and the host's Docker address pool already ran out once (owner checklist item 3).
  `runtime: none` and smaller classes reduce pressure; the fleet design removes the per-allocation ingress entirely.
- **Startup is slow for small jobs:** per-allocation build (without `PLAYGROUND_IMAGE`), four services, new TLS
  certificate, multi-sweep attachment. Fixes are FLEET-2 (slim image, warm pool, ephemeral runs).
- **No resize:** change size by finishing work, disposing, and opening a new workspace with another class.
- **No verified backup** of runtime volumes exists; under the 2026-10-30 owner decision it is optional future work.

## Verification boundaries

Unit/transport tests, exact-head image CI, merged source, deployed matching worker/MCP revisions and authenticated
disposable acceptance are separate evidence. The multi-container image scenario covers Chromium private entry, secure
cookies, app/API/WebSocket traffic, anonymous denial, shared edits, read-only Git metadata, UID 1000, a daemonized child,
container termination and exact volume absence; its heartbeat-free fixture is not live revocation proof. Full
current-grant/browser/lifecycle acceptance on the real host is still required before PLAY-1 is complete. Earlier wording
of this page is in git history; incident notes are in `docs/status/2026-10-30-playground-*.md`.
