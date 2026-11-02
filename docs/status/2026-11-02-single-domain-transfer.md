# 2026-11-02 — SINGLE-DOMAIN-1: one domain for every transfer

- **What changed:** one-time download/upload commands now use this service's own domain (`PUBLIC_BASE_URL`) through
  Routing Middleware (`middleware.js`, `src/native-git/relay.js`); workspaces attached to a Playground runtime download
  and upload from the runtime's copy (runtime ingress routes the transfer paths to the broker); new compound
  `github_repo_download`; the three transfer tools are in the compact (default) list; every transfer result carries
  an `if_blocked` note naming the one domain to allow; the home page, START-HERE and NATIVE-GIT-OPERATIONS say the same.
- **Verified:** real `git clone`, `git push` and `curl` through the real middleware into a real local worker and a real
  local runtime ingress + broker; relay refusal, header, redirect and digest-bound tests; nine write-contract checks for
  `github_repo_download` through every door. Not verified: Vercel's live proxy behaviour (body sizes above 4 MB in
  particular) — live check after release.
- **Branch/PR:** `ai/claude/single-domain-transfer` (see the PR for head SHA and CI).
- **Release needs:** deploy the control plane; rebuild/publish the runtime image for runtime transfers. Shared worker
  redeploy optional.
- **Next:** live acceptance: `github_repo_download` from a Claude sandbox that allows only the service domain (git and
  archive), an upload over 4 MB, and a runtime-attached download after the image rebuild.
