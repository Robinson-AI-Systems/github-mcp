# FLEET-7 — Warm runtimes that switch on only under measured demand

## Owner approval 2026-11-01

Chris approved items 1–9 on 2026-11-01 with self-aware gates. Design and gates: [GATED-EXPANSION](../designs/GATED-EXPANSION-2026-11-01.md).

## Outcome and acceptance

Outcome: pre-started single-use runtimes cut start time, but only when measured demand and host headroom exceed stored thresholds; otherwise dormant, and they drain when demand falls. Never pre-binds credentials.

Accepted when the gate is implemented as code with tests for both the on and off decision, the feature works through every door it is offered on, and docs/TOOL-CATALOG.md describes it.

## Drift check

No gate raises spend, widens access or opens public sign-up by itself. Secrets never pass through a tool.
