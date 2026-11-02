# CHUNK-UPLOAD-1 — Large uploads work reliably through the single domain

## Owner request 2026-11-02

Live-found after release `5aa1a7a8` (worker redeployed): through the service's own domain an 8.4 MB
`curl --upload-file` worked, but a 20,977,459-byte `.tar.gz` (valid locally) first arrived (HTTP 200) and then apply said
"the gzip data is damaged", and a fresh upload of the same file got HTTP 502 `ROUTER_EXTERNAL_TARGET_CONNECTION_ERROR`.
The coordinator asked for chunked, resumable uploads with plain shell tools, receive-time integrity, and a refused apply
that never damages the quarantine. Folded in, also live-found: `github_check_wait` on a repository with no CI at all
answered `still_running` forever.

## Outcome and acceptance

Outcome: begin returns one copy-paste command that sends any upload up to the cap in 4 MiB requests, resumes when run
again, and is verified (offsets, total size, SHA-256) before anything is quarantined; a refused apply leaves the upload
intact; `github_check_wait` answers `no_ci` for a repository that runs no checks. Accepted when the tests below pass with
the real worker behind the real relay handler and `ci` + `release-policy` are green at the exact head.

## Root cause of the "damaged" 20 MB upload

`openArchive` expanded a `.tar.gz` into a fixed `expanded.tar` next to the quarantined file and never removed it. The
first apply was refused (a bad `deletePaths` entry) after expansion; the corrected apply then opened `expanded.tar` with
`wx`, got `EEXIST`, and `gunzipBounded` reported every non-refusal error as "the gzip data is damaged". The bytes were
fine. Fix: a unique scratch file per open, removed on close and on failure; only zlib errors (`Z_*`) are reported as
damaged. The relay/worker receive path itself does not corrupt bytes (pipeline completes after the write stream
finishes; the claim file makes a retried request get 410, never interleave); receive-time checks are added anyway.

## Design

- Worker (`workers/native-git/upload.js`): `PUT <cap>/chunk?offset=N` (≤8 MiB) stored as `parts/<offset>-<len>-<sha>.part`
  via a temp file and an upload lock; identical retry → `already_stored`; different bytes or overlap → 409; optional
  `X-Content-SHA256`. `GET <cap>/status` → merged `present` ranges. `POST <cap>/finish?size=&sha256=` → gaps 409 with
  `missing` (upload stays open); re-hash every part, assemble, compare whole SHA-256 (mismatch discards, 422). Git mode:
  the assembled file is a git bundle fetched (fsck on) into the existing quarantine repository; a bundle with only HEAD
  becomes branch `upload`. The first chunk claims the address for chunks (atomic `link`); one-request and chunked uses
  exclude each other. Capability `upload_chunks: "chunks-v1"`.
- Window: first use within 10 minutes as before; a chunked upload that started in time may continue 20 more minutes
  (`UPLOAD_CHUNK_GRACE_MS`, relay and worker); justification: 100 MiB over a slow link can exceed ten minutes, and the
  capability still names one quarantine.
- One-request path: refuses a short body and a client digest mismatch at receipt; returns `sha256` and `upload_id`.
- Relay and runtime ingress forward exactly `/chunk?offset=<digits>` (PUT), `/status` (GET),
  `/finish?size=<digits>&sha256=<hex64>` (POST), and `x-content-sha256`; ingress reports `upload_chunks: "v1"`.
- Tools: `github_git_workspace_upload` begin and `github_repo_change` upload return `command` (chunked, when worker and
  ingress support it), `single_command`, `chunk_note`; the always-visible digest stays ≤1200 bytes (short `if_blocked`).
- `github_check_wait`: on the first poll with no checks at all, reads the workflow list, the commit's check suites and
  the commit date; zero and zero and older than 2 minutes → `status: no_ci`.

## Tests

`tests/unit/native-git-chunked-upload.test.js` (31 MB archive with the exact command through relay to a real worker;
out-of-order, retried, conflicting and overlapping chunks; resume after a cut chunk; finish digest mismatch; one-request
digest mismatch; refused apply then successful apply; git bundle; time window; relay shapes),
`tests/unit/native-git-upload-contract.test.js` (nine write-contract checks; the returned command run through every
door), `tests/unit/repo-change.test.js`, `tests/unit/conn-fb-1.test.js` (no_ci), `tests/unit/playground-ingress.test.js`.

## Release

Control plane (Vercel) with the daily release; native worker redeploy; runtime image rebuild for attached workspaces
(until then those keep the one-request command).

## Drift check

Builds on GIT-UPLOAD-1 and SINGLE-DOMAIN-1 unchanged: same upload capability fields and purpose, same quarantine,
apply, size caps and content protection; no GitHub request, credential, permission or database change. New: three
upload sub-paths on the existing relay and worker route, a 20-minute grace only for an upload already sending chunks,
one forwarded header (`x-content-sha256`), and two read-only GitHub calls in `github_check_wait` (workflows, check
suites). The compact listing is unchanged (no new tool, description or property).
