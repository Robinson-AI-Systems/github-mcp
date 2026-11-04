# 2026-11-03 — Git remote routing: mid-size pushes and the owner's own connection (RELAY-OWNER-1)

Card: [RELAY-OWNER-1](../pr-cards/RELAY-OWNER-1.md).

- **Mid-size pushes through the service domain** (about 16 KB to 256 KB) were corrupted or cut off. Cause: the worker's
  domain-door push answered `200` before reading the push; the Go reverse proxy in front of the PC (Tailscale Funnel)
  then reads and drops up to 256 KiB of the unread body itself. Fix: the reply starts with Git's first byte (as the
  direct host already did). Verified here: the new size case in `tests/unit/git-remote.test.js` (8 KB to 2 MB, byte-exact; fails at
  60 KB on the old code) and the git-remote, git-direct, transfer-relay suites. Live re-check (scratch repository, all six
  sizes, plus a 2 KB file with a documented FAKE token) needs a release and a worker redeploy.
- **Chris's claude.ai connection is the owner for his PC** when its verified numeric GitHub id equals the new protected
  setting `OPERATOR_GITHUB_USER_ID` (Vercel production; not committed). Other people and every pass stay off the PC.
  Verified here: new cases in `tests/unit/worker-pool-owner-hosts.test.js`, `tests/db/pub-1-tenancy.test.js`,
  `tests/db/pub-2-pilot-identity.test.js`.

Next: set `OPERATOR_GITHUB_USER_ID` (OWNER-CHECKLIST item 8), release `live`, redeploy the PC worker, then re-run the
six live push sizes on robinson-ai-scratch/upload-probe and check `github_server_status` from Chris's connection.
