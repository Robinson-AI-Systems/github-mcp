# Replacing a key or secret (key rotation)

**Who this is for:** Chris, and any agent helping him. **When:** only if a key is ever exposed (pasted somewhere it should
not be, seen in a screenshot, on a lost laptop) or you simply want to change it. None of this is a launch chore.

Every replacement below keeps people connected: there is **no downtime** if you follow the steps in order. Each one has
been rehearsed end to end with fake keys in `tests/unit/key-rotation-rehearsal.test.js` (the encryption key in
`tests/browser/sign-in.test.js`); the launch readiness report checks that those rehearsals exist
(`docs/launch/key-rotation.json`). A rehearsal on your real App is optional (owner checklist, "only if you want them").

Golden rules: never paste a key or secret into a chat, an issue, a pull request or a tool. Keys go only into GitHub's App
settings page, Vercel's settings page, or the protected setup page (`https://github.robinsonaisystems.com/api/github/setup`,
which asks for your administrator passphrase). Agents never see the values.

| Secret | Where it lives | Where you replace it | Downtime | Old one still works for |
|---|---|---|---|---|
| App private key | sealed in the database | GitHub App settings, then the setup page | none | until you delete it on GitHub (Undo for 24 hours) |
| App client secret | sealed in the database | GitHub App settings, then the setup page | none | until you delete it on GitHub (Undo for 24 hours) |
| App webhook secret | sealed in the database | the setup page, then GitHub App settings | none | 24 hours (or until "Finish now") |
| Tenant routing key (`GITHUB_TENANT_ROUTING_KEY`) | Vercel setting | Vercel settings, then a deployment | none for active people; see below | the window you choose (at most 30 days) |
| Encryption key (`TOKEN_ENCRYPTION_KEY`) | Vercel setting | Vercel settings, then a deployment | none | as long as it stays in `TOKEN_ENCRYPTION_KEY_PREVIOUS` |

"The setup page" below always means the section **Replace a GitHub App key or secret** on the protected setup page. In
its "Account whose App this is" box, type the GitHub account the App was made for (the same name you see under "Your
accounts" when you press "Show my accounts"). The App's settings page on GitHub is
GitHub → your organization or profile → Settings → Developer settings → GitHub Apps → the App → General.

## 1. GitHub App private key

What it does: proves to GitHub that the server is the App, every time the server asks GitHub for a short-lived
installation token. GitHub lets an App have several private keys at once, which is what makes this seamless.

1. **You, on GitHub:** on the App's settings page, under "Private keys", press **Generate a private key**. Your browser
   downloads a `.pem` file. The old key keeps working.
2. **You, on the setup page:** choose "Private key", open the `.pem` file in a text editor, copy all of it (from the
   `BEGIN` line to the `END` line) into the box, tick "Yes, replace this secret", type your passphrase and press
   **Replace the secret**.
3. **The server:** reads the key, signs a test request with it and asks GitHub "who am I?" (`GET /app`). Only if GitHub
   answers with this App's number is the new key saved (sealed). Then it drops its cached installation tokens, so every
   new token is made with the new key. The old key is kept, sealed, for 24 hours only so Undo can put it back. A wrong or
   unknown key is refused and nothing changes.
4. **You, on GitHub:** delete the old key (the one with the older date) under "Private keys". Then delete the downloaded
   `.pem` file from your computer (or store it in your password manager).
5. **Optional, on the setup page:** press **Finish now** for "Private key" so the old one is forgotten at once instead of
   after 24 hours.

How to check it worked: the page says "GitHub accepted the new private key". Then ask any assistant to run
`github_whoami`; it should list your accounts as usual.

Roll back: within 24 hours press **Undo** for "Private key" (only useful while the old key is still on GitHub). After that,
generate another key and repeat the steps.

Downtime: none. The old key stays valid on GitHub until step 4, and the server switches only after GitHub accepted the new one.

## 2. GitHub App client secret

What it does: used when people sign in with GitHub and when their GitHub sign-in is renewed. GitHub lets an App have
more than one client secret at a time.

1. **You, on GitHub:** on the App's settings page, under "Client secrets", press **Generate a new client secret** and copy
   it (GitHub shows it once).
2. **You, on the setup page:** choose "Client secret", paste it in the box, tick the box, passphrase, **Replace the secret**.
3. **The server:** asks GitHub whether the App's client id and this secret belong together (an OAuth exchange with a
   made-up code: GitHub answers "bad code" when the secret is right and "incorrect client credentials" when it is not;
   nothing is granted either way). Only then is it saved (sealed). Sign-ins and renewals use it from that moment.
4. **You, on GitHub:** delete the old client secret.
5. **Optional:** **Finish now** for "Client secret".

Check: the page says "GitHub accepted the new client secret". Sign-ins keep working (an agent can confirm with
`github_whoami` on a signed-in connection).

Roll back: **Undo** within 24 hours (while the old one is still on GitHub).

Note: if Vercel production has the settings `GITHUB_PILOT_APP_CLIENT_ID` and `GITHUB_PILOT_APP_CLIENT_SECRET`, those win
over the stored secret for the public sign-in (`src/tenancy/pilot-app-client.js`). In that case also put the new secret
into `GITHUB_PILOT_APP_CLIENT_SECRET` in Vercel before you delete the old one on GitHub, and it takes effect at the next
deployment. Whether those settings exist in production: not checked (an agent can check the names, never the values).

Downtime: none.

## 3. GitHub App webhook secret

What it does: GitHub signs every event it sends the server (App installed, removed, sign-in revoked) with it; the server
refuses anything not signed correctly. GitHub has only one webhook secret at a time, so the server accepts the old one
for 24 hours while you switch.

1. **You, on the setup page:** choose "Webhook secret", leave the box **empty**, tick the box, passphrase, **Replace the
   secret**. The server makes a strong new secret and says where to see it.
2. **You:** open the link it shows (`/api/github/setup?show=...`) in the same browser and press reveal. You see the new
   secret once (the link works for 10 minutes).
3. **You, on GitHub:** on the App's settings page, under "Webhook", paste it into **Webhook secret** and press **Save
   changes**.
4. **The server:** until step 3, GitHub keeps signing with the old secret, which the server still believes for 24 hours;
   after step 3 GitHub signs with the new one, which the server believes. Nothing is lost in between. After 24 hours only
   the new one is believed.
5. **If the old secret was exposed:** press **Finish now** for "Webhook secret" right after step 3, so the old one stops
   being believed at once.

Check: on GitHub, the App's "Advanced" tab lists recent deliveries; new ones should show a green tick (status 200).

Roll back: if you never managed to save it on GitHub, press **Undo** within 24 hours and the old one is the only one again.
If more than 24 hours passed, just repeat from step 1 (a delivery that was refused can be resent from GitHub's "Advanced"
tab, "Redeliver").

Downtime: none, as long as step 3 happens within 24 hours of step 1.

## 4. Tenant routing key (`GITHUB_TENANT_ROUTING_KEY`)

What it does: every connection made through the public sign-in or the private pilot carries a signed tag saying which
person's private storage it belongs to; this key makes and checks that signature. On its own it opens nothing: each
request is also checked against the stored (hashed) token, the person's membership and their GitHub grant.

The server can check old tags with the previous key for a window you choose, while making all new tags with the new key.
Assistants renew their access every hour, and each renewal moves them to the new key, so active people never notice.

1. **You (or anyone you trust on your own computer):** make a new key with this Terminal command (Mac/Linux), and paste the
   result straight into Vercel (never into a chat):
   `openssl rand 32 | base64 | tr '+/' '-_' | tr -d '=\n'` (43 characters).
2. **You, in Vercel → the project → Settings → Environment Variables (Production):**
   - copy the current value of `GITHUB_TENANT_ROUTING_KEY` into a new setting `GITHUB_TENANT_ROUTING_KEY_PREVIOUS`;
   - put the new key into `GITHUB_TENANT_ROUTING_KEY`;
   - add `GITHUB_TENANT_ROUTING_KEY_PREVIOUS_UNTIL` with the end of the window in UTC, written like `2026-11-08T12:00:00Z`.
     7 days is a good choice; the server ignores anything more than 30 days ahead, in the past or written another way
     (then it behaves as if there were no previous key).
3. **The change takes effect at the next production deployment** (the daily release, or a redeploy you start in Vercel).
4. **The server:** checks tags with the new key first and the previous key only until the end time; it never makes a tag
   with the previous key.
5. **After the window:** delete `GITHUB_TENANT_ROUTING_KEY_PREVIOUS` and `GITHUB_TENANT_ROUTING_KEY_PREVIOUS_UNTIL`
   (they are ignored after the end time anyway).

Check: an agent asks `github_whoami` on a signed-in connection before and after the deployment; both work.

Who has to reconnect after the window: anyone whose assistant did not use the connection at all during the window, and
private-pilot clients you issued on the setup page ("Issue a private MCP client"), because their client id itself is
signed; issue a new one there. People who connected through the public sign-in only need to have used it once during the
window.

Emergency: if the key was exposed and you want everyone signed out at once, skip the two `_PREVIOUS` settings (only step 1,
the new `GITHUB_TENANT_ROUTING_KEY`, and the deployment). Everyone reconnects once.

Roll back: put the old key back in `GITHUB_TENANT_ROUTING_KEY` and the newer one in `GITHUB_TENANT_ROUTING_KEY_PREVIOUS`
with a new end time, then deploy; connections made in between keep working.

Downtime: none for people who use their connection during the window.

## 5. Encryption key (`TOKEN_ENCRYPTION_KEY`)

What it does: scrambles every saved GitHub credential and the App secrets in the database.

1. Make a new key: `openssl rand -base64 32` (see `docs/DEPLOY.md`), and keep a copy in your password manager.
2. In Vercel production: put the current value into `TOKEN_ENCRYPTION_KEY_PREVIOUS` (at most two old keys, separated by a
   comma) and the new one into `TOKEN_ENCRYPTION_KEY`. It takes effect at the next deployment.
3. The server reads with the new key first and the old one(s) after; everything saved from then on uses the new key.
   Replacing an App secret (sections 1 to 3) re-seals that secret with the new key too.
4. Keep the old key in `TOKEN_ENCRYPTION_KEY_PREVIOUS`: there is no bulk re-save yet (`docs/ROADMAP.md`), so removing it
   would make older saved credentials unreadable (those people would have to add them again).

Downtime: none. Rehearsed in `tests/browser/sign-in.test.js` ("a key change does not sign people out").

## What the server does not do

- It never shows, logs or returns a key, secret or old value. Tools cannot replace these secrets; only the protected setup
  page and Vercel can.
- It never accepts more than one previous value per secret, never for longer than the stated window, and never makes
  anything new with an old value. "Finish now" ends a window at once.
- Every replacement, Undo and Finish is written to the change log (`setup_replace_app_secret`, `setup_undo_app_secret`,
  `setup_finish_app_secret`), with the secret's name only.
