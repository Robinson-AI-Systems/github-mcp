# FLEET-2 — Faster small runtimes: slim image, run-at-commit mode, upsize hint

## Owner approval 2026-11-01

Chris approved items 1–9 on 2026-11-01 with self-aware gates. Design and gates: [GATED-EXPANSION](../designs/GATED-EXPANSION-2026-11-01.md).

## Outcome and acceptance

Outcome: small jobs start on a slim runtime image (no Chromium/PostgreSQL) when the repository shows no browser/database signals; a run-at-commit tool runs one command at a ref and cleans up; an out-of-memory kill is reported as `out_of_memory` with the next size. Gates: see design.

Accepted when the gate is implemented as code with tests for both the on and off decision, the feature works through every door it is offered on, and docs/TOOL-CATALOG.md describes it.

## Drift check

No gate raises spend, widens access or opens public sign-up by itself. Secrets never pass through a tool.

## Delivered 2026-11-01 (PR #518)

All three pieces in one PR (one outcome: small jobs start faster and cheaper, and say when they need more).

- **Slim image gate** (`src/playground/runtime-variant.js`): Dockerfile target `slim` (same supervisor code, no
  Chromium/Playwright browsers, no PostgreSQL; `runtime` = slim + those); `publish-runtime-image.yml` builds, smoke-tests
  and publishes `<sha>-slim` with per-tag skip; `resolvePrebuiltImage(..., {variant: 'slim'})`. New allocations
  (`enqueueAllocation`, `ensureAllocation`, device and pool paths) record `runtimeImage {variant, reason, signals}`;
  `github_playground_read allocation` shows `runtime_image`. Tests: `tests/unit/playground-runtime-variant.test.js`
  ("slim gate" ON/OFF, "image choice and fallbacks", "repository signals", the provision write contract "small on the
  slim image" through all three doors, and "a small provision records the slim decision ... medium stays full").
- **Run-at-commit** (`src/playground/run.js`, `github_playground_run`): resumable phases opening → provisioning →
  starting → running → disposing → done, ~40 s per call, same requestKey continues. Tests:
  `tests/unit/playground-run.test.js` (nine write-contract checks through handler, dispatch and github_call; "runs one
  command at a branch on the smallest fitting size ... cleans everything up"; "checks out an exact commit SHA and
  refuses an unreachable one"; "is resumable ..."; "refuses an invalid ref and a pass without Git access").
- **Upsize hint**: `workers/coding-workspace/runtime.js` records `out_of_memory` (`killedByOom`, `readOomKills`);
  `upsizeHint` in `src/playground/sizing.js`. Tests: `tests/unit/playground-oom.test.js`, and the real-image smoke test
  "kernel out-of-memory kill is recorded as out_of_memory, never confused with timeout or cancel" (injected counter plus
  a real cgroup OOM when the container is memory-limited, as in the image workflow).

Not proven here: a live run on the deployed server and the first published slim tag (needs the next release; the
package must be public, see the owner checklist row from the image-publish note).

## 2026-11-01 — Queued image kept at provisioning

Live run on release cbefa0be showed a queued allocation's published image replaced by a source build at provisioning; fixed and tested (see `docs/status/2026-11-01-fleet-2.md`).
