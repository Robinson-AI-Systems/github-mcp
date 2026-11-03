# DECISIONS — current decisions

One line per decision that still governs work. Full reasoning, superseded decisions and the original dated entries (63 of them,
2026-10-12 to 2026-10-28) are in [archive/DECISIONS-2026-10-30-history.md](archive/DECISIONS-2026-10-30-history.md), unchanged.
Add a new decision as a row here with a link to its status note or card; put long reasoning in the note, not here.
Where the archive disagrees with this table or [OWNER-DECISION-2026-10-27.md](OWNER-DECISION-2026-10-27.md), the table and that document win.

| Decision | Date | Reason (one line) | Detail |
|---|---|---|---|
| Keep VER-1 `server_release` permanently and add `github_server_status` (release, deploy time, recent live changes, worker versions, health) to the default compact list; room is made by trimming listing text, not raising the 6,000-token budget | 2026-11-02 | Chris: "Keep this feature permanently and expand it with a dedicated github_server_status tool that reports build version, deployment timestamp, recent release notes, worker versions, and health checks in one compact response." | [SRV-STATUS-1](pr-cards/SRV-STATUS-1.md) |
| The worker serves the git remote directly on its own domain (`GIT_DIRECT_ORIGIN`), authorized per request by the control plane (worker-signed, key id + hash only); per-push limit is the stored setting `git_remote.push_limit`, default 2 GiB (GitHub's limit); pushes over GitHub's limit go on in parts and land atomically; files over 100 MiB are refused with a Git LFS explanation (no LFS, no spend) | 2026-11-02 | Chris, 18:24 MST: "Build it and beat GitHub's push." | [GIT-DIRECT-1](pr-cards/GIT-DIRECT-1.md) |
| The service's own domain is a plain git remote (`/git/<owner>/<repo>.git`) with per-repository session keys: hash-only, read or write, 8 h default / 24 h max (stored setting `git_remote.lifetime`), revocable, every use logged; pushes reuse the native guarded push | 2026-11-02 | Chris, 16:51 MST: "Build option 2" | [GIT-REMOTE-1](pr-cards/GIT-REMOTE-1.md) |
| Conflicts and Git refusals in native workspaces are definite outcomes (conflict = applied with outcome conflict; refusal = rejected), never unconfirmed | 2026-11-02 | Owner's agent: these are final facts with a plain next step | [NATIVE-ERGO-1](pr-cards/NATIVE-ERGO-1.md) |
| One-time transfers use this service's own domain via Routing Middleware; compact listing budget is 6,000 tokens | 2026-11-02 | Owner: sandboxes should need one allowed domain; transfer tools belong in the default list | [SINGLE-DOMAIN-1](pr-cards/SINGLE-DOMAIN-1.md) |
| Backups and restore are optional future work, not a production gate | 2026-10-30 | Owner deferred them; data-preservation and cleanup safeguards stay binding | [note](status/2026-10-30-playground-provider-identity.md) |
| Playground may run in protected best-effort resource mode without verified quotas | 2026-10-30 | Owner allows production use before resource monitoring exists; allocation/identity/grant/attachment checks and network readback still required | [note](status/2026-10-30-playground-best-effort.md) |
| Execution fails closed on unverified converted Compose networks; public ingress goes through a separate gateway | 2026-10-30 | Provider adds shared networks to the executor; intended plan alone is not proof | [note](status/2026-10-30-playground-network-readback.md) |
| Provider-assigned names are read back, persisted and required for every mutation; lost creates recover by exact-name inventory | 2026-10-30 | Dokploy appends suffixes to appName | [note](status/2026-10-30-playground-provider-identity.md) |
| Coding workspaces target 8 vCPU / 8 GiB / 150 GB in isolated per-workspace environments (PAR-2 / PLAY-1) | 2026-10-29 | Owner-approved full coding workspace expansion | [PLAY-1](pr-cards/PLAY-1.md), [record](status/2026-10-29-coding-workspace-expansion.md) |
| No daily job quotas; native capacity is admitted by measured memory, storage and responsiveness | 2026-10-29 | Fixed counts were arbitrary limits | [note](status/2026-10-29-native-resource-admission.md) |
| Full owner writes disclose, execute, journal and verify in one call; only explicit delegated restrictions apply | 2026-10-28 | Product-user authority; no product-made approval or permission ceilings | [OWNER-DECISION](OWNER-DECISION-2026-10-27.md), [plan](designs/AUTHORITY-PARITY-2026-10-28.md) |
| Sequential write batching (`github_write_batch`) is composition, not new authority | 2026-10-27 | Delegates to ordinary guarded writers; read-only `github_batch` unchanged | archive: C-16 entries |
| Large JSON fields are carried once and never silently dropped; compact responses are defaults, not capability vetoes | 2026-10-27 | Agents need complete data | archive: 2026-10-27 entries |
| CI: 30-second soft target; passing slow tests never fail the run | 2026-10-27 | Fast feedback without false failures | [CI-FAST-1](pr-cards/CI-FAST-1.md) |
| Speed is built into the MCP (fast first view, whole-workflow critical path, one guarded writer) | 2026-10-26 | Do not depend on each agent's sophistication | [C-6](pr-cards/C-6.md) |
| Explicit, confirmed rule overrides are decided by GitHub, not refused by us; first-time fork CI approval belongs to the authorized owner | 2026-10-26 | Best-effort rule discovery is explanatory only | archive: 2026-10-26 entries |
| Outside contributor PRs are maintainer-owned; signed download redirect URLs are never model-visible | 2026-10-26 | Bearer-leak and adoption policy | archive: 2026-10-26 entries |
| Public free launch from Chris's website; no directory listing, no people cap | 2026-10-24 | Free for now; monetize later | [ROADMAP](ROADMAP.md) |
| God mode: one optional master token; "act as me"; owners/admins may override branch rules on purpose (`overrideRules` + reason) | 2026-10-24 | Owner design | archive: 2026-10-23/24 entries, [GOD-5](pr-cards/GOD-5.md) |
| The product does not control what users spend; honest cost notice and confirmation remain | 2026-10-24 | Users own their spend | archive: 2026-10-24 entries |
| Checks that need a paid upgrade are recorded unverified/dropped, never blockers | 2026-10-24 | Owner will not buy plans for tests | archive: 2026-10-24 entries |
| Public sign-in: changes on by default (read-only optional); per-person time zone (UTC default); people can delete their own data | 2026-10-23 | Owner decisions | archive: 2026-10-23 entries, [PUB-6](pr-cards/PUB-6.md) |
| Sign-in is GitHub once, one Approve page, no cookies, "My connection" page | 2026-10-23 | Prior flow broke repeatedly | archive: sign-in rebuild entry |
| The Hub owns discovery/connection to this product; Hub routes are not this product's completion gate | 2026-10-23 | Standalone completion | archive: 2026-10-19 entry |
| CAP-6 gated families: runner, larger-runner, merge-queue and Copilot tools are offered only where GitHub shows the feature; their spending tools are `strictSpend` (always ask, owner included; an unworkable cost refuses; a metered cost GitHub does not publish is shown as COST UNKNOWN) | 2026-11-01 | Owner approval of gated expansion item 9 ("shows the price and needs confirmation") | [CAP-6](pr-cards/CAP-6.md) |
| Real-device checks live in OWNER-CHECKLIST and never block development or merges | 2026-10-22 | Owner request | [OWNER-CHECKLIST](OWNER-CHECKLIST.md) |
| Instructions stay short (AGENTS.md simplified); per-PR status goes in `docs/status/` notes | 2026-10-22 | Long ledger caused merge conflicts and drag | [status README](status/README.md) |
| Maximum legitimate GitHub authority plan (CAP-1..CAP-5) approved | 2026-10-21 | Owner-requested capability expansion | [MAXIMUM-AUTHORITY](designs/MAXIMUM-AUTHORITY.md) |
| End-user authority supersedes developer-restriction readings; paid features are priced/confirmed, not refused | 2026-10-16 | Product user's agent must be able to act | [END-USER-AUTHORITY](END-USER-AUTHORITY.md) |

## 2026-10-30 — Production is the default sign-in mode

Chris: the sign-in must not refuse Production mode, and Production should be the default. Implemented for normal sign-in connections on the production deployment: the page offers Production first and selected, and the old per-account `production_enabled` switch no longer vetoes them (`src/oauth/policy.js`, `src/tenancy/github-consent.js`, `mcp-route.js`, `optional-setup.js`, `src/tools/production-guard.js`). Preview deployments still offer Preview only. Delegated passes (`rtc` and scratch) keep the issuer's restriction. Home page: Claude can add a connector from the phone app; ChatGPT must be added in the phone's browser first, then used in the app.

## 2026-11-01 — Runtime fleet (Chris: "Yes to all your recommendations")

- **Dial-out host agent approved.** Any person can add computers or servers they own or administer (PC, laptop, VPS, home
  server, a Dokploy or other Docker host, tailnet machines) as Playground hosts for **their own** connection. The agent only
  makes outbound HTTPS check-ins; no tunnel, no inbound port. Each person's machines run only that person's work.
- **Placement order:** the person's own ready machines first, then the operator's shared pool (today one Dokploy server),
  then Git-only. Chris's PC, his Dokploy access and his tailnet are simply resources he has, not the design target: the
  product must work the same for every person who signs in.
- **Default size:** `medium` is the built-in default since 2026-11-01 (code default, so every deployment gets it), after a live medium runtime ran the full unit suite on the operator pool. `PLAYGROUND_DEFAULT_SIZE` still overrides it.
- **Prebuilt runtime image:** approved to publish the runtime image and pin `PLAYGROUND_IMAGE` to its digest.
- **The two audit problems** (heartbeat outages, large clones) approved and fixed (PR #503).


## 2026-11-01 — Gated expansion approved (items 1–9)

Chris approved building all nine previously unapproved items, each used only when its own coded gate says so
("self aware on when to actually use the things that are built"). Item 5 (single-container runtime) is not built:
it removes executed-code/Git-broker isolation and no demand level justifies that. Design:
[GATED-EXPANSION](designs/GATED-EXPANSION-2026-11-01.md); cards FLEET-2, FLEET-7, PUB-7, PUB-8, PUB-9, CAP-6.

## 2026-11-02 — PG-STUCK-1: stuck Playground runtimes are replaced; only real work extends a workspace lease

Found live: five Appliance Desk runtimes created 2026-10-30/31 sat in `deploying`/`allocated`/`attaching` for two days
(two with Dokploy `composeStatus: error`), the sweep retried them every 30 s forever, and the owner's agent kept them
alive. Decisions: (1) a shared-pool runtime with a provider `error`, or no provisioning/attachment progress for a stored
operator threshold (`PLAYGROUND_STUCK_AFTER_MINUTES`, default 45 minutes: every healthy step finishes in minutes), is
removed and replaced on the next provision/attach/run; the native workspace is kept; after 3 failed starts in a row it is
reported, not retried. This is a service resource threshold, not an owner spending or policy limit. (2) Workspace idle
leases are extended only by real work: Git operations, Git reads (log/diff/refs/files), uploads, downloads and Playground
commands/status/logs. A status inspect (`github_git_workspace_read` status, open/download replays, run progress checks,
write preflights and readbacks) and refused/rejected calls are not activity, so an agent that keeps checking or retrying
a broken workspace no longer keeps it alive. Cost: a person who only checks status for four hours lets an idle workspace
expire, which is the intended meaning of "idle". (3) A `github_git_workspace_close` that could not be confirmed is
finished by the same call with the same requestKey (each step is idempotent) instead of requiring a new key.

## 2026-11-01 — PUB-7: approved live policies stay in effect; the lawyer review is an owner row

The PUB-7 card asked for "draft" legal pages labelled for Chris and a lawyer. On `main` the privacy, terms, security and
support pages were already approved by Chris on 2026-10-25 (`docs/legal/OWNER-REVIEW.md`) and live with `LEGAL_APPROVED=yes`.
Relabelling them "not in effect" in production would withdraw a live, approved privacy notice, so they keep their approved
text there; anywhere `LEGAL_APPROVED` is not `yes` they say "DRAFT — not yet reviewed by a lawyer; not in effect." The lawyer
review is the owner checklist row "Review draft legal pages with a lawyer before public opening", which the readiness gate
reads. The new `/status` page has its own approval (`STATUS_PAGE_APPROVED=yes`), because the 2026-10-25 approval did not cover it.

## 2026-11-01 — Direct uploads into native workspaces (GIT-UPLOAD-1)

Chris, 2026-11-01 21:02 MDT: "Build 1 and 2 together now" — both the temporary "push here" Git address and the one-time
folder upload link, on one mechanism. Bulk bytes go from the agent straight to the native Git worker (never through
Vercel's ~4.5 MB function body limit, never with a GitHub credential). The address carries a control-plane-signed,
purpose-separated (`robinson-native-upload/v1`), single-use, ten-minute capability bound to one upload of one workspace
that grants only quarantine writes; an authenticated apply checks and applies it (fast-forward only for Git; safe
names/types/sizes for archives; content protection on every new byte). The URL is returned once, like Playground's
one-time preview entry, and is not stored in the change log. Design: [GIT-UPLOAD-1](pr-cards/GIT-UPLOAD-1.md).

## 2026-11-01 — Direct downloads from native workspaces (GIT-DOWNLOAD-1)

Chris asked on 2026-11-01 to "finish the remaining work" after an outside agent reported it had to pull 100+ files one at
a time ("A 'fetch this ref as a tarball straight to disk' tool … would close that gap"). Built as the mirror of
GIT-UPLOAD-1 on the same mechanism: an authenticated begin snapshots the workspace on the native Git worker, and the
control plane signs a purpose-separated (`robinson-native-download/v1`), ten-minute, one-session capability for it that
grants only a read-only `git clone`/`git fetch` (advertised refs only) or one `.tar.gz` download (a ref, or the current
worktree without `.git`). No GitHub credential; the URL is returned once and not stored in the change log. Outgoing
bytes are the person's own workspace content, so they are not secret-scanned. Design: [GIT-DOWNLOAD-1](pr-cards/GIT-DOWNLOAD-1.md).

2026-11-03 04:27 MST (PC-WORKER-1) — Chris: "Use my PC … treat the PC as the primary route, not the fallback. Build for
the PC." and "my own use of this PC always wins instantly, so anything running on it must be pausable/killable and
resumable, never defended." Dokploy's Traefik cuts uploads at 60 s and its admin will not raise it. So the native Git
worker runs on the PC (WSL2 Docker, low priority, localhost ports, Tailscale Funnel on the PC's own node, no router
change) as the primary worker; Dokploy stays the previous worker. The owner pause is a file on the worker volume that
refuses new work with `no_operation_started`; admitted work finishes; kill is always allowed. Runbook:
[PC-WORKER](PC-WORKER.md).

2026-11-03 (WORKER-POOL-1) — Chris, relayed by Vivienne: "He wants the system to use his available machines automatically
when his main PC gets busy." Each machine runs its own native Git worker behind the one control plane. New workspaces go
to the preferred host while it has headroom and spill to the next when it is paused, short of resources, at its limit
or offline; when none can take work the open is refused plainly ("busy or paused; try again in a minute",
`no_operation_started`); a queue is not built (ROADMAP). A workspace and its runtime are pinned to their host for life,
no live migration, and uncertain work is never re-run elsewhere. Host addresses come only from protected configuration
(`NATIVE_GIT_WORKER_URL`, `NATIVE_GIT_PREVIOUS_WORKER_URL`, `NATIVE_GIT_WORKER_POOL`) because hosts receive signed
leases and short-lived GitHub credentials; the stored `native_git.worker_pool` setting may only disable a host or
change its priority or limit. The previous host is now eligible for new work (lowest default priority). The direct git
host stays the primary's; a git remote key placed elsewhere uses this service's domain. Agent-facing tools unchanged.
Runbook: [NATIVE-GIT-OPERATIONS](NATIVE-GIT-OPERATIONS.md) "Worker pool".
