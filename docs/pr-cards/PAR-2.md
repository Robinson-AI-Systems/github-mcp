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
