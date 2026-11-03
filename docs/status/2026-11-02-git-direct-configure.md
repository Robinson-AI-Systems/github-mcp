# 2026-11-02 — GIT-DIRECT-2: the control plane configures the direct git host

Owner: "Finish it first" (2026-11-02 21:53 MST). Card: [GIT-DIRECT-2](../pr-cards/GIT-DIRECT-2.md).

- **What changed.** The native worker accepts a signed `direct_configure` action (write lease, pinned control key),
  checks both origins, stores them on its volume (`.git-direct/config.json`, atomic, 0600), starts the direct listener
  on port 3001 without a restart and reads the file again at boot; worker environment values win. The first applied
  `github_git_remote_setup` with Vercel's `GIT_DIRECT_ORIGIN` set sends it once, re-reads capabilities, pins the worker
  key and returns the direct URL, or falls back to the MCP domain with `direct_note`. No Dokploy environment edit needed.
- **Verified.** `tests/unit/git-direct-configure.test.js` (worker action, signatures, origins, live listener, restart,
  environment precedence, turning off; setup configures once, dry run sends nothing, fallbacks; nine write-contract
  checks through every door), plus `git-direct`, `git-remote`, `git-remote-contract` suites and the worker smoke test.
- **Branch.** `ai/claude/git-direct-configure` (merges origin/main with #558's worker `build_commit`).
- **Next (release, normal route).** Daily release of the control plane; worker redeploy from a commit with GIT-DIRECT-2
  (no environment change); Vercel production `GIT_DIRECT_ORIGIN=https://git.<domain>`; one setup call; live acceptance
  (clone, ~100 MB push through `remote_url`, then ~1 GB after Traefik's read timeout is raised — owner/admin step).
