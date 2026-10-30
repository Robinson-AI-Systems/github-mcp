# Execution cards — just in time

Same system as the Stripe MCP and Appliance Desk. The implementing agent writes short cards for the related approved units selected for the current bundle and,
when useful, its immediate successor. Sol 5.6 at light/medium effort is the intended routine use (`SOL-GUIDE.md`). Avoid writing distant
cards whose prerequisites are hypothetical; `work-index.json` preserves all later scope. A missing card is work, not a
reason to stop. Designs govern behavior; cards cannot silently override them. A card preserves an existing subsection ID and full acceptance, not a mandatory separate PR. Size PRs by outcome (AGENTS "Size a PR by outcome"); do not invent or subdivide IDs to inflate completion.

## Minimum card (usually 40–100 lines)

Keep one finite consumer/fixture checklist for the selected outcome: actual symbol
and caller, required input/result shape, persistence/provider boundary, role/scope,
full synthetic fixture and refusal/recovery proof. Reuse existing recipes/decisions;
check the real adapter/form control early. This is detail inside the current card,
not another planning document, invented subsection or separate approval ceremony.

- ID, title, design section, prerequisites, "Baseline inspected" SHA.
- Risk/permission boundaries and migration ownership/order (if any), plus an honest workload estimate. No per-card line ceiling. Name the bundle's selected subsection IDs, complete connected outcome and any concrete reason to split delivery; related migrations and risk areas may share a PR while retaining every independent guard/test.
- **Read only these:** a bounded list of design headings and files (with line ranges when long).
- Literal `## Drift check A` heading with an actual comparison table (or "first card: no prior code"). The index validator requires the words `Drift check`; do not paraphrase that heading.
- Build contract: files, exported signatures, which tools (by TOOL-CATALOG name) with their safety marks (production,
  access, message, spend), credential (`I`/`U`/`K`), summaries used, GitHub operations (method + path from
  `node scripts/openapi-find.mjs`, or the GraphQL mutation/query from `node scripts/graphql-find.mjs`).
- Named tests: unit, write-contract (nine checks) per write tool, request-shape test per GitHub call (fake GitHub
  validates against the vendored description), db when SQL changes.
- Commands to run (with `set -o pipefail` when piping).
- Done when: observable conditions; what the successor inherits.

Validate coverage with `python3 docs/pr-cards/validate-index.py` and the catalog with `python3 scripts/count-catalog.py`.

## Extra execution detail (prepare once, reuse while coding)

Use [IMPLEMENTATION-DETAIL](../implementation-contracts/IMPLEMENTATION-DETAIL.md) when preparing the card.
Find the current unit in [REMAINING-WORK](../implementation-contracts/REMAINING-WORK.md), then cite only the needed
[TOOL-RECIPES](../implementation-contracts/TOOL-RECIPES.md) heading. Record exact exports, argument-to-request mapping,
before/after verification, fixture arrangements, forbidden side effects and ordered slices with focused commands.
The [G-4 packet](../implementation-contracts/G-4-PACKET.md) is a worked example, not a READY card.

Keep distant work as navigation rows with proposed paths; the JIT card resolves paths against actual code. Put large
tables in a linked companion packet so a resumed implementer reads the exact current slice, not every future unit.
Shared nine-check tests remain mandatory; compound workflows also need mutation-trace and partial-failure coverage.

## Effort guide for Sol 5.6

Light: read tools in an area whose pattern already exists; docs cards. Medium: the trust layer and every guard, merges,
secrets, credentials and login, passes, universal tools, developer tools, anything touching SQL. A Sonnet/Opus second
opinion is optional and limited to one concrete question; no mandatory model switch.
