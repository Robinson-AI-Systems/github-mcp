# 2026-11-02 — GIT-DIRECT-1: direct git host on the worker, pushes beyond GitHub's 2 GB

- **Owner decision:** Chris, 18:24 MST: "Build it and beat GitHub's push." ([DECISIONS](../DECISIONS.md),
  [card](../pr-cards/GIT-DIRECT-1.md)).
- **What changed:** the native worker can serve `/git/<owner>/<repo>.git` itself on `GIT_DIRECT_ORIGIN` (own port 3001),
  so git traffic skips Vercel's proxy (live limit there: about 25 MB per push). Each request is authorized by the
  control plane (`/api/git-remote?op=authorize`, signed by a worker key pinned at setup; only the key's id and hash are
  sent). Pushes stream to Git's quarantine on disk; stored per-push limit `git_remote.push_limit` (default 2 GiB); the
  volume keeps 512 MiB free; refusals are `remote:` lines. Pushes over GitHub's limit go on in parts through temporary
  refs and land in one atomic leased push; a failed part reports what GitHub has. Files over 100 MiB are refused with a
  Git LFS explanation (both doors). 20 failed keys per source per 10 minutes, then 429. Setup returns `remote_url` on
  the direct host and `fallback_url` on the MCP domain when both sides are configured; otherwise unchanged.
- **Verified (source, local):** real git through a TLS terminator to the worker's direct port, real hook and
  control-plane handlers, fake GitHub (`tests/unit/git-direct.test.js`, 13 tests); GIT-REMOTE-1 suites unchanged and
  passing. Measured: 256 MiB push 47.9 s (5.3 MiB/s end to end with scanning), clone 9.8 s, no memory growth; parts with a
  5 MiB stand-in limit, every received pack under it.
- **Not verified:** the live Dokploy/Traefik path, a real >2 GB push to GitHub, GitHub accepting pushes to
  `refs/robinson-git-remote/*` (standard Git behaviour; GitHub-specific acceptance is a live check), macOS.
- **Release needs:** control plane (daily release); worker redeploy with the new environment values; owner steps (DNS
  record, Dokploy domain on port 3001 with HTTPS, Traefik read timeout, Vercel `GIT_DIRECT_ORIGIN`) in
  [GO-LIVE-CHECKLIST](../GO-LIVE-CHECKLIST.md) and [OWNER-CHECKLIST](../OWNER-CHECKLIST.md). No secret, no table.
- **Branch/PR:** `ai/claude/git-direct`, PR #556 (see the PR for head SHA and CI). The coding-workspace (dedicated broker)
  image also packages the worker, so it now copies `src/git-remote/wire.js` too (its image check caught it).
- **Next (live acceptance after the owner steps):** setup on `robinson-ai-scratch/upload-probe` (write); clone through
  `remote_url`; push ~100 MB and ~1 GB of scratch data; confirm on GitHub; the same key on `fallback_url`; cancel the key
  and see the next fetch refused on the direct host.
