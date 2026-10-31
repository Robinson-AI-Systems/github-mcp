# 2026-10-30 — `live` branch deleted and recreated

What happened: PR #489 (source branch `live`, into `main`) was opened to restore ancestry after a merge commit was made on `live`. When it merged (5:11:55 PM MDT), GitHub deleted the PR's source branch, `live` (5:11:57 PM MDT). Production on Vercel kept serving its last deployment (6f6cc46); nothing broke, but no release could run.

Fix: `live` was recreated from `main` (9768f54) at the owner's request, which is also the requested manual release of PR #491 (line-number edits).

Rule added to `.github/RELEASE-POLICY.md`: never use `live` as a PR source branch; reconcile with a ref update plus expected-head lease.
