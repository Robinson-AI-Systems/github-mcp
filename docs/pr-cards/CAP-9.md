# CAP-9 — Agent merge configuration legs (CAP-7 follow-on M1): pinned-catalog check

## Origin

[CAP-7](CAP-7.md)'s missing-with-plan row M1: "Agent merge configuration — get / update /
disable (map §5.5, title-level) — 3 legs. TO-BE-FILED: a named-tool card in the CAP line; its
first step is a pinned-catalog check for these operations, after which the legs are either
covered or stay MISSING with tools built." This card is that filing, and its first step — the
pinned-catalog check — was run in the change that lands the card (Takeover Batch 2,
2026-11-04).

## The pinned-catalog check (2026-11-04, against the census pins)

Method: the repository's own finders over the pinned sources — `scripts/openapi-find.mjs`
over the pinned REST description (2026-03-10) and `scripts/graphql-find.mjs` over the pinned
GraphQL schema (schema-2026-10-09).

- REST: no operation reads, updates or disables an agent merge configuration. The pinned
  agent surface is agent TASKS (`/agents/tasks`, `/agents/repos/{owner}/{repo}/tasks`) and
  organization agent secrets/variables (`/orgs/{org}/agents/...`). Word searches for
  "merge configuration" and for agent-merge routes return nothing.
- GraphQL: no `agentMerge`, `mergeConfiguration` or Agent-merge field exists in the pinned
  schema (name searches return no match).

## Disposition

The three legs STAY MISSING. There is nothing in the pinned catalogs to build a named tool
against, and nothing for the universal door to dispatch — the map's §5.5 rows were
title-level († degraded in the service map itself), and at method/path level the pinned
sources do not contain the operations. This matches CAP-7's own plan for the outcome
("or stay MISSING with tools built" — no tools can be built).

Revisit condition: a future catalog re-pin (a newer REST description or GraphQL schema
revision entering this repository's pins) that contains agent merge-configuration
operations reopens this card; the check above is the exact procedure to re-run.

## What changed

- This card and its work-index registration only. No source code, no tool registrations,
  no census code: the census correctly keeps the surface absent because the pinned
  sources do not contain it.

## Drift check

Baselines re-verified before composing: both finders were run at the Batch 2 head against
the repository's vendored pins, the same pins the census is built from (REST 2026-03-10
revision `58b1e0c0…`, GraphQL schema-2026-10-09 revision `be38ec5d…`). The check is
reproducible from the commands named above; it changes no behavior, raises no spend and
widens no access.
