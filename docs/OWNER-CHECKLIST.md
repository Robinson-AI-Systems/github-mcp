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

4. **Direct git host for big pushes (GIT-DIRECT-1/-2, added 2026-11-02, simplified 2026-11-02).** Today a git push through the MCP domain stops at about 25 MB (Vercel's proxy). With one extra web address pointed at the worker, pushes go straight to it (default up to 2 GB, GitHub's own limit; bigger ones can be sent on in parts). Already done: the `git` DNS record and the Dokploy domain on port 3001 with HTTPS. **No Dokploy environment edit is needed any more**: the agent sets Vercel's `GIT_DIRECT_ORIGIN`, and the next release plus worker redeploy let the service configure the worker itself. The one step left for you (or the server's admin, since it is the friend's server): raise Traefik's upload read timeout on that server, which today stops any upload that takes longer than 60 seconds (a first ~100 MB test usually fits; 1 GB will not). Exact wording: [GO-LIVE-CHECKLIST "Direct git host"](GO-LIVE-CHECKLIST.md). Nothing is bought. Until then everything keeps working through the MCP domain. Decision for later, not now: whether to allow single pushes above 2 GB (stored setting `git_remote.push_limit`) and whether to build Git LFS support (paid on GitHub beyond its free quota; see ROADMAP).

5. **Deploy the updated runtime image for Git access inside Playground (AGENT-FB-3, added 2026-11-03).** The new `git_access` operation needs the Playground runtime image rebuilt from this release (`workers/coding-workspace`) on the shared pool and any of your own machines. Until then it says the runtime did not accept the key and cancels it; nothing else is affected. Not a blocker.

6. **Link this chat to the PC (Claude desktop app → Link to this computer)** (PC-WORKER-1, added 2026-11-03). Lets an agent run the PC worker kit and its checks inside WSL itself instead of through your assistant. Optional: Vivienne can run the same commands over SSH ([PC-WORKER](PC-WORKER.md)). To pause the worker any time, from Windows: `wsl -u root -e /srv/robinson-git/pc-worker pause` (and `resume`). Nothing is bought.

## Only if you want them

- **Backups of Git workspaces.** Optional and not needed for production (decision 2026-10-30). No backup exists today. The off-server destination currently returns 401; do not work around it. When you want it: [runbook](NATIVE-GIT-BACKUP-RUNBOOK.md).
- **Paid-feature tests.** Only with a specific cost approved by you. Nothing is bought just to finish a test.
- **Budget-deletion test.** You declined it on 2026-10-23. Leave it closed.
- **Meta Muse / Muse Code.** Test only if you want those clients.
- **Hub checks.** Optional; the Hub team owns them.
- **Pricing and spend alerts.** Choose only if you want to charge or cap spend. Nothing is assumed.
- **Copilot and larger-runner costs (CAP-6, optional decision).** Since June 2026 GitHub bills Copilot (coding agent, code review) and larger runners by use with no fixed price per action. These tools now always ask you first, show "COST UNKNOWN", and refuse when even that cannot be worked out. If you would rather they refuse every action without a published price, say so; it is a one-line change. Nothing waits on this.
- **Only if a key is ever exposed: replace it (KEY-ROTATION, added 2026-11-01).** Not a launch chore. If the App's private key, client secret or webhook secret, or the routing or encryption key, is ever seen by someone it should not be, follow [KEY-ROTATION](KEY-ROTATION.md): App secrets are replaced on the protected setup page (GitHub checks the new one first; nobody is signed out), the two Vercel keys in Vercel settings. Agents cannot do the GitHub or Vercel steps and never see the values.
- **Real-account key rotation rehearsal (optional, KEY-ROTATION).** Only if you want to see it once on your real App: follow [KEY-ROTATION](KEY-ROTATION.md) section 3 (webhook secret: setup page, then paste on GitHub). Tell an agent when done; it then checks that new deliveries show 200. The rehearsals with fake keys already count for launch readiness; this one never blocks anything.
- **Fine-grained token, live check (PUB-9).** Only if you want to see it on your real account once it is released: on GitHub create a fine-grained token for an organization or account where the App is *not* installed (pick one or two repositories and give Contents read), then open My connection, tap "Add a fine-grained token" and paste it there (never into a chat). Agents then check `github_whoami` and a read on that place. Never blocks anything.

## Public launch inputs

- [x] Privacy, terms and security text approved; support email `hello@robinsonaisystems.com` set. `LEGAL_APPROVED=yes` and `PUBLIC_SUPPORT_EMAIL` are in Vercel production (checked 2026-10-30, values by name only).
- [ ] GitHub Marketplace listing (only if wanted): verify publisher email, pick trader status, accept the agreement, then enroll the webhook and cron secrets privately. See [GO-LIVE-CHECKLIST](GO-LIVE-CHECKLIST.md) and [listing](marketplace/LISTING.md).
- [ ] Official MCP Registry listing (only if wanted): choose where the signing key lives and finish the DNS step. Never put the key in chat or the repo.
- [ ] Website button: [connect-button](website/connect-button.html) goes on the business site through that site's own work.

**Before opening wider (PUB-7, added 2026-11-01).** The readiness report (`github_launch_readiness`, or `npm run launch:readiness`) reads these three boxes. Agents tick a box only after you say it is done. None of them blocks building; the report only says when to ask you about opening wider, and it never changes a setting.
- [ ] Review draft legal pages with a lawyer before public opening. You approved the privacy, terms, security and support text on 2026-10-25; no lawyer has read it (agents are not lawyers). Also read the new draft `/status` page; if you are happy with it, set `STATUS_PAGE_APPROVED=yes` in Vercel production (until then it shows a draft banner).
- [ ] Confirm the GitHub App is set up for public use: on GitHub's App settings page, check name, logo, homepage, support contact, the addresses in [GO-LIVE-CHECKLIST](GO-LIVE-CHECKLIST.md) section 3 and the permission list ([review](audits/APP-PERMISSIONS-2026-10.md)). Tell an agent "App settings checked".
- [ ] Real-device check before opening: a first-time person (or you, signed in as a new person) connects on a real phone, installs the App, adds an extra token and sees tools unlock. Tell an agent how it went; agents run everything else in test browsers.

## Playground (coding workspaces)

- [x] **Done 2026-11-01 (by Vivienne for Chris):** the `github-mcp-runtime` package is public (the org setting allowing public packages was turned on first). Anonymous pulls verified. Runtimes now use the published image of each release automatically — no digest to pin by hand.

**More shared capacity (optional, 2026-11-01):** to add another Dokploy instance or server to the shared pool, give agents its address and put its API key in a new protected Vercel setting (for example `PLAYGROUND_KEY_SECOND`) — never in chat. Agents then add it to `PLAYGROUND_POOLS`.

**Runtime fleet decisions (2026-11-01, none blocks work):**
- [x] **Approved 2026-11-01:** the "dial-out" host agent ([design §2.1](designs/RUNTIME-FLEET-2026-11-01.md)). Yes means your PC and tailnet machines can run Playground work with no public tunnel; each machine makes one small check-in request about every 25 seconds while idle. Recommended: yes.
- [x] **Approved 2026-11-01:** pool order = each person's own machines first, then the shared Dokploy pool.
- [x] **Done 2026-11-01:** smaller default runtime. A medium runtime passed a real build, and medium is now the built-in default (no Vercel setting needed). Agents can still ask for small/medium/large per workspace.
- [x] **Approved 2026-11-01:** let agents publish the runtime image once and set `PLAYGROUND_IMAGE` to its digest, instead of building it for every workspace. Needs a container registry choice (GitHub Packages is free for public images).


**PLAY-2 (2026-10-31):** After reviewed/deployed enrolled-host software exists, the first real acceptance needs your own WSL2/Docker PC paired by you under your own connection, plus a user-owned outbound HTTPS tunnel reachable from the controller. The bench GitHub key stays on your device; never paste keys or tunnel secrets into chat. Real appliance-desk workspace measurement, ownership proof and mid-run revocation can occur only after your personal enrollment. Agents may implement and test synthetic fixtures independently. The first pairing-only helper is `tools/playground-device/pair.mjs` with instructions in `tools/playground-device/README.md`; it retains the Ed25519 signing key locally. Do not run it as a completed Playground installation: approved devices still require an independently verified canary before commands. This step remains owner-operated and is not requested until the source is reviewed, deployed and the owner's tunnel is ready. No new paid fallback, operator quota, or hosting plan has been approved. See [PLAY-2](pr-cards/PLAY-2.md).


Released in "best effort" mode (`vercel.json` sets `PLAYGROUND_RESOURCE_MODE`). Dokploy credentials are saved in protected setup; live provisioning reached Dokploy on 2026-10-30. Host monitoring, quotas and backups are optional. Private workspace isolation and clean-up are required. Some Dokploy host reads return 401; a signed clean-up proof covers that. Do not give unrestricted admin, paste credentials in chat, or buy more resources. Details: [PLAYGROUND-OPERATIONS](PLAYGROUND-OPERATIONS.md).

Acceptance counts (56 passed, 15 not yet) are from the 2026-10-29 ledger in [STATUS](STATUS.md); unverified today.