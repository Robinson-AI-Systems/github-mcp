# GIT-DIRECT-2 — The control plane configures the worker's direct git host (no Dokploy environment edit)

## Owner decision 2026-11-02 21:53 MST (in chat)

"Finish it first." Context: GIT-DIRECT-1 (#556) turned the worker's direct git host on only through worker environment
values (`GIT_DIRECT_ORIGIN`, `GIT_DIRECT_CONTROL_ORIGIN`) in Dokploy's compose environment box, which our connector
cannot edit safely. The DNS record and the Dokploy domain (`git.<domain>` → container port 3001, HTTPS) are already in
place; the agent sets Vercel's `GIT_DIRECT_ORIGIN`.

## Outcome and acceptance

Outcome: with only Vercel's `GIT_DIRECT_ORIGIN` set (plus the existing `PUBLIC_BASE_URL`), the first applied
`github_git_remote_setup` configures the worker over the existing signed control-plane → worker path, the worker starts
its direct listener without a restart and keeps the setting on its volume, and setup returns the direct URL; on any
failure setup falls back to the MCP-domain URL with a plain note. Accepted when the tests below pass and `ci` +
`release-policy` are green at the exact head; live acceptance (clone and a ~100 MB push through `remote_url`) follows the
next release and worker redeploy.

## Design (and why)

**One PR.** The worker action, its persistence and live listener, and the setup change are one usable outcome; either
half alone would change nothing for Chris.

**Worker action `direct_configure`** (`src/native-git/protocol.js` allow-list, `workers/native-git/server.js`,
`workers/native-git/direct.js` `directHost`). It is an ordinary signed worker lease (protocol 3, ≤ 90 s, verified with the
pinned `NATIVE_GIT_CONTROL_PUBLIC_KEY` like every other action) and must carry `allowWrite: true`; options
`{ origin, control }` or `{ origin: null }`.
- Both origins must be https with no user name, password, path, query or fragment, and must not be the same host
  (`directOrigins`). Refused values store nothing and answer 400 with a plain reason.
- Stored in `<storage>/.git-direct/config.json` (`{ version: 1, origin, control }`): written to a random temporary name
  with mode 0600 and `wx`, then renamed (atomic); the directory is 0700 and must not be a symlink. A file that does not
  parse or holds an invalid origin is ignored (host off).
- The listener (`GIT_DIRECT_PORT`, default 3001) starts at once, without a restart; a later change of values only
  swaps the configuration the running server reads per request. At boot `server.js` reads the file and starts the
  listener when it is configured. Configure calls are serialised.
- **The environment wins.** When both `GIT_DIRECT_ORIGIN` and `GIT_DIRECT_CONTROL_ORIGIN` are set on the worker, the
  file is never consulted or changed; the action succeeds only with the same values and cannot turn it off.
- `{ origin: null }` removes the file and turns the host off (its git routes answer 404 "turned off"; `/health` stays).
- Capabilities report `git_direct: { version: "v1", origin, control, worker_key, source: "environment" | "file" }` when
  configured, and `git_direct_configure: "v1"` whenever the worker can be configured (not on a dedicated
  single-workspace broker, which has no direct host and answers the action with 404).

**Setup** (`src/tools/git-remote.js`). The read step computes what the worker serves; it never changes the worker, so
a dry run or an unconfirmed call previews only. When this service names a direct host that the worker does not serve
(or serves from a stored file that asks another control origin, as after a `PUBLIC_BASE_URL` change), the applied setup
sends `direct_configure { origin: GIT_DIRECT_ORIGIN, control: PUBLIC_BASE_URL's origin }` once, reads the signed
capabilities again and, when they now match, pins the worker key and returns `remote_url` on the direct host exactly as
GIT-DIRECT-1. Any failure (worker not updated, refused, unreachable, not confirmed) issues the key on the MCP domain
with `direct_note` saying why in plain words; the next setup tries again. An environment-configured worker is used as
it is (GIT-DIRECT-1 behaviour unchanged).

**Safety properties kept.** Every direct request is still authorized per request by the control plane (`op=authorize`,
worker-signed, pinned key, single-use nonce); the direct host still serves only the fixed git paths for its one host
name (421 otherwise), never proxies or follows redirects; the failed-attempt limit is unchanged; the session key is
never logged or sent on. The new action carries no secret: two public origins in, public origins and the public worker
key out. Why not a new secret or table: the existing signed lease already authenticates the control plane to the
worker.

## Tests

`tests/unit/git-direct-configure.test.js`:
- worker: the signed action with a write lease is accepted; unsigned, stranger-signed, malformed-signature, expired and
  read (`allowWrite: false`) leases change nothing; bad origins (http, path, credentials, query, wrong scheme, missing
  control) and the same host for both are refused, nothing stored;
- the listener starts live: `/health` answers `ok`, git routes need a key (401 Basic challenge), other host names get
  421, other paths 404; configuring again with the same values is a no-op;
- the file is 0600 with exactly `{ version, origin, control }`, is read again after a simulated restart (listener up),
  and a damaged file is ignored;
- the worker environment wins over the file and cannot be changed or turned off by the action;
- `{ origin: null }` turns it off (404 "turned off", capabilities omit it, stays off after restart); a dedicated broker
  refuses the action;
- setup: a dry run sends nothing; the first applied setup configures once, stores this service's two origins, pins the
  key and returns the direct URL; real clone and push through it; a second setup sends nothing; a stored host with a
  stale control origin is reconfigured; an environment-configured worker gets no action;
- fallback: unreachable worker, worker refusal (same host as this service), and a worker without the action each give
  the MCP-domain URL, a plain `direct_note` and a working key;
- the nine write-contract checks pass through every door with the control-plane-configured host, and every door returns
  the direct address.
`tests/unit/git-direct.test.js`, `git-remote.test.js` and `git-remote-contract.test.js` pass unchanged (the test world
now boots the worker the way `server.js` does). `workers/native-git/smoke.test.js` checks the image can store the file
(0600) as the unprivileged user.

## Release

Control plane (daily release) and a worker redeploy from a commit that includes GIT-DIRECT-2. Vercel production env
`GIT_DIRECT_ORIGIN=https://git.<domain>` (set by the agent). No Dokploy environment edit: `GIT_DIRECT_PORT` defaults to
3001, which the existing Dokploy domain targets. Traefik's entry-point `readTimeout` (60 s default since v2.11.2) still
stops any single upload that takes longer than that; raise it before large pushes. Then one `github_git_remote_setup`
configures the worker and pins its key. No new secret, table, GitHub API version, permission, plan or spend change.

## Drift check

Builds on GIT-DIRECT-1 (same direct door, authorization, claims, limits and setup output). New: worker action
`direct_configure`, volume file `.git-direct/config.json`, capability fields `git_direct.control`, `git_direct.source`
and `git_direct_configure`, setup result field `direct_note`.
