# Audit release and live verification

Owner explicitly authorized an additional manual release, then prioritized audit corrections over native Git. Native Git is parked; initial Dokploy remains acceptable with portable execution/state migration.

Merged #445 (authority/read/parity), #446 (owner-only checked manual release), #447 (owner setup/connection transition and deterministic DB housekeeping proof). #447 final source `a7760c0` and merged main `4ea56dee0d70505714db946c3217b107175aeb16` passed all unit, PostgreSQL, browser, RTC, shapes, static and release-policy checks. No unresolved review threads.

Release bootstrap: the old deployed MCP refused dispatch on its own protected main. After independent trusted green checks, ancestry and exact main/live observations, the explicitly owner-authorized manual release used GitHub's expected-head, non-force live fast-forward from b47643d to 4ea56dee. Daily receipts were not deleted or rewritten. Vercel independently showed READY for that source on live, attached to the serving public aliases; credential-free `/api/contract` reported the same revision. Once serving, the custom MCP itself successfully dispatched the checked manual workflow without a confirmation round trip (journal 2537, run 40692341751); independent readback showed both workflow jobs successful. This gives the normal checked route a target-specific receipt without another code promotion.

Real custom probes at that deployed revision: branch/ref alias and PR pull_number alias passed; an actually incomplete zero-hit code search returned absence_verified=false plus actionable warning; scanner guidance returned exact repository settings/Robinson workflow and did not claim installation or clean state; foreign-account read was denied before provider access. The official full src/db.js read matched reviewed source and blob 75bafde9d8b812fc9d1c2e520114ebdfa53cd523.

The custom full read arrived without truncation but redacted 20 harmless RTC table identifiers (98,275 vs 98,401 characters). Byte windows explicitly refused for the same false positives. Do NOT mark full-file parity passed from that result. Current correction narrows the RTC detector to the issued credential length, prevents partial-token validation error leakage, adds safe diagnostics/explicit modified-text metadata and real-file regression coverage. Full exact-head CI, review, merge, correction deployment and recheck remain required.

Local correction validation: 64/64 tests across six files passed, including actual src/db.js equality, harmless identifiers in exact byte windows, real RTC pass redaction/byte denial, value-free diagnostics, unshaped/deep/property-name/validation-error credential containment and retained reads. Initial failure exposed truncated long argument names; the generic validator now omits those names instead of leaking token prefixes. An existing credential-shaped-content error phrase was retained for compatibility. No credential assertion was removed.

PR #448 first complete CI passed PostgreSQL, browser, shapes, RTC, static and two unit shards; its only test failure was the explicit registry list missing the new diagnostic tool. Review PRRT_kwDOVD_LK86xIvxj found a P1 partial-credential leak when an existing handler clipped provider text before redaction. Correction moves the shared detector into a dependency-free GitHub module and redacts complete text before output/log/journal truncation at affected boundaries; provider requests and identities are unchanged. Registry expectation is updated. The focused correction selection passed 933/933 across 13 files, including real commit/comparison patch boundaries and 306 shared-cap overlap positions, log and journal cases. Final assembled exact-head CI remains required.

The correction also retains conservative RTC-prefix masking for provider-supplied search/log/error excerpts that may already be truncated upstream; complete source-file decisions use the accurate issued-format detector. Later focused runs passed 25/25 (Actions/real-file/boundaries), 32/32 (including persistence and upstream excerpts), and 23/23 (error/RTC/log paths). Output identities/provider mutation payloads are not rewritten by the clipping fix. Full final-head CI is required after publication.

Final line-window check also protects multiline private-key interiors before selecting original source lines; line numbering is preserved. The full byte guard already checks the complete file. This closes the analogous range-selection boundary rather than relying on a header remaining in the requested excerpt.

## Final deployed correction and acceptance

The preceding correction checkpoints are historical. #448 final source `b4e587834680c7c9ab12845908c9076bfbd02031` passed every required family in CI run 40699884905 and release-policy; the P1 review was fixed and resolved. Merged `75b4d61bf665c1d6a5a066950f53bd9fa4ae8790`, released through the checked workflow run 40700781978, independently verified serving Vercel READY and contract source. [Content-protection evidence](../CONTENT-PROTECTION.md#live-verification-after-the-correction) records exact immutable file identity, fresh official/full-text equality and all four reconstructed byte windows with hash. The original broken large-read finding is now resolved live for that audit fixture, including single-copy payload delivery and retention-independent byte continuation.

A real incomplete zero-hit search on the corrected deployment again returned completeness=incomplete, absence_verified=false and actionable warning. HTML requests to /, /privacy and /connection returned 200 with CSP, nosniff and same-origin Referrer-Policy; unauthenticated MCP initialize returned 401 with WWW-Authenticate. The organization hosted-runner read still returned GitHub's genuine 404 unsupported-organization response: no entitlement, plan or billing setting was changed.

## Owner confirmation cleanup

Current source outcome removes duplicate target-entry requirements for full owners on project/issue/org-type/org-field deletion, advisory publication and budget deletion. Optional supplied confirmations remain strict accuracy checks. Project deletion compares fresh identity/title against its original provider read. Selected-member Codespaces writes still require exact users and active organization membership; full owners do not need an extra replacement acknowledgement, while explicit false and restricted-grant requirements remain effective. GitHub's unreadable policy GET limitation still produces UNCONFIRMED after 204. No paid/destructive real-account test is inferred.

Legacy unsupported GraphQL mutations now report missing verified ownership/readback contracts as implementation gaps, with tool search, alternate REST search/describe and exact-setting guidance. They are not declared impossible or forbidden by the owner's GitHub authority. Completing each contract remains named engineering backlog; arbitrary unchecked mutation execution is not a substitute.

Local focused proof: 1181/1181 first-group tests and 540/540 organization/GraphQL tests passed. Final assembled checks, exact-head CI, review and merge remain required for this cleanup. The already-live content correction is independent of that pending source work. Native Git remains deferred by the owner's audit-first priority; no worker is provisioned.

## Outstanding acceptance accounting after the live audit fix

All 15 remaining standalone queue obligations were reconciled, preserving 55 recorded deployed passes and two optional Hub-owned checks. The snapshot extract was checked with the repository's acceptance reviewer against actual main/live/deployed 75b4d61b READY. This validates accounting, not provider truth or permission. The permanent queue retains exact revisions, procedures, evidence and re-entry steps.

| Queue obligation | Current result / exact remaining prerequisite |
| --- | --- |
| GOD6-ACT-AS | Personal owner writes and App-only reads observed; disposable secondary read-only/switch fixture and exact App-only scratch write remain. |
| GOD6-RULE-OVERRIDE | Retired server-list/second-confirmation criterion corrected; approved disposable rules/PR fixture and separate restricted grant remain. |
| HARD1-SIGNIN-NO-CAP | Fresh disposable real-client OAuth consent remains; saved grant and browser CI do not replace it. |
| PRIVATE-USER-PASS-SCOPE | Private pilot retired; equivalent supported narrowed OAuth/RTC grant proof remains. No retired mode recreated. |
| PUB5-HEADERS-LIMITS | Real HTML headers/unauthenticated challenge passed; disposable client PKCE/refresh-family replay and usage fixture remain. |
| Y7-AUTH-PREVIEW | Explicit dry-run/restricted grant replaces obsolete full-owner PREVIEW denial; eligible security attachments and 100-entry inventory remain. |
| Y9D-HOSTED-READ | Performed, unsuccessful: genuine provider 404 unsupported organization. Use existing eligible entitlement; no upgrade purchased. |
| Y9D-SAFETY-DENIAL | Separate deliberately read-only/narrow/capped pass and eligible fixture remain; no paid mutation. |
| O4-AUTH-BUDGET-WRITE | Owner-confirmation cleanup release and exact disposable budget deletion authority remain; do not delete a real ceiling to test. |
| O4-AUTH-CODESPACES-WRITE | Cleanup release, exact approved replacement policy and independent saved-policy UI readback remain. |
| U1-AUTH-METERED-WRITE | Earlier scratch write/revert retained; deliberately capped/narrow pass proof remains. |
| Y7-AUTH-PRIVATE-PAID-WRITE | Already eligible paid-feature fixture plus exact operation/financial exposure authorization remain. |
| Y9D-OWNER-AUTH-WRITES | Exact paid/destructive operation, target and cost authorization remain. No expense incurred for a checkbox. |
| NATIVE-REVOCATION | Separately disposable grant and revocation authority remain; working connector preserved. |
| RTC-DIRECT | Genuine short-lived service RTC pass remains; current OAuth grant is not an RTC pass. |

Final local repository check and publication-base comparison passed. Additional target-accuracy/restricted-grant/unsupported-contract regressions passed 379/379 across two files. Required remote exact-head CI, review and merge are still pending for the owner-confirmation cleanup; content-protection live evidence above remains valid independently.

The capability inventory/report also retains its legacy refused-by-design machine key for compatibility while explicitly exposing these rows as missing verified contracts with concrete discovery/setup recovery. It no longer says there is no next action or asks for an already-given owner decision. Historical risk notes do not establish a new provider refusal.

PR #449 first exact-head CI passed every database/browser/RTC/shape/static family and two unit shards; the remaining shard failed exactly two assertions expecting retired GraphQL refusal wording. Both now require truthful missing-contract explanation and actionable discovery/setup guidance while retaining no-mutation checks. Capability-inventory recovery tests passed 11/11. Previously indexed CI-FAST-1 was independently reconciled to already-merged #426, exact-head green checks/resolved review and observed passing-overrun/retained artifact logs; its work-index entry is now MERGED without a new implementation claim.
