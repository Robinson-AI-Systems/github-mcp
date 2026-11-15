# SCANNER-OWNER-1: the secret scanner finds the repo's account

## Owner request 2026-11-15

An agent working on Robinson-AI-Systems/development-rack ran `github_secret_scanner allow` without `owner` and got a bare
404: the connection's default account is Chris's personal account, not the organization. The push refusal's own suggested
scanner call also left `owner` out, so copying it failed the same way. Chris asked for every such shortcoming to be fixed.

## Outcome and acceptance

- With no `owner` and more than one account on the connection, the gateway uses the account that actually has the repo.
  It checks the default account first, with one GET per account. An explicit `owner` is never changed.
- The git push refusal's suggested `github_secret_scanner` call includes `owner` from the remote slug.

Accepted by `tests/unit/fixes-2026-11-14.test.js` ("allow without owner finds the account that has the repo") and
`tests/unit/push-refusal-630.test.js`.

## Drift check

Changes: `src/tools/security-scanner-settings.js`, `workers/native-git/remote-hook.mjs`, the TOOL-CATALOG row for
`github_secret_scanner`, `docs/status/2026-11-15-scanner-owner.md`.
