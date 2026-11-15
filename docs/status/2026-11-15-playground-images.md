# 2026-11-15: Playground runtimes leave no images behind (PLAY-IMAGES-1)

- Chris (2026-11-15): the Playground images need automatic cleanup. Four 2.6 GB `ras-playground:<sha>` images sat on
  the Workshop, each left by a finished runtime.
- Cause: `compose up --build` builds one image per runtime. `down -v` removes containers, volumes and networks, but
  never images.
- Now (tools/playground-device/agent.mjs):
  - `down()` removes the images its runtime built;
  - `sweepImages()` runs at startup (inside `reconcile()`) and hourly when no order is in flight. It removes any
    `ras-pg-*` image whose runtime is no longer recorded;
  - an image a container still uses is refused by Docker and kept;
  - the cleanup is best effort and never fails a down or a reconcile.
- Tests: `tests/unit/playground-image-cleanup.test.js`.
