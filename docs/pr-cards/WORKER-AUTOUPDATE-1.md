# WORKER-AUTOUPDATE-1 — The PC native Git worker updates itself between jobs

## Owner decision 2026-11-11 05:19 MST (in chat)

Agents kept reporting the Git worker out of date (it sat on the 2026-11-03 build 6debdc88 while
the server released 340cb102 — the 2026-11-10 re-pin had refreshed only the control key in
`.env`, never the code). Chris: keep the worker current automatically — not by waiting for idle
time (there often is none), but by slipping the update in **between jobs**; a worker mid-job
cannot be updated, so the update waits for the job boundary.

## Outcome and acceptance

Outcome: a systemd timer on the PC checks every 10 minutes whether the worker build
(`SOURCE_COMMIT` in `/srv/robinson-git/.env`) matches the tip of the `live` release branch —
the same ref `pc-worker update` installs by default and the commit `github_server_status`
reports as the server's release. When a newer build exists, the updater closes admission with
the worker's own owner-pause gate (marked `worker-autoupdate`; the owner's own pause is never
touched or overridden), waits for admitted work to finish (no `mutation.lock` files, no
established connections to the worker ports, a short quiet window), swaps with
`pc-worker update --commit <target>`, verifies the new build (container healthy, local + public
health, control-key pin against the MCP's `/api/native-git-key`, container env HTTP version),
and only then reopens admission. Accepted when the unit tests pass, `ci` + `release-policy` are
green at the exact head, and the live proofs on Chris's PC pass: deferral under a held lock, a
real update drained around a live clone, automatic rollback from a deliberately broken build,
and a connector fixture (clone/write/commit/push/read-back) on the final build.

## Design (and why)

- **Drain cap 900 s, then defer — never kill.** 900 s is the longest single operation the worker
  itself allows (the default clone timeout, `NATIVE_GIT_CLONE_TIMEOUT_MS` 900000 ms), so any
  admitted job can finish inside the wait; past it, the update defers to the next 10-minute
  cycle and a receipt says so. An update pending over 6 hours is flagged overdue in the status.
- **Rollback is automatic.** Verification failure re-runs the update at the previous commit
  (its image is still on disk, so it is fast) and verifies that; only if the rollback also
  fails does admission stay closed (new work fails over to the pool's other host) with the
  state set to `attention`. A failed update must never take git service down with it.
- **Receipts + one-read status.** Every attempt appends to
  `/srv/robinson-git/autoupdate/receipts.jsonl` (from/to builds, seconds admission was paused,
  result) and refreshes `status.json`; `pc-worker autoupdate status` prints state, both builds
  and the last receipt, so "is the worker current?" answers itself.
- **Owner first, as always.** The updater does nothing while the PC's RECLAIM flag is set,
  while the worker is owner-paused or stopped, while its own pause file
  (`/srv/robinson-git/.autoupdate-pause`, via `pc-worker autoupdate pause`) exists, and it
  never downgrades — a rewound release branch is journaled and skipped.
- **No server change.** The comparison source already exists: the repo's release branch. The
  signing relationship is preserved by construction — the swap is install.sh itself, which
  re-fetches the MCP's current control public key on every run (the 2026-11-10 re-pin path),
  and the updater verifies the pin afterwards.
- **Build-machinery preflight.** A swap is pointless if the image cannot build, and closing
  admission first would pause git service for nothing: before draining, the updater proves
  `docker buildx` runs. Builds on this PC otherwise resolve plugins from Docker Desktop's
  integration share (a read-only ISO that went unreadable on 2026-11-11 while the Engine stayed
  healthy — every plugin read failed EIO and *no* worker image could build, including manual
  rollbacks). When the ambient buildx is broken, the updater seeds its own checksum-verified
  buildx under its state folder and pins `DOCKER_CONFIG` there for the swap; when even that
  fails it defers *before* closing admission and says so in the receipt.
- **Two live lessons folded back in (2026-11-11, first real attempts).** (1) The kit Docker
  config must be *self-contained*: it originally carried buildx alone, and install.sh's
  prerequisite check (`docker compose version`) failed under it — the kit now seeds both
  plugins, checksum-verified. (2) The public-health gate cannot rely on WSL curl alone: WSL
  refuses this host's own Funnel name instantly (mirrored networking) while the name answers
  fine publicly, so the gate falls back to the Windows-side curl on the same machine — without
  that, every verify (including of a healthy rollback build) failed and admission stayed shut.
- **Third live lesson (2026-11-11, the successful run).** install.sh *builds* the new image
  but, while the admission pause is up, deliberately does not start it — so the updater's
  verify must start the freshly built container itself (`compose up -d --no-build`, pause
  still held) before checking health. The first version's verify instead chased the still-
  running old container and misattributed the failure to the public path.
- **Install path.** `install.sh` installs the script + units (atomically — it runs under the
  updater during a swap) whenever the source it installs from carries them, and enables the
  timer; an older release leaves an installed updater untouched.

## Files

`deploy/pc/worker-autoupdate.sh`, `deploy/pc/worker-autoupdate.service`,
`deploy/pc/worker-autoupdate.timer`, `deploy/pc/pc-worker` (`autoupdate` subcommand),
`deploy/pc/install.sh` (install/enable step), `tests/unit/worker-autoupdate.test.js`,
`docs/PC-WORKER.md` (runbook section).

## Drift check

Builds on PC-WORKER-1 (install kit, `pc-worker`, the `.owner-pause` admission gate,
`SOURCE_COMMIT` reporting) and SRV-STATUS-1 (the server's build comparison). New: the updater
script and its systemd units under `deploy/pc/`, the `pc-worker autoupdate` subcommand, the
updater's own pause file (`.autoupdate-pause`), and its state folder
(`/srv/robinson-git/autoupdate/`). No protocol, tool schema, database, routing or worker-code
change; the worker image is untouched (deploy/pc is not part of it), and Dokploy/Render
deployments are unaffected.
