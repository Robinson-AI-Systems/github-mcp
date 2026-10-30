# Owner checklist

Only things that need you (your sign-in, phone or desktop, money, or a decision). None of these block building or merging; agents keep working. Updated 2026-10-30. Rule: [OWNER-DECISION-2026-10-27](OWNER-DECISION-2026-10-27.md). Older boxes are in the [archived checklist](archive/OWNER-CHECKLIST-2026-10-29-before-reconciliation.md) and are not extra chores.

## Already working (do not repeat)

- The connector is live at `https://github.robinsonaisystems.com` with owner operations, PR/CI/review tools and Git workspaces (clone, edit, commit, fetch, merge, push). Public sign-in was approved. Do not re-approve it or reinstall the connector as a test.
- Git workspaces close after 4 idle hours (activity renews the time). There is no daily job limit and no fixed workspace count; only real server load limits work. Source: `docs/OWNER-DECISION-2026-10-27.md`.
- New workspaces run on Dokploy. Older ones may still sit on Render until they close; do not cancel Render yet. Evidence: [rollout note](status/2026-10-29-native-resource-admission.md).

## Do when you have time

1. **Fleet machine tool.** Install `ras-github` on the external machine using [its guide](../tools/ras-github/ras-github.README.md), then have an agent test a real push. Agents cannot install on your machine.
2. **Test sign-ins for agents.** Provide spare sign-ins through the protected setup page: a fresh consent, a read-only one, a capped one, and one that may be deliberately revoked. See [DISPOSABLE-CONNECTION-ACCEPTANCE](DISPOSABLE-CONNECTION-ACCEPTANCE.md). Never paste tokens in chat. Agents run the tests.

## Only if you want them

- **Backups of Git workspaces.** Optional and not needed for production (decision 2026-10-30). No backup exists today. The off-server destination currently returns 401; do not work around it. When you want it: [runbook](NATIVE-GIT-BACKUP-RUNBOOK.md).
- **Paid-feature tests.** Only with a specific cost approved by you. Nothing is bought just to finish a test.
- **Budget-deletion test.** You declined it on 2026-10-23. Leave it closed.
- **Meta Muse / Muse Code.** Test only if you want those clients.
- **Hub checks.** Optional; the Hub team owns them.
- **Pricing and spend alerts.** Choose only if you want to charge or cap spend. Nothing is assumed.

## Public launch inputs

- [ ] Approve the privacy, terms and security text and choose the support email (`PUBLIC_SUPPORT_EMAIL`, then `LEGAL_APPROVED=yes` in Vercel). Until then those pages show a DRAFT banner (`src/tenancy/trust-pages.js`).
- [ ] GitHub Marketplace listing (only if wanted): verify publisher email, pick trader status, accept the agreement, then enroll the webhook and cron secrets privately. See [GO-LIVE-CHECKLIST](GO-LIVE-CHECKLIST.md) and [listing](marketplace/LISTING.md).
- [ ] Official MCP Registry listing (only if wanted): choose where the signing key lives and finish the DNS step. Never put the key in chat or the repo.
- [ ] Website button: [connect-button](website/connect-button.html) goes on the business site through that site's own work.

## Playground (coding workspaces)

Released in "best effort" mode (`vercel.json` sets `PLAYGROUND_RESOURCE_MODE`). Dokploy credentials are saved in protected setup; live provisioning reached Dokploy on 2026-10-30. Host monitoring, quotas and backups are optional. Private workspace isolation and clean-up are required. Some Dokploy host reads return 401; a signed clean-up proof covers that. Do not give unrestricted admin, paste credentials in chat, or buy more resources. Details: [PLAYGROUND-OPERATIONS](PLAYGROUND-OPERATIONS.md).

Acceptance counts (56 passed, 15 not yet) are from the 2026-10-29 ledger in [STATUS](STATUS.md); unverified today.
