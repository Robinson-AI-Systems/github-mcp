# GIT-UPLOAD-1 — Direct bulk uploads into native Git workspaces

## Owner approval 2026-11-01

Chris approved building both transfer modes together on 2026-11-01 21:02 MDT: "Build 1 and 2 together now". Recorded in
[DECISIONS](../DECISIONS.md).

## Problem

An outside agent working in its own sandbox had to move about 8 MB of images into a native workspace through
`github_git_workspace_run write_file`, about 1 MB per call. Every byte went agent → MCP (Vercel) → worker, inside JSON.
Vercel function bodies are capped at about 4.5 MB, and the GitHub token must never leave the connector, so bulk bytes
must go straight to the native Git worker without any GitHub credential.

## Outcome and acceptance

Outcome: an agent asks `github_git_workspace_upload` for a one-time address, sends its files directly to the native Git
worker with a plain `git push` or `curl --upload-file`, and then applies them to the workspace with one call. Accepted
when real `git push` and real `curl` uploads land only in quarantine, apply fast-forwards or extracts with every listed
refusal tested, the tool passes the nine write-contract checks through every door, and no result contains a GitHub
credential.

## Drift check

No GitHub or provider credential leaves the control plane; no new paid service, setting, domain or port; no database
migration; the workspace changes only through an authenticated, journaled apply. Commit and push are unchanged.

## Security design (the capability)

- **What the URL carries.** `https://<worker origin>/v1/upload/<base64url(claim)>.<signature>`. The claim is
  `{purpose:"robinson-native-upload/v1", version:1, workspace_id, binding, mode, maxBytes, expiresAt, uploadId, nonce}`:
  `binding` is the SHA-256 of the workspace's tenant/connection/repository binding (the raw authority never leaves the
  control plane), `expiresAt` ≤ now + 10 minutes, `maxBytes` ≤ 100 MiB, `uploadId`/`nonce` are 128-bit random. No GitHub,
  provider or service credential is in it; the worker holds none for it either.
- **Signer and verifier.** Signed by the existing control-plane native-worker key (`signNativeUploadClaim`, Ed25519,
  HKDF-derived on the MCP; legacy HMAC only for fixtures) and verified with the worker's pinned public key
  (`verifyUploadCapability`). Purpose separation is exact both ways: the upload verifier requires exactly these nine
  fields and this purpose; the request-lease verifier (`verifyWorkerBody`) now refuses any body with a `purpose`; the
  coding, preview, device and fleet verifiers each require their own purpose. A request lease therefore never works as
  an upload address and an upload claim never works as a request lease (both tested).
- **Bound to one upload.** The claim must match the upload record created by an authenticated, signed `upload_begin`
  (same binding, mode, cap, expiry and nonce) for a workspace whose own binding matches and is not expired.
- **Single use.** The first request that carries data creates `<uploadId>.claimed` with `O_EXCL` (`open(..., 'wx')`);
  every later request gets 410. Git's empty `0000` probe and the ref advertisement do not consume it. A declared
  oversize body (413) or a worker under resource pressure (503) is refused before the address is used.
- **Quarantine only.** Git mode receives into a separate bare repository per upload (`.uploads/<workspace>/<id>/repo.git`,
  `git init --template=` so no sample hooks) with `receive.fsckObjects`/`transfer.fsckObjects` (refuses `.git` trees and
  malformed objects), `receive.denyDeletes`, `receive.maxInputSize`, `core.hooksPath=/dev/null`, no auto-gc, and a
  read-only `objects/info/alternates` view of the workspace objects so only new objects are sent. It runs
  `git receive-pack --stateless-rpc` with the worker's fixed environment (no system/global config, no credential
  helpers). Pushed refs land only in that repository — never in the workspace's branches, refs, config or hooks.
  Archive mode stores one file. Nothing touches the worktree or the workspace object store until apply.
- **Apply (authenticated, signed, journaled).** Holds the workspace mutation lock, checks `expectedGeneration`, and does
  every check in quarantine before any change; refusals return `status:"refused"` and the tool reports `rejected` with
  the plain reason.
  - Git: workspace on a branch, no tracked changes, nothing in progress; the pushed commit must descend from workspace
    HEAD (fast-forward only); no new symlinks/submodule links; no collision with untracked files; ≤ 5,000 commits;
    files ≤ 100 MiB, total ≤ 256 MiB; every new blob **and commit message** (including content deleted again in a later
    commit) passes the repository's content protection (built-in rules plus the repository's custom scanner rules, as
    `write_file` uses). Then a local fetch into `refs/robinson/incoming/<id>`, `merge --ff-only`, ref removed.
  - Archive (.tar.gz, .tar, .zip, detected by content): refuses absolute paths, `..`, `.git` (any case, any depth),
    backslashes, drive letters, control characters, symlinks, hard links, devices/FIFOs, unknown/encrypted/zip64 entries,
    duplicates, file/folder clashes, more than 10,000 entries, files over 100 MiB, more than 256 MiB expanded, more than
    100× expansion (zip/gzip bombs), size/CRC lies, and destinations that pass through workspace symlinks or clash with
    folders; scans every file. Writes use the existing `O_NOFOLLOW` directory-handle writer with readback.
  - Success bumps the generation, records `applied` (a second apply refuses), deletes the quarantine and returns a
    compact summary (commits/files added, changed, deleted or unchanged, bytes, sample paths). Commit and push stay with
    `github_git_workspace_run`.
- **Returned once.** The URL is in the first response only (`present` reads it from the apply response); the change-log
  row stores the upload status without it, so a replay never re-issues it.
- **Cleanup.** Unused/received uploads are kept until 70 minutes after the address expired, then the worker's
  60-second sweep removes them; closing or sweeping a workspace removes all its uploads.
- **How AGENTS.md "secrets never pass through a tool" is honored.** No GitHub/provider credential, key or secret
  value is ever in an argument or result. The URL is a capability in the same class as Playground's one-time preview
  `entry_url`: unguessable, single-use, ten-minute, bound to one workspace upload, and it grants only writes into a
  quarantine that an authenticated apply must still check. Results say "Do not publish the URL".

## Limits

Upload body ≤ `maxMegabytes` (1–100 MiB, default 50) plus 1 MiB of Git commands; a request may take up to 5 minutes on
the worker (other worker routes keep their 15-second body deadline). Dedicated Playground broker workspaces are refused
(use the runtime). The worker must report `direct_upload: "quarantine-v1"` in capabilities (new worker image).

## Tests

`tests/unit/native-git-upload.test.js` (worker, real Git and curl), `tests/unit/native-git-upload-contract.test.js`
(nine checks × three doors, full flows, no-credential assertions).

## 2026-11-01 — Compact clients

First live begin (release 26643443): the result, which holds the one-time command, was dropped by a compact client
(`omitted_fields: ["result"]`), making the feature unusable there. Begin/apply now add a bounded `progress` with the
command or the apply summary. Test: `native-git-upload-contract.test.js` (fails without the change).

## 2026-11-02 — Live acceptance

Archive and git uploads from an outside machine, single-use refusal and checked apply all passed live; evidence in `docs/status/2026-11-01-direct-upload.md`.
