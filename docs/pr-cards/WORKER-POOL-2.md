# WORKER-POOL-2 — Owner-only pool hosts: only Chris's own work on his PC

## Owner decision 2026-11-03 (Chris, in chat)

"Only my work on my PC." Other people's native Git workspaces must never be placed on his home PC; they go to the
operator's Dokploy worker. His PC serves only his own connections.

## Outcome and acceptance

Outcome: every pool host has an audience (`owner` = only the service owner's own connections, `shared` = anyone), and
nothing a person other than the owner does can start work on, be handed the address of, or be told the state of an
owner-only host; the owner keeps the PC first with spill to Dokploy. Accepted when
`tests/unit/worker-pool-owner-hosts.test.js` passes, the existing worker-pool, native-git, transfer-relay, git-remote,
git-direct, server-status, repo-change and pc-worker suites pass (the worker-pool suite now runs as the owner), and `ci` +
`release-policy` are green at the exact head; live acceptance follows a release.

## The rule (and why this shape)

- **Audience** comes only from protected configuration: an optional `"audience": "owner" | "shared"` field on a
  `NATIVE_GIT_WORKER_POOL` entry (an entry for the primary's or previous host's origin sets theirs). The stored setting
  `native_git.worker_pool` cannot change it (a database row must never open the PC to everyone).
- **Default, safe today with no new setting:** the primary host (`NATIVE_GIT_WORKER_URL`, the PC) is `owner` whenever any
  other configured host is `shared`; every other host is `shared`. A one-host pool stays `shared` unless it says
  `"audience": "owner"` (otherwise nobody else could use native Git at all). With today's settings (PC primary, Dokploy
  previous) the PC is owner-only and Dokploy shared.
- Why a JSON field and not a new `NATIVE_GIT_OWNER_ONLY_HOSTS` list: the pool already lives in one protected JSON
  setting with per-host fields; one more field is the smallest change, and the default covers the current setup.
- **Who is the owner:** `ownerCaller(ctx)` = the operator's direct full connector (`operator: true`, set only by the
  operator's own database route, PUB-8) and no tenant scope. Not the owner: public-connect and private-tenant people
  (`gh_t_<id>` schemas), Marketplace connections, service passes (even ones Chris issued), RTC/HTTPS door calls and
  background maintenance contexts. Those are all `shared` callers. Git remote keys: a key in the root database
  (`scope.legacy`) is the owner's; a tenant key is not.

## What follows the rule

- **Placement** (`placeWorkspace`: workspace open, `github_repo_download`, `github_repo_change`, `github_playground_run`,
  `github_git_remote_setup`): owner-only hosts are filtered out for a non-owner before any probe; they are not asked and
  not named in the refusal. No shared host available → the existing plain retryable refusal (`native_hosts_busy`,
  `no_operation_started`). Never a fallback to the PC.
- **Unpinned worker calls** (`callNativeWorker` with no stored host: the `github_git_workspace_read` capabilities probe,
  `github_server_status`'s worker check): `routeJobFor` sends a non-owner to the first enabled host they may use (or
  refuses with `no_operation_started`), so the PC's signed capabilities (which include its direct-host address) never
  reach a non-owner.
- **Pinned calls** (a workspace's stored host, an older workspace's creation time, a dedicated broker), transfer relay
  routes (`w`/`p`/`h.<id>`, produced only from a workspace's stored host) and git remote keys keep their host so nothing
  breaks. A non-owner request served on an owner-only host this way is counted (`strayCount()`) and logged
  (`[worker-pool] non-owner request served on owner-only host`, host name only). With placement filtered, new ones cannot
  arise.
- **Git remote:** a person's key is placed on Dokploy, so `remote_url` is this service's domain; the direct origin
  (`GIT_DIRECT_ORIGIN`, the PC's) and the "primary worker is not taking new work" note are never given to them.
- **Direct git host authorization** (`op=authorize`): the direct host is the primary's, so a key whose recorded host is
  another host is refused there (`other_host`, nothing served) — a person who learned the PC's address cannot use it. A
  person's key made before this change (no recorded host, mirror on the primary) keeps working and is counted.
- **`github_server_status`:** each pool host shows `audience`. A non-owner sees an owner-only host as
  `{ name, audience: "owner", state: "owner_only" }` (not asked, no counts), the `direct_git` check is left out for them
  when the primary is owner-only, and `workers.native_git` comes from their own first host. Addresses were never shown and
  still are not.

## Tests

`tests/unit/worker-pool-owner-hosts.test.js` (real signed worker hosts on real local Git, fake GitHub): audience
defaults, explicit and invalid audience, stored setting cannot change it, `ownerCaller` for operator / public / tenant /
pass / background; `routeJobFor`; a person's open through every door and `github_repo_download` land on Dokploy with zero
requests to the PC; the owner on the PC first, spilling to Dokploy when paused; shared host offline or paused → plain
retryable refusal for the person (the PC not asked, not named), the owner still on the PC, the same intent works after
resume; capabilities probe for a person from Dokploy; a pinned PC workspace read by a non-owner is served and counted, the
owner's own reads are not; git remote setup for a person returns this service's domain with no PC address; the owner's
setup still uses the PC; a person's pre-existing PC key keeps working through the domain door and is counted; the direct
host refuses a key from another host; status redaction for a person and live PC state for the owner.

## Not covered here

Live acceptance (needs a release; then a public-connect account's `github_git_workspace_open` should land on Dokploy and
`github_server_status` should show `pc` as `owner_only`). An owner edit surface for audiences (protected setting only, by
design). Per-repository or per-person audiences.

## Drift check

Builds on WORKER-POOL-1 (pool, placement, routing, key host), PUB-8 (`operator` mark), GIT-DIRECT-1/-2 (direct host is
the primary's). New: pool entry field `audience`, host field `audience`, `ownerCaller`/`hostAllowed`/`routeJobFor`/
`strayCount` in the new control-plane-only `src/native-git/pool-audience.js` (kept out of `pool-config.js`, which the worker images copy), pool status state `owner_only`, direct authorize refusal reason
`other_host`. No database migration, no tool schema change, no protocol version change.
