# CAP-6 — Runners, merge queue and Copilot tools listed only where the feature exists

## Owner approval 2026-11-01

Chris approved items 1–9 on 2026-11-01 with self-aware gates. Design and gates: [GATED-EXPANSION](../designs/GATED-EXPANSION-2026-11-01.md).

## Outcome and acceptance

Outcome: tools for self-hosted/larger runners, merge queues and Copilot exist, are listed only for accounts where the feature is present, and every spending action is classified spend with price and confirmation.

Accepted when the gate is implemented as code with tests for both the on and off decision, the feature works through every door it is offered on, and docs/TOOL-CATALOG.md describes it.

## Drift check

No gate raises spend, widens access or opens public sign-up by itself. Secrets never pass through a tool.
