# Disposable connection acceptance

Use this prepared matrix only with separately disposable grants. On 2026-10-29 the actual custom-service connection inventory showed two full-access production logins, both useful; neither is a revocation/replay fixture. No useful login was revoked, narrowed, copied or replayed. Existing source tests and earlier real actor/read evidence remain valid but do not stand in for these cases.

## Setup and custody

The existing `github_create_pass` tool can mint an issuer-scoped, short-lived read-only pass for a named authorized account/repository. The pass itself is deliberately shown only through the protected one-use setup page after the owner signs in; it is never returned in tool output. Its normal tool contract accepts account, profile, areas, repos, days and an explicit per-pass request rate. This can prepare a test grant without changing the owner login, but does not make its secret available to this agent or prove human consent.

Arrange the disposable grant and existing authenticated runner together when the owner is ready. Use the normal protected setup/client sign-in and protected runner vault described in [developer connection recovery](pr-cards/DEVELOPER-CONNECTION.md). Do not retrieve or overwrite another runner's rotating checkpoint. Do not ask for a token, password or passphrase in chat. The exact target must be a uniquely marked run-owned scratch repository. No new provider credential or permission is inferred from permission to create a service pass.

## Matrix

| Case | Required disposable setup | Actual observations required |
| --- | --- | --- |
| Read-only and repository scope | Read-only service pass restricted to the one scratch repository and required read areas | Allowed repository read succeeds; write and a different repository/account refuse before provider mutation; the owner login still works. |
| Explicit delegation allowance | Separate deliberately restricted pass with issuer-chosen allowance | The selected restriction is enforced and explained, while an unrelated grant is unchanged. Never turn this into a service-wide daily job quota or fixed native request count. |
| Revocation | One disposable service pass, retained exact connection ID and safe pre-revocation read | Revoke only that pass through the normal tool; its next read refuses; the useful owner login and other user remain usable. No relabeling a working-login disconnect as a disposable test. |
| Fresh sign-in and renewal | Genuinely new human client consent and a disposable refresh-token family in one serialized protected runner | New login succeeds; normal renewal preserves scope; replay/revocation cases refuse as designed and do not affect the other login. A saved working connection or a fake-browser test is not fresh human sign-in. |
| Person/App preference | Separate disposable credential-setting fixture | Owner-person and genuinely App-only operations report the actual actor; OFF/read-only preference cases match the selected credentials without changing the useful owner preference. Earlier independent actor proof is retained. |
| Direct RTC | Exact-origin, short-lived read-only RTC service pass | Allowed direct read, scope denial and expiry/revocation through that actual transport; adapter OAuth is not substituted for RTC. Hub relay/sandbox checks remain optional and separately owned. |

Use the existing acceptance IDs in the current ledger; several IDs share one matrix fixture. Do not create a new checklist or count these as missing implementations. Codespaces administrative UI checks and paid hosted-runner/private-security checks additionally require the exact eligible provider fixture. A read-only or spending restriction in a test grant is an explicit delegation choice, not permission to buy capacity or change all-user behavior. The owner-declined budget deletion test is excluded.

## Evidence and exact cleanup

Record deployed source/origin, actual transport, selected nonsecret scope, allowed/denied result and independent readback. Keep raw tokens, reveal handles, private setup links and refresh material out of public evidence. On completion revoke only the run-created pass, close only run-owned workspaces and delete the exact marked scratch repository with independent absent readback. Retain working grants and other agents' work. If human consent/protected custody or the intended provider fixture is unavailable, record the specific prerequisite instead of manufacturing a successful case.
