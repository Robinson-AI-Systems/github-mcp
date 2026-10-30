# Owner checklist

Only things that need you (your sign-in, phone or desktop, money, or a decision). None of these block building or merging; agents keep working. Updated 2026-10-30. Rule: [OWNER-DECISION-2026-10-27](OWNER-DECISION-2026-10-27.md). Older boxes are in the [archived checklist](archive/OWNER-CHECKLIST-2026-10-29-before-reconciliation.md) and are not extra chores.

## Already working (do not repeat)

- The connector is live at `https://github.robinsonaisystems.com` with owner operations, PR/CI/review tools and Git workspaces (clone, edit, commit, fetch, merge, push). Public sign-in was approved and `GITHUB_PUBLIC_CONNECT=enabled` is set in Vercel production (checked 2026-10-30). Do not re-approve it or reinstall the connector as a test.
- Git workspaces close after 4 idle hours (activity renews the time). There is no daily job limit and no fixed workspace count; only real server load limits work. Source: `docs/OWNER-DECISION-2026-10-27.md`.
- New workspaces run on Dokploy. Older ones may still sit on Render until they close; do not cancel Render yet. Evidence: [rollout note](status/2026-10-29-native-resource-admission.md).

## Do when you have time

1. ~~**Fleet machine tool.**~~ **Done (owner-verified 2026-10-30).** `ras-github` is installed and works as expected on the external machine; Chris's other AI agent checked it on its own virtual machine. Recorded as the owner's report; this repository has not run it there and agents cannot reach that machine. Guide: [its guide](../tools/ras-github/ras-github.README.md).
2. **Test sign-ins for agents.** Provide spare sign-ins through the protected setup page: a fresh consent, a read-only one, a capped one, and one that may be deliberately revoked. See [DISPOSABLE-CONNECTION-ACCEPTANCE](DISPOSABLE-CONNECTION-ACCEPTANCE.md). Never paste tokens in chat. Agents run the tests.

3. **Docker network address pools (Playground).** On 2026-10-30 a new workspace failed with "all predefined address pools have been fully subnetted": the Dokploy host ran out of private network addresses (about nine workspaces use three networks each). On the host, set `default-address-pools` in Docker's `daemon.json` to a larger range with small subnets (for example base `10.64.0.0/12`, size `24`), then restart Docker. Needs host access; the project's Dokploy key cannot do it. Agents must not delete existing test workspaces without your say-so. Evidence: failed deployment of `ras-pg-88af4607...`. Chris does not do server settings himself: hand the exact steps in [docker-address-pools](status/2026-10-30-docker-address-pools.md) to whichever AI agent or person has shell access to the Dokploy server.

## Only if you want them

- **Backups of Git workspaces.** Optional and not needed for production (decision 2026-10-30). No backup exists today. The off-server destination currently returns 401; do not work around it. When you want it: [runbook](NATIVE-GIT-BACKUP-RUNBOOK.md).
- **Paid-feature tests.** Only with a specific cost approved by you. Nothing is bought just to finish a test.
- **Budget-deletion test.** You declined it on 2026-10-23. Leave it closed.
- **Meta Muse / Muse Code.** Test only if you want those clients.
- **Hub checks.** Optional; the Hub team owns them.
- **Pricing and spend alerts.** Choose only if you want to charge or cap spend. Nothing is assumed.

## Public launch inputs

- [x] Privacy, terms and security text approved; support email `hello@robinsonaisystems.com` set. `LEGAL_APPROVED=yes` and `PUBLIC_SUPPORT_EMAIL` are in Vercel production (checked 2026-10-30, values by name only).
- [ ] GitHub Marketplace listing (only if wanted): verify publisher email, pick trader status, accept the agreement, then enroll the webhook and cron secrets privately. See [GO-LIVE-CHECKLIST](GO-LIVE-CHECKLIST.md) and [listing](marketplace/LISTING.md).
- [ ] Official MCP Registry listing (only if wanted): choose where the signing key lives and finish the DNS step. Never put the key in chat or the repo.
- [ ] Website button: [connect-button](website/connect-button.html) goes on the business site through that site's own work.

## Playground (coding workspaces)

Released in "best effort" mode (`vercel.json` sets `PLAYGROUND_RESOURCE_MODE`). Dokploy credentials are saved in protected setup; live provisioning reached Dokploy on 2026-10-30. Host monitoring, quotas and backups are optional. Private workspace isolation and clean-up are required. Some Dokploy host reads return 401; a signed clean-up proof covers that. Do not give unrestricted admin, paste credentials in chat, or buy more resources. Details: [PLAYGROUND-OPERATIONS](PLAYGROUND-OPERATIONS.md).

Acceptance counts (56 passed, 15 not yet) are from the 2026-10-29 ledger in [STATUS](STATUS.md); unverified today.