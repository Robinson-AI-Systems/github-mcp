# 2026-10-27 — C-8 single-request latency checkpoint

## Recovered source
PAR-4 enterprise permission gap was merged as PR #423 on checked main `e2f9d541a634ec77baceca125bbd48ab9c3bf06c`; the source is **not accepted as a real enterprise mutation** and follows normal live release. One genuine review finding (unguarded enterprise security-config attach) was addressed by exact curated-route mappings and regression tests before merge.

## Request latency evidence (not controlled apples-to-apples)
Owner-supplied agent report: simple check around 2.8 seconds custom vs 1.3 official, while PR workflow efficiency and CI reliability improved. Three alternating authenticated session reads collected here: official whoami 326/362/338 ms, custom whoami 1172/724/617 ms. The operations and connections differ and measured times include hosting/connector overhead; no sourced production speedup is claimed from implementation until released.

## Source candidate C-8 (in the feature branch, tests not yet green)
- Read-only `github_whoami` parallelizes independent account rate reads in bounded waves of 10, starts independent master status alongside account inventory, passes that one status to `actAsFor` and reuses the per-request personal-rate evidence. No long-lived user-credential or GitHub CI state cache.
- `factsFor` fetches four independent scoped preferences/rate reads in parallel.
- Tenant provider HTTP telemetry accumulates fixed nonsecret outcome, event and coarse duration buckets per authenticated MCP request. The existing checked tenant SQL namespace gets one awaited JSONB aggregate upsert, including final MCP outcome, in `api/mcp.js` cleanup; a failure remains a metric failure only. No per-provider SQL wait before returning the GitHub HTTP result, no fire-and-forget persistence, no change to admission, authenticated identity, user-scoped budget or release controls. OAuth/non-MCP default logging stays as before.
- New `tests/unit/server-tools.test.js`, `tests/unit/request-latency.test.js` plus `scripts/benchmark-request-latency.mjs`, and `tests/db/pub-3-runtime.test.js` cover semantics, synthetic-delay critical path and real DB per-tenant metric counts. The tests and full CI still need execution on the exact final head.

## Boundaries and next evidence
No production release, account/grant changes, paid provider setup, GitHub write, launch publication or private telemetry collection. Only publish timings measured from the independently verified new Vercel `live` revision, after release and in the same client conditions. Prepare checked PR, diagnose all CI/review findings and merge only after exact-head required checks.
