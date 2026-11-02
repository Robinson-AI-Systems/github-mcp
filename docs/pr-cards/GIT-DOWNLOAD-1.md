# GIT-DOWNLOAD-1 — Direct bulk downloads from native Git workspaces

## Owner request 2026-11-01

Chris asked to "finish the remaining work" after relaying feedback from an outside AI coding agent using the connector:
"No way to grab the code in bulk. The archive-download tool deliberately withholds the link, so I'm pulling 100+ files
one at a time. The built-in integration gives me a plain git clone. A 'fetch this ref as a tarball straight to disk'
tool, or a batch 'give me these N files' call, would close that gap." Recorded in [DECISIONS](../DECISIONS.md).

## Problem

`github_content_get_archive_link` withholds GitHub's archive link (it carries a short-lived GitHub token), and
`github_git_workspace_read read_file` returns at most 32 KiB per call. An agent wanting a whole native workspace — or
its uncommitted work — had to read files one by one through Vercel. GitHub tokens must never leave the connector.

## Outcome and acceptance

Outcome: an agent calls `github_git_workspace_download` once and gets a one-time command — `git clone "<url>" repo` or
`curl -fsSL "<url>" -o repo.tar.gz …` — that pulls the whole workspace straight from the native Git worker. Accepted when
a real `git clone` returns the exact workspace HEAD (and `git fetch` works), an archive equals `git archive` for a ref and
includes uncommitted files for `worktree` without `.git`, expired/replayed/wrong-workspace/upload-purpose addresses and
escaping links are refused, the tool passes the nine write-contract checks through every door with the command in
`progress`, and no result contains a GitHub credential.

## Drift check

No GitHub or provider credential leaves the control plane; no new paid service, setting, domain or port; no database
migration; the workspace is never changed (read-only snapshot). Upload, commit and push are unchanged.

## Security design (the capability)

- **What the URL carries.** `https://<worker origin>/v1/download/<base64url(claim)>.<signature>`. The claim is exactly
  `{purpose:"robinson-native-download/v1", version:1, workspace_id, binding, mode, maxBytes, expiresAt, downloadId, nonce}`
  (`binding` = SHA-256 of the workspace binding; `expiresAt` ≤ now + 10 minutes; `maxBytes` ≤ 500 MiB;
  `downloadId`/`nonce` 128-bit random). No GitHub, provider or service credential is in it.
- **Purpose separation, both ways.** Signed by `signNativeDownloadClaim` (refuses any other purpose, `credential`,
  `action` or `uploadId`) and verified by `verifyDownloadCapability` (exact field set and purpose). The upload verifier
  refuses download claims and the download verifier refuses upload claims (different purpose and fields); the request
  lease verifier refuses any body with a `purpose`; a request lease never works on `/v1/download` (all tested).
- **Snapshot at begin.** An authenticated, signed `download_begin` (write lease, disk admission, the workspace's busy
  lock) creates `.downloads/<workspace>/<id>/repo.git`: a bare repository (`--template=`, no hooks) whose
  `objects/info/alternates` is a read-only view of the workspace objects (plus `shallow` for shallow clones), holding
  only the refs to serve — local branches and tags with HEAD, or one requested ref. Archives fix the commit at begin;
  `worktree` writes the tar.gz at begin. The workspace's refs, config, hooks, worktree and generation never change.
- **Git mode** serves smart HTTP `GET info/refs?service=git-upload-pack` and `POST git-upload-pack` with
  `git upload-pack --stateless-rpc` in the snapshot repository, under the worker's fixed environment (no system/global
  config, no credential helpers, `core.hooksPath=/dev/null`) and `uploadpack.allow{Filter,TipSHA1InWant,
  ReachableSHA1InWant,AnySHA1InWant,RefInWant}=false`, so only advertised tips can be wanted. `git-receive-pack` is
  refused. Request bodies ≤ 4 MiB; served bytes across the session ≤ `maxBytes`.
- **One session, not one request.** The first request creates `<id>.claimed` with `O_EXCL`; later requests are accepted
  only within 5 minutes of that first request (at most 64 requests) and until the response that carries the pack
  (`done` or `PACK` seen); then 410. A session that started before expiry may finish within its window; an unused
  address expires after 10 minutes (403). Worker memory pressure answers 503 before the address is used.
- **Archive mode** answers one `GET`: the commit via `git archive --format=tar` in the snapshot repository (workspace
  attributes/config are not used) gzipped on the fly, or the `worktree` file built at begin: tracked plus untracked,
  not-ignored files (`git ls-files --cached --others --exclude-standard`), read through `O_NOFOLLOW` directory handles;
  never `.git`; in-tree symbolic links are stored as links; a link that points outside the tree (absolute, `..`, or into
  `.git`) or a folder that is a link refuses the download; at most 100,000 files / 2 GiB before compression.
- **Content.** Downloads are the person's own workspace content (they can already read it), so no secret scanning on the
  way out; nothing outside the workspace repository — no `.git/config`, credential helpers or server files — is served.
- **Limits.** At most 20 unused addresses per workspace; snapshots are removed when served or failed, and by the
  60-second sweep 15 minutes after their session window; closing or sweeping a workspace removes all of them.
- **Returned once.** The URL is in the first response only (`present`), the always-visible `progress` carries the
  command for compact clients, and the change log stores the status without it, so a replay never re-issues it.
- **How AGENTS.md "secrets never pass through a tool" is honored.** No GitHub/provider credential, key or secret value
  is ever in an argument or result. The URL is a capability in the same class as GIT-UPLOAD-1's upload address and
  Playground's one-time preview `entry_url`: unguessable, ten-minute, one session, bound to one snapshot of one
  workspace, read-only. Results say "Do not publish the URL".

## Limits

`maxMegabytes` 1–500 (default 200) caps what is sent. Building a `worktree` archive is limited to 40 seconds (use a
commit `ref` or mode git for very large trees). Dedicated Playground broker workspaces are refused. The worker must
report `direct_download: "one-time-v1"` in capabilities (new worker image).

## Tests

`tests/unit/native-git-download.test.js` (worker, real `git clone`/`git fetch`/curl/tar), `tests/unit/native-git-download-contract.test.js`
(nine checks × three doors for both modes, full flows, purpose separation both ways, no-credential assertions).
