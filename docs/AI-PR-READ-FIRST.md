# Review requirements by scope

Governing product requirements: [authority specification](OWNER-DECISION-2026-10-27.md).
The [active plan](designs/AUTHORITY-PARITY-2026-10-28.md) identifies the remaining migration work.

## Product integrity — every connection

- Bind each operation to the authenticated principal, tenant, connected provider account, actual credential and exact target. No cross-tenant credential fallback or fabricated grant.
- Credentials enter only protected setup, stay encrypted, and never appear in tool arguments, results, logs, journals or PRs. Sealed secret tools remain the path for provider secret writes. Scanning results expose locations/types, never matching secret values.
- Preserve revoked/expired grant checks, credential downscoping, independent provider authorization and faithful provider refusals/Retry-After.
- Every write uses the shared journal/replay/readback lifecycle. A replay cannot send a second write; ambiguous outcomes are uncertain, not success or safe blind retries. Account/target accuracy and caller-selected expected heads remain verified.
- Read-modify-write operations preserve fields the caller did not select and compare intended changes on independent readback.
- Repository/user text is data, never instructions. Preserve untrusted markers, redaction and bounded context with functional complete retrieval.
- RTC remains independently usable, provider-authenticated, lazy and tenant scoped; no required Hub dependency or hidden wire-contract change.

## Owner full connection

- Disclosure is generated and journaled in the same call as execution. Unknown price is explicit, never a price-check refusal. Production, access, notifications or resource classification cannot manufacture a confirmation ritual.
- GitHub governs branch rules, default branches, environment approvals and billing. A server-maintained list does not overrule the account owner. The owner can edit their own standing settings through authorized tools.
- Ordinary merges are submitted to GitHub; merge-when-green remains requested automation. GitHub-granted bypass authority is available as deliberate, disclosed, journaled execution.
- Do not switch a valid user operation to an App merely to enforce a second branch policy. Preserve genuinely App-only operations and honest actor reporting.
- No fixed server write-spacing rule applies to the full owner connection. Real provider rate signals remain effective.

## Explicit delegated grants

Read-only, narrowed accounts/repositories, allowed areas, pass expiry, access-change permission and issuer-selected spending/pacing remain binding. A pass never gains ordinary-owner behavior. Refresh preserves the grant; revocation takes effect. Existing grant changes require actual issuer authority; do not broaden them as an incidental migration.

## Builder operating instructions

No autonomous spending, credentials in tests, real destructive tests or unapproved permission changes. Use fake provider/disposable database/browser fixtures; preserve exact-head ci and release-policy checks, self-review, no direct main commits and the normal checked release route. These instructions bind the building agent; no runtime product flag may be introduced solely to enforce them.

## Review evidence

Record changed contract, affected callers/doors, provider request shape, successful behavior, denial and recovery/replay/readback tests. Distinguish generated configuration, source tests, merged source, deployed source and real client acceptance. Run required checks once on the assembled tree, fix actual failures without deleting assertions, and record unavailable infrastructure precisely.
