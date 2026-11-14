# Worker auto-update (WORKER-AUTOUPDATE-1) — 2026-11-11

Owner order (2026-11-11): agents kept reporting the PC native Git worker out of date; Chris
asked for automation that keeps it current by slipping updates in **between jobs**, not by
waiting for idle time, and confirmed a worker mid-job cannot be updated — the update must wait
for the job boundary.

**Built (this PR):** `deploy/pc/worker-autoupdate.sh` + systemd service/timer (check every
10 min), installed by `install.sh` when the source carries it; `pc-worker autoupdate
status|run|pause|resume|log`. The updater compares `SOURCE_COMMIT` with the `live` tip, closes
admission with the worker's own marked owner-pause file, drains on `mutation.lock` + established
connections (cap 900 s, then defers — never kills a job), swaps via `pc-worker update --commit`,
verifies (health local + public, control-key pin against `/api/native-git-key`, container env
HTTP version), and rolls back automatically on any failed gate. Receipts land in
`/srv/robinson-git/autoupdate/receipts.jsonl`; status in `status.json` (one read via
`pc-worker autoupdate status`). It stands down for RECLAIM, the owner's pause, a stopped
worker, and a rewound release branch.

**State at the order:** the worker was still on 6debdc88 (2026-11-03) — the 2026-11-10 re-pin
had refreshed only the control key in `.env`, never the code — 22 commits behind the server's
340cb102 on `live`, protocol 3 on both sides.

**Live proof (run on Chris's PC the same day; details in the session report):** a deferral with
a held lock, a real 6debdc88 → 340cb102 update drained around a live clone, an automatic
rollback from a deliberately broken target build, and a full connector fixture
(clone/write/commit/push/read-back) on the final build.
