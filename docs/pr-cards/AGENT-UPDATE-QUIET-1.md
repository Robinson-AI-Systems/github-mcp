# AGENT-UPDATE-QUIET-1: offer an agent release only to older agents

## Found live 2026-11-15

AGENT-AUTO-RELEASE-1 worked: the Workshop's Playground agent moved itself to fleet-agent/2. But the control plane
kept offering fleet-agent/2 on every check-in. The agent refused it each time, logging a line every ~20 seconds, and
it first waited for all of its running jobs (`settle()`) before each refusal.

## Outcome and acceptance

- The agent reports `agentVersion` (its payload version) on every check-in. The server records it on the host and
  offers a release only when it is newer. An agent that does not report a version (fleet-agent/2 and older) is still
  offered, so it can update to one that does.
- The agent remembers an offer it declined for good (not newer, bad signature, not supervised): no settle, no log line,
  until the offer changes. "busy" and "awaiting_drain" are retried at the next check-in as before.
- `version.json` → fleet-agent/3 releases this to every paired machine through AGENT-AUTO-RELEASE-1.

Accepted by `tests/unit/fleet-dial-out.test.js` (new case; fails on the old code) and the existing PLAY-3,
auto-release and image-cleanup tests.

## Drift check

Changes: `src/fleet/host.js`, `src/fleet/agent-release.js`, `tools/playground-device/agent.mjs` and `version.json`,
the dial-out test, this card, `docs/status/2026-11-15-agent-auto-release.md`.
