# 2026-11-15: secret scanner finds the repo's account; push refusals name the owner

- Owner feedback 2026-11-15:
  - `github_secret_scanner` `allow` without `owner` used the connection's default (personal) account for a repo in
    Robinson-AI-Systems, and failed with a bare 404.
  - The push refusal's suggested scanner call left out `owner`, so copying it reproduced that failure.
- Now:
  - With no `owner` and more than one account, the gateway uses the account that has the repo. It checks the default
    account first, with one GET per account. An explicit `owner` is never changed.
  - The push hook's suggested call carries `owner` from the remote slug.
- Tests: `tests/unit/fixes-2026-11-14.test.js` (allow across two accounts) and `tests/unit/push-refusal-630.test.js`
  (the refusal's call has `owner`).
- PR #651.
