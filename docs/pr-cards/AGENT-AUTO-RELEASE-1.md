# AGENT-AUTO-RELEASE-1: the control plane publishes the Playground agent it carries

## Owner request 2026-11-15

Chris: "Get the rest handled." PLAY-IMAGES-1 merged, but no machine received it: the agent's signed self-update
channel needed an operator to build a bundle by hand, host it and set three env values, and that was never done. The
Workshop's agent had to be rebuilt by hand.

## Outcome and acceptance

- The server packs `tools/playground-device` (agent, pair, update, run + version.json) into a byte-identical tar.gz
  (fixed order, zero mtimes, fixed modes), so every instance computes the same sha256.
- It serves those bytes at `/api/fleet/agent-bundle?sha=<sha256>` (public: the same code as this repo; agents install
  it only after checking the control plane's signature over the hash).
- With no `PLAYGROUND_AGENT_*` values set, the check-in advertises that bundle and the version in `version.json`.
  Operator values still win; `PLAYGROUND_AGENT_AUTO_RELEASE=off` turns it off. It stays off without an https
  `PUBLIC_BASE_URL`.
- `version.json` goes to `fleet-agent/2`, which releases PLAY-IMAGES-1 to every paired machine.
- The docs check now refuses a change to the agent payload without a `version.json` bump (exception:
  "Agent-release: not needed — <reason>"), so an agent fix can never again sit unreleased.

Accepted by `tests/unit/agent-auto-release.test.js` (deterministic bytes, system tar unpacks the payload, the
advertisement verifies with the agent's own `verifyRelease`, the route serves only the advertised sha) and
`tests/unit/check-scripts.test.js`. Existing PLAY-3 tests unchanged and passing.

## Drift check

Changes: `src/fleet/agent-release.js` (new), `src/fleet/host.js`, `api/fleet/agent-bundle.js` (new),
`rack-server.mjs` (route), `scripts/check-docs-updated.mjs`, `tools/playground-device/version.json`, tests, this
card, `docs/status/2026-11-15-agent-auto-release.md`.
