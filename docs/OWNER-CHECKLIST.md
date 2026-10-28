# Chris's checklist — only the things that need you

- [ ] **Native Git HTTPS route (2026-10-28):** worker source is released and the existing Dokploy container is healthy, but its generated public origin times out. An authorized network operator must route an HTTPS hostname to this project's native-git:3000 (reachable proxy or owned outbound tunnel), without exposing host/Docker administration. Current account is denied server-wide controls; no usable Cloudflare account selector was available. See [exact evidence and re-entry](status/2026-10-28-combined-release.md) and [route verification](NATIVE-GIT-OPERATIONS.md). Once reachable, agents can finish scratch clone/push/readback/disposal without another product implementation.


**Owner decision pending — private `github-mcp` (2026-10-26).** No change may be made until Chris explicitly approves the conversion after checking that GitHub Team or higher is needed to retain private branch protections, a GitHub Actions usage estimate against the account's paid-plan included allowance and the current $0 overage cap, and a plan to grant David2024patton authorized access to the new private repo. His existing public fork would remain public. Documentation of the current licensing status is separate.

Everything an AI agent can do, test or verify on your behalf, it does. This page lists the **only** things that
strictly need you (your sign-in, your device, your money or your decision). None of them blocks development; agents
build and merge without waiting. Do them whenever you are ready, top to bottom. Tick the box and add the date.

Rules for agents: add a row here (plain English, one step at a time) instead of stopping to ask. Never tick a box for
Chris. Never mark a check passed without real observations. Results go in `docs/developer-evidence.json`.

## A. Do once, any time

- [ ] **Save your two server secrets** in your password manager, especially the admin passphrase. They were set up
      privately on 2026-10-12 and exist only in Vercel settings. (IN-03)
- [ ] **Connect your real GitHub accounts.** Open the server's setup page and click "Create the GitHub App" once for
      `Robinson-AI-Systems` and once for `christcr2012`, then "Install" on each (All repositories is recommended), and
      "Authorize as me" once. GitHub hands the keys straight to the server; there is nothing to copy. (IN-04, IN-05)

## B. Device checks (need your phone and computer)

- [x] **Phone check, Claude app** — done 2026-10-22: the Claude phone app reported the connector, account robinson-ai-scratch,
      live mode, no spending limit. Desktop/web is covered by the connector you added on claude.ai.
- [x] **Phone check, ChatGPT** — done 2026-10-22: ChatGPT reached the custom server as robinson-ai-scratch (read-only preview, by your
      choice of permissions at sign-in).
- [x] **PUB-4 scope decided:** covers Claude and ChatGPT both; code part merged.
- [x] **Phone check, ChatGPT on Android** — done: it works (Chris, 2026-10-23).
- [ ] **Optional, only if the chance comes up: ChatGPT on iPhone, and the desktop app.** Ask "which GitHub account am I connected to?" and tell the agent. Blocks nothing; Android already proves the sign-in.
- [x] **Disconnect and reconnect test — done (Chris, 2026-10-23):** disconnecting and reconnecting has worked many times (adding accounts, switching between preview and production).
- [ ] **Two-minute tidy-up (optional):** delete the old, finished branches on the repository page (Branches; GitHub's "delete branch after merge" setting would stop new ones piling up): ai/o2-org-members-20261014,
      ai/o2-owner-org-members-20261014, docs/authority-corrections-acceptance-handoff, docs/hub-contract-reference-20261019 (all merged), and
      scratch/status-fragments (its content is redundant), plus the merged ai/claude/* working branches. The agent's environment is not allowed to delete branches.
- [x] **PUB-5 decided 2026-10-24:** no ChatGPT/Claude directory listing (they refuse unofficial connectors); public and free from your website instead. Steps are in "PUB-5 launch" below.

## B2. Give the agent a working connection to your deployed server (lets agents run the real-account tests for you)

- [x] **Add the server as a connector in Claude** — done 2026-10-22 (scratch organization). Agents can use the GitHub tools
      directly in a new session. Ordinary scratch writes (create/close an issue, branches, PRs on disposable fixtures) work in
      preview mode; only operations the server classifies as production need production mode.
- [x] **Connector switched to production mode for the scratch organization only** — done by Chris 2026-10-22 (compact tool menu).
      Never for his real accounts without his say-so. This lets agents test production-classified operations on scratch
      fixtures, each still behind its own guards and confirmation.

## B3. Things that cannot be tested until you have them

- [x] **A GitHub Enterprise to test with:** the free Enterprise trial on `robinson-ai-scratch` (2026-10-23, ends about
      2026-11-22) covers it for now. See the ENT-1 row below for the one thing you do.

## C. Decisions only you can make

- [x] **Releases are pre-authorized (Chris, 2026-10-23):** agents release when needed and say so afterwards.
- [ ] **Turning on production** for each real account, when you want the server to make real changes there
      (`docs/GO-LIVE-CHECKLIST.md` section 3).

## Done

(Nothing yet.)

## Added 2026-10-23 (connecting more accounts, branch setting, webhook proof)
- [ ] **Turn on "Automatically delete head branches"** for Robinson-AI-Systems/github-mcp: repository Settings, General, Pull Requests. (The agent's environment is not allowed to change repository settings.)
- [x] **Connect more of your accounts (done 2026-10-23):** `Robinson-AI-Systems` (organization) and `christcr2012` (personal) are installed and listed on the connect screen next to `robinson-ai-scratch`.
- [x] **(done 2026-10-23)** Turn on production for the accounts you want changed (`Robinson-AI-Systems`, and `christcr2012` for personal-account tests): setup page, administrator passphrase, production switch for that account. Then disconnect and reconnect the Claude connector and choose **Production**. Until then the agent can only read on those accounts. Waiting on this: the branch setting and old-branch cleanup on github-mcp, and the real-account budget, Codespaces and protection checks.
- [x] **(done 2026-10-23)** Sign in as yourself on the setup page ("Authorize as me") for `Robinson-AI-Systems` and `christcr2012`.** This lets the agent read your personal settings and plan. Your new GitHub Pro covers only personal repositories; `Robinson-AI-Systems` is on GitHub's free organization plan, so organization budgets, Codespaces access and private-repo branch protection stay blocked until you upgrade that organization (your money decision).
- [ ] **Optional, 2 minutes: prove webhook signatures.** The agent created and removed a test webhook but cannot see its signing secret (it is shown only behind your passphrase). To prove the signature check, create a test webhook through the agent, open the one-time link it returns, and compare against a receiver you control.
- [x] **Enterprise trial started on `robinson-ai-scratch` (done 2026-10-23).** It is free for 30 days and ends on its own; do not add a card. Budgets can now be read, rulesets accept "evaluate" mode, and private-repo branch protection works there. Still not working there, and not a plan problem: creating a new budget and the Codespaces access setting both answer "not found". You decided on 2026-10-23 that this is sufficient; no further budget testing.
- [x] **Paid plan for `Robinson-AI-Systems` — not needed now (Chris, 2026-10-23).** Private-repo protection and budgets on that organization stay untested there; they are covered on the scratch organization. Revisit only if you want them.

## Updated 2026-10-23 after Chris's answers
- [ ] **Optional, only if really needed: a second GitHub account** (a throwaway you control) to finish the collaborator-invitation test (H3). Agents will say if it is the last thing blocking a result.
- [ ] **Package token — needs a walk-through.** When you are ready, tell the agent "walk me through the package token" and it will guide you one small step at a time. Blocks nothing.
- The Hub is not a checklist item. The Hub finds and connects to this server; our only job is to keep following the Hub's published spec (`docs/HUB-COMPATIBILITY.md`). No Hub-run tests are tracked here.

## Later, for the public launch (approved 2026-10-23; blocks nothing now)
- [ ] **Read and approve the terms of service and privacy policy** the agent drafts, and have a lawyer look at them before launch. Drafts are in `docs/legal/` (PRIVACY-DRAFT.md, TERMS-DRAFT.md); nothing serves them yet.
- [x] **Say go** for public use: done 2026-10-24 — public and free, from your website, no invite list, no people cap (PUB-5).
- [ ] **Choose the support contact** (an email address) that appears on the App and the legal pages.
- [ ] **Decide pricing, if any,** once the cost numbers from the load test exist.
- [x] **Package token saved and fully tested (done 2026-10-23).** Agents published a throwaway package themselves with a GitHub workflow; read, delete and restore all passed. Nothing more needed from you.

## Public sign-in: where it stands (updated 2026-10-23, after the rebuild)
Rebuilt and tested in real browsers (Android Chrome, iPhone Safari engine, desktop Chrome) by the agents, so you no longer
test fixes on your phone. Still switched OFF. The new sign-in: your app opens GitHub, you tap **Approve** once, you are back
in your app. Everything optional is on one page, **My connection** (`github.robinsonaisystems.com/connection`), which your
assistant can give you the link to: add accounts, add the master token, make your apps read-only, time zone, disconnect an
app, delete your data. What remains is yours:
- [ ] **Say "go"** when you want public sign-in turned on. The agent flips the switch, moves the connector address to
      `github.robinsonaisystems.com` and runs a real sign-in end to end first.
- [ ] **Then move your own setup across (about five minutes, once):**
      1. In ChatGPT and in Claude, remove the old Robinson GitHub MCP connector and add it again with the new address.
      2. Connect: GitHub opens, then tap **Approve**. If the App is not yet on one of your accounts, the page says so and
         gives you one "Install" button.
      3. Open **My connection** and press **Add** next to any account still missing (for example `christcr2012` or
         `Robinson-AI-Systems`).
      4. On the same page press **Add my master token** and follow the four steps. It replaces the separate package and
         notifications tokens you set up before.
      Your old connection keeps working until you remove it, so nothing breaks in between. Custom entries you added to the
      protected-repositories list on the old setup page do not carry over (the standard list does); tell the agent if you
      had any.
- [ ] **Approve the legal text** in `docs/legal/` (privacy notice and terms), ideally after a lawyer reads them, and **choose a support email** that goes on them and on the App.
- [ ] **Decide pricing, if any,** once real usage numbers exist (the setup page shows them once people connect).
- [ ] **Optional: try it once on your phone after "go".** Nice to have, not needed to prove it works.
- Handled by the agent, nothing for you: time zones, read-only option, usage view, deleting a person's data (yours and theirs), key change procedure, the domain's HTTPS certificate, and the browser tests.
- **When your registrar moves the nameservers to Vercel,** the DNS records must exist on the Vercel side too (including `github` and any email or website records). Tell the agent when the cutover is close and it will compare and add the missing records so nothing breaks.

## Finish plan (written 2026-10-23; agents build it, these are the only parts that need you)
The remaining work is planned in `docs/designs/FINISH-PLAN.md`. None of these blocks building.
- [ ] **Before about 2026-11-22 (Enterprise trial end): replace your master token once, with enterprise permissions.**
      After the ENT-1 tools are released, the agent tells you. Open My connection, press "Replace or remove it", and use
      the link "Include enterprise permissions". Takes about a minute.
- [ ] **Optional decision: "extra places" (GOD-5).** With your master token you will be able to add organizations or
      repositories where the App is not installed. Planned default: each one starts **read-only** and you switch on
      changes per place on My connection. Tell the agent if you want a different default. Nothing waits on this.
- [ ] **One field in the GitHub App settings (HARD-1, when the agent asks):** Setup URL →
      `https://github.robinsonaisystems.com/api/github/setup` → Save. The old address keeps working until then.
- [ ] **Optional, for one acceptance test:** a second GitHub account you control (the collaborator-invite check);
      already listed above, still optional.
- [ ] **Public launch decisions (LAUNCH-1, whenever you like):** turn on invite-only (recommended while you test with a
      few people), the support email shown on the App and the trust pages, approving the legal text (ideally after a
      lawyer reads it), and the monthly hosting-cost alert amount (default $20).
- Money decisions stay yours and stay untested until you choose: budgets deletion, paid runners, paid Copilot or
  Sponsors actions.
- [x] (LAUNCH-1) Invite list: decided 2026-10-24 — not used; the service stays open to everyone. The switch remains only as an emergency lever.
- [ ] (LAUNCH-1) Check the hosting cost estimate: on the owner setup page, "Public usage" shows an estimated monthly cost. The starting price (`PUBLIC_COST_PER_1K_CALLS_CENTS`, 5 cents per 1,000 calls) is a rough guess; when you have a real Vercel/Neon bill, set it to match, and set `PUBLIC_COST_ALERT_CENTS` (default 2000 = $20) to the monthly amount you want a warning at. Not needed for building or merging.
- [ ] (LAUNCH-1) Publish decisions for the trust pages: the privacy, terms, security and support pages now exist at `/privacy`, `/terms`, `/security`, `/support` with a "DRAFT" banner. When you are happy with the wording (ideally after a lawyer reads `docs/legal/`), set `LEGAL_APPROVED=yes`; set `PUBLIC_SUPPORT_EMAIL` to the address people should write to (until then they say "support email coming soon"). Not needed for building or merging.
- [ ] (LAUNCH-1) Decide whether the GitHub App keeps its full permission list. The review (`docs/audits/APP-PERMISSIONS-2026-10.md`) recommends keeping it: nothing is unused. If you want a smaller App, say so; changing it on GitHub makes every installer approve again. Not needed for building or merging.
- [x] (done 2026-10-24, manual release by agent at Chris's request) **Release of `live`:** the agent environment refuses to move the `live` branch. The daily scheduled job does it by itself; if you want the new code live sooner, ask for a manual release. Not a blocker for development.
- [x] (done 2026-10-24) **Optional: allow deploy keys on the scratch organization** (GitHub org Settings → Repository → "Deploy keys" policy). Only needed to finish one test row (GITHUB-H3-ACCESS-LIFECYCLE); it widens access slightly, so it is your call. Not a blocker.
- [ ] **Two quick checks on your phone or computer (ACC-1):** (1) [done 2026-10-24: Robinson-AI-Systems added as a read-only extra place and tested; removed again by you at 06:48; nothing left to do] (2) next time you sign in a new app or person, tell the agent whether it worked. Neither blocks anything.
- [x] (done 2026-10-24, approved by Chris) **Optional shortcut, restores whoami and changes now instead of after tomorrow's release (HARD-2):** tell the agent "yes, run the two additive column statements on the two existing person schemas". Otherwise the fix arrives with the next daily release. Reads keep working either way.

## PUB-5 launch (written 2026-10-24; agents build it, nothing here blocks building or merging)
Defaults in brackets are what the agents build; change any by telling the agent.
- [ ] **Name shown to people** [Robinson MCP for GitHub, with "Not affiliated with or endorsed by GitHub" on every page]. Leading with your own brand keeps clear of GitHub's trademark.
- [ ] **Free daily limit per person** [5,000 assistant calls a day, 300 changes an hour]. Stops one heavy user from running up your bill. Your own GitHub account is exempt (the agent fills in its number for you; you add it as a setting) so your agents are never slowed.
      Your GitHub number (found 2026-10-24 with the connector, not a secret): **227716942** (user christcr2012). In Vercel (Settings → Environment Variables, Production) add `PUBLIC_UNLIMITED_SUBJECTS` = `227716942`, then redeploy. Several people: separate numbers with commas.
- [ ] **Pause new sign-ups automatically when the estimated monthly cost reaches** [$50]. People already connected keep working. You can also pause by hand.
- [ ] **Sign people out after this long without use** [180 days]. They just sign in again; it keeps fewer stored keys and costs less.
- [ ] **Turn on spend alerts in Vercel and Neon** (their own settings pages, free): Vercel → Settings → Billing → Spend Management; Neon → Billing. Those emails are how you hear about cost, so the server needs no email system.
- [ ] **Launch with the trust pages still marked DRAFT?** [yes]. When ready: set `LEGAL_APPROVED=yes` and `PUBLIC_SUPPORT_EMAIL`.
- [ ] **Move the GitHub App to your Robinson-AI-Systems organization** (GitHub → the App's settings → Advanced → Transfer ownership). Recommended before the Marketplace listing, which shows the owner's name; today it shows `robinson-ai-scratch`.
- [ ] **Put the connect button on your website:** open `docs/website/connect-button.html`, paste it into the page on robinsonaisystems.com where the product belongs (or ask for it in the website repository's own session). No scripts, no tracking.
- [ ] **Publish to the official MCP Registry** (free, one DNS record and one command; the file `server.json` is ready). Steps, from https://modelcontextprotocol.io/registry/authentication.md (checked 2026-10-24):
      1. On your computer: `openssl genpkey -algorithm Ed25519 -out key.pem` (keep `key.pem` private; never send it to anyone, including an agent).
      2. `PUBLIC_KEY="$(openssl pkey -in key.pem -pubout -outform DER | tail -c 32 | base64)"` then `echo "robinsonaisystems.com. IN TXT \"v=MCPv1; k=ed25519; p=${PUBLIC_KEY}\""`.
      3. Add that as a TXT record on robinsonaisystems.com at your DNS provider; wait a few minutes.
      4. `PRIVATE_KEY="$(openssl pkey -in key.pem -noout -text | grep -A3 "priv:" | tail -n +2 | tr -d ' :\n')"` then `mcp-publisher login dns --domain robinsonaisystems.com --private-key "${PRIVATE_KEY}"` and, in the repository folder, `mcp-publisher publish`.
- [ ] **GitHub Marketplace listing:** after the App is moved to Robinson-AI-Systems, submit the listing in `docs/marketplace/LISTING.md` (screenshots are in that folder) as organization owner and accept the Marketplace Developer Agreement. Free plan only.

## God mode "act as me" (GOD-6, planned 2026-10-24)
- [ ] Nothing to do. When it is built, your master token makes GitHub show **you** instead of the bot. If you ever want the
      bot back, use the "Act as me" switch on My connection. Note: anything that only accepts you (like appliance-desk's
      extra testing build) will then also accept your agents, because GitHub sees you.
      Overriding branch rules (for example merging without the required review) works when you ask for it: the assistant
      shows which rules it would skip and you confirm each time. A second switch on My connection turns that off.

## GitHub's new installation token format (2026-10-24)
- [ ] Nothing required. The server already handles the longer tokens (tested). Optional: let an agent switch on GitHub's test header for a day
      on the live service to confirm, then switch it off (`docs/GO-LIVE-CHECKLIST.md`).

## Marketplace final owner inputs (2026-10-24)

Implementation is approved and the publication hold is lifted. Remaining private/legal inputs, after the prepared code and listing are reviewable:

- [ ] Verify the Robinson-AI-Systems publisher email using GitHub's email to hello@robinsonaisystems.com.
- [ ] Choose the Marketplace trader classification that truthfully describes your business.
- [ ] Approve the final privacy, terms and security text, including separate Marketplace cancellation and anti-replay record retention, then accept GitHub's Marketplace agreement on the prepared listing.
- [ ] Privately enroll the Marketplace webhook and cron secrets in the prepared GitHub/Vercel forms; keep them out of chat. Exact variable names and endpoints are in the Marketplace activation section of `docs/GO-LIVE-CHECKLIST.md`.
- [ ] Through the normal initial GitHub sign-in/install flow, give the custom connector the organization's App installation identity needed for protected-branch merges. The current master-token extra place cannot satisfy that rule. No branch-rule override or separate manual installation is inferred.

## Using this connector in Claude Code (PAR-1, 2026-10-24)
- [ ] Keep the official GitHub integration connected in Claude Code as well. It is what lets agents copy repositories,
      push changes with git, use GitHub's command-line tool and get pull-request notifications. This connector cannot do
      those (it lives in the conversation, not on the agent's computer). Agents should use this connector for GitHub tools;
      the official one stays for git.

## Added 2026-10-26 — Meta Muse real-client acceptance (optional; not a development gate)

- [ ] **Meta Muse personal assistant on Android/iPhone:** After MUSE-2 is merged and deployed, open Muse → Settings → Connectors → Add custom connector. Use `https://github.robinsonaisystems.com/api/mcp`; if the form requires a Client ID, copy the public, nonsecret `pcl_meta_muse_public_client_20261026_v1xyz` from the live homepage and leave **Client Secret blank**. Sign in with your OWN GitHub account in the browser and approve the App plus Muse; Muse should return to your chat. Ask Muse to list tools, perform a permitted read, reject an unapproved change, refresh/reconnect, then disconnect. Capture the exact screen/error if it fails. This is client acceptance only, not a prerequisite to build or merge. Never paste GitHub tokens or passwords into Muse.
- [ ] **Muse Code, only if you use it:** Add the homepage's JSON to your Muse Code settings, run `muse mcp login github-robinson`, sign in with GitHub in your browser, and use `/mcp` to verify tools; report the result.
