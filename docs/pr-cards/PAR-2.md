# PAR-2 — organization issue taxonomy reads and on-demand repository secret review

**Owner authorization:** 2026-10-26 request from Muse comparison. **Outcome:** a connected GitHub user can discover their organization's issue types and issue fields using dedicated bounded read tools, and can request a no-secrets-returned review of selected GitHub-hosted repository files for high-confidence credential patterns, without creating alerts or changing files. Ship together as an MCP usability/parity bundle; extend PAR-1.

## Drift check

| Expected prior state | Verified in source | Implementation |
| --- | --- | --- |
| No standalone org issue type/field readers | `org-planning.js` uses the GETs internally only for writes | Expose bounded read-only tools with connected-org checks |
| Alerts exist but no file-triggered secret review | `security-read.js` reads stored alerts only | Bounded, redacted selected-file scanner; no unsupported GitHub remote API claims |
| Catalog was 471 tools, PAR-2 unindexed | Registry and checker output | Add PAR-2 to work index and reconcile 474 catalog tools |

## Acceptance criteria

- [x] `github_org_list_issue_types` and `github_org_list_issue_fields` use the exact REST GET endpoints on the connected organization, reject personal/foreign orgs, report plan/permission errors plainly, and project only bounded metadata with explicit partial/truncation indicators.
- [x] Read tools return IDs, type names, descriptions, enabled flags/colors, field types/visibility/select options, with no secrets or unrelated GitHub objects. Tests cover missing or wrong org, empty collection, capped responses and permission failures.
- [x] `github_security_scan_files` accepts only an enrolled repository + explicit paths/ref (not raw code, credentials or arbitrary URLs), obtains file content through the existing authenticated GitHub client and scans *server-side*. A finite cap limits files, bytes, time, binary/symlink/large files; all incomplete scans are clearly marked.
- [x] A credential detection engine recognizes bounded high-confidence token/private-key patterns; findings contain only rule, path, line and remediation — **never** original token values, snippets, file content, or logs. No repository writes, alerts, stored scan payloads or client-supplied secret strings.
- [x] Tests cover positive and negative synthetic fixtures, fake GitHub request shapes, cross-account rejection, invalid paths, oversize, binary and unreadable files, findings redaction and the registry/tool discoverability.
- [x] Catalog, roadmap/status, handoff and tests reconciled; exact-head CI/release-policy and reviews passed through #453. Combined checked release 40743480147 serves READY 53df99ef. Actual proof and named remaining native ingress/fixture prerequisites are in docs/status/2026-10-28-combined-release.md.

## Honest boundaries

GitHub's **official** `run_secret_scanning` is a remote-MCP-only feature backed by GitHub Secret Protection, with ephemeral findings. GitHub's public REST API has **no equivalent ad-hoc scanning endpoint**. Our bounded built-in pattern scanner scans only *existing selected repository files* via a GitHub App grant, not uncommitted local IDE files, and is not a replacement for GitHub's proprietary engine, full historical scan, push protection, or secret-scanning alerts. It must never claim coverage parity or declare a repository clean solely on no matches; use GitHub's official scanner for its stronger detection. No newly enabled GitHub paid features or credentials.

## Implementation checkpoint

Plan committed before feature changes. Implementation and synthetic tests checked in; their suites passed on an earlier CI revision, but latest-head required CI and real Muse/provider acceptance must still be verified before merge and deployment. 

## 2026-10-28 remediation — Drift check and current scope

The [authority/parity plan](../designs/AUTHORITY-PARITY-2026-10-28.md) supersedes older owner confirmation/cap/protection acceptance in this card. Reuse existing implementations; complete-read fallback, owner write authority and repository scan guidance are current work. Historical MERGED status does not certify this follow-up or deployed parity. Keep existing completion evidence unchanged; follow-up proof belongs in the dated remediation status.

### Live false-positive correction, 2026-10-28

The first authorized audit release exposed RTC schema names being redacted and exact byte windows refused. Correct the detector against the actual issued-pass format, retain positive credential protection, add value-free rule/location diagnostics and explicit redacted-text metadata, and verify the exact database-module blob through both official and custom routes after deployment. See `docs/CONTENT-PROTECTION.md`. Native Git is lower priority and not included.

## Owner-approved native Git expansion, 2026-10-28

Five native workspace tools connect the existing MCP lifecycle to a portable signed-HTTP worker running real Git, using tenant/connection-bound job metadata and per-request provider authorization. Scope, commands, limits, advanced local alternatives and migration/acceptance procedure are in docs/NATIVE-GIT-OPERATIONS.md. Existing API-only and scanner work remains separately evidenced; this expansion does not close proprietary scanner equivalence. The owner directs implementation/pre-release tests first, one combined checked release afterward, then live acceptance. Native source/image/live proof must remain distinct.

### Combined delivery and live boundary

#449–#453 are merged and released together after source checks. Large full/byte reads, value-free false-positive diagnostics, organization IP inventory, security-setting dry runs, scratch repository create/delete, headers, unauthenticated denial and PKCE method checks were exercised on READY 53df99ef. The native image is deployed and internally healthy with Git 2.39.5, but external ingress times out. Hosted native clone/push is still blocked on an authorized network route, not declared passed. See the combined release checkpoint and operations re-entry recipe.

## Agent-managed repository protection, 2026-10-28 follow-up

Owner requests database-password coverage, removal of unrelated project references and a compact direct scanner toolset. Implement one gateway with repository-scoped typed rules, narrow immutable-file exceptions, versioned CAS/history/rollback, mandatory who/when/why and pinned before/after retest receipts, and non-applying portable profile offers. Default coverage includes reviewed Gitleaks rule breadth with attribution; no proprietary engine equivalence is claimed. File-output guards and scanner findings share repository policy; native transport versioning prevents an old worker from silently ignoring it. See docs/SECRET-SCANNER.md and docs/status/2026-10-28-database-password-protection.md. New exact-head CI/image/review/merge/release and synthetic live probes are required before claiming this follow-up delivered.

Live acceptance correction: normalize scanner policy objects for PostgreSQL JSONB readback, while preserving all values and array ordering. See [scanner release acceptance](../status/2026-10-28-scanner-release-acceptance.md). No weakening of verification or initial unconfirmed evidence.

## Current live acceptance, 2026-10-28

Scanner follow-up and the native Git worker now have actual custom-MCP evidence on READY8004b9e: signed Render route, native clone/edit/commit/push with provider readback, replay/refusal, conflict/abort, persistence across redeploy, repository policy propagation and non-applying profile offer, tested rollback and exact fixture cleanup. See [dated proof](../status/2026-10-28-render-native-git-acceptance.md). This satisfies the native-worker lifecycle row only; retain unrelated external prerequisites and advanced local Git alternatives.

## Switch and parallel-agent follow-through

Owner reports three switch preflight refusals and requests usable parallel agents. Shared branch/name/ref switch aliases, safe argument/capacity feedback and independently checked-out branch verification are covered by real dispatcher/Git tests. Separate workspace HTTP calls overlap up to a reviewed capacity of two; same-workspace exclusion, overload/Retry-After and replay remain tested. No host resize or paid upgrade. See [current follow-through](../status/2026-10-28-native-git-follow-through.md) for exact checks/deployment/remaining evidence; initial Render lifecycle acceptance remains separately recorded.

## Four-agent capacity follow-through, 2026-10-29

Owner requests more native Git concurrency for multiple AI agents. The existing configured worker is validated at four simultaneous independent requests, preserving same-workspace exclusion and bounded overload. No host resize or new paid resource; current sampled resource headroom and exact live fixture proof belong in [capacity note](../status/2026-10-29-native-git-capacity.md). This limit applies to native execution, not the API-based GitHub tools.

## Native contract/lifecycle fleet repair, 2026-10-29

Active follow-up: [contract/lifecycle note](../status/2026-10-29-native-git-contract-lifecycle.md). Branch create/rename/delete aliases and operation-specific help, independent ref readback, explicit failed previews, bounded transport diagnostics and historical versus current clone replay are under verification. Dispatcher/real-Git regression includes a moved main, true two-parent merge and identical pushed commit on a previously absent remote branch. This is source proof only until checked merge/release and authenticated live acceptance; preserve the existing four-request capacity and disk. External helper batching, CI/log/receipt/rule diagnostics remain separate unresolved fleet work.

### Durable native clone retry follow-up, 2026-10-29

The fleet lifecycle acceptance found ten-minute request buckets could reopen a closed clone. Keep native clone intents stable across buckets, recover legacy journal receipts only after original client/pass ownership proof, and refuse without cloning if historical metadata is unavailable. Real dispatcher/Git tests cover one-hour active/disposed retries, fresh keys, legacy recovery and foreign passes; the existing shared database contract covers literal-prefix lookup against isolated PostgreSQL in CI. Other write contracts are unchanged. Exact-head review/checks and live proof are recorded in [the durability note](../status/2026-10-29-native-open-durability.md).

### Owner-requested activity-based native leases, 2026-10-29

Outcome: preserve an agent's workspace while authorized activity continues; use four hours of inactivity by default, not four hours since creation. Update worker deadlines, connection-bound metadata, old-workspace adoption, protocol compatibility, cleanup, replay and all callers together. Real dispatcher/Git virtual-clock regressions cover continued reads/writes past the original deadline, idle expiry, no-renew inventory/health, foreign/revoked callers, legacy adoption, generation/lock preservation and closed replay. The shared isolated PostgreSQL contract must certify active-only scoped renewal. Worker-first compatible rollout, exact-head required CI/image/review, checked manual release and disposable live idle-window proof are tracked in [the idle lease note](../status/2026-10-29-native-idle-leases.md).


## Owner-requested Dokploy cutover, 2026-10-29

Move the active worker to the repaired Dokploy HTTPS route, preserving verifier, storage and all existing work. The Compose default becomes eight concurrent requests, shared 2 GiB RAM and configurable two-CPU ceiling; standalone/Render settings remain unchanged. Extend the real dispatcher/Git capacity test through eight, including per-workspace exclusion and ninth-request overload. Acceptance: reviewed exact-head checks/image; matching Dokploy source; signed protocol-3 idle-v1/eight capacity; eight parallel clone/write/exact reads; persistent uncommitted bytes across redeploy; authenticated commit/push and independent remote verification; exact run-owned cleanup. Check aggregate active jobs across all connections immediately before cutover. Zero permits an empty active-state cutover with both old volumes retained; otherwise preserve/migrate active state before switching. Source/configuration proof is not live acceptance. See [cutover record](../status/2026-10-29-dokploy-native-cutover.md).

Cutover CI repair: the first full unit run hit its existing hard watchdog, so the same full suite is divided into six independently isolated Vitest partitions. The layout guard rejects collapsed partitions or a denominator mismatch. All existing timing/aggregate/secret/permission controls remain; no timing-only retry or raised timeout.


## Native worker host continuity correction, 2026-10-29

The first cutover inventory inspected only the default schema; isolated tenants retained two old active workspace rows. Preserve the two hosts and route stored workspaces to their original configured origin while new clones use Dokploy. Compact host pins, explicit previous-origin/cutover metadata for old rows, no arbitrary origin/fallback, real two-worker Git preservation/replay/close and fail-closed route tests are required. The earlier zero-active inference is withdrawn; see [host continuity record](../status/2026-10-29-native-worker-host-routing.md). Finish operational proof before claiming full cutover.


Dokploy migration accepted for new workspaces on READY0af2bd93832d5806f9ddcfed6d6c9f77b3265799: matching actual worker source, signed eight-request idle-v1, eight fresh parallel clone/write/exact-read lanes, independent native push SHA/parent, persistent uncommitted bytes and exact cleanup passed. Previous-host continuity was also exercised live with a disposable Render marker. Two older workspace rows remain on Render during a non-destructive drain; retirement is pending, not a completed cancellation. See [final cutover record](../status/2026-10-29-dokploy-native-cutover.md).

## 2026-10-29 — resource admission follow-through

Current owner instruction applies globally: no daily job quota and no fixed native Git request/workspace count. Worker resource observations govern native execution; native metadata bypasses generic pending-job slots, with isolation, TTL, ordinary background-job reservations and result retention unchanged. Twelve held real-Git service requests, pressure/recovery/replay/disposal tests, real-process/filesystem sampling, two-tenant Postgres and packaged-image acceptance cover this repair. See [implementation and deployment record](../status/2026-10-29-native-resource-admission.md); source tests and live verification remain distinct.
