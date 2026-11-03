# PC worker — the native Git worker on Chris's PC (PC-WORKER-1)

Owner decision 2026-11-03: the PC is the **primary** native Git worker; Dokploy is kept as the **previous** worker so
its existing workspaces keep working. Card: [PC-WORKER-1](pr-cards/PC-WORKER-1.md). Files: `deploy/pc/`.

**The owner's rule:** "my own use of this PC always wins instantly, so anything running on it must be
pausable/killable and resumable, never defended." Everything below follows from that rule.

Placeholders used here: `<pc>.<tailnet>.ts.net` is the PC's own Tailscale name (from Windows Tailscale), `<mcp-domain>`
the MCP's domain, `<dokploy-worker-origin>` the current Dokploy worker address. Real values go only in the PC's own
`/srv/robinson-git/.env` and in Vercel, never in this repository.

## What runs where

- **Inside WSL2 Ubuntu** (Docker Engine, not Docker Desktop): one container, compose project `robinson-git`, built from
  `workers/native-git/Dockerfile`. It never touches other containers, their volumes or other Tailscale daemons.
- **Folder** `/srv/robinson-git` on WSL's own ext4 disk (never `/mnt/c`): `src/` (this repository at the release commit),
  `data/` (workspaces, mirrors, receipts, the pause file; owned by the container user 1000), `.env` (settings, mode 600),
  `pc-worker` (the control script).
- **Ports** are published on `127.0.0.1` inside WSL only (never the LAN): worker API `47300` → container `3000`, direct git
  `47301` → container `3001`. Both are adjustable in `.env` (`PC_WORKER_API_PORT`, `PC_WORKER_GIT_PORT`).
- **Public address**: Tailscale Funnel on the PC's **own Windows Tailscale node** (`tailscale.exe`), one name
  `https://<pc>.<tailnet>.ts.net`, port 443, routed by path:

  | Path | Goes to | Why |
  |---|---|---|
  | `/git/…` | `http://127.0.0.1:47301/git` (direct git host) | big pushes and clones, no hosting-proxy limit |
  | `/health` | `http://127.0.0.1:47301/health` (direct git host, answers `ok`) | `github_server_status` checks `GIT_DIRECT_ORIGIN/health`, so a stopped direct port shows up |
  | everything else (`/v1/…`) | `http://127.0.0.1:47300` (worker API) | signed control-plane calls, uploads, downloads |

  No router port is opened. Funnel on the separate game node is not touched; only this PC's node gets these three
  handlers, and the installer refuses to change anything if this node already serves something else.

### Why one name works (checked against Tailscale's source and docs)

- Tailscale serve strips the mount path before proxying and then joins the target's own path, so
  `--set-path=/git http://127.0.0.1:47301/git` turns `/git/o/r.git/info/refs` into `/git/o/r.git/info/refs` on the
  worker, and `--set-path=/health http://127.0.0.1:47301/health` turns `/health` into `/health` (an empty remainder
  takes the target path). The longest matching mount wins; `/` passes paths unchanged. Source:
  `ipn/ipnlocal/serve.go` (`http.StripPrefix(... mountPoint ...)`, `r.SetURL(rp.url)`, and "if oldOutPath == "" … use
  the target path"), and `ipn/serve.go` `ExpandProxyTargetValue` keeps the target path.
- It keeps the incoming `Host` (`r.Out.Host = r.In.Host`), so the direct git host's own-name check passes, and sets
  `X-Forwarded-For` to the real client address (for Funnel the original source, not the relay), so the failed-key limit
  counts each client separately (the worker trusts that header only from a private peer, which the WSL/Docker hop is).
- CLI syntax: [tailscale funnel](https://tailscale.com/kb/1311/tailscale-funnel) — `tailscale funnel --bg --yes
  --https=443 [--set-path=/path] <target>`; `--bg` settings persist across reboots and `tailscale down/up`; Funnel
  ports are 443, 8443 or 10000; `tailscale funnel status [--json]`; turn one path off by repeating its flags plus `off`.
  Also [tailscale serve](https://tailscale.com/kb/1242/tailscale-serve).
- Windows reaches the WSL ports through WSL's localhost forwarding:
  [`localhostForwarding`](https://learn.microsoft.com/en-us/windows/wsl/wsl-config) (default `true`) "specifying if
  ports bound to wildcard or localhost in the WSL 2 VM should be connectable from the host via localhost:port". It works
  in the default NAT mode; in `networkingMode=mirrored` Windows and WSL share `127.0.0.1`, which also works. Check from
  PowerShell: `curl.exe http://localhost:47301/health` (expect `ok`) and `curl.exe http://localhost:47300/health`
  (expect `{"service":"robinson-native-git","protocol":3}`). The installer runs the same check through
  `/mnt/c/Windows/System32/curl.exe`.

**The worker API's own `/health`** (JSON with `protocol: 3`) is reachable at `http://127.0.0.1:47300/health` inside WSL
and from Windows; publicly, `/health` answers from the direct port. The control plane checks the worker API with a
signed capabilities call, not `/health`.

## Install (run inside WSL as root, non-interactive)

Bootstrap once (later runs update in place):

```bash
git clone https://github.com/Robinson-AI-Systems/github-mcp.git /srv/robinson-git/src
bash /srv/robinson-git/src/deploy/pc/install.sh --mcp-origin https://<mcp-domain> --ref live
#   check the printed public address and the health lines, then add Funnel:
bash /srv/robinson-git/src/deploy/pc/install.sh --mcp-origin https://<mcp-domain> --ref live --configure-funnel
```

From Windows over SSH, wrap each line in `wsl -u root -e bash -lc '<line>'`.

Options: `--commit <full-sha>` (exact commit instead of the `live` branch tip), `--control-key ed25519:…` (instead of
fetching it), `--public-origin https://<pc>.<tailnet>.ts.net` (instead of asking `tailscale.exe`), `--home <dir>`
(default `/srv/robinson-git`), `--tailscale <path to tailscale.exe>`.

What it does, step by step (each prints `ok`, `note` or `FAILED` with the reason):

1. **Prerequisites**: root, git, docker (Engine answering), docker compose, curl, python3; `--home` not under `/mnt/`;
   Windows `tailscale.exe` at `/mnt/c/Program Files/Tailscale/tailscale.exe` (it never calls a plain `tailscale` inside
   WSL, which may belong to another daemon).
2. **Folders**: `src/`, `data/` (chown 1000:1000, mode 700).
3. **Source**: clone or fetch, then check out the exact commit (`--commit`, or the tip of `--ref`, default `live`).
4. **Settings**: creates `.env` from `deploy/pc/.env.example` once, then fills only what it is given:
   `NATIVE_GIT_CONTROL_PUBLIC_KEY` (public; fetched from `https://<mcp-domain>/api/native-git-key` when not given),
   `MCP_ORIGIN`, `PC_WORKER_PUBLIC_ORIGIN` (from `tailscale.exe status --json`), `SOURCE_COMMIT`, `PC_WORKER_DATA`.
   Stops with a list of what is missing.
5. **Build**: `compose config`, then builds `robinson-git-native:<commit>` (the commit is passed as `SOURCE_COMMIT`, so
   `github_server_status` reports it).
6. **Start** (skipped while paused): refuses ports already in use by something else, starts the container, waits for
   both health checks inside WSL, then checks Windows can reach both ports. Installs `/srv/robinson-git/pc-worker`.
7. **Funnel** (only with `--configure-funnel`): refuses if this node already serves anything other than these three
   handlers; then runs

   ```bash
   tailscale.exe funnel --bg --yes --https=443 http://127.0.0.1:47300
   tailscale.exe funnel --bg --yes --https=443 --set-path=/git http://127.0.0.1:47301/git
   tailscale.exe funnel --bg --yes --https=443 --set-path=/health http://127.0.0.1:47301/health
   ```

   and checks `https://<pc>.<tailnet>.ts.net/health` (a new name can take a few minutes).
8. **Done**: prints the public address, the commit and the Vercel settings to change.

## Pause, resume, stop (from Windows)

```powershell
wsl -u root -e /srv/robinson-git/pc-worker pause     # stop new work, let admitted work finish (30 s), stop the container
wsl -u root -e /srv/robinson-git/pc-worker resume    # allow work again and start it (no rebuild)
wsl -u root -e /srv/robinson-git/pc-worker stop      # stop right away (2 s); also refuses new work until resume
wsl -u root -e /srv/robinson-git/pc-worker status    # paused?, container health, local health, locked workspaces
```

A desktop shortcut works the same way: target `C:\Windows\System32\wsl.exe -u root -e /srv/robinson-git/pc-worker pause`.
Other commands: `pause --keep-running` (refuse new work but keep the container running), `logs [lines]`,
`recover-lease <id>`, `update [install options]`.

**How pause works.** `pause` writes `/srv/robinson-git/data/.owner-pause`. While that file exists the worker refuses
every new piece of work before it starts: workspace actions answer HTTP 429 `worker_resource_pressure`, reason
`owner_paused`, `no_operation_started: true`, `Retry-After: 60`; uploads, downloads and git requests (MCP domain and
direct host) answer 503 "This worker is paused by its owner … nothing was started". Agents see "Native Git worker is paused
by its owner … No operation was started. Retry later; GitHub API tools keep working." Status calls (signed
capabilities, metadata-only inspect) still answer and report `owner_paused: true`. Work admitted before the pause runs
on. Then `pause` stops the container gracefully (`PC_WORKER_PAUSE_GRACE_SECONDS`, default 30; the worker stops taking
connections on SIGTERM and finishes open requests). Once stopped, the Funnel answers 502 and agents are told the worker
"is not answering … its host may be paused by its owner, restarting or offline". A stopped container stays stopped
across reboots (`restart: unless-stopped`) until `resume`.
Re-running `install.sh` or `pc-worker update` while paused or stopped builds the new image but leaves it stopped
(the owner's pause wins); run `pc-worker resume` afterwards. Both scripts work from a bare systemd unit or SSH session
without a `HOME` variable.

**Kill is always safe, with these honest limits** (checked against the code and its tests):

- Everything is on disk: workspaces, mirrors, intent receipts, the direct host key and settings survive any stop, kill,
  WSL shutdown or reboot. Nothing is re-sent automatically after a restart: every write has an intent receipt, and a
  receipt left in `sending` is reported as `uncertain` ("inspect before another intent"), never replayed.
- A clone cut off mid-way is marked `failed` at the next start (`recoverInterruptedClones`); open a new workspace.
- A workspace write cut off mid-way leaves its `mutation.lock`. The workspace then answers "leased; interrupted leases
  require operator recovery" until released: `pc-worker status` lists such workspaces, and with the worker stopped
  `pc-worker recover-lease <id>` releases one (the old lock is kept as `recovered-lock-<time>`, the uncertain receipt
  stays). Then the agent inspects the workspace and remote refs before any new change.
- A git push cut off mid-way: before the final atomic push to GitHub nothing changes on GitHub; if it was cut off during
  that last step GitHub may or may not have the new refs, and git reports an error either way. Run `git fetch` (or
  `git ls-remote`) to see, then push again if needed. Quarantined uploads that never finished are cleaned up by the
  worker's sweep.
- Agents that were mid-call get an error, not a silent success. Their next call after `resume` works normally.

## Switch the MCP to the PC (Vercel production settings, names only)

After install and Funnel, and once `https://<pc>.<tailnet>.ts.net/health` answers:

| Setting | New value | Why |
|---|---|---|
| `NATIVE_GIT_WORKER_URL` | `https://<pc>.<tailnet>.ts.net` | new workspaces, capabilities and the git remote go to the PC |
| `NATIVE_GIT_PREVIOUS_WORKER_URL` | `<dokploy-worker-origin>` (today's `NATIVE_GIT_WORKER_URL`) | workspaces created on Dokploy keep routing there (each stores a hash of its worker origin) |
| `NATIVE_GIT_WORKER_CUTOVER_AT` | the UTC switch time, `YYYY-MM-DDTHH:MM:SSZ` | required whenever a previous worker is set (used only for old rows without a stored origin) |
| `GIT_DIRECT_ORIGIN` | `https://<pc>.<tailnet>.ts.net` | the direct git host moves to the PC |

Unchanged: `NATIVE_GIT_CONTROL_PUBLIC_KEY` lives on the worker only (the installer pins it); the MCP's signing key,
`PUBLIC_BASE_URL` and everything else stay. The settings take effect with the next Vercel deployment (normal release
route). Then:

1. `github_server_status`: worker `ok`, `build_commit` = the PC commit, direct git `ok`.
2. One `github_git_remote_setup` (applied): the PC worker reports its direct host from its environment
   (`GIT_DIRECT_ORIGIN` + `GIT_DIRECT_CONTROL_ORIGIN` in the PC's `.env`, so no `direct_configure` call is needed); setup
   pins the PC's direct-host signing key (root setting `git_remote.direct_worker`) and returns
   `remote_url` on `https://<pc>.<tailnet>.ts.net/git/…`. Keys made earlier for the Dokploy direct host stop working
   there (the pinned key moved); their `fallback_url` on the MCP domain keeps working, and a new setup gives the PC address.
3. Live acceptance: open/clone/push/close on the scratch repository through the PC; a large push through `remote_url`.

GIT-DIRECT-2 alternative: leaving `GIT_DIRECT_ORIGIN`/`MCP_ORIGIN` out of the worker is not supported by this kit's
compose file (it requires them); the environment route is simpler and survives a wiped volume.

## Update to a new release

```bash
/srv/robinson-git/pc-worker update                    # tip of live
/srv/robinson-git/pc-worker update --commit <full-sha>
```

It fetches, checks out the commit, rebuilds `robinson-git-native:<commit>`, recreates the container (unless paused) and
re-checks health. Each build is tagged by its commit and older images stay, so a rollback is `update --commit <previous-sha>` (the
build is then answered from Docker's cache in seconds). Workspaces and settings are kept. Old images can be listed with
`docker image ls robinson-git-native` and removed one by one with `docker image rm robinson-git-native:<sha>`; never
run a global prune on this PC (other containers live there).

## Logs

`pc-worker logs` (last 200 lines) or `pc-worker logs 1000`. The worker never logs keys, tokens, signatures or paths.

## Roll back to Dokploy

Fast (minutes, no data move): in Vercel set `NATIVE_GIT_WORKER_URL` back to `<dokploy-worker-origin>`, set
`NATIVE_GIT_PREVIOUS_WORKER_URL` to `https://<pc>.<tailnet>.ts.net` (so workspaces opened on the PC keep resolving
while the PC is up), `NATIVE_GIT_WORKER_CUTOVER_AT` to the rollback time, and `GIT_DIRECT_ORIGIN` to
`https://git.<domain>` (or remove it); deploy. Run `github_git_remote_setup` once so the Dokploy direct host is pinned
again. Only two worker origins are routable at a time (current and previous).

To retire the PC later: let its workspaces close (4 idle hours) or move them (`docs/NATIVE-GIT-OPERATIONS.md` "Moving
the worker"), then remove it from Vercel, `pc-worker stop`, and remove the Funnel handlers:

```bash
tailscale.exe funnel --https=443 --set-path=/health off
tailscale.exe funnel --https=443 --set-path=/git off
tailscale.exe funnel --https=443 off
```

## Sizing and the PC's own use

Defaults (`.env`): 4 CPUs, 6 GB memory (no swap beyond it), CPU weight 256 (Docker default 1024), IO weight 100,
`nice 10` and `ionice` idle class for the worker and every git process, first to be killed on memory shortage
(`oom_score_adj 500`). New work is refused when less than 256 MB of the container's memory or 20 GB of the data disk
is free. WSL itself is capped by `.wslconfig` (16 GB / 16 cores today). WSL shuts its VM down after `vmIdleTimeout`
only when nothing runs in it; the game server already keeps it up, and Docker restarts the worker with WSL.

Bandwidth: pushes and clones use the PC's internet link (about 250–300 Mbps today over Wi-Fi). There is no bandwidth cap
in the worker; pause it when the link is needed.

## WSL2 notes (PC-WORKER-2, found on the first real install, 2026-11-03)

- **Mirrored networking.** With `networkingMode=mirrored` in `.wslconfig`, Docker's published localhost ports never
  answer: Docker's protection rule drops 127.0.0.1 traffic that does not arrive on `lo`, and mirrored mode routes it
  through the Windows path. The kit therefore runs the worker with host networking, listening on 127.0.0.1 only
  (`NATIVE_GIT_BIND_HOST`), on the API and git ports from `.env` (47300/47301). This also works under NAT networking
  with localhost forwarding. Nothing listens on the LAN.
- **No IO weight.** WSL2 kernels have no BFQ scheduler, so a `blkio` weight makes the container fail to start. IO
  priority comes from `ionice` only.
- **Docker Desktop credential store.** If WSL's `~/.docker/config.json` names `credsStore: desktop.exe` (Docker
  Desktop installed alongside Engine), builds from SSH or service sessions fail. The scripts detect this and build
  with an empty config (the base image is public).
