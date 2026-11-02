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
- **Branch/PR:** `ai/claude/single-domain-transfer`, PR #540 (see the PR for head SHA and CI).
- **Release needs:** deploy the control plane; rebuild/publish the runtime image for runtime transfers. Shared worker
  redeploy optional.
- **Next:** live acceptance: `github_repo_download` from a Claude sandbox that allows only the service domain (git and
  archive), an upload over 4 MB, and a runtime-attached download after the image rebuild.

**Live acceptance (2026-11-02 ~13:20 UTC, release `03432d6c`, worker redeployed, runtime image rebuilt):** run from an
agent sandbox whose network allowlist reaches `github.robinsonaisystems.com` but not the worker or runtime hosts, against
`robinson-ai-scratch/upload-probe`:
- `github_repo_download` archive: `curl` through the domain, HTTP 200, a valid .tar.gz; the same link again answered
  410, and a tampered link 403. (One earlier attempt answered 502 while the worker was being redeployed.)
- `github_repo_download` git: `git clone` through the domain in 1.3 s, exact HEAD `92d4a1f`; it reused the open workspace.
- Upload over 4 MB: an 8,391,044-byte archive `curl --upload-file` through the domain, HTTP 200 in 3.0 s; apply added
  all 8 files (8,388,608 bytes). Vercel did not apply a 4 MB limit to this proxied body, so `direct_command` was not needed.
- Runtime-attached workspace (small, attached): the archive download routed through the domain to the runtime broker,
  HTTP 200, 4 files.
Untested: multi-hundred-MB repositories and the 120-second first-byte window. Transfers now count toward Vercel data
transfer.
