# Native Git operation contracts and closed-workspace replay

Owner reports branch creation refused and confused close/re-open. Plan before source: align branch-create/rename/delete name/branch arguments without confusing source ref, expose exact per-operation help through the existing capabilities read, preserve actionable safe preflight failures including failed previews, and label replayed clone receipts with independently observed current workspace availability. Reopening a disposed workspace must require a new intent; no automatic clone or mutation resend. Add real dispatcher/Git regressions for branch aliases, invalid/conflicting options, branch ref readback, close/replay/new-open, and unavailable worker state. Preserve tenant/repository authorization and existing immutable receipts.

Observed journal for the reported repository contains a branch_create unsupported-option refusal and a later failed-state preview; raw original argument values are not retained, so the exact original call is not claimed. Existing source only accepts name for branch creation despite branch also appearing in the shared schema. The earlier switch repair does not resolve this separate branch contract. Existing open replay returns the original successful after-state even after disposal, without distinguishing historical state from current availability.

Deliver the coherent correction through exact-head checks/review/normal merge, checked release, matching worker deployment at the existing four-request configuration and actual disposable branch/close/re-open acceptance. No capacity/price change and no unrelated workspace mutation. Keep original reported failures and historical evidence intact.

## Expanded owner-supplied agent report (before implementation)

Include reported content-push ancestry, 29-file partial delivery, missing CI, inconsistent arguments and helper allowlist/discovery. Current source differs from the report: text push accepts 50 files and uses createCommitOnBranch with expectedHeadOid; Git-data push accepts 12, explicitly rejects larger input, and creates commits with parents:[observedHead]. No mutating path in this repository slices to 12. Thus silent loss and orphan ancestry are not yet attributed to this server; locate the ras-github helper and actual successor PRs before claiming their cause. Preserve explicit provider/credential/workflow-event distinctions for CI; never forge merge parents or silently dispatch workflows. Add 29-file manifest/count and parentage regression/actual readback proof, improve supported binary batch limits and explicit count receipts where justified, and document verified route alternatives. The database-connection detector and harmless-literal fix already have synthetic live proof; proprietary scanner equivalence remains an honest gap.

## Resumed fleet repair, 2026-10-29

Observable outcome: branch aliases and real native fetch/merge/push preserve history, closed clone replays distinguish historical receipts from present availability, and preflight/transport failures expose bounded actionable diagnostics without leaking private worker details. Acceptance includes dispatcher-to-real-Git branch/rename/delete, conflict recovery, two-parent merge and remote readback, active/disposed/unavailable replay, denied access and failed preview tests, assembled checks and exact-head CI/image/review before release.

The expanded fleet report also requires separate diagnosis of snapshot batching, new-branch creation, CI event/filter/credential behavior, CI/log/read completeness, receipt accuracy, merge-rule diagnostics and argument consistency. The helper is a standalone Python script on an external agent machine, not present in this checkout or connected GitHub searches; its batching/exit behavior remains unverified until its source is supplied. A remote-parented content commit cannot import a local merge graph. Do not infer missing ancestry or silent truncation solely from a single-parent commit, and do not misrepresent explicit workflow dispatch as a push event fix.

Reconciled runtime: fetched main remains 91b10af8; production alias resolves through the provider to READY source 0d752439; Render's live deploy uses that same source. Authenticated worker capabilities report protocol 2 and max_concurrent 4. Existing instance/disk retained; no deployment or configuration mutation performed. No open MCP PR was observed at startup. Recovery source is b8493e4a, checked out in a separate worktree to preserve the prior local session.

### Source verification and prerequisite reconciliation

Focused dispatcher/native/transport/write-core suites: 108 tests passed across four files; lint and diff whitespace check passed. A fixture setup initially used PREVIEW on a deliberately failed read, which correctly hit the existing delegated production boundary; corrected the fixture to PRODUCTION, retaining the boundary. Real-Git proof covers rename/delete aliases, no-send invalid arguments, active/disposed/missing clone replays, revoked repository access, moved main, two-parent merge and exact native remote commit equality. These are synthetic provider/local Git tests, not deployed acceptance.

The existing 56 accepted ledger rows remain unchanged. All 15 required remaining rows are included in deployed ancestry and were reassessed against the recovery evidence and current connected capabilities. Do not run revocation, grant changes, paid operations or destructive budget tests on the useful owner connection to manufacture proof:

| Acceptance ID | Specific remaining prerequisite and re-entry |
| --- | --- |
| GITHUB-NATIVE-REVOCATION | Separately disposable native service grant for revocation/renewal proof; retain current working grant. |
| GITHUB-RTC-DIRECT | Separate disposable scoped direct RTC pass for the outstanding denial/lifecycle matrix; reuse existing direct proof only for its recorded cases. |
| GITHUB-Y9D-HOSTED-READ | Eligible hosted-runner provider entitlement; earlier actual provider refusal remains, no purchase authorized. |
| GITHUB-Y9D-SAFETY-DENIAL | Deliberately restricted/read-only/capped grant and eligible fixture, not the full owner grant. |
| GITHUB-Y9D-OWNER-AUTH-WRITES | Exact approved disposable hosted-runner fixture and provider entitlement/cost authorization for actual mutation. |
| GITHUB-O4-AUTH-BUDGET-WRITE | Owner declined further budget deletion tests; retain that decision, no new owner task or real ceiling deletion. |
| GITHUB-O4-AUTH-CODESPACES-WRITE | Exact disposable organization/user policy fixture and independent administrative UI readback without inferred billable widening. |
| GITHUB-Y7-AUTH-PREVIEW | Eligible organization security attachments/100-entry inventory plus separate restricted grant; preserve existing private-inventory/dry-run evidence. |
| GITHUB-Y7-AUTH-PRIVATE-PAID-WRITE | Eligible private security fixture, explicit feature/cost authorization and actual independent provider readback. |
| GITHUB-U1-AUTH-METERED-WRITE | Exact approved metered fixture and explicit cost authorization; unknown cost disclosure does not authorize builder spending. |
| GITHUB-PRIVATE-USER-PASS-SCOPE | Separately narrowed current public OAuth grant; do not recreate retired pilot mode or narrow the useful owner grant. |
| GITHUB-HARD1-SIGNIN-NO-CAP | Genuinely new human OAuth sign-in; existing connected access is not fresh sign-in evidence. |
| GITHUB-GOD6-ACT-AS | Disposable credential-setting fixture/grant for switch OFF/App-only/read-only cases; existing person-actor write evidence retained. |
| GITHUB-GOD6-RULE-OVERRIDE | Exact disposable rules/PR fixture plus restricted grant; do not change real production rules as a test. |
| GITHUB-PUB5-HEADERS-LIMITS | Disposable refresh-token family for replay/revocation and per-person usage UI readback; existing header/PKCE evidence retained. |

Both optional Hub rows remain optional and unperformed. Independent off-host backup destination/schedule/key custody remains an operator prerequisite; no Render snapshot is relabeled independent recovery proof. Helper batching/exit/source diagnosis, CI events/log completeness, merge-rule diagnostics and remaining fleet receipts/alias work continue after this coherent native correction; none is marked fixed by these source tests.

PR #462 initial remote head fea2c94b independently matches local tree 067c7d37. All first-head CI families, release-policy and worker image passed. An independent review identified a valid long-branch readback limit mismatch: prefixing a permitted branch with refs/heads/ could exceed the shared 256-character ref bound after mutation. Correct the internal refs-only bound to 267 while retaining all argument validation and add real-Git create/rename/delete regression at 250 and 256 characters. A new exact-head CI/review cycle is required; initial green checks do not certify the correction. Local shell push lacked a credential, so publication uses the authorized custom MCP, exact expected head and independently identical complete tree; no credential setup or policy bypass.
