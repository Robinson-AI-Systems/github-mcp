# Runtime fleet — one Git + Playground system across many hosts (design, 2026-11-01)

**Status:** design requested by Chris on 2026-11-01 ("make use of more resources on different platforms when available —
Dokploy, my PC, other devices in my tailnet — and scale workspaces so small projects use small spaces and finish fast").
**Update 2026-11-01:** Chris approved the recommendations (dial-out agent, own machines first, medium default after a
real build, prebuilt image) and set the frame: the product works the same for **everyone who signs in**; his own PC,
Dokploy and tailnet are just resources he has. FLEET-1 (sizes) is merged; FLEET-3 (dial-out agent with placement) is
built in source ([card](../pr-cards/FLEET-3.md)); FLEET-2, 4–6 remain in `docs/ROADMAP.md`; nothing here overrides PLAY-1's operational record or
PLAY-2's fences. It changes no security rule: signed short-lived claims, no credentials in executable containers, tenant
isolation, uncertain-never-rerun receipts and exact-ownership cleanup all stay.

## 1. What exists today (checked against code, 2026-11-01)

| Piece | Where it runs | How work reaches it | Limits that matter for this design |
|---|---|---|---|
| Control plane (MCP) | Vercel functions + Neon | MCP / HTTPS | Short request/response functions; cron sweep every minute |
| Native Git worker | One Dokploy container (+ legacy Render host draining) | Control plane **calls in** over public HTTPS, Ed25519-signed, ≤90 s claims | One replica per volume; one primary origin plus one *previous* origin for drains; 2 CPU / 2 GiB shared by every workspace; no shell |
| Playground allocation (PLAY-1) | One Dokploy compose **per workspace**: initialize + broker + coding + ingress gateway, four volumes, own private network | Created by the control plane through the Dokploy API; control plane **calls in** via a generated sslip.io domain | Until this PR every allocation was planned at the protected 8 CPU / 8 GiB; every workspace open queued one, even for Git-only work; each one consumes a Dokploy private network (the host's address pool has already run out once); sealed source transfer ≤ 100 MiB, no symlinks; startup is minutes (build/pull, four services, attach) |
| Enrolled device (PLAY-2) | User's own PC/server | Pairing + signed probe/canary, control plane **calls in** to a pinned *public* HTTPS origin | Origin must resolve to public IPv4 (tailnet 100.64/10 and `.local`/`.internal` names are refused); at most 8 devices per connection; no device can be `ready` yet — no code path promotes beyond `pending_canary` |

Two structural facts drive almost every limit above:

1. **Every host must accept inbound HTTPS from Vercel.** That is why the PC needs a public tunnel, why tailnet devices are
   unusable, and why each Dokploy allocation needs its own ingress domain and gateway.
2. **One size and one shape for every job.** A lint run on a 2 MB repository and a Playwright suite on a monorepo both get
   the same four-service, 8 CPU / 8 GiB allocation, queued at clone time whether or not a command is ever run.

## 2. Target design

### 2.1 Host agent that dials out (FLEET-3) — the key change

Replace "control plane calls the host" with "the host's supervisor calls the control plane", the same model GitHub Actions
self-hosted runners and Buildkite agents use:

- A small **host agent** (the PLAY-2 device supervisor, generalised) runs on any machine: Chris's PC (WSL2/Docker), a
  tailnet box, a spare laptop, a VPS, or a Dokploy service. It needs **only outbound HTTPS** to
  `github.robinsonaisystems.com`. No tunnel, no public IP, no inbound port, no Funnel. A tailnet-only machine works
  because it can reach the internet, not because Vercel can reach the tailnet.
- The agent long-polls `POST /api/fleet/lease` (≤ 25 s per request — an ordinary short Vercel function, no WebSockets) with
  its device-key-signed heartbeat: free CPU/RAM/disk, image digest, cached repositories, current receipts. The control plane
  answers with zero or one **work lease**: an Ed25519-signed, ≤ 90 s, binding-pinned claim exactly like today's
  `/v1/coding` claim, plus a lease ID stored in Neon.
- The agent executes locally and **posts** status, hash-pinned log windows and the final receipt back
  (`POST /api/fleet/report`). Reads by agents (`github_playground_read`) are served from those reports in Neon/result
  handles, so a sleeping PC never blocks a read of a finished job.
- Revocation is a heartbeat answer ("terminate binding X, generation N") plus the existing local fail-closed lease expiry:
  a host that stops hearing from the control plane stops its work. `revocation_pending` stays until the agent reports
  signed absence evidence (unchanged PLAY-2 §E semantics).
- Git credentials never travel to the device's command container. For native Git on a device, the agent's privileged
  broker receives a just-in-time, repository-scoped installation token inside the signed lease (same as the Dokploy
  worker today), never written to disk/config, never visible to user code.

This removes PLAY-2's biggest live blocker (§H "tailnet-only machine is not reachable") and also removes the
per-allocation ingress domain/gateway on Dokploy for agent-mode hosts. PLAY-2 deferred a device-initiated relay because
"Vercel functions must not be assumed to host indefinite WebSockets"; long-poll does not need WebSockets — each request is
a normal bounded function call, and an idle fleet costs one small request per host per ~25 s. That cost must be measured
against the Vercel Pro function-invocation allowance before rollout (owner checklist item).

**Tailnet bonus (optional, FLEET-3b):** one enrolled agent may act as a *local coordinator* for other machines on the same
tailnet that the same user enrolled, so only one machine needs to poll. Never across users; each machine still has its own
key and enrollment.

### 2.2 One scheduler, many pools (FLEET-4)

A **placement** step runs after the current authorization check and picks a pool for each new runtime:

1. **The user's own enrolled hosts** (PC, tailnet devices) — free to the operator, preferred when online and big enough.
2. **Operator Dokploy pool** — one or more Dokploy servers/projects (today: the friend's server), best-effort.
3. **Repository CI fallback** — committed work only, explicit, never automatic (unchanged).
4. *(Future, needs owner economics decision)* hosted sandbox tier.

Inputs: requested size class, host free capacity from heartbeats, **data locality** (a host that already has this
repository's objects or this workspace's files wins), user preference order, and pool health. A pool that refuses
(pressure, offline, revoked) produces a `deferred`, `no_operation_started` receipt — never a silent move of a command that
may have started. A user's job never lands on another user's device; an operator pool host never receives a user's device
key. Placement is recorded on the allocation (`placement_kind=operator|enrolled`, host ID, generation) as PLAY-2 §A
already specifies.

### 2.3 Right-sized and warm runtimes (FLEET-1 built, FLEET-2 proposed)

**Built in this PR (FLEET-1):**

| Class | Whole-allocation ceiling | Good for |
|---|---|---|
| `small` | 2 CPU / 2 GiB | lint, type checks, unit tests of small projects (no browser) |
| `medium` | 4 CPU / 4 GiB | typical installs, builds and suites incl. a test database |
| `large` | 8 CPU / 8 GiB (original) | Playwright/Chromium, monorepos, heavy builds |

- `github_git_workspace_open` takes `runtime: auto | none | small | medium | large`; `github_playground_workspace`
  `provision` takes `size`. `none` opens a Git-only workspace and queues **no** allocation (saves a Dokploy network and
  minutes of provisioning for edit-and-push work). `auto` uses protected `PLAYGROUND_DEFAULT_SIZE` (unset = `large`, so
  existing behaviour is unchanged until the operator chooses).
- A class only **lowers** the protected ceilings and fresh headroom; it never raises them, reserves or buys anything. The
  class is stored on the allocation row and is immutable for that allocation (plan hash stability); legacy rows without a
  class keep their exact original plan.

**Proposed (FLEET-2):**

- **Slim image variant** (`coding-slim`: Node 24, npm, Python, Git, build tools — no PostgreSQL, no Chromium) for `small`,
  so pull/start is seconds instead of minutes. `medium`/`large` keep the full image. Both pinned by digest.
- **Collapsed shape for small jobs:** one container (executor) + the host agent's broker, instead of four services and a
  private network per workspace. On agent-mode hosts the per-allocation ingress gateway disappears (no inbound traffic).
- **Warm pool:** each host keeps N pre-started, unbound slim containers (N from heartbeat headroom, default 1). Binding a
  warm container to a workspace is a signed bind, then it is single-use and destroyed after — never reused across
  workspaces or tenants.
- **Ephemeral run mode** for "run this command at this commit": clone/reference-copy at an exact SHA (plus the small dirty
  diff when present), run, return receipts, destroy. No long-lived allocation. Uses the same execute/read/cancel tools.
- **Upsize on pressure, honestly:** an out-of-memory or pressure refusal returns a suggestion to re-run with the next class;
  a command that may have started is never re-run automatically.

### 2.4 Caches that make small jobs fast (FLEET-5)

Per host, per tenant (never shared across tenants):

- **Git object cache** — a bare mirror per repository used with `--reference`/alternates, so a repeat clone is seconds.
- **Dependency cache** — npm/pip caches keyed by lockfile hash, mounted read-only into the executor with a writable overlay.
- **Locality hint** in heartbeats so the scheduler prefers the warm host.
Caches are disposable data, counted against the host's disk, and wiped on tenant revocation.

### 2.5 Native Git worker scale-out (FLEET-6)

Today: one primary origin + one previous origin, one volume. Generalise the existing per-workspace origin pin (already a
hash of the worker origin stored on the job) from "current/previous" to a **set** of protected worker origins
(`NATIVE_GIT_WORKERS`, each with its own pinned public key and weight). New workspaces pick a worker by free capacity;
existing workspaces stay pinned to theirs; drain/retire stays per-origin. Enrolled agent hosts can also hold native Git
workspaces for their own tenant, which removes the 100 MiB sealed-transfer step for those jobs (git and runtime share one
machine — PLAY-2 §F "device-native direct clone").

## 3. Order of work

| Card | Outcome | Depends on | Owner input |
|---|---|---|---|
| FLEET-1 | Size classes + Git-only open | — | Optional: set `PLAYGROUND_DEFAULT_SIZE` (recommend `medium`) |
| FLEET-2 | Slim image, collapsed small shape, warm pool, ephemeral runs | FLEET-1 | None |
| FLEET-3 | Outbound host agent (lease/report endpoints, heartbeat revocation), PC first | PLAY-2 pairing (merged) | Approve outbound-agent model; confirm Vercel invocation budget |
| FLEET-4 | Scheduler across enrolled hosts + Dokploy pool(s), locality | FLEET-3 | Pool preference order |
| FLEET-5 | Per-host Git object + dependency caches | FLEET-3 | None |
| FLEET-6 | Multiple native Git workers, device-native Git | FLEET-3 | Any extra Dokploy server/project |

Each is a whole outcome with its own tests, exact-head CI and later live acceptance. FLEET-3 supersedes PLAY-2 §C's
"user-owned public tunnel" as the *first* transport only after Chris approves; until then the tunnel path in PLAY-2 stays
the recorded plan.

## 4. Risks and how the design keeps them closed

- **Polling cost and latency:** long-poll ≤ 25 s per host; work starts within ~1 s of being queued when a host is polling.
  Measure invocations/day before enabling more than a handful of hosts.
- **Stolen device key:** a key can only lease work for its own tenant/enrollment generation; revocation bumps the
  generation and every outstanding lease dies within 90 s.
- **Malicious host owner:** unchanged PLAY-2 disclosure — a user's own machine runs only that user's work; device-attested
  cleanup is labelled as such.
- **Smaller classes failing large builds:** default stays `large` until the operator opts in; agents get a clear upsize hint.
