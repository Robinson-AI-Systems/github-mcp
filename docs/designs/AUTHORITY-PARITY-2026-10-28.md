# Authority alignment and GitHub MCP replacement plan

Owner-authorized 2026-10-28. Status: implementation in progress; not a completion or deployed-parity claim.

## Governing intent

The server is a tool between a user, their agent and GitHub. Authority comes from the user's actual provider grant and current instruction. An owner's informed current instruction overrides their standing defaults; a delegate cannot override its issuer's restrictions. GitHub owns billing, repository rules, environments, permission enforcement and provider rate limits. Product duties are disclosure, execution, journaling, replay protection, credential/tenant isolation, and truthful independent verification. Builder restrictions govern implementation agents only and never become end-user runtime restrictions. The product requirements are incorporated in docs/OWNER-DECISION-2026-10-27.md; private supplied reports are not reproduced and supersedes conflicting older instructions and acceptance criteria.

## Standing fallback requirement (owner, 2026-10-28)

When exact provider parity is genuinely unavailable, implement the strongest practical Robinson AI Systems alternative. Where that cannot supply the capability, the MCP must return concrete repository setup guidance with exact settings, files, commands and verification. Disclose the difference and prerequisites; never relabel a heuristic or existing-alert read as the proprietary fresh scan. `github_security_scan_guidance` implements the first such fallback for secret scanning.

## Inputs and evidence boundary

- Owner decision updated 2026-10-27, supplied in this conversation.
- Replacement verification PDF, verified live 2026-10-28: large reads broken; duplicate text/structured payloads; argument naming drift; local secret matcher weaker than provider alerts; incomplete search can return zero hits.
- The full Markdown audits and builder package referenced by those attachments were not supplied. Do not invent their contents or claim their acceptance.
- Baseline main b47643d already includes C-13 snapshots/byte windows/selectors, C-15 rate observations and C-16 write batches. Those are existing source, not new work here. Reported live behavior may predate source delivery; test actual handlers and deployment separately.
- Official parity is evaluated against the report's named operations. A broad tool count does not prove complete parity with every current official tool.

## Delivery sequence and finite acceptance

| Outcome | Implementation and design | Proof required |
| --- | --- | --- |
| 1. Authoritative rules | Incorporate owner decision; scope AGENTS, authority/review docs and plan entry points. Supersede contradictory historical requirements without rewriting dated evidence. | New builders find this plan first; no governing rule implies owner defaults outrank current owner instruction. |
| 2. Reliable complete reads | Trace content_get, dispatcher, storage and get_result through direct/MCP/meta/RTC. Keep efficient default previews but support full bounded text or deterministic complete paging even when retention is unavailable. Preserve SHA/path/continuation and UTF-8 correctness. | Reassemble 61,421-character source at one pinned SHA; multibyte text; storage failure; expiry/foreign handle; credentials withheld. No silent lost suffix. |
| 3. Efficient wire results | One full authoritative payload at public MCP boundary; compact companion metadata with explicit location. Nested workflows retain full structured data. RTC returns complete data; schema-bound results remain valid. | Small/large/error/read/write/runner/retained/RTC fixtures; no duplicate full payload and no lost status/navigation. |
| 4. Argument compatibility | Adopt aliases at declared schema boundaries for branch/ref and pull_number/number, reject conflicting values; never guess arbitrary provider parameters. | Direct/meta/RTC acceptance of aliases; conflicting values fail before provider call. Existing callers keep working. |
| 5. Honest search and scanning | Expose completeness and actionable zero-hit caveats; retain provider total/incomplete state. Label local scan as bounded heuristic over named committed files. Expose existing genuine provider secret-scanning alerts as the provider-backed route; do not imply alerts constitute a fresh whole-history scan. | Incomplete zero results cannot assert absence; local no-match cannot assert repository clean; provider endpoint shape and redaction tests. |
| 6. Shared owner write authority | Remove production/cost/notification/protected-list policy from owner full connection execution; retain disclosure and explicit dry runs. Keep chosen read-only/profile/account binding and owner-issued pass restrictions. Price unavailable becomes unknown disclosure. No tool-supplied classification creates owner ceremony. | Owner one-call paid/production/access/notifying writes; restricted passes deny; missing journal/credential or foreign tenant denies; provider refusal/ambiguous outcome/replay/readback retained. |
| 7. Tool-specific authority | Sweep branch deletion, merge and bypass, universal REST/GraphQL, project refs, owner settings and pacing for duplicate GitHub policy. Expected SHA is caller accuracy control; merge_when_green is optional automation. | GitHub accepts/refuses actual operation; no local default-branch/protection/green-check veto on ordinary owner operation. No widening of delegate scopes. |
| 8. Connection/settings transition | Inspect OAuth grants, refresh, public accounts, DB defaults, pages and issued passes. Separate connection-owned delegation from obsolete account production/cap flags. Make owner-controlled settings changeable through authorized tools where applicable. Migrate only with explicit semantics; never infer pass widening from legacy data. | Existing owner grants keep provider scope; refresh/revoke/isolation pass; legacy capped passes remain restricted; browser/database verification for any changed persistence/UI. |
| 9. Finish-work reconciliation | Reconcile FIN cards/index/roadmap/catalog against merged code and acceptance ledger. Retire obsolete guard acceptance, keep genuine missing API behavior/credential enrollment/real-client acceptance distinct. Implement concrete eligible unfinished items; do not invent scope from counts. | Every claim points to source/tests or real evidence. Named remainder has file, next action and prerequisite. |
| 10. Release and head-to-head acceptance | Reviewed PR with exact-head ci + release-policy; merge when green. Preserve builder daily-release policy unless explicitly changed by owner. Verify READY deployed source before live comparison. | Same file/SHA via official and custom, continuation, read/write/denial, supported clients; no parity claim from unit CI alone. |

## Native Git expansion

The owner asked whether actual direct full Git can be included. [Native Git workspaces](NATIVE-GIT-WORKSPACES.md) specifies the worker architecture, typed operations, isolation/credential model, conflicts, recovery, costs and acceptance. It is proposed design, not delivered functionality; this request does not make existing API git-data tools full native Git.

## Implementation boundaries

Do not weaken secrets, authentication, tenant scope, user-selected read-only grants, explicit pass restrictions, immutable request identity or readback truth. Do not provision paid services or use real destructive/paid actions as tests. No Hub dependency. Source tests use fake provider and disposable databases. Preserve exact provider refusals and Retry-After; owner writes have no additional server pacing policy. Product changes and builder operating permissions are separate.

## Current session strategy

Document first, then assemble coherent read/parity and authority changes with focused regressions. Run mandatory checks on the assembled tree, provider-shape checks for changed requests and database/browser tests for changed storage/UI. Record missing local infrastructure honestly and use exact-head CI. Open/merge the checked PR under existing authorization. Keep source, merge, release and live acceptance statuses separate. If execution limits prevent all outcomes, update the progress below and checkpoint the same plan rather than claiming completion.

## Progress

- [x] Both supplied reports reviewed; baseline source and prior merged feedback reconciled.
- [x] Full plan documented before implementation.
- [x] Governing documentation aligned; older setup/compatibility surfaces remain explicitly tracked.
- [x] Complete reads and wire efficiency verified in source and live immutable-file comparison, including exact four-window byte reconstruction after false-positive correction (#448).
- [x] Argument/search behavior and honest scanning alternatives verified in source tests; proprietary scanner parity is not claimed.
- [x] Shared owner write authority verified through handler, dispatcher and meta-tool source tests.
- [ ] Tool-specific authority and settings/connection transition verified.
- [ ] Unfinished work reconciled and implemented where eligible.
- [ ] Required checks, review and merge.
- [x] Deployed head-to-head audit read/search/scanner/alias/denial acceptance; exact evidence in the audit checkpoint. Broader paid/client/RTC acceptance remains individually tracked.

## Concrete follow-up after the first implementation outcome

See [the dated checkpoint](../status/2026-10-28-authority-parity.md) for commands, proof and named remainder. Existing work-index accounting reports CI-FAST-1 as the remaining older indexed work; this new authority/parity follow-up is tracked on AUTH-1/PAR-2 without rewriting their previous merger evidence. Legacy enrollment/UI/persisted-field cleanup, unsupported universal operation contracts, exact source-bearing release acceptance and native Git worker implementation remain separately named work. No source count, green static check or generated workflow closes those obligations.

## Current checkpoint after the audit release

#445–#448 merged, with the content correction independently serving READY on 75b4d61b. Owner setup/connection persistence and workflow result propagation were delivered in #447. Remaining duplicate typed-target confirmations and truthful unsupported GraphQL guidance are in the current owner-confirmation cleanup; exact-head review/CI/merge is still required. The existing acceptance queue now separates current restricted-grant criteria from superseded owner policy. Each real paid/destructive/client fixture remains individually named, never relabeled passed. Native Git is deferred by the owner's audit-first priority, with its portable design retained.

## Owner execution order, 2026-10-28 follow-through

Owner explicitly directs: finish implementation first, run all acceptance that does not need a release as work proceeds, then make one combined checked release and run live acceptance. Do not promote intermediate chunks. Coherent reviewed chunks may merge to main; merging is not releasing. This instruction supersedes any earlier suggestion to release #449 immediately.

Remaining implementation is grouped by usable outcome, not line counts:

1. Complete verified administrative mutation contracts and their alternative routes, plus legacy owner-facing setup/wording cleanup. Query the pinned provider schema, preserve exact account/enterprise binding and secret handling, cover before/send/readback/replay and delegated denial. Inspect the official fresh-scanning interface: integrate only if its real credential/request/result contract is verifiable; otherwise improve the concrete Robinson/repository alternative without claiming equivalence.
2. Deliver portable native-Git execution, service authorization and MCP integration together: isolated typed worker operations, durable workspace/journal/lease state, credential broker, complete protected output, real local bare-repository conflict/recovery/network tests, portable initial Dokploy packaging and migration instructions. Honest unsupported advanced capabilities must supply setup guidance. No paid infrastructure or uncontrolled host execution is inferred.
3. Reconcile documentation and perform complete pre-release verification on assembled outcomes. Reassess the existing 15 acceptance obligations; preserve real prerequisites rather than inventing passes. Once implementation is finished and exact-head checks/reviews pass, use the owner's now-authorized combined checked release, independently verify serving READY/source, and run eligible live proof. Missing exact paid/destructive fixtures remain separate, never authorization to spend.

This is the same approved audit/parity/native-Git scope. Do not label implementation finished while a functioning worker or named contract still exists only as a design. Exact publication/release/checkpoints belong in the dated status note.
