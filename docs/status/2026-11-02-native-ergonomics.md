# 2026-11-02 — One-call change and native Git ergonomics (NATIVE-ERGO-1)

Owner feedback (fac-ultra build, native-workspace items 1, 2, 4, 5, 6, 10, 13, 14, 16, 21). Card:
[NATIVE-ERGO-1](../pr-cards/NATIVE-ERGO-1.md). Merged as PR #546 (head b7ef39d, merge fffd2a3) with `ci` and
`release-policy` green at the exact head. Source merged only: not released, deployed or live-accepted yet.

- **New** `github_repo_change` (default list): files/deletions or an upload → branch → one commit → push with lease and
  readback → optional PR via `github_workflow_open_pr`. Same call again resumes; never commits twice. `expectedHead`
  refuses a moved branch; `allowMoved` builds on it.
- **Fixed refusals**: `fetch`/`merge`/`remove_file`/`add` accept the options agents pass (cause: a strict per-operation
  option allowlist with no aliases; `add .` failed the path check because `.` is not a file path). Upload begin no longer
  refuses `expectedGeneration` (cause: a blanket "not used by this operation" check).
- **UNCONFIRMED → definite**: the run tool verified only `status === 'applied'`, so a worker `conflict` or `rejected`
  fell through to "UNCONFIRMED", and worker HTTP 400 (checks that refused before any change) was classed uncertain.
  Conflicts are now applied with `outcome: "conflict"`; refusals are `rejected` with a next step and `next_generation`.
- **Upload apply REJECTED twice** (live log): the code paths that reject are a stale `expectedGeneration` (most likely
  here: every run, even a failed one, moves the generation), an upload not yet received / already applied / expired, or a
  content refusal. Each now says which, and stale generations give the value to send.
- **Large uploads**: no limit below `maxMegabytes` (default 50, max 100 MiB) exists in this code; the worker streams to
  disk. A 30 MB archive through the local relay and worker passes. The live 19.5 MB 502 predates the relay; live sizes
  above 8.4 MB are not verified yet.
- **Tests**: `tests/unit/repo-change.test.js`, `tests/unit/native-git-ergonomics.test.js` (real worker, real bare remote).
- **Release needs**: daily release for the MCP side. Redeploy the native Git worker image (Dokploy) and publish the
  runtime image for remove-several, switch create, merge flags, fetch prune/tags, changed_files and upload
  deletePaths/mirror; until then those are refused plainly with a fallback.
- **Next**: live retest per the owner's list on a scratch branch after release and worker redeploy.
