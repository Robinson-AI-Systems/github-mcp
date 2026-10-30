# Owner decisions (IN-xx)

Your recorded decisions, kept short. Newest authority: [OWNER-DECISION-2026-10-27](OWNER-DECISION-2026-10-27.md) (with its 2026-10-29 and 2026-10-30 additions). Where a row below disagrees with it, the decision wins. Rows about "our development agents" bind builders only, not your own connection ([END-USER-AUTHORITY](END-USER-AUTHORITY.md)). Agents ask only what a card needs. Old wording is in git history and `docs/archive/`.

## Answered or superseded

- **IN-00 (answered 2026-10-10):** plans approved so building could start.
- **IN-01 (answered 2026-10-10):** repository stays public (free CI and secret scanning); no automated reviewer. The building agent reviews its own PRs.
- **IN-07 production switch (superseded 2026-10-27):** your full connection runs production changes with same-call disclosure, a log and a readback. Production limits apply only to passes you deliberately restrict. Fixed 2026-10-30: the sign-in page offers Production by default on the production deployment, with no per-account switch. Delegated passes keep the issuer's production restriction.
- **IN-08 protected-resource list (superseded):** it may inform warnings. GitHub's own rules decide. It cannot block you or stop you editing it.
- **IN-09 spending cap (removed for your connection):** costs are reported, not vetoed. Limits you set on a pass still bind. The $0 budget is for building agents only.
- **IN-10 write pacing (clarified):** your writes follow GitHub's rate signals. Pass limits you chose stay.
- **IN-12 production names, IN-13 notification confirmation:** informational only; no extra confirmation for you.
- **IN-14 (answered 2026-10-10):** no legacy compatibility with the old toolkit.
- **IN-15 (answered yes 2026-10-16):** new GitHub App permissions approved. You add them on github.com (Settings, Developer settings, GitHub Apps, the App, Permissions). `github_check_permissions` lists the exact names. Nothing breaks if you wait; the affected tools say "missing permission".
- **IN-16 (2026-10-27):** money tools run real supported GitHub actions with cost disclosure. An unknown price is a notice, not a refusal.
- **IN-17 (answered yes 2026-10-16):** wiki editing approved (libraries `isomorphic-git` and `memfs`, both in `package.json`).
- **IN-18 (answered 2026-10-24):** no ChatGPT/Claude directory listing. Public and free from your own website, no invite list required, no people cap. See `docs/pr-cards/PUB-5.md`.

## Setup rows

- **IN-02:** Vercel project plus a separate Neon database for this server. Done; details in [DEPLOY](DEPLOY.md).
- **IN-03:** `ADMIN_PASSPHRASE` and `TOKEN_ENCRYPTION_KEY` set in Vercel. Still open for you: privately save both in your password manager. Unverified whether done.
- **IN-04:** one private GitHub App per account (organization `Robinson-AI-Systems`, personal `christcr2012`), created from the setup page. Scratch done. Your two real accounts: unverified, check "Show my accounts" on the setup page.
- **IN-05:** which repositories each App reaches. Recommended: all repositories.
- **IN-06:** scratch organization `robinson-ai-scratch` set up and verified 2026-10-12; its production flag was turned on 2026-10-18. Never mark a real organization as scratch.
- **IN-11 (optional):** a classic token with only the `notifications` box ticked, for notification tools. Add it on the setup page, only if wanted.

## Later in the same period

- **Daily job limit (2026-10-29):** none, for anyone.
- **Git and Playground resources (2026-10-29/30):** limited only by real server load; best-effort mode allowed; backups optional.
- **Name (2026-10-29):** "Robinson's Playground", by Robinson AI Systems.

## Index

| ID | Status |
|---|---|
| IN-00 | Answered — plans approved |
| IN-01 | Answered — public repo, no automated review |
| IN-02 | Done — Vercel + Neon set up |
| IN-03 | Set; password-manager backup unverified |
| IN-04 | Scratch done; real accounts unverified |
| IN-05 | Repositories reached: all recommended |
| IN-06 | Scratch org verified; production flag on 2026-10-18 |
| IN-07 | Superseded — production switch |
| IN-08 | Superseded — protected-resource list |
| IN-09 | Removed — spending cap for owner connection |
| IN-10 | Clarified — write pacing |
| IN-11 | Optional — notifications token |
| IN-12 | Informational — production names |
| IN-13 | Informational — notification confirmation |
| IN-14 | Answered — no legacy compatibility |
| IN-15 | Answered yes — new App permissions |
| IN-16 | Authorized — money tools execute with disclosure |
| IN-17 | Answered yes — wiki libraries |
| IN-18 | Answered — no directory listing |
