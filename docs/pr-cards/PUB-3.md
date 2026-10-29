# PUB-3 — Private tenant capacity, abuse controls and incident isolation

**Stage: PUB-3 source implementation completed on PR #267; live/mobile/provider acceptance independent; merge requires final exact-head green CI/review**. Source baseline `3c68af7dfe0a2352d53f490a395908bc3b2be260`. Existing private tenant OAuth was merged in PR #264; no live/private device acceptance is asserted. Keep plugins private and do not create a customer signup or pay for load testing.

## Drift check A — shared caller paths and safety policy

- Existing GitHub rate limiter `src/github/rate.js` uses **per-tenant isolated database** for per-account/installation provider blocks; owner global legacy path unchanged. Private tenant aggregate budgets and abuse limits are missing.
- Existing `src/db.js` result_store and gh_async_jobs retain 24-hour entries, but have no per-tenant storage ceiling/concurrency cap. Private namespaces already isolate all tables; avoid weakening provider permissions or user abilities to solve capacity.
- Existing `api/mcp.js`, `src/tenancy/mcp-route.js`, `src/tenancy/oauth-token.js`, OAuth and job start/result read seams are available. Limit only after verified tenant resolution; unauthenticated abuse receives refusal with no owner database fallback.
- Keep private tenant opt-in OFF by default. App storage/limits are separate from product spending caps and the developer's $0 execution budget. Existing owner may choose additional user-authorized capabilities.
- Do not add PII/credentials to telemetry; redact errors categorically; use opaque event/operation classes and bounded duration histograms.

## Original whole PUB-3 acceptance

1. [x] Every active private tenant has atomic, independently configurable Postgres-backed account/connection request budgets and failure-path burst defenses across multiple Vercel instances; a burst by tenant A never consumes tenant B's counters or lets unauthorized calls reach GitHub.
2. [x] Existing jobs, retained results and GitHub API access obey tested per-tenant/per-client bounded concurrency, size, lifetime and stored-row caps; expired records are reclaimed safely without deleting live work or data belonging to another tenant.
3. [x] An authenticated tenant revoke/suspend/cancel makes further private traffic fail closed, including already-issued bearer refresh, outstanding jobs and result reads; previous and other tenants' data remains confidential.
4. [x] Private operational metrics record bounded nonsecret rate decisions, request duration buckets, OAuth/refresh outcome classes and service/provider failures with no tokens, credentials, private repository content, raw URL queries, email or user-provided error strings.
5. [x] Real disposable PostgreSQL two-tenant tests exercise concurrent requests, duplicate submissions, quota recovery, malicious/oversized payloads, tenant revocation, retention deletion and provider failure; unit/shape/RTC/CI and release-policy remain intact.
6. [x] Current legacy owner path, all end-user delegated GitHub capabilities and production/approval/spend/protected-resource rules stay unchanged; operational fair-use limits are explicitly disclosed and must not silently impose the developer agent's $0 testing policy on customers.

## Implementation / proof plan

Atomic fixed-window tenant and per-connection quota claims in a shared per-tenant PostgreSQL schema, implemented with parameterized single-statement upsert and strong scoped keys. A reserved slot counts even if GitHub refuses; honest retry metadata. Bound concurrent jobs by tenant and client with read-before-insert prevented by a lock; cap retained result bytes/count while allowing normal shaped pagination. Expired results/jobs removed in bounded batches without touching active records. Telemetry uses predefined event types, coarse duration buckets, no raw bearer/url/errors or content, and a 24-hour retention cut.

Stress the real DB with concurrent two-tenant connections and the same IDs to prove separate quotas; verify rollback/retry, no job oversubscription, throttled cleanups and revocation. Validate all existing write and OAuth tests and both full unit shards. Update docs/STATUS.md, owner guide, roadmap, risk/decision notes and record line counts. No external runtime config, paid capacity, public listing or live write.

<!-- bundle-plan:start -->
```json
{
  "workKind": "ENGINEERING",
  "baseRevision": "3c68af7dfe0a2352d53f490a395908bc3b2be260",
  "outcome": "Complete PUB-3 PRIVATE tenant-aware runtime capacity and reliable isolation across requests, jobs, results, telemetry and revocation, while preserving legacy owner behavior and user permissions.",
  "integrationBoundary": "Private tenant MCP and OAuth path, isolated Postgres namespaces, existing job/result storage, no public customer enrolment, no new spending/provisioning/release.",
  "newEngineering": "Per-tenant atomic quota storage and enforcement, bounded retained data, safe cleanup and abuse-aware metrics, per-tenant independent DB tests with concurrent clients, auth refusal and real write gates untouched.",
  "estimatedProductionLines": 650,
  "relatedWorkDecision": "One substantial complete PUB-3 runtime isolation and resource protection trust boundary in one PR; PUB-4 real two-device acceptance remains a separate integration bundle.",
  "subsections": [
    {
      "id": "PUB-3",
      "acceptance": [
        "Every active private tenant has atomic, independently configurable Postgres-backed account/connection request budgets and failure-path burst defenses across multiple Vercel instances; a burst by tenant A never consumes tenant B's counters or lets unauthorized calls reach GitHub.",
        "Existing jobs, retained results and GitHub API access obey tested per-tenant/per-client bounded concurrency, size, lifetime and stored-row caps; expired records are reclaimed safely without deleting live work or data belonging to another tenant.",
        "An authenticated tenant revoke/suspend/cancel makes further private traffic fail closed, including already-issued bearer refresh, outstanding jobs and result reads; previous and other tenants' data remains confidential.",
        "Private operational metrics record bounded nonsecret rate decisions, request duration buckets, OAuth/refresh outcome classes and service/provider failures with no tokens, credentials, private repository content, raw URL queries, email or user-provided error strings.",
        "Real disposable PostgreSQL two-tenant tests exercise concurrent requests, duplicate submissions, quota recovery, malicious/oversized payloads, tenant revocation, retention deletion and provider failure; unit/shape/RTC/CI and release-policy remain intact.",
        "Current legacy owner path, all end-user delegated GitHub capabilities and production/approval/spend/protected-resource rules stay unchanged; operational fair-use limits are explicitly disclosed and must not silently impose the developer agent's $0 testing policy on customers."
      ],
      "remainingEngineering": [
        "Scoped atomic rate/capacity decisions in private tenant PostgreSQL and requests",
        "Bounded per-tenant async jobs/results and retained bytes, cleanup and revocation",
        "Privacy-safe operational metrics without token/repository/PII leaks",
        "Real two-tenant Postgres concurrency, oversized payload, replay and revoked session tests",
        "Check, full exact-head CI, review and documentation; no live/public/spend changes"
      ]
    }
  ]
}
```
<!-- bundle-plan:end -->

## Source verification and security closeout — 2026-10-19

Implementation head `49ee0e1aa1b6e8eca012651e3451662cf1f16c54` passed full `ci 39352668681` including check, two unit shards, disposable PostgreSQL, shapes, RTC; `Daily live policy 39352668770` passed. Initial red CI diagnosed a corrupted duplicate source module, then a test counting an earlier tenant job as the same client's slot; both corrected without reducing quota enforcement or suppressing tests. Later real PostgreSQL verified per-tenant owner budget configuration and owner-only cleanup preserving another tenant. Source commits and tests do NOT establish real GitHub mobile/desktop acceptance or public scale readiness. No live deployment/pilot enablement or extra spending.

1. **Source proof:** Actual isolated Postgres capacity functions claim tenant and per-client counters atomically inside rollback-on-refusal SQL subtransactions; two independent connections exercise races; private request and OAuth routes gate before provider/dispatch; a protected owner form configures scoped request budgets. `tests/db/pub-3-runtime.test.js`; CI 39352668681 passed.

2. **Source proof:** Scoped job/result store wrapper validates max TTL, body bytes, daily usage and active reservation slots; concurrent Postgres claims refuse over limit; expiry cleanup uses bounded deletes; independent tenant B untouched; real DB and unit regression; CI 39352668681 passed.

3. **Source proof:** Existing signed tenant access checks owner/allowlist on each request; protected owner action revokes first, then private incident cleanup clears oauth clients/codes, bearer grants, jobs and retained results via one scoped statement. New real DB test forbids nonowner cleanup, verifies disabled tenant A, preserves tenant B, and CI 39352668681 passed.

4. **Source proof:** Record only fixed event, outcome and coarse latency buckets; private MCP/OAuth/refresh and provider transport events are emitted with redacted tenant SQL. Tests reject raw user-provided errors/URLs/token values and prove successful/refused/provider-failure class counts; CI 39352668681 passed.

5. **Source proof:** Two-tenant disposable Postgres checks overlapping clients and key names, atomic racing claims, independent counters, retained limits, TTL, tenant-local revocation/cleanup; unit tests check limits, malformed inputs and secrets; exact-head CI 39352668681 and daily policy 39352668770 passed on implementation head. Final docs-only head still needs new exact-head CI.

6. **Source proof:** Only PRIVATE tenant API and protected owner form changed. Legacy owner route bypasses tenant fair-use controls; original write/production/spend/approval/protected-resource rules unchanged. Private pilot OFF unless separately configured; no capacity purchase, public App enrollment, manual release or provider write. Source audit and green CI required after final doc commit.

**Outcome:** one original PUB-3 engineering subsection; the original 57-row provider acceptance remains unchanged (14 passed, 28 pending, 15 blocked, with 2 optional Hub-only rows). PRIVATE owner and GitHub safeguards retained. Exact HEAD after documentation reconcile still requires GitHub Actions green and reviewer threads resolved before merge.

<!-- bundle-delivery:start -->
```json
{
  "productionAdded": 604,
  "productionRemoved": 15,
  "newEngineering": "Per-tenant atomic usage and slot claims, safely configurable budgets, job/result wrappers, coarsely aggregated telemetry including provider outcomes, owner emergency revocation recovery",
  "planComparison": "Completed the approved PUB-3 runtime boundary, without publishing or making any provider/device acceptance claim; final source size and line counts documented after diff audit.",
  "relatedWorkDecision": "One substantial whole original PUB-3 subsection, not separate helper credits.",
  "decision": "SUBSTANTIAL_EXCEPTION",
  "exceptionEvidence": "One cross-cutting private tenant reliability/security boundary spans SQL, MCP/OAuth request gates, protected owner UI, real PostgreSQL concurrence tests, cleanup, telemetry; the implementation is cohesive and requires full independent CI despite single subsection.",
  "subsections": [
    {
      "id": "PUB-3",
      "criteria": [
        {
          "criterion": "Every active private tenant has atomic, independently configurable Postgres-backed account/connection request budgets and failure-path burst defenses across multiple Vercel instances; a burst by tenant A never consumes tenant B's counters or lets unauthorized calls reach GitHub.",
          "evidence": "Actual isolated Postgres capacity functions claim tenant and per-client counters atomically inside rollback-on-refusal SQL subtransactions; two independent connections exercise races; private request and OAuth routes gate before provider/dispatch; a protected owner form configures scoped request budgets. `tests/db/pub-3-runtime.test.js`; CI 39352668681 passed."
        },
        {
          "criterion": "Existing jobs, retained results and GitHub API access obey tested per-tenant/per-client bounded concurrency, size, lifetime and stored-row caps; expired records are reclaimed safely without deleting live work or data belonging to another tenant.",
          "evidence": "Scoped job/result store wrapper validates max TTL, body bytes, daily usage and active reservation slots; concurrent Postgres claims refuse over limit; expiry cleanup uses bounded deletes; independent tenant B untouched; real DB and unit regression; CI 39352668681 passed."
        },
        {
          "criterion": "An authenticated tenant revoke/suspend/cancel makes further private traffic fail closed, including already-issued bearer refresh, outstanding jobs and result reads; previous and other tenants' data remains confidential.",
          "evidence": "Existing signed tenant access checks owner/allowlist on each request; protected owner action revokes first, then private incident cleanup clears oauth clients/codes, bearer grants, jobs and retained results via one scoped statement. New real DB test forbids nonowner cleanup, verifies disabled tenant A, preserves tenant B, and CI 39352668681 passed."
        },
        {
          "criterion": "Private operational metrics record bounded nonsecret rate decisions, request duration buckets, OAuth/refresh outcome classes and service/provider failures with no tokens, credentials, private repository content, raw URL queries, email or user-provided error strings.",
          "evidence": "Record only fixed event, outcome and coarse latency buckets; private MCP/OAuth/refresh and provider transport events are emitted with redacted tenant SQL. Tests reject raw user-provided errors/URLs/token values and prove successful/refused/provider-failure class counts; CI 39352668681 passed."
        },
        {
          "criterion": "Real disposable PostgreSQL two-tenant tests exercise concurrent requests, duplicate submissions, quota recovery, malicious/oversized payloads, tenant revocation, retention deletion and provider failure; unit/shape/RTC/CI and release-policy remain intact.",
          "evidence": "Two-tenant disposable Postgres checks overlapping clients and key names, atomic racing claims, independent counters, retained limits, TTL, tenant-local revocation/cleanup; unit tests check limits, malformed inputs and secrets; exact-head CI 39352668681 and daily policy 39352668770 passed on implementation head. Final docs-only head still needs new exact-head CI."
        },
        {
          "criterion": "Current legacy owner path, all end-user delegated GitHub capabilities and production/approval/spend/protected-resource rules stay unchanged; operational fair-use limits are explicitly disclosed and must not silently impose the developer agent's $0 testing policy on customers.",
          "evidence": "Only PRIVATE tenant API and protected owner form changed. Legacy owner route bypasses tenant fair-use controls; original write/production/spend/approval/protected-resource rules unchanged. Private pilot OFF unless separately configured; no capacity purchase, public App enrollment, manual release or provider write. Source audit and green CI required after final doc commit."
        }
      ],
      "remainingEngineering": []
    }
  ]
}
```
<!-- bundle-delivery:end -->

## 2026-10-19 — Final reservation-admission correction (awaiting exact-head CI/review)

An additional security review after the green `dbc364e` head discovered that the original storage facade debited daily job/result quota before validating the job ID/result handle or reserving an active slot. That let malformed or saturated requests exhaust a legitimate customer's daily quota even when no job/result could be stored. In `src/tenancy/runtime-limits.js`, the facade now validates all required input before any reservation, acquires the bounded active-resource slot first, then claims daily usage and creates the resource within a release-on-failure try/catch. The previously enforced byte-size, lifetime, per-client and per-tenant capacity limits remain unchanged.

A new **genuine disposable PostgreSQL** regression in `tests/db/pub-3-runtime.test.js` checks that malformed and slot-capped job/result attempts leave their daily usage untouched, then tests successful writes and proper daily charge after releasing the occupied slot. Initial red run `39353890112` was a strict policy-writer rejection of passing read-only resolved defaults back during test cleanup, not an application failure; the cleanup now restores only supported owner-configurable override fields. Database shard `118404882897` passed at `5b8fbcd0263ba256c95c94d13112c910773f9c21`; full-CI completion remains an exact-head gate, **not yet claimed here**.

**Measured changed production source (GitHub PR files API): 604 added / 15 removed** across `api/` and `src/`; no tests/docs/generated lines counted. One substantial whole original PUB-3 outcome with six acceptance criteria, not extra helper-card credit. Existing live/provider acceptance remains separate, original 57-case queue unchanged, private plugins remain PRIVATE, and no money, public signup, data migration or release is authorized.


## Owner correction: no daily job-creation quota, 2026-10-29

Remove connection and tenant daily job counters/admission for everyone. Existing legacy stored job allowances normalize to unlimited and are omitted from future policy saves; no large numeric replacement, owner bypass or schema fallback. Retain active job/result reservations, job TTLs, result size/retention, existing request/OAuth/provider controls and actual delegation. Update the public limits page and native clone capacity guidance. Regression: more than200 successive create/finish cycles despite exhausted legacy daily counters in isolated Postgres, a separate tenant without the legacy override, no daily job counter consumption, active-slot/malformed/failure-path coverage retained, and no false uncertainty for pre-clone admission failures. Exact-head CI/review/release and authenticated disposable clone/close acceptance remain separate. See [daily quota repair](../status/2026-10-29-no-daily-job-quota.md).

## 2026-10-29 — resource admission follow-through

Current owner instruction applies globally: no daily job quota and no fixed native Git request/workspace count. Worker resource observations govern native execution; native metadata bypasses generic pending-job slots, with isolation, TTL, ordinary background-job reservations and result retention unchanged. Twelve held real-Git service requests, pressure/recovery/replay/disposal tests, real-process/filesystem sampling, two-tenant Postgres and packaged-image acceptance cover this repair. See [implementation and deployment record](../status/2026-10-29-native-resource-admission.md); source tests and live verification remain distinct.
