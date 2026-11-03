# PC-WORKER-1 — The native Git worker on Chris's PC as the primary worker (Dokploy kept as previous)

## Owner decision 2026-11-03 04:27 MST (in chat)

"Use my PC … treat the PC as the primary route, not the fallback. Build for the PC." Dokploy's Traefik cuts uploads at
60 s and its admin will not raise it. Hard rule: "my own use of this PC always wins instantly, so anything running on it
must be pausable/killable and resumable, never defended." Facts given: Windows 11 + WSL2 Ubuntu with Docker Engine inside
WSL (another container runs there and is not touched), on 24/7, Tailscale on Windows runs unattended, Funnel is used by a
separate node for another purpose (not touched), no router port-opening, ~250–300 Mbps.

## Outcome and acceptance

Outcome: one installer run inside WSL builds and starts the worker at an exact commit with low priority and small
limits, publishes it on localhost only, and (behind `--configure-funnel`) exposes it on the PC's own
`https://<pc>.<tailnet>.ts.net` with `/git` and `/health` to the direct git port and everything else to the worker API;
`pc-worker pause|resume|status|stop` (from Windows via `wsl -u root -e …`) stops new work at once, and the MCP switches
to the PC with four Vercel settings while Dokploy workspaces keep resolving. Accepted when the unit tests below pass,
the scripts pass shellcheck, the compose file passes `docker compose config`, and `ci` + `release-policy` are green at
the exact head; live acceptance follows the install on the PC (owner-side operator) and the Vercel switch.

## Design (and why)

**One PR**: compose file, installer, control script, the worker's owner-pause switch, the control-plane messages and the
runbook are one usable outcome; any part alone would not let Chris use or pause the PC worker.

- **`deploy/pc/compose.yaml`**: project `robinson-git`; same hardened container as Dokploy (read-only root, no
  capabilities, user 1000, init); `cpus` 4, memory 6 GB (no extra swap), `cpu_shares` 256, IO weight 100, `nice 10` and
  `ionice` idle class (a refusal is reported, not fatal), `oom_score_adj` 500, admission floors 256 MB memory / 20 GB
  disk; all but the IO weight adjustable in `.env` (compose does not interpolate `blkio_config.weight`). Bind mount
  on WSL ext4 (`/srv/robinson-git/data`), `restart: unless-stopped` (a stopped worker stays stopped), healthcheck of
  both ports, image tagged by commit, `SOURCE_COMMIT` build argument (SRV-STATUS-1). Ports `127.0.0.1:47300→3000`,
  `127.0.0.1:47301→3001` only. Direct git host configured from the environment (`GIT_DIRECT_ORIGIN` = the PC origin,
  `GIT_DIRECT_CONTROL_ORIGIN` = the MCP origin), so its listener (and `/health` on it) is up from boot.
- **One public name, path routing**: Tailscale serve strips the mount and joins the target path, keeps `Host`, and sets
  `X-Forwarded-For` to the Funnel client (verified in Tailscale's `ipn/ipnlocal/serve.go` and `ipn/serve.go`), so
  `--set-path=/git http://127.0.0.1:47301/git` and `--set-path=/health http://127.0.0.1:47301/health` work and the
  direct host's own-name check and per-client failed-key limit keep working. `/health` goes to the direct port because
  `github_server_status` checks `GIT_DIRECT_ORIGIN/health`; the worker API is checked by its signed capabilities call.
  Windows reaches the WSL ports via WSL `localhostForwarding` (NAT default) or mirrored mode.
- **Owner pause** (`workers/native-git/resources.js`, `server.js`, `upload.js`, `download.js`, `remote.js`, `direct.js`):
  the resource monitor takes a `pauseFile` (`<storage>/.owner-pause`, the default in `nativeGitServer`); while it exists
  every admission check returns `owner_paused` (Retry-After 60). Workspace calls answer 429 with
  `no_operation_started: true`; uploads, downloads and the MCP-domain git remote answer 503 with "paused by its owner …
  nothing was started"; the direct git host refuses before any key check or authorization call. Capabilities and
  metadata-only inspect still answer; capabilities add `owner_paused: true`. Admitted work finishes. A pause check that
  cannot tell counts as paused (never defended). Dedicated Playground brokers and Dokploy never have the file.
- **Control plane** (`src/native-git/client.js`): a 429 `owner_paused` reads "paused by its owner … No operation was
  started"; a non-JSON 502/503/504 (a stopped host behind the tunnel) reads "not answering … may be paused, restarting or
  offline … the outcome may be unknown" instead of "invalid response". Routing is unchanged: `NATIVE_GIT_WORKER_URL`
  (PC) + `NATIVE_GIT_PREVIOUS_WORKER_URL` (Dokploy) + `NATIVE_GIT_WORKER_CUTOVER_AT` already route each workspace by its
  stored origin hash; `GIT_DIRECT_ORIGIN` moves the direct host.
- **Scripts**: `deploy/pc/install.sh` (root inside WSL, non-interactive, idempotent; prerequisites, clone/fetch at an
  exact commit or the `live` tip, `.env` from placeholders with the public key fetched from `/api/native-git-key`, build,
  start, local and Windows-side health, Funnel only with `--configure-funnel` and only when this node serves nothing
  else, public URL and Vercel setting names). It only ever calls the Windows `tailscale.exe`, never a plain `tailscale`
  inside WSL. `deploy/pc/pc-worker` (pause [--keep-running], resume, stop, status with locked-workspace listing, logs,
  recover-lease, update). Both wrap their body in `main` so an update that rewrites the script mid-run is safe.

## Kill-safety (verified against the code)

Files persist; writes are journaled with intent receipts and never replayed (`engine.js execute`: `sending` receipts
read back as `uncertain`); interrupted clones become `failed` at boot (`recoverInterruptedClones`); a write cut off
mid-way leaves `mutation.lock`, released with `pc-worker recover-lease <id>` (existing `snapshot-cli.js recover-lease`);
git-remote mirror locks are in memory only; a push cut off during the final atomic push to GitHub may or may not have
landed (git reports an error; fetch to see). Documented in `docs/PC-WORKER.md`.

## Tests

- `tests/unit/pc-worker-owner-pause.test.js`: monitor pause/resume and fail-closed; a real worker refuses a new clone
  with 429 `owner_paused` + `no_operation_started` + Retry-After 60 and creates nothing, capabilities report it, resume
  accepts; a clone admitted before the pause finishes and the next write is refused while a metadata inspect answers;
  the direct host refuses while paused before any authorization call and serves again after resume; client messages for
  `owner_paused` and non-JSON 502/503/504; the ts.net origin as worker URL, direct origin (worker and control-plane
  checks), relay route `w`, with Dokploy as previous route `p` and pinned workspaces routed to it; one host serving the
  direct git routes only for its own ts.net `Host`.
- Existing native-git, git-direct, server-status and repo-change suites unchanged and passing.
- `shellcheck` on both scripts; `docker compose config` on the compose file with fake values; the installer and control
  script run end to end against a fake `docker` and fake `tailscale.exe` (no daemon in the sandbox).

## Not covered here

Building the image and running it on Docker (no daemon in the build sandbox; CI's native image workflow builds the same
Dockerfile), and the live PC install, Funnel and Vercel switch (owner-side operator; recorded in the status note).

## Drift check

Builds on GIT-DIRECT-1/-2 (direct door, authorization, environment configuration) and SRV-STATUS-1 (`SOURCE_COMMIT`).
New: worker volume file `.owner-pause`, admission reason `owner_paused`, capability field `owner_paused`, control-plane
messages for a paused or unreachable host, and `deploy/pc/`. No protocol, tool schema, database or routing change;
Dokploy and Render deployments are unaffected (no pause file there).
