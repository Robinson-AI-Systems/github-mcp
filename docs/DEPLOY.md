# Deploy and set up

For Chris, who is not a developer. The server is already live at `https://github.robinsonaisystems.com` (Vercel plus its own Neon database). This page explains how it is set up, how to add a GitHub account, and what to do if something breaks. Existing paid Vercel and Neon plans are used; nothing here needs a new plan.

Only the daily release job updates the `live` branch, and Vercel builds only `live` (`.github/RELEASE-POLICY.md`). Do not deploy by hand. Where a step says Agent, say "go" in chat and Claude does it through your Vercel and Neon connections. Secrets are always yours to type; Claude must never see them.

## Part 1. The two homes (already done)

- **Vercel project** `github-mcp`, linked to `Robinson-AI-Systems/github-mcp`, builds the `live` branch, Node 24.x.
- **Neon database** for this server only. Never share the Appliance Desk or Stripe database. The server creates its tables (about 29 in `src/db.js`) the first time it runs.

## Part 2. Settings in Vercel

Vercel, project, **Settings**, **Environment Variables**, **Production** only. After any change, redeploy (Deployments, latest, Redeploy).

- `DATABASE_URL` (secret): the Neon connection string.
- `PUBLIC_BASE_URL`: `https://github.robinsonaisystems.com`, nothing after it.
- `ADMIN_PASSPHRASE` (secret): a long phrase you invent. You type it on the setup page and the sign-in page. It is not your Vercel or GitHub password.
- `TOKEN_ENCRYPTION_KEY` (secret): scrambles every saved GitHub key. Make one with `openssl rand -base64 32` (Mac/Linux Terminal) and paste it straight into Vercel. Keep one copy in your password manager. If it is lost, saved GitHub credentials cannot be read and you redo setup. Never rotate it casually; see [GO-LIVE-CHECKLIST](GO-LIVE-CHECKLIST.md) section 4.

`VERCEL_ENV` is set by Vercel; do not add it. Other switches (public sign-in, Marketplace, Playground) are in GO-LIVE-CHECKLIST. Unverified: that you have saved the passphrase and key privately.

## Part 3. Add a GitHub account

Open `https://github.robinsonaisystems.com/api/github/setup` in a full browser (Chrome or Safari), not an app's built-in browser. Each button asks for your passphrase again on purpose.

1. **Create.** Type the account name, choose Organization or Personal user, enter your passphrase, press **Prepare the GitHub App**, then **Continue to GitHub** and **Create GitHub App**. GitHub gives its keys straight to the server; you copy nothing. If GitHub rejects a permission name, tell Claude the exact words.
2. **Install.** Press the install link. **All repositories** is recommended (IN-05); the server's own safety checks narrow what it does. Press **Install**.
3. **Check.** Press **Show my accounts and check them with GitHub**. If it lists permissions not yet granted, open the App on GitHub (Settings, Developer settings, GitHub Apps, the App, Permissions) and accept them.
4. **Authorize as me** (recommended). This lets the server do the few things only a person can do.
5. Repeat for the second account: `Robinson-AI-Systems` and `christcr2012`.

No App wanted? Paste a fine-grained token under the alternative section. It is checked, saved scrambled and shown only by its last four characters. Classic tokens are refused, except the optional ones below.

Optional classic tokens (setup page only, never a tool or chat): **notifications** (only the `notifications` box ticked) and **packages** (`read:packages`, plus `delete:packages` or `write:packages` if you want those; `repo` for repository registries).

**Scratch organization** (IN-06): create the App for `robinson-ai-scratch` the same way, then use the scratch section of the setup page with the exact name and your passphrase. Never mark a real organization as scratch.

What each App asks GitHub for: `src/github/app-manifest.js`. Its webhook is `https://github.robinsonaisystems.com/api/github/webhook`.

## Part 4. Check it is alive

- Open `https://github.robinsonaisystems.com/`. You see a small page of facts and connect steps (name, tool counts, nothing secret).
- Open `/.well-known/oauth-authorization-server`. It starts with `{"issuer"`.

If a page says "temporarily unavailable", the database address is wrong or Neon is waking; wait ten seconds and reload. If it persists, tell Claude "the server shows unavailable"; it reads the deployment logs without printing secrets.

## Part 5. Connect Claude

See [START-HERE](START-HERE.md) (includes phone).

## If something goes wrong

- **Credentials can only be set up on the production deployment:** you opened a preview address. Use the production address.
- **The server has no encryption key:** `TOKEN_ENCRYPTION_KEY` is missing or wrong, or Vercel was not redeployed.
- **Too many attempts:** five wrong passphrases from this network; wait 15 minutes.
- **Setup page expired; reload it:** the page was open over ten minutes.
- **Secure browser required / form just clears:** open the setup address directly in Chrome or Safari. The passphrase is the Vercel value of `ADMIN_PASSPHRASE`.
- **Setup link expired after GitHub:** links are single-use and last an hour. Start that step again.
- **Could not read the GitHub App back:** press the check button again; if it persists, delete the App on GitHub and redo Part 3 step 1.
- **Account shows suspended:** unsuspend it in GitHub, the organization's Settings, Installed GitHub Apps.

To start an account over: delete its App on GitHub (Settings, Developer settings, GitHub Apps, Advanced, Delete), then redo Part 3.

## For agents

Older private-pilot, tenant-quota and Marketplace rollout notes that were in this file are in git history; current design is in `docs/designs/` and dated `docs/status/` notes. Database changes are additive (`IF NOT EXISTS`); roll back by reverting through a new PR, never by dropping tables.
