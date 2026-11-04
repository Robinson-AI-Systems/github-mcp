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
- `PUBLIC_SUPPORT_EMAIL`, then `LEGAL_APPROVED=yes` after you approve the text. Until then `/privacy`, `/terms`, `/security`, `/support` show a "DRAFT — not yet reviewed by a lawyer; not in effect" banner.
- `STATUS_PAGE_APPROVED=yes` after you read the new `/status` page (PUB-7). Until then it shows the same draft banner. It is not linked from any page.
- Before opening wider, ask the owner tool `github_launch_readiness` (or run `npm run launch:readiness`). It says per launch condition met / not met / needs you, and never changes a setting.
- GitHub App settings for public sign-in: "Request user authorization (OAuth) during installation" OFF; Setup URL `/api/github/setup`; webhook `https://github.robinsonaisystems.com/api/github/webhook`; callback `/api/github/user-callback`. The webhook address was moved 2026-10-24 (per earlier record; not rechecked today).
- My connection page: `/connection` (public sign-in only).

## 4. Keys

- Replacing any key or secret, step by step and without downtime: [KEY-ROTATION](KEY-ROTATION.md) (App private key, client secret and webhook secret on the setup page; routing and encryption keys in Vercel). Only needed if one is ever exposed.
- Change the encryption key without logging everyone out: put the old key in `TOKEN_ENCRYPTION_KEY_PREVIOUS` (at most two), set the new one in `TOKEN_ENCRYPTION_KEY`, release (`src/core/crypto.js:17-20`). Remove an old key only after everything sealed with it is re-saved.
- Change `GITHUB_TENANT_ROUTING_KEY` without signing people out: old key into `GITHUB_TENANT_ROUTING_KEY_PREVIOUS` plus an end time `GITHUB_TENANT_ROUTING_KEY_PREVIOUS_UNTIL` (UTC, at most 30 days ahead), new key into `GITHUB_TENANT_ROUTING_KEY`, release. Leaving out the two `_PREVIOUS` settings still signs everyone out at once (emergency lever).
- Optional test: `GITHUB_STATELESS_INSTALLATION_TOKENS=enabled`, make a few calls, then remove the setting (`disabled` forces the old tokens).

## 5. Marketplace (only if wanted; not activated)

After the Marketplace code is deployed: privately set `GITHUB_MARKETPLACE_WEBHOOK_SECRET` and `CRON_SECRET` (32+ characters each), the same webhook secret in the listing. Set `GITHUB_MARKETPLACE_PLAN_ID` (the free plan's number) and `GITHUB_MARKETPLACE_CONNECT=enabled`. Webhook `/api/marketplace/webhook`; hourly sweep `/api/marketplace/sweep` (`vercel.json` cron, minute 17). Then test a real purchase, cancellation and data deletion. Details: [listing](marketplace/LISTING.md).

## 6. Git workspaces and Playground

Settings (names only): `NATIVE_GIT_WORKER_KEY`, `PLAYGROUND_DOKPLOY_ORIGIN`, `PLAYGROUND_DOKPLOY_API_KEY`, `PLAYGROUND_DOKPLOY_PROJECT_ID`, `PLAYGROUND_DOKPLOY_ENVIRONMENT_ID`, `PLAYGROUND_INGRESS_IPV4`. `PLAYGROUND_RESOURCE_MODE=best_effort` is in `vercel.json`. All enrolled per your 2026-10-29/30 notes (unverified from code). See [PLAYGROUND-OPERATIONS](PLAYGROUND-OPERATIONS.md). Backups: optional, not a go-live gate.

Single domain (SINGLE-DOMAIN-1): transfers use `PUBLIC_BASE_URL` (already set). Optional switch `NATIVE_GIT_TRANSFER_RELAY=off` returns worker-host addresses. Runtime transfers need the runtime image rebuilt from a commit that includes SINGLE-DOMAIN-1 (new `ingress.js`); older runtimes get a plain fallback.

Git remote (GIT-REMOTE-1): no new setting. The control plane release brings `/git/*` (Routing Middleware), `/git-remote/exchange` and `/api/git-remote`; the two tables are created on first use. Redeploy the native worker from a commit that includes GIT-REMOTE-1 (capability `git_remote: "v1"`; until then `github_git_remote_setup` answers "the native Git worker must be updated"). No runtime image change. Optional stored setting `git_remote.lifetime` `{ "default_hours": 8, "max_hours": 24 }` (defaults apply when absent).

Direct git host (GIT-DIRECT-1/-2, optional; until it is done everything keeps working through the MCP domain). Placeholders: `<domain>` is your domain, `<server-ip>` the Dokploy server's public IPv4 (the address your current worker domain already points to). Since GIT-DIRECT-2 no Dokploy environment edit is needed: the control plane configures the worker itself.
1. **DNS** (your DNS provider) — done 2026-11-02: record type `A`, name `git` (giving `git.<domain>`), value `<server-ip>`, TTL default, **DNS only** (a proxying CDN would cap upload size, which is what this host avoids).
2. **Dokploy, worker app → Domains** — done 2026-11-02: host `git.<domain>`, path `/`, container port `3001` (the worker's default `GIT_DIRECT_PORT`), HTTPS on, Let's Encrypt.
3. **Release and worker redeploy** (agent, normal route): the control plane release that includes GIT-DIRECT-2, and a worker redeploy from a commit that includes it (no environment change; the worker reports `git_direct_configure: "v1"`). Check `https://git.<domain>/health` answers `ok` once the worker is configured (step 5).
4. **Vercel** (production environment, agent): `GIT_DIRECT_ORIGIN=https://git.<domain>`; it takes effect with the next deployment.
5. **Agent**: call `github_git_remote_setup` once. It sends the worker the signed `direct_configure` action (`origin` = `GIT_DIRECT_ORIGIN`, `control` = `PUBLIC_BASE_URL`'s origin), the worker stores it on its volume and starts the direct listener without a restart, and setup pins the worker's signing key and returns `remote_url` on `git.<domain>`. If it cannot, the result's `direct_note` says why and `remote_url` stays on the MCP domain. Then live acceptance: clone, a push of ~100 MB and of ~1 GB to the scratch repository through `remote_url`, then the same key on `fallback_url`.
6. ~~Dokploy → Traefik configuration~~ **No longer needed (PUSH-EXIT-1, 2026-11-03).** The worker compose now has its own `push-exit` front door: Traefik passes `git.<domain>` through by SNI (TCP routers are not cut at 60 s) to a Caddy container that gets its own certificate (TLS-ALPN-01) and streams to the worker. Proven live with a 97 s upload. Nothing on the server's global Traefik settings changes.

Owner identity for the PC (RELAY-OWNER-1, 2026-11-03): Vercel production `OPERATOR_GITHUB_USER_ID` = the operator's numeric GitHub user id (same number as in `PUBLIC_UNLIMITED_SUBJECTS`; never committed). Check after the next deployment: from Chris's claude.ai connection `github_server_status` shows `pc` as `available` (not `owner_only`) and `github_git_remote_setup` records the key on the PC; from any other person's connection `pc` stays `owner_only`.

Push exit (PUSH-EXIT-1, 2026-11-03; after Chris releases `live`): (a) **Dokploy** (agent): redeploy the native Git worker compose from `live`; check `https://git.<domain>/health` answers `ok`; optionally delete the now-shadowed Dokploy domain `git.<domain>` → port 3001 (recreate it the same way to undo). (b) **Vercel** production (agent): `GIT_DIRECT_ORIGIN=https://git.<domain>` and `GIT_DIRECT_HOST=previous` (the Dokploy host's role, or its pool name), then a production redeploy. (c) **Agent**: one applied `github_git_remote_setup` (pins the Dokploy worker key; result shows `push_exit`). (d) Live timings on the scratch repository: 40 MB, 150 MB, ~1 GB. Roll back: `GIT_DIRECT_ORIGIN` back to the PC address, remove `GIT_DIRECT_HOST`, redeploy, setup once.
Worker environment values `GIT_DIRECT_ORIGIN` + `GIT_DIRECT_CONTROL_ORIGIN` still work (GIT-DIRECT-1) and, when both are set, win over the stored configuration.
Optional stored setting `git_remote.push_limit` `{ "max_push_bytes": n }` (default 2 GiB = GitHub's limit; raise it to accept larger single pushes, which are then sent on to GitHub in parts; mind the worker volume).

PC worker as the primary native Git worker (PC-WORKER-1, owner decision 2026-11-03 "Use my PC … treat the PC as the primary route, not the fallback"). Dokploy stays the previous worker. Runbook with every command: [PC-WORKER](PC-WORKER.md). Placeholders: `<pc>.<tailnet>.ts.net` is the PC's own Windows Tailscale name, `<mcp-domain>` the MCP's domain.
1. **PC, inside WSL as root** (Chris's assistant over SSH, or an agent on a linked device): `git clone https://github.com/Robinson-AI-Systems/github-mcp.git /srv/robinson-git/src`, then `bash /srv/robinson-git/src/deploy/pc/install.sh --mcp-origin https://<mcp-domain> --ref live`. Expect every step `ok`, both local health checks and the Windows reachability check.
2. **PC, Funnel on its own node**: the same command plus `--configure-funnel` (adds `/`, `/git`, `/health` on 443 of this node only; refuses if the node already serves anything else). Check `curl -fsS https://<pc>.<tailnet>.ts.net/health` answers `ok`. No router change.
3. **Vercel** (production, agent): `NATIVE_GIT_WORKER_URL=https://<pc>.<tailnet>.ts.net`, `NATIVE_GIT_PREVIOUS_WORKER_URL=<current Dokploy worker origin>`, `NATIVE_GIT_WORKER_CUTOVER_AT=<UTC switch time>`, `GIT_DIRECT_ORIGIN=https://<pc>.<tailnet>.ts.net`; effective with the next release deployment.
4. **Agent**: `github_server_status` (worker ok, `build_commit` = the PC commit, direct git ok), one `github_git_remote_setup` (pins the PC's direct-host key; `remote_url` on the ts.net name), then live acceptance on the scratch repository (open/clone/push/close, a large push through `remote_url`), recorded in `docs/developer-evidence.json`.
5. **Pause/resume from Windows**: `wsl -u root -e /srv/robinson-git/pc-worker pause` / `resume` / `status` / `stop`. Rollback to Dokploy: swap the two worker URLs in Vercel (runbook "Roll back to Dokploy").
The Dokploy Traefik 60-second upload limit (step 6 above) no longer matters for pushes once the direct host is on the PC.

## 7. Appliance Desk and other repos (Agent can check)

Run `github_workflow_app_readiness` for `appliance-desk` ([APP-NEEDS-APPLIANCE-DESK](APP-NEEDS-APPLIANCE-DESK.md)). Done 2026-10-09: `main` requires `ci` only. Not verified: force-push and deletion blocked, secret scanning, fork-PR approval, a `live` branch. Same ruleset wanted on `stripe-mcp`, `google-workspace-mcp`, `robinsons-toolkit-hub`, `vercel-mcp`, `neon-mcp`; not verified.
