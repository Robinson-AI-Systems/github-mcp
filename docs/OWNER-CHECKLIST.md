# Current owner checklist — reconciled 2026-10-29

This is the current list of external inputs, not a new approval request. Existing authorization persists. The [prior checklist](archive/OWNER-CHECKLIST-2026-10-29-before-reconciliation.md) preserves historical decisions and completed setup; its duplicated or stale unchecked boxes are not additional obligations. The [owner authority decision](OWNER-DECISION-2026-10-27.md) governs conflicting historical restrictions.

## Already usable and not something to repeat

The custom connector is serving at https://github.robinsonaisystems.com with authenticated owner operations, PR/CI/review tools and native Git clone/edit/commit/fetch/merge/push. Public availability was approved; do not ask the owner to approve public sign-in again or reinstall the working connector as a routine test. Native Git needs no official connector. Package read/delete/restore proof and current person/App actor proof are retained; do not request replacement credentials without an actual missing permission. Current end-user authority, genuine delegated restrictions, mobile browser tests and optional Hub independence remain requirements.

This release changes new native workspaces to a four-hour **idle** timeout. Authorized workspace activity renews the selected window; close removes the workspace. Existing workspaces keep their original stated duration. Application tests still run in GitHub Actions or a separate development environment.

## Operational items still outstanding

- [ ] Install the supplied corrected `ras-github` package on the external fleet machine using its packaged README, then verify a disposable real-client multi-file push and native sync. The script and ten offline tests are prepared; this repository cannot install an external host's local helper. Keep content-snapshot publication distinct from local Git ancestry and check each repository's actual CI subscriptions/filters.
- [ ] Choose the independent off-host encrypted backup destination, schedule and private key custodian. Use [native operations](NATIVE-GIT-OPERATIONS.md) to prove restoration before claiming independent recovery. Render snapshots alone do not satisfy this. No paid storage is authorized implicitly.
- [ ] For the remaining identity/lifecycle acceptance, supply separately disposable sign-in/grant fixtures through protected setup: fresh human consent, read-only/narrow/capped grants, and a refresh-token family that may deliberately be replayed/revoked. Keep tokens out of chat and preserve the useful owner connection. Agents perform the actual tests and cleanup once the exact fixtures exist.

The authoritative [acceptance ledger](STATUS.md) and [ID-by-ID prerequisite review](status/2026-10-29-native-git-contract-lifecycle.md) retain 56 passes, 15 unpassed required rows and two optional Hub rows. Several unpassed rows contain partial proof; they are not 15 missing implementations or 15 new owner chores. Separate Codespaces policy/UI and eligible security/runner fixtures are required where named.

## Choices that remain optional

- **Dokploy hosting return:** the operator corrected generated hostnames to the public ingress address. HTTPS health and unsigned rejection verify; source provenance is recorded. Before a cutover, agents must verify signed four-request capacity, retained verifier/storage and exact workspace continuity. Keep Render and its disk until then. CPU sizing remains flexible; do not infer dedicated resources, SSD backing or a volume quota from total host capacity.
- **Paid-feature acceptance:** use already eligible hosted-runner/private-security fixtures where available. An operation with additional cost needs a specific cost proposal and approval; do not buy a plan, activate billable features or widen real users merely to complete a test.
- **Budget deletion:** the owner declined further tests on 2026-10-23. Preserve that decision. Its historical unpassed row is not a current owner task and must not be reopened automatically.
- **Other clients:** Meta Muse/Muse Code onboarding can be tested if those clients are wanted. Use the homepage's current public client information and the user's own protected GitHub consent; existing browser tests do not manufacture fresh client acceptance.
- **Hub:** relay/sandbox verification is Hub-owned and optional. It does not block standalone completion.

## Public distribution and business inputs

The implementation and public-use authorization already exist. The following distribution/activation inputs remain unverified unless a later dated record proves them complete:

- [ ] Approve final privacy/terms/security text and choose the support email; obtain legal review if desired. Agents can prepare the text, but cannot invent approval or the business contact.
- [ ] For a GitHub Marketplace listing: verify the publisher email, choose truthful trader classification, accept the Marketplace agreement, and privately enroll the prepared webhook/cron activation secrets using the documented protected setup. Follow [go-live guidance](GO-LIVE-CHECKLIST.md) and [listing material](marketplace/LISTING.md); do not put secret values in tool arguments. Do not repeat the App transfer or installation based only on old unchecked boxes.
- [ ] For official MCP Registry publication: choose protected signing-key custody and complete the prepared DNS-authenticated publication. Do not put the registry private key in chat or this public repository.
- [ ] If wanted, place the prepared [connect button](website/connect-button.html) on the business website through that repository's own work session.
- [ ] Choose pricing only if monetization is wanted, and choose provider spend alerts/limits using actual billing observations. No new price, quota or monthly ceiling is inferred here.

See the latest dated repair/release note for exact source, CI, deployment, acceptance and cleanup evidence. Builder no-spend and project-isolation rules remain distinct from full-owner product authority.
