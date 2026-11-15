# 2026-11-15: the Playground agent releases itself

- Found: PLAY-IMAGES-1 merged but reached no machine. The agent's signed self-update was built (PLAY-3 §5.1) but its
  release inputs were never set in production, so the Workshop's agent was rebuilt by hand the same day.
- Now: the control plane builds the agent bundle from its own copy of `tools/playground-device`, serves it by sha256
  and advertises `version.json`. Bumping that version releases a new agent to every paired machine, and the docs
  check refuses an agent change without a bump.
- Released with this change: `fleet-agent/2` (PLAY-IMAGES-1 plus the SECOND-SHIFT-599 reconcile fix).
- PR card: `docs/pr-cards/AGENT-AUTO-RELEASE-1.md`.
