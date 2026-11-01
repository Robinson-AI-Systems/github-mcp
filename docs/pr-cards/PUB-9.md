# PUB-9 — Fine-grained token tenants, offered only when enrolled

## Owner approval 2026-11-01

Chris approved items 1–9 on 2026-11-01 with self-aware gates. Design and gates: [GATED-EXPANSION](../designs/GATED-EXPANSION-2026-11-01.md).

## Outcome and acceptance

Outcome: people can enroll a fine-grained token on the protected page; the tools it unlocks come from its actual permissions; nothing is offered until one is enrolled.

Accepted when the gate is implemented as code with tests for both the on and off decision, the feature works through every door it is offered on, and docs/TOOL-CATALOG.md describes it.

## Drift check

No gate raises spend, widens access or opens public sign-up by itself. Secrets never pass through a tool.
