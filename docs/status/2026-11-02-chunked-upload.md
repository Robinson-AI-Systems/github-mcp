# 2026-11-02 — CHUNK-UPLOAD-1: large uploads through the single domain

- **What changed:** `github_git_workspace_upload` begin (and `github_repo_change` upload) now return a resumable chunked
  `command` (split + curl in 4 MiB requests; size and SHA-256 checked at finish; git mode sends a git bundle) plus the
  old one-request `single_command` (archive now sends `X-Content-SHA256`). Worker: `/chunk`, `/status`, `/finish` on the
  same one-time address; relay and runtime ingress forward exactly those shapes. A refused apply no longer leaves a stale
  `expanded.tar` that made the next apply say "gzip data is damaged" (the cause of the live 20 MB failure).
  `github_check_wait` answers `no_ci` for a repository with no workflows, check suites or required checks.
- **Verified:** real worker behind the real relay handler: 31 MB archive with the exact command, out-of-order/retried/
  conflicting chunks, resume after a cut chunk, digest mismatches, refused-then-successful apply, git bundle, time
  window; nine write-contract checks for the upload tool through every door; fake-GitHub tests for `no_ci`.
  Not verified: Vercel's live proxy with the chunked command (needs a release).
- **Merged:** PR #548 (head `8b060f89`, `ci` and `release-policy` green), merge commit `c5ca2e9a`.
- **Release needs:** control plane (daily release); native worker redeploy (until then begin offers the one-request
  command only); runtime image rebuild for runtime-attached workspaces (same fallback until then).
- **Next:** live acceptance after release: the 20 MB archive with the chunked command through the domain, an apply refused
  then corrected, `github_check_wait` on `robinson-ai-scratch/upload-probe` PR #1.

**Live acceptance (2026-11-03 ~00:00 UTC, release `5179c359`, worker redeployed):** from an agent sandbox that can reach
only the MCP domain, `github_repo_change` with `upload: "archive"` returned the chunked command. Running it unchanged on
a 20,977,460-byte `.tar.gz` (the size that failed earlier) sent 6 chunks in 20 s; finish verified the size and SHA-256.
The second `github_repo_change` call then applied all 20 files, committed `4279786` and pushed `retest/big-upload` to
`robinson-ai-scratch/upload-probe`. A non-existent `deletePaths` entry was reported as "already absent" and did not
disturb the upload.

**Follow-up (CHECK-WAIT-2):** `github_check_wait` on that scratch repository kept answering `still_running`, because it
has manual-only workflows, so "no workflows" was false. It now also answers `no_ci` with `reason: none_ran` when no check
suite has run on a commit more than 10 minutes old and no check is required. A required check that is still missing
keeps it waiting (`tests/unit/conn-fb-1.test.js`).
