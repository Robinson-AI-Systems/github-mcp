# CAP-7 — Completeness re-census 2026-11-04: two-source reconciliation and re-issued grade

## Owner approval 2026-11-04

The fleet-wide completeness re-census runs under the RAS MCP Standard (Library D-001) as
amended by the capability-completeness grading amendment (Library PR #5, landed
2026-11-04). The amendment reopens every server's completeness rows and requires the
grade to be re-issued from a two-source map: a service-first map of the platform built
only from the vendor's official documentation, reconciled against a server inventory
built only from the server's own code — neither cartographer sees the other's work
(Critic Step 0 pattern). This card is GitHub Unleashed by Robinson AI Systems' record of
that reconciliation. Design authority: [MAXIMUM-AUTHORITY](../designs/MAXIMUM-AUTHORITY.md);
the row reopened is [CAP-1](CAP-1.md)'s.

## Outcome and acceptance

Outcome: CAP-1's completeness grade is re-issued from the two-source map counts, with
every MISSING item recorded as missing-with-plan and every COMPOSITION-OWED workflow
flagged, in the open.

Accepted when this card is merged with the counts, the grade, the missing-with-plan
rows and the declared limits below, the work index carries this card, and the index
validator passes with CAP-7 added to its acceptance units in this same change (the
validator's own rule for intentional scope changes).

## The two sources (sealed)

- Service map (GitHub's official REST + GraphQL reference only, crawled 2026-11-04):
  SHA-256 `f22e91ea30555b3129a93794f43ed648dee8c4ec804f05908cbf3aacad4bd58d`.
  ≈110 resources; ≈225 REST endpoints verified at method/path level plus ≈180 at
  title level (marked † in the map); 148 GraphQL mutations by name; 14 owner
  workflows; declared degraded items in its §20, carried into this record below.
- Server inventory (this repo's code only, frozen at `main` == `live`
  `8ed04c17f6e82148acf1a9eaad6180b296bdc75c`): SHA-256
  `19933da17e9cfa33da1081da79f7d000eab21b5fc45c0df74995961b786540bf`.
  513 registered tools counted by registry execution (223 reads, 290 writes);
  profile visibility read_only 213 / everyday 302 / full 512, plus 1 operatorOnly.

## Map counts (audited core) and the re-issued grade

Counting unit: one REST operation leg (create / read / update / delete / list-search /
named action) from the service map's resource tables. Audited core = 608 legs (map
§1–§12, §14, §15 REST rows). Outside the core, named not smoothed: the map's §7.7
Actions-administration aggregate (~30 title-level rows), §13 Apps/installations
detail, §12.6 organization-Codespaces detail, 25 unopened GraphQL reference
categories, and the map's out-of-scope areas (§20 item 6).

| Disposition | Count |
|---|---|
| Mapped (REST legs in the audited core) | 608 |
| Covered — NAMED tier (dedicated tool) | 450 (74.0%) |
| Covered — DOOR tier (universal pinned-operation tools only; presumed-pinned, see limits) | 150 (24.7%) |
| Composed (additional operation legs) | 0 — composites re-reach counted legs; composition graded below |
| Owner-excluded (operation legs) | 0 — owner rulings bind scopes, not operations (see below) |
| Missing | 4 |
| Unverified | 4 |

Arithmetic: 450 + 150 + 4 + 4 = 608. Conservative variant (every DOOR leg counted as
unproven, per MAXIMUM-AUTHORITY's rule that an API finder result alone counts zero
implemented operations): NAMED 450 (74.0%), unproven-or-missing 158 (26.0%). The grade
is PARTIAL under both variants.

GraphQL block (family-level grading): no GraphQL-only capability in the map's
inventoried set (148 mutations, 8 categories) is MISSING. Auto-merge, merge queue,
review-thread resolution, draft conversion, issue delete, comment minimize, issue pin,
one-call commits and the Projects v2 full lifecycle are COVERED-NAMED; PR
archive/unarchive and PR revert are COVERED-DOOR only (`github_graphql_write`). A
per-mutation reconciliation of all 148 names is not claimed — it is a subset of the
unresolved census block below.

Against CAP-1's frozen acceptance: criterion 1 (reproducible enumeration) MET at
source level; criterion 2 (every source operation reconciled with dispositions) NOT
MET — the server's own census at the frozen head still reads unresolved=1,184 of
1,549 operation keys and 7,286 unresolved credential decisions, and this re-census
does not disposition the full pinned surface; criterion 3 (machine-generated family
gap report) PARTIAL — machinery exists, the full-granularity gap picture sits inside
the unresolved block; criterion 4 (credential conflicts explicitly unresolved, no
invented coverage percentage, implementation separate from live evidence) MET as an
accounting discipline, with the live-evidence leg OPEN (census verified=0). CAP-1's
own status line stands as written — "APPROVED, ENGINEERING IN PROGRESS" — and the
census's "Functional coverage percentage: NOT COMPUTED" stands unreplaced.

**Re-issued completeness grade: PARTIAL.** Capped there by the amendment while
plausibly-needed capabilities stand MISSING and while criterion 2's unresolved block
remains undispositioned.

## Missing-with-plan

| # | Item | Plan |
|---|---|---|
| M1 | Agent merge configuration — get / update / disable (map §5.5, title-level) — 3 legs | TO-BE-FILED: a named-tool card in the CAP line; its first step is a pinned-catalog check for these operations, after which the legs are either covered or stay MISSING with tools built. |
| M2 | Delete a deployment record (map §9.1) — 1 leg; the core's one clean symmetry break (create exists, delete does not) | TO-BE-FILED: small card adding the delete leg beside `github_deploy_create` with the confirmation discipline of `github_actions_delete_run`, or a recorded deliberate refusal with the owner's word. |
| M3 | PR archive/unarchive + revert have no dedicated tool (GraphQL block) | TO-BE-FILED: a named-tool card in the PR line if the owner wants them curated; DOOR-covered meanwhile. Not counted in the core MISSING total. |
| M4 | The unresolved census block itself (1,184 operation keys; 7,286 credential decisions) | Plan exists — the CAP line itself. CAP-1 is IN PROGRESS; this card does not duplicate it. The grade stays capped until the block is dispositioned or the owner narrows the claimed surface. |

## Composition-owed

A job is COMPOSITION-OWED when the server's best path exceeds 3 calls. Of the map's
14 owner workflows, 12 run at ≤3 calls through this server (the composed layer — 19
`workflow`-area runners plus `github_write_batch`, `github_repo_change`,
`github_label_sync` — absorbs the rest). Two are owed:

| # | Workflow | Best path today | Proposal |
|---|---|---|---|
| C1 | W12 — triage a new issue end-to-end (raw API: 4) | 4: `github_issue_create` → `github_issue_set_labels` → `github_issue_set_assignees` → `github_project_set_item` | TO-BE-FILED: `github_workflow_issue_triage` — create + labels + assignees + project placement in one guarded call with readback. Caveat: if `github_issue_create` accepts labels/assignees inline, the count falls to 2 and the flag dissolves; the registered descriptions available to the re-census do not say so. |
| C2 | W13 — set up a Project v2 board + field + item (raw API: 4, all GraphQL) | 4: `github_project_create` → `github_project_field_save` → add item → `github_project_set_item` | TO-BE-FILED: a board-setup composition (e.g. `github_workflow_project_board_setup`); the existing `github_workflow_project_setup` composes repository setup, not boards. |

## Symmetry notes (from the reconciliation ledger)

The platform itself withholds the reverse leg in most asymmetric pairs (no PR delete
anywhere, git objects immutable, commit/deployment statuses append-only, no check-run
delete, no artifact create, secret values write-only), and the server matches the
platform's shape in every adjudicated pair but one: deployment-record delete (M2).
Owner rulings bind scopes, not operations: the owner-scope wall (enrolled accounts
christcr2012, Robinson-AI-Systems, robinson-ai-scratch; foreign-owned repositories
refused) with the recorded fac-ultra exception of 2026-11-01 (curated reads via the
collaborator credential; content-push writes to fac-ultra remain refused), per-user
enrollment for other people's accounts, and the census's refused-by-design=87 stand as
recorded — no mapped leg is dispositioned owner-excluded.

## Declared limits

- The service map's §20 degraded list is carried in full: Contents and Branches
  reference bodies failed to load mid-pass (titles verified, method lines †); git
  blob method lines not find-verified; ~30 subcategories at title level (†); team
  discussions' REST existence unverified; classic Projects REST absence
  unverified-flagged; GraphQL queries not inventoried and 25 GraphQL categories not
  opened; `unfollowUser` unverified.
- The DOOR tier (150 legs) rests on the pinned-catalog presumption (pinned REST
  2026-03-10 / GraphQL 2026-10-09 per CAP-1); the presumption and the conservative
  variant are stated with the counts above.
- The server inventory proves registration, not per-tool live function; the live
  catalog was spot-checked, not paged end-to-end.
- UNVERIFIED legs (4): get / update / delete a commit comment (map leg †-degraded,
  inventory names a create tool only) and delete an organization († leg, no tool).

## What changed

- `docs/pr-cards/CAP-7.md` (new) — this record.
- `docs/pr-cards/work-index.json` — CAP-7 registered (batch CAP, design
  [MAXIMUM-AUTHORITY](../designs/MAXIMUM-AUTHORITY.md), dependencies [CAP-1](CAP-1.md)
  and CAP-5, status IN_PROGRESS while this pull request is the landing vehicle).
- `docs/pr-cards/validate-index.py` — CAP-7 added to REQUIRED_UNITS, the validator's
  own same-PR rule for intentional scope changes. No other validator behavior changes.

## Not changed

- No source code, no tool registrations, no census code
  (`src/github/capability-inventory.js` untouched — the card joins the record, not
  the machine census).
- No existing card's text or status, including [CAP-1](CAP-1.md)'s frozen acceptance;
  the grade is re-issued here, not rewritten there.
- MAXIMUM-AUTHORITY's accounting rule stands as written and is applied, not amended.

## Drift check

Baselines re-verified before composing: both source seals match their SHA-256 values
exactly; `main` re-read at composition time is still `8ed04c17…`, the frozen head the
inventory was built from, and the live server release reports the same commit. The
reconciliation changes no behavior, raises no spend, widens no access, and touches no
credential surface; it is a record, and every number in it traces to one of the two
sealed sources or to arithmetic shown beside it.
