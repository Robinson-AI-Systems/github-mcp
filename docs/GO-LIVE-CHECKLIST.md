# Go-live checklist

Switches and settings behind the live service. Names only; never put values in chat, files or PRs. "Owner" means only you; "Agent" means Claude can do it when you say go. Rule: your own full connection is not gated by old production, spend or protected-list ceremonies ([decision](OWNER-DECISION-2026-10-27.md)). The items below are setup, not permission gates. Today's status for each: see [STATUS](STATUS.md); anything not shown by code is marked unverified.

## 1. The server (done)

- [x] Vercel project `github-mcp` and its own Neon database (IN-02). Node 24.x (`package.json`).
- [x] Production settings exist: `DATABASE_URL`, `PUBLIC_BASE_URL`, `ADMIN_PASSPHRASE`, `TOKEN_ENCRYPTION_KEY`. Unverified: that you saved the last two in a password manager (Owner).
- [ ] This repo's own GitHub rules: `main` needs `ci`, merge commits, secret scanning and push protection. Ask Claude to run `github_workflow_repo_health` on it. Unverified today.
- [x] Releases: pull requests go to `main`; only the daily job moves `live`; Vercel builds only `live` (`.github/RELEASE-POLICY.md`, `vercel.json` `git.deploymentEnabled`). Do not deploy by hand.

## 2. GitHub accounts (Owner, on the setup page)

Setup page: `https://github.robinsonaisystems.com/api/github/setup`. Steps are in [DEPLOY](DEPLOY.md) Part 3.

- [x] Scratch organization `robinson-ai-scratch` (IN-06).
- [ ] App created and installed for `Robinson-AI-Systems` and for `christcr2012` (IN-04, IN-05). Unverified; use "Show my accounts" to check.
- [ ] "Authorize as me" done for each account (needed for a few personal-only actions).
- [ ] Optional: notifications token (IN-11); package token (classic, `read:packages`, plus `delete:packages` / `write:packages` if wanted).
- [ ] Approve new App permissions on github.com (IN-15). `github_check_permissions` lists them.
- [ ] Connector added in Claude: [START-HERE](START-HERE.md).

## 3. Public sign-in switches (all off unless set)

Set in Vercel Production, then redeploy.

- `GITHUB_PUBLIC_CONNECT=enabled` turns on the GitHub sign-in and Approve page for everyone. It also needs `GITHUB_PRIVATE_TENANT_PILOT=enabled`, `GITHUB_PILOT_APP_ID` and `GITHUB_TENANT_ROUTING_KEY`. Remove it to stop new sign-ins; existing connections keep working. Whether it is on in production: unverified.
- Limits with defaults: `GITHUB_PUBLIC_MAX_CLIENTS` (100000), `GITHUB_PUBLIC_MAX_OPEN_FLOWS` (5000), `GITHUB_PUBLIC_MAX_OPEN_FLOWS_PER_CLIENT` (20). Free use per person: `PUBLIC_FREE_CALLS_PER_DAY` (5000), `PUBLIC_FREE_WRITES_PER_HOUR` (300). People who never return are cleaned up after `PUBLIC_INACTIVE_DAYS` (180). Source: `src/tenancy/public-connect.js`, `public-usage.js`. These are server fairness settings, not limits on your own connection; `PUBLIC_UNLIMITED_SUBJECTS` exempts named people.
- `GITHUB_PUBLIC_INVITE_ONLY=enabled` limits NEW people to the invite list on the setup page. Existing people are never locked out.
- `GITHUB_PUBLIC_NEW_SIGNUPS=paused` closes new sign-ups by hand. They also pause on their own when the cost estimate reaches `PUBLIC_COST_PAUSE_CENTS` (5000). Estimate settings: `PUBLIC_COST_PER_1K_CALLS_CENTS` (5), `PUBLIC_COST_ALERT_CENTS` (2000).
- `PUBLIC_SUPPORT_EMAIL`, then `LEGAL_APPROVED=yes` after you approve the text. Until then `/privacy`, `/terms`, `/security`, `/support` show a DRAFT banner.
- GitHub App settings for public sign-in: "Request user authorization (OAuth) during installation" OFF; Setup URL `/api/github/setup`; webhook `https://github.robinsonaisystems.com/api/github/webhook`; callback `/api/github/user-callback`. The webhook address was moved 2026-10-24 (per earlier record; not rechecked today).
- My connection page: `/connection` (public sign-in only).

## 4. Keys

- Change the encryption key without logging everyone out: put the old key in `TOKEN_ENCRYPTION_KEY_PREVIOUS` (at most two), set the new one in `TOKEN_ENCRYPTION_KEY`, release (`src/core/crypto.js:17-20`). Remove an old key only after everything sealed with it is re-saved.
- Changing `GITHUB_TENANT_ROUTING_KEY` signs everyone out at once (emergency lever). No overlap period.
- Optional test: `GITHUB_STATELESS_INSTALLATION_TOKENS=enabled`, make a few calls, then remove the setting (`disabled` forces the old tokens).

## 5. Marketplace (only if wanted; not activated)

After the Marketplace code is deployed: privately set `GITHUB_MARKETPLACE_WEBHOOK_SECRET` and `CRON_SECRET` (32+ characters each), the same webhook secret in the listing. Set `GITHUB_MARKETPLACE_PLAN_ID` (the free plan's number) and `GITHUB_MARKETPLACE_CONNECT=enabled`. Webhook `/api/marketplace/webhook`; hourly sweep `/api/marketplace/sweep` (`vercel.json` cron, minute 17). Then test a real purchase, cancellation and data deletion. Details: [listing](marketplace/LISTING.md).

## 6. Git workspaces and Playground

Settings (names only): `NATIVE_GIT_WORKER_KEY`, `PLAYGROUND_DOKPLOY_ORIGIN`, `PLAYGROUND_DOKPLOY_API_KEY`, `PLAYGROUND_DOKPLOY_PROJECT_ID`, `PLAYGROUND_DOKPLOY_ENVIRONMENT_ID`, `PLAYGROUND_INGRESS_IPV4`. `PLAYGROUND_RESOURCE_MODE=best_effort` is in `vercel.json`. All enrolled per your 2026-10-29/30 notes (unverified from code). See [PLAYGROUND-OPERATIONS](PLAYGROUND-OPERATIONS.md). Backups: optional, not a go-live gate.

## 7. Appliance Desk and other repos (Agent can check)

Run `github_workflow_app_readiness` for `appliance-desk` ([APP-NEEDS-APPLIANCE-DESK](APP-NEEDS-APPLIANCE-DESK.md)). Done 2026-10-09: `main` requires `ci` only. Not verified: force-push and deletion blocked, secret scanning, fork-PR approval, a `live` branch. Same ruleset wanted on `stripe-mcp`, `google-workspace-mcp`, `robinsons-toolkit-hub`, `vercel-mcp`, `neon-mcp`; not verified.
