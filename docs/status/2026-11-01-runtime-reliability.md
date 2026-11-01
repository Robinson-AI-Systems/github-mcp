# 2026-11-01 — Runtime reliability: heartbeat outages and large clones

Chris approved fixing the two problems recorded by the documentation audit.

- **Heartbeat outages:** a Playground runtime used to stop itself on any failed heartbeat, including a brief Vercel or
  Neon error. Now a signed denial still stops it immediately; an unreachable control plane only blocks new commands once
  the last signed lease expires, while running commands get a bounded grace (`CODING_AUTHORITY_GRACE_MS`, default
  5 minutes, max 15). Retries every 10 s. No lease is ever extended. Tests: `tests/unit/playground-authority.test.js`.
- **Large clones:** clones were killed by the 45 s Git watchdog. A clone now waits up to 30 s inside the request, then
  continues in the background (`state: "opening"`) with a 15-minute watchdog (`NATIVE_GIT_CLONE_TIMEOUT_MS`); work and
  close are refused until it is ready, failures are recorded as `failed`, and a worker restart marks unfinished clones
  `failed`. Tests: `tests/unit/native-git-worker.test.js` "large clones continue in the background".

Needs a worker image redeploy and the daily MCP release to take effect live; not live-verified.
