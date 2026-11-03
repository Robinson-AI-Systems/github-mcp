# PUSH-EXIT-1 — A replaceable push exit near GitHub: big plain git pushes land fast

## Owner direction 2026-11-03 (in chat, relayed by the session that launched this card)

"Make big git pushes from an agent sandbox to GitHub fast" (targets: 150 MB on GitHub in under ~90 s, ~1 GB in under
~10 min), using the Dokploy worker as a **replaceable** "push exit" near GitHub: one configured origin or host, swappable
later for another near-GitHub exit without redesign. All existing protections stay; owner-only PC routing
(WORKER-POOL-2) is unchanged for workspaces; the push exit is a shared operator host anyone may use.

## Outcome and acceptance

Outcome: with `GIT_DIRECT_HOST` naming the Dokploy pool host and `GIT_DIRECT_ORIGIN` its push-exit address, every
`github_git_remote_setup` caller allowed on that host (the owner and everyone else) gets a key on that host and a
`remote_url` on the push exit; plain `git push` streams through Traefik's TCP passthrough to a Caddy front door and the
worker's direct git port with no 60 s cut, then on to GitHub with every existing rail. Accepted when
`tests/unit/push-exit.test.js` and the existing git-remote, git-direct, git-direct-configure, worker-pool,
worker-pool-owner-hosts and server-status suites pass and `ci` + `release-policy` are green at the exact head; the live
40 MB / 150 MB / ~1 GB timings follow the release and the Dokploy redeploy.

## Measured before building (2026-11-03, from this agent sandbox)

| Path | Result |
|---|---|
| Sandbox → Cloudflare upload sink | 30 MB in 2.8 s (10.7 MB/s): the sandbox itself is not the limit |
| PC route (Tailscale Funnel → PC → github.com) | 150 MB in 444–612 s; onward PC → GitHub ~0.4 MB/s (owner's measurements) |
| Dokploy HTTP route (Traefik HTTP router, control) | a 97 s upload was cut at 61 s (Traefik entry-point `readTimeout`, 60 s) |
| Dokploy **TCP route** (Traefik `HostSNI`, TLS terminated by Traefik, PROXY v2) | a 97 s upload and a 100 s download both completed intact |
| Dokploy TCP passthrough → **Caddy** (TLS-ALPN-01 certificate, PROXY v2) → sink, the shipped Caddyfile | 95 s download and 97 s chunked upload intact; 150 MB upload in 74.9 s (2.0 MB/s, HTTP/2) |
| Sandbox → Dokploy, 150 MB single stream | 69 s (2.2 MB/s) |
| Sandbox → Dokploy, 4 × 30 MB in parallel | 52 s for 120 MB (2.3 MB/s total): parallel streams do not add up, so ~2.2 MB/s is the Dokploy server's inbound link |

The earlier "~1.2 MB/s" sample was an artifact: an unauthenticated receive-pack answers 401 after reading 1 MB.

## Choice: approach A (Traefik TCP passthrough + Caddy), and why

- **Proof for A.** Traefik clears a connection's read deadline once a TCP router has peeked the TLS ClientHello, so
  the entry-point `readTimeout` (which this account cannot change) does not apply to TCP routes. Proven live with the
  control above (HTTP route cut at 61 s; TCP route intact at 97–100 s).
- **Why Caddy, not Traefik's own TLS on the TCP router.** Traefik terminates TLS on TCP routers with ALPN `h2` offered,
  and the agent proxy then speaks HTTP/2 to a backend that only speaks HTTP/1.1 (`curl: Remote peer returned unexpected
  data while we expected SETTINGS frame`). TLS options cannot be declared with Docker labels on this Traefik (the
  router was dropped when it referenced one). Passthrough to Caddy fixes both: Caddy speaks HTTP/1.1 and HTTP/2 to
  clients and HTTP/1.1 to the worker, gets its certificate by TLS-ALPN-01 through the same passthrough (port 80 belongs
  to Traefik, so no HTTP challenge), and turns Traefik's PROXY header into the real client address.
- **Why not B (chunked bundle push) or parallel uploads.** Parallel streams measured no faster (the exit's inbound link
  is the limit), and B would replace plain `git push` with a tool and a new apply path. A keeps plain git and every
  existing rail with a much smaller change. B stays a fallback idea in `docs/ROADMAP.md` only if a future exit has a
  per-connection limit.
- **What this means for the targets.** The push exit's measured inbound link (~2.2 MB/s) is the floor: 150 MB of
  base64 text (git compresses it to roughly three quarters) needs ~50–55 s to upload, then the scan and the onward
  push; ~1 GB of base64 text needs ~6 min to upload. Whether 150 MB lands in under ~90 s depends on Dokploy's onward
  speed to GitHub (to be measured after release). Because the exit is two settings, a faster near-GitHub host can be
  swapped in without code changes.

## Design

**Control plane (one setting chooses the exit).** `directHostOf(env)` (`src/native-git/pool-config.js`): the pool host
named by `GIT_DIRECT_HOST` (a host name such as `dokploy`, or a role such as `previous`); unset = the primary, exactly
as GIT-DIRECT-1/-2; a name that matches no configured host = no direct host at all (never a guess).
- `github_git_remote_setup` (`src/tools/git-remote.js`): when the caller may use the exit host (`hostAllowed`,
  WORKER-POOL-2), placement tries the exit first; if it cannot take the key (paused, disabled, busy, offline, not
  updated), ordinary placement applies and the result's `direct_note` says "The push exit (<name>) is not taking new
  work just now …". `direct_configure` and the capabilities re-read are pinned to the exit host (`job: { host }`,
  no lease renewal). New result field `push_exit: "<host name> (<exit host name>)"` whenever `remote_url` is on the exit.
- `op=authorize` (`src/git-remote/api.js`): a key whose recorded host is not the exit host is refused (`other_host`, as
  before for the primary); no exit host → 404 `direct_host_not_configured`; a non-owner pre-pool key on an owner-only
  exit is counted (as before).
- `github_server_status` (`src/tools/server-status.js`): `health.direct_git` carries `exit: <host name>` (never an
  address); an unmatched `GIT_DIRECT_HOST` is `down` with a plain reason; a caller who may not use an owner-only exit
  still sees nothing about it.
- **Owner-only PC routing is unchanged for workspaces.** Only git remote keys go to the exit, and only for callers the
  exit's audience allows. Nobody else's data is ever routed to the PC.

**Dokploy front door** (`workers/native-git/compose.yaml` service `push-exit`, `workers/native-git/push-exit.Caddyfile`):
- Traefik TCP router `robinson-push-exit`: `HostSNI(${GIT_PUSH_EXIT_HOST})`, entry point `websecure`,
  `tls.passthrough=true`, service port 8443 with `proxyprotocol.version=2`. TCP routers apply before HTTP routers on the
  same entry point, so the existing Dokploy HTTP domain for that host name is shadowed (and can be deleted after the
  live check).
- Caddy `2.8.4-alpine`, read-only root, `cap_drop: [ALL]` plus `NET_BIND_SERVICE` (the image's binary carries that file
  capability; without it exec fails — found on the live probe), `no-new-privileges`, 256 MB, its certificate on its own
  volume, no published port. PROXY header accepted only from private Docker-network peers; X-Forwarded-For replaced
  with the real client address (verified live: a client-sent `X-Forwarded-For: 9.9.9.9` arrived as the real address),
  so the worker's failed-key limit stays per client. Only `/git/*` and `/health` are passed; everything else is 404.
  `flush_interval -1` streams git's progress; no total request deadline (the worker's 2-minute idle close and 12 h push
  cap still apply).
- `GIT_PUSH_EXIT_HOST` defaults to `git.robinsonaisystems.com` (the existing DNS name and Dokploy domain); it must equal
  the host of the control plane's `GIT_DIRECT_ORIGIN`.

**Every rail stays:** per-request authorization through the control plane (worker-signed, pinned worker key,
single-use nonce), the content scan with `{fixtures:'allow'}`, branch guards and GitHub's own rules, the change log and
read-back, the 100 MB file / LFS refusal, the per-push limit and parts beyond 2 GB, the failed-attempt limit. No new
secret, table, protocol version, GitHub API version, permission, plan or spend.

**Swapping the exit later:** run the worker (and a TLS front that passes long requests, such as this Caddy) on the new
host, add it to `NATIVE_GIT_WORKER_POOL` with a name, point DNS at it, set `GIT_DIRECT_HOST` to that name and
`GIT_DIRECT_ORIGIN` to its address, and call `github_git_remote_setup` once (it pins the new worker key).

## Tests

`tests/unit/push-exit.test.js` (real worker with its direct host, real git, real control-plane handlers, fake GitHub; the
PC is an owner-only primary that must receive no request):
- `directHostOf`: unset/empty = primary, host name, role, unknown name and invalid text = none; audiences unchanged;
- the owner's key is placed on the exit (not the PC), `remote_url`/`fallback_url`/`push_exit`, worker key pinned, a
  real clone and a 3 MB+ push through the exit, per-request signed authorization, change row confirmed with read-back,
  zero Routing Middleware requests, zero PC requests;
- a person's key lands on the shared exit with the direct address and no PC address;
- a credential-shaped file pushed through the exit is still refused by the scanner and never reaches GitHub;
- the exit disabled: the owner falls back to ordinary placement on the MCP domain with the plain note; that key is
  refused by the exit's direct host (`other_host`, 403);
- `GIT_DIRECT_HOST` naming no host: domain URL, authorize refuses, `direct_git` down with the plain reason;
- `github_server_status` names the exit (`exit: "previous"`) for owner and person, never an address;
- the compose service and Caddyfile: SNI passthrough with PROXY v2 and no HTTP router, locked-down container with a
  pinned image, PROXY trusted from private ranges only, TLS-ALPN-01, only the direct git paths, upstream `native-git:3001`.
`test/helpers/git-remote-world.js`'s key scope now carries the recorded host exactly as production's `openKeyScope`.

## Release (after Chris's go-ahead; nothing here is applied before)

1. Release `live` (Chris).
2. Dokploy: redeploy compose `GitHub native Git worker` from `live` (`mcp__Dokploy__dokploy_deploy_compose`). It adds the
   `push-exit` service; Caddy gets its certificate within about a minute. Check `https://git.robinsonaisystems.com/health`
   answers `ok`. Then (optional cleanup, reversible) delete the shadowed Dokploy HTTP domain for that host (port 3001);
   to restore it, create it again: host `git.robinsonaisystems.com`, service `native-git`, port 3001, HTTPS, Let's Encrypt.
3. Vercel production env: `GIT_DIRECT_ORIGIN=https://git.robinsonaisystems.com` (today the PC's Funnel address) and
   `GIT_DIRECT_HOST=previous` (the Dokploy host's role; its pool name works too). Redeploy production so they apply.
4. One applied `github_git_remote_setup` (it configures the Dokploy worker's direct host if needed and pins its key).
   Keys made earlier for the PC's direct host stop working (they last at most 24 h); run setup again.
5. Live acceptance on `robinson-ai-scratch/upload-probe`: 40 MB, 150 MB, ~1 GB of base64 text; record times.

Roll back: set `GIT_DIRECT_ORIGIN` back to the PC's address and remove `GIT_DIRECT_HOST`, redeploy, run setup once.

## Drift check

Builds on GIT-DIRECT-1/-2 (direct door, authorization, configure action, claims, limits, setup output) and WORKER-POOL-1/-2
(pool, placement, audiences, recorded key host). New: env `GIT_DIRECT_HOST`, `directHostOf`, setup result field
`push_exit`, status field `direct_git.exit`, compose service `push-exit` and its Caddyfile. No database migration, no tool
schema change, no worker protocol change.
