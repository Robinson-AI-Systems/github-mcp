# 2026-11-03 — PC worker kit fixes from the first real install (PC-WORKER-2)

The first run on the owner's PC (WSL2 Ubuntu, standalone Docker Engine 29.9.2, mirrored networking) built and
started the worker, but found three real-machine problems:
1. `docker-credential-desktop.exe` not found: the WSL Docker config names Docker Desktop's store, unusable over SSH.
   The scripts now build with an empty Docker config when the named helper is missing.
2. `blkio_config.weight` is fatal on WSL2 (no `io.weight` without BFQ). Removed; `ionice` remains.
3. Blocker: under mirrored networking Docker's raw-PREROUTING rule (`ip daddr 127.0.0.1 iifname != "lo" … drop`)
   kills published localhost ports from WSL and Windows. The worker now uses host networking and binds 127.0.0.1
   (`NATIVE_GIT_BIND_HOST`) on the `.env` ports, so no Docker port rules are involved; still loopback only.
Tests: `tests/unit/pc-worker-wsl.test.js`; shellcheck clean. Next: re-run the install on the PC, then Funnel,
switch-over and push tests.
