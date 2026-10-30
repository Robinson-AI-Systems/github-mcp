# Current owner checklist — reconciled 2026-10-29

This is the current list of external inputs, not a new approval request. Existing authorization persists. The [prior checklist](archive/OWNER-CHECKLIST-2026-10-29-before-reconciliation.md) preserves historical decisions and completed setup; its duplicated or stale unchecked boxes are not additional obligations. The [owner authority decision](OWNER-DECISION-2026-10-27.md) governs conflicting historical restrictions.

## Already usable and not something to repeat

The custom connector is serving at https://github.robinsonaisystems.com with authenticated owner operations, PR/CI/review tools and native Git clone/edit/commit/fetch/merge/push. Public availability was approved; do not ask the owner to approve public sign-in again or reinstall the working connector as a routine test. Native Git needs no official connector. Package read/delete/restore proof and current person/App actor proof are retained; do not request replacement credentials without an actual missing permission. Current end-user authority, genuine delegated restrictions, mobile browser tests and optional Hub independence remain requirements.

This release changes new native workspaces to a four-hour **idle** timeout. Authorized workspace activity renews the selected window; close removes the workspace. Existing workspaces keep their original stated duration. Application tests still run in GitHub Actions or a separate development environment. For all users, new workspaces use Dokploy with resource-based admission and no fixed request/workspace count or daily job quota; older Render workspaces retain their original host during a safe drain. Render is not yet cancelled. Twelve live clone/write/exact-read/close lanes passed on matching released source. See [current rollout/cleanup evidence](status/2026-10-29-native-resource-admission.md).

## Operational items still outstanding

- [ ] Install the canonical corrected `ras-github` package from `tools/ras-github/` on the external fleet machine using its [installation and acceptance guide](../tools/ras-github/ras-github.README.md), then verify a disposable real-client multi-file push and native sync. The script, reversible installer and offline/fake-transport tests are prepared; this repository cannot install an external host's local helper. Keep content-snapshot publication distinct from local Git ancestry and check each repository's actual CI subscriptions/filters.
- Optional future backup: the owner selected an existing interim off-server destination and Chris as encryption-key custodian. Activation/restore acceptance is deferred and does not block production under the2026-10-30 owner decision. Destination access still returns401; do not bypass it or ask for it as a production prerequisite. Use the [prepared runbook](NATIVE-GIT-BACKUP-RUNBOOK.md) when activation is requested. No verified backup currently exists and no paid storage is authorized implicitly.
- [ ] For the remaining identity/lifecycle acceptance, supply separately disposable sign-in/grant fixtures through protected setup: fresh human consent, read-only/narrow/capped grants, and a refresh-token family that may deliberately be replayed/revoked. Keep tokens out of chat and preserve the useful owner connection. The [prepared disposable-connection matrix](DISPOSABLE-CONNECTION-ACCEPTANCE.md) names the setup, observations and exact cleanup. Agents perform the actual tests once those fixtures exist.

The authoritative [acceptance ledger](STATUS.md) and [ID-by-ID prerequisite review](status/2026-10-29-native-git-contract-lifecycle.md) retain 56 passes, 15 unpassed required rows and two optional Hub rows. Several unpassed rows contain partial proof; they are not 15 missing implementations or 15 new owner chores. Separate Codespaces policy/UI and eligible security/runner fixtures are required where named.

## Choices that remain optional

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

## Playground operator activation — existing hosting plan

The integrated source and best-effort mode are released. The owner enrolled the Dokploy account credential/provider settings; actual live provisioning reached Dokploy on2026-10-30. The application enforces project boundaries; no special project-scoped API key exists. Host resource monitoring/quota guarantees and backups are optional under current owner decisions. Private workspace/credential isolation and exact cleanup remain required. See [the operating contract](PLAYGROUND-OPERATIONS.md). Current project/container reads work, while host-volume/health reads return401; a narrowly bound signed cleanup proof can substitute for forbidden host-volume inspection. Do not request unrestricted administration, put credentials in chat or buy/increase resources. Fleet/Render and genuine disposable acceptance fixtures remain separate.
