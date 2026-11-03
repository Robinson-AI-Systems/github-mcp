# WORKER-POOL-1 — Native Git worker pool: use the other machines when the main PC is busy

## Owner request 2026-11-03 (Chris, relayed by his assistant Vivienne)

"He wants the system to use his available machines automatically when his main PC gets busy." Baseline: every execution
site (Chris's PC as primary, the Dokploy worker, later the Workshop machine, Caleb's PC once enrolled) is a host with its
own worker behind the same control plane; a workspace and its runtime are placed together and pinned for life (no live
migration); hosts advertise online/paused, active leases, free resources and a limit; preferred host first, spill when it
is busy, paused or offline; all busy → queue or a plain "busy, try again" with `no_operation_started`; an off host is
unavailable until it checks in; the owner's own use always wins; never silently rerun uncertain work; no change to the
tools agents call.

## Outcome and acceptance

Outcome: new native Git workspaces (from `github_git_workspace_open`, `github_repo_download`, `github_repo_change` and
`github_playground_run`) are placed on the first available host of a configured pool and stay there, every per-workspace
call and transfer routes to that host, and `github_server_status` shows each host's state. Accepted when the tests below
pass, the existing native-git, transfer, git-remote, git-direct, playground-run, repo-change and server-status suites pass
unchanged except the one contract noted below, and `ci` + `release-policy` are green at the exact head; live acceptance
follows a release with a second host configured.

## Design (and why)

**One PR**: registry, live status, placement in every opener, routing, worker capacity fields and visibility are one
usable outcome; placement without routing (or routing without placement) would strand workspaces.

- **Registry** (`src/native-git/pool-config.js`): hosts from protected settings only — `NATIVE_GIT_WORKER_URL` (primary,
  priority 10), `NATIVE_GIT_PREVIOUS_WORKER_URL` (previous, priority 90, now also eligible for new work) and the optional
  JSON list `NATIVE_GIT_WORKER_POOL` (`name`, `origin`, `priority` 0–1000 lower first, `maxWorkspaces`, `enabled`; an entry
  for the primary's or previous host's origin only renames or adjusts it; invalid entries skipped and reported; at most
  16). Host id = the existing 32-hex origin hash, so every workspace already stored keeps routing. **Why env-only
  addresses:** a host receives signed leases and short-lived GitHub credentials, so a database row must never be able to
  add one. The stored setting `native_git.worker_pool` (root `server_settings`) only disables a host or changes its
  priority or limit (`applyPoolSetting`); no edit surface yet (ROADMAP).
- **Live status** (`src/native-git/pool.js`): each host's signed `capabilities` (8 s probe timeout). Cached per server
  configuration: an available answer for 20 s, an unreachable host as unavailable for 20 s (an off machine does not slow
  every open); paused, busy and full answers are never reused, so a resumed host takes work at once. `noteOpened` counts
  an open into the cached answer; `forgetHost` drops it after a definite refusal. States: available, paused, busy (with
  the admission reason), full, update_required, unavailable, disabled, draining (primary `NATIVE_GIT_WORKER_DRAINING`).
- **Worker capacity** (`workers/native-git/server.js`, `engine.js`): capabilities add `active_workspaces` (opening or
  ready, lease not expired, any tenant) and `max_workspaces` (`NATIVE_GIT_MAX_WORKSPACES`, null = resources only); an
  `open` over the limit answers 429 `workspace_limit` with `no_operation_started` before anything starts. The smaller of
  the worker's and the pool entry's limit applies. `deploy/pc` passes the optional setting through.
- **Placement** (`placeWorkspace`): priority order, first host enabled + answering + not owner-paused + admitting +
  under its limit. Used by the preflight (`admitClone`, the run's `read`) and again at the clone (`openWorkspace`,
  `startRun`), which records the host id in the job as before. A definite refusal at the clone (no operation started) is
  skipped for the next host with a new job record; an uncertain answer is never retried elsewhere. None available → plain
  retryable refusal: "All workspace hosts are busy or paused; try again in a minute. No operation was started (nothing
  was cloned). Hosts: pc paused, …" (`native_hosts_busy` from the preflight; `not_applied`/`no_operation_started` from the
  clone step; a one-host pool keeps the earlier `native_resource_pressure` code; all hosts outdated → the earlier
  update message). A queue was not built (ROADMAP).
- **Routing**: `nativeWorkerRoute` resolves a stored host id against every configured host. Relay routes `w` and `p` are
  unchanged; any other host is `h.<host id>` (`routeFor`/`resolveRoute`), resolved only from protected settings, with the
  existing HMAC tag binding the destination origin. Git remote: setup places the key on the first available host that
  serves `git_remote` and records it in the key index (`git_remote.<id>`, field `host`); `openKeyScope` → authorize →
  edge forward to that host (older keys: the primary; a removed host: plain 503). The direct git host stays the primary's:
  a key placed elsewhere gets this service's domain and a note, and setup never configures another host's direct origin.
- **Runtime attachment**: attach, release and dispose already use the workspace's stored job (with its host); the
  dedicated broker is reached by its own origin. No code assumed a single worker host beyond `nativeWorkerRoute`.
- **Visibility**: `github_server_status` health adds `worker_pool` (only with two or more hosts, or an invalid pool
  setting): `ok` with the number available, `down` when none takes new work, `degraded` when part of the setting is
  invalid; each host by name with state, reason and counts, never an address.

## Changed contract

`tests/unit/native-git-service.test.js` "records admission refusal after metadata creation…": a worker that refuses at
the clone after the preflight passed now yields `not_applied` / `no_operation_started` (retryable, request key released)
instead of `rejected`; the same-intent retry still succeeds. This is the owner's requested answer.

## Tests

`tests/unit/worker-pool.test.js` (real signed worker hosts on real local Git, fake GitHub validated against the schema):
registry parsing, ordering, invalid entries, stored-setting limits (cannot add an address), pinned routing and refusal of
an unknown host; host judging; placement — preferred host, spill when paused (and back at once after resume), over the
worker-reported or registry limit, failing admission, unreachable; refusal at the clone skipped for the next host;
all busy through every door (plain retryable refusal, nothing cloned, no job, same intent works after a resume); a
disabled host; pinning — workspaces on two hosts keep reads and runs on their own host, and a paused host's workspace is
not moved; a one-time download from a pool host through the `h.<id>` relay route; relay `w`/`p` kept, a tag cannot be
moved to another route, unknown id refused; capabilities caching; server status by name only; playground run and repo
change spill; worker `active_workspaces`/`max_workspaces` and the `workspace_limit` refusal; git remote edge forwarding
per key host; git remote setup on the next host with no direct host; the nine write-contract checks for
`github_git_workspace_open`, `github_repo_download` and `github_playground_run` through every door with the primary paused.

## Not covered here

Live hosts (no second worker is configured yet), the owner edit surface for the stored setting, a queue, Wake-on-LAN and
enrolling other people's machines (ROADMAP).

## Drift check

Builds on PC-WORKER-1 (owner pause, `owner_paused` capability, PC as primary with Dokploy as previous), SINGLE-DOMAIN-1
(relay routes and HMAC tags), GIT-REMOTE-1/GIT-DIRECT-1/-2 (key index, edge, direct host pinning), FLEET-1..7 vocabulary
(own machines first, placement recorded once). New: `src/native-git/pool-config.js`, `src/native-git/pool.js`, settings
`NATIVE_GIT_WORKER_POOL` (control plane) and `NATIVE_GIT_MAX_WORKSPACES` (worker), stored setting
`native_git.worker_pool`, capability fields `active_workspaces`/`max_workspaces`, admission reason `workspace_limit`,
relay route `h.<host id>`, key-index field `host`, status section `health.worker_pool`, reason code `native_hosts_busy`.
No database migration, no tool schema change, no protocol version change.
