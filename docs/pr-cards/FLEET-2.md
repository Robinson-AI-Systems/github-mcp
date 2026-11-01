# FLEET-2 — Faster small runtimes: slim image, run-at-commit mode, upsize hint

## Owner approval 2026-11-01

Chris approved items 1–9 on 2026-11-01 with self-aware gates. Design and gates: [GATED-EXPANSION](../designs/GATED-EXPANSION-2026-11-01.md).

## Outcome and acceptance

Outcome: small jobs start on a slim runtime image (no Chromium/PostgreSQL) when the repository shows no browser/database signals; a run-at-commit tool runs one command at a ref and cleans up; an out-of-memory kill is reported as `out_of_memory` with the next size. Gates: see design.

Accepted when the gate is implemented as code with tests for both the on and off decision, the feature works through every door it is offered on, and docs/TOOL-CATALOG.md describes it.

## Drift check

No gate raises spend, widens access or opens public sign-up by itself. Secrets never pass through a tool.
