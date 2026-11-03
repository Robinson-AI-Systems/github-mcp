# 2026-11-02 — GIT-REMOTE-1: plain git clone, pull and push on the service's own domain

- **Owner decision:** Chris, 16:51 MST: "Build option 2" ([DECISIONS](../DECISIONS.md), [card](../pr-cards/GIT-REMOTE-1.md)).
- **What changed:** `github_git_remote_setup` (compact list) returns a one-time setup command; after it, agents use
  `git clone https://<origin>/git/<owner>/<repo>.git`, `git pull`, `git push`. Session keys are hash-only, per
  repository, read or write, 8 h default / 24 h max, cancellable on My connection and the owner setup page, every use
  logged. Routing Middleware checks the key before forwarding a signed claim to the native worker; the worker serves a
  per-connection mirror and pushes through its own pre-receive hook (guard gates, change log, content protection,
  atomic leased push to GitHub). Compact listing 5,896/6,000 tokens (`github_pr_create` and `github_branch_create`
  now list lean schemas to make room).
- **Verified (source):** real git clone/fetch/pull/push and the exact setup command through the real middleware (edge
  stand-in with TLS and a CONNECT proxy) to the real worker and hook and a fake GitHub (git http-backend); refusals as
  `remote:` lines (no key, expired, revoked, wrong repository, read-only push, GitHub protected branch, scanner hit,
  guard gate); code single use and expiry; key absent from results, logs and requests; nine write-contract checks
  through every door; store contract on fake and PostgreSQL (`npm run test:db`); browser test of the My connection list
  and cancel (local Chrome). Measured locally: 60 MiB push ≈ 9.4 s, its clone ≈ 2.4 s.
- **Not verified:** Vercel's live proxy with a large single push request (about 20 MB is the stated caution); the live
  tenant (public sign-in) database path end to end; macOS (the command uses only sh, curl and git).
- **Branch/PR:** `ai/claude/git-remote`, PR #552 (see the PR for head SHA and CI).
- **Release needs:** control plane (daily release); native worker redeploy. No new environment variable, no runtime
  image change.
- **Next (live acceptance after release):** from a sandbox that allows only the MCP domain, `github_git_remote_setup`
  on `robinson-ai-scratch/upload-probe` with access write; run the command; clone, push a branch, pull; a push of about
  10 MB and of about 30 MB to find the live limit; cancel the key on the setup page and see the next fetch refused.
