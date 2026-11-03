# 2026-11-03 PC worker kit polish (PC-WORKER-2 follow-up)

From the second PC install on desktop-ol64acp (healthy, commit de40361e):

- `install.sh` and `pc-worker` no longer fail with "HOME: unbound variable" when started from a bare systemd unit; the
  Docker config check falls back to `/root`.
- `docs/PC-WORKER.md` now says a re-install or `update` while paused or stopped builds but does not start the worker;
  `pc-worker resume` starts it. This is deliberate: the owner's pause wins.

Verified: `tests/unit/pc-worker-wsl.test.js`, `bash -n` on both scripts, `npm run check`.
