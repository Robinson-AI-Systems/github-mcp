# PLAY-IMAGES-1: Playground image cleanup

## Owner request 2026-11-15

"Playground images need an auto-cleanup system." Four finished runtimes had left 10.5 GB of `ras-playground:<sha>`
images on the Workshop.

## Outcome and acceptance

- A runtime that goes down (`down()`) removes the images built for its compose project.
- The agent sweeps images of runtimes it no longer records:
  - at startup;
  - then hourly, between orders.
- Images that a container uses, and images of other compose projects, are never removed.
- Docker errors never fail a down or a reconcile.

Accepted by `tests/unit/playground-image-cleanup.test.js`. The existing PLAY-3 agent tests are unchanged and pass.

## Drift check

Changes: `tools/playground-device/agent.mjs`, the new test, this card, `docs/status/2026-11-15-playground-images.md`.
