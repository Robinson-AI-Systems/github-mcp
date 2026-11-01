# 2026-11-01 — FLEET-3 dial-out host agent (source)

Chris approved the runtime-fleet recommendations and asked that it work for everyone who signs in, not just him.

Built: anyone can add a computer or server they control from My connection with one command
(`node agent.mjs join …`, then `node agent.mjs run`). The agent only checks in outward; an automatic readiness check makes
it Ready; new workspaces go to the person's own ready machines first, then the shared Dokploy pool, then Git-only; signed
requests reach its runtime through a mailbox relay; revoking it deletes its runtimes. See [FLEET-3](../pr-cards/FLEET-3.md),
tests in `tests/unit/fleet-dial-out.test.js` (10 passing locally; whole unit suite passes except the known local-only
snapshot test that also fails on unmodified main and passes in CI).

Not yet: a release, a real paired machine, interactive preview on own machines, device-native Git (FLEET-6), published
runtime image (FLEET-2).
