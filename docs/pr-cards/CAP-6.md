# CAP-6 — Runners, merge queue and Copilot tools listed only where the feature exists

## Owner approval 2026-11-01

Chris approved items 1–9 on 2026-11-01 with self-aware gates. Design and gates: [GATED-EXPANSION](../designs/GATED-EXPANSION-2026-11-01.md).

## Outcome and acceptance

Outcome: tools for self-hosted/larger runners, merge queues and Copilot exist, are listed only for accounts where the feature is present, and every spending action is classified spend with price and confirmation.

Accepted when the gate is implemented as code with tests for both the on and off decision, the feature works through every door it is offered on, and docs/TOOL-CATALOG.md describes it.

## Drift check

No gate raises spend, widens access or opens public sign-up by itself. Secrets never pass through a tool.

## 2026-11-01 — Built (branch `ai/claude/cap-6-gated-feature-tools`)

Outcome: the runner, larger-runner, merge-queue and Copilot families are offered only for accounts where GitHub shows
the feature, and every spending tool in them always asks first and shows its price or COST UNKNOWN. Acceptance: the gate
is code (`src/github/feature-gates.js`) with on, off and unknown decisions tested for every family, through every door
(MCP `tools/list`, dispatcher, `github_call`, `github_search_tools`, `github_describe_tool`, RTC discovery), and
`docs/TOOL-CATALOG.md` describes it.

What was already built (Batch Y) and is now gated: `github_runner_*` (8: list/get runners and groups, remove, labels,
group save/delete/access, registration/removal/JIT tokens revealed only on the one-time setup page, never in a result),
`github_hosted_runner_*` (4, create/scale-up spend), Copilot seats, policy, content exclusions, agent tasks, Spaces and
`github_review_request_copilot`.

New tools: `github_feature_families` (read; why a family is hidden; `refresh`), `github_merge_queue_get`,
`github_merge_queue_enqueue` (exact expected head, optional jump, undo = dequeue), `github_merge_queue_dequeue`,
`github_copilot_assign_issue` (GraphQL `addAssigneesToAssignable` with the bot id GitHub offers; user credential).
The universal GraphQL tool keeps refusing `enqueuePullRequest`/`dequeuePullRequest` and now points to these tools.

How each gate decides (cached 10 minutes per connection and account; `on` lists and runs, `off` hides and refuses a call
by name with the reason, `unknown` hides from lists but a call by name runs and GitHub decides):

| Family | On | Off | Unknown |
|---|---|---|---|
| Self-hosted runners | org: `GET /orgs/{org}/actions/runners` answers; personal account: always (repository runners) | org: 404 | 401/403, outage, 4 s timeout |
| Larger runners | org: `GET /orgs/{org}/actions/hosted-runners` answers | personal account; org 404/422 | 401/403, outage |
| Merge queue | a merge queue on one of the org's 25 most recently pushed repositories (GraphQL) | personal account; none found | 401/403, outage |
| Copilot | org: `GET /orgs/{org}/copilot/billing` answers; personal: `copilot-swe-agent` offered on the newest repository | org 404/422; personal: not offered / no repository | 401/403, outage |

Spend (owner decision 2026-11-01: "shows the price and needs confirmation"): new write-layer declaration `strictSpend`
(contract-generic, `src/core/write.js`): every connection, the owner's own included, must confirm, and a price function
that fails refuses for everyone. `src/tools/index.js` refuses to start if a spending tool in a gated family lacks it.
Strict: `github_hosted_runner_create`, `github_hosted_runner_scale_up`, `github_copilot_add_seats`,
`github_copilot_team_seats`, `github_copilot_agent_task_start`, `github_copilot_assign_issue`, and
`github_review_request_copilot` (now spend: since 2026-06-01 Copilot code review uses AI credits and Actions minutes).
Known prices come from `src/github/prices.js` (Copilot seats); metered actions GitHub does not price per use return an
explicit `null` and show COST UNKNOWN with mandatory confirmation. Self-hosted runner administration stays $0
(GitHub postponed its announced $0.002/min self-hosted charge, changelog 2025-12-16 update; re-check if it returns).

Left out, and why:
- Copilot usage-metrics reports (`/orgs/{org}/copilot/metrics/reports/*`): GitHub answers only with signed download
  links, which must never reach a model (DECISIONS 2026-10-26); seat (`github_copilot_get_billing`) and premium-request
  (`github_billing_get_usage` with `premiumRequests`) reports already exist.
- No token flow returns a secret: registration/removal/JIT tokens stay on the one-time page (`github_runner_register`).

Tests: `tests/unit/cap-6-feature-gates.test.js` (gates on/off/unknown for every family, cache, listing, refusal through
dispatcher and `github_call`, search/describe, production door wiring), `tests/unit/cap-6-tools.test.js` (nine-check
write contract for enqueue, dequeue and assign through handler, dispatcher and `github_call`; refusals; spend
classification and `strictSpend`), `tests/shapes/cap-6-shapes.test.js` (every probe and new document schema-valid),
`tests/unit/mcp-endpoint.test.js` (tools/list honours the gate and survives a failing one). Real-account acceptance:
not run (needs an organization with these features; recorded in the status note).
