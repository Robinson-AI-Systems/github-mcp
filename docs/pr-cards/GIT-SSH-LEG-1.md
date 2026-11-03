# GIT-SSH-LEG-1 — An SSH leg to GitHub with short-lived per-repository deploy keys

## Owner direction 2026-11-03 (in chat, relayed by the session that launched this card)

Chris approved building and releasing this: let the native Git worker send pushes to GitHub over SSH instead of HTTPS,
using a temporary write deploy key per push, on hosts where he turns it on (his owner-only PC first).

## Measured (2026-11-03, from Chris's PC, same hour and network; 150 MB incompressible to robinson-ai-scratch/upload-probe)

| Leg | Time | Rate |
|---|---|---|
| HTTPS (`https://github.com/<o>/<r>.git`, installation/user token in an extra header; today's worker leg) | 444 s | ~0.34 MB/s (GitHub's TCP window often ~70 KB; RTT 46 → ~90 ms under load) |
| SSH port 22 (`git@github.com`) | 18.3 s | ~8.2 MB/s |
| SSH port 443 (`ssh.github.com`) | 17.9 s | ~8.4 MB/s |

The house uploads to a far non-GitHub server at 57 MB/s, so the slowness is GitHub's HTTPS git front end from there.

## Outcome and acceptance

Outcome: with `NATIVE_GIT_GITHUB_TRANSPORT=ssh` on a worker, every push through the git remote adds a fresh write deploy
key on exactly that repository (through the broker, with the push's own credential), pushes over SSH with GitHub's host
keys pinned, removes the key right after (success or failure) and reads back that it is gone, falling back to HTTPS with
a plain reason whenever the key or the SSH connection is refused; every other rail is unchanged and the change log shows
each key add/removal as an access change plus the push's transport and per-step timings. Accepted when
`tests/unit/git-ssh-leg.test.js`, `tests/shapes/deploy-key-shapes.test.js` and the existing git-remote, git-direct and
worker suites pass and `ci` + `release-policy` are green at the exact head; the live timing on the PC follows Chris's
release, `pc-worker update` and the two `.env` lines.

## Scope

1. **Worker (`workers/native-git/github-ssh.js`, `remote-hook.mjs`, `remote.js`, `server.js`).** Settings
   `NATIVE_GIT_GITHUB_TRANSPORT` (`https` default | `ssh`), `NATIVE_GIT_GITHUB_SSH_PORT` (`443` default =
   `ssh.github.com:443` | `22` = `github.com`), `NATIVE_GIT_GITHUB_HTTP_VERSION` (`HTTP/1.1` | `HTTP/2` | unset = git's
   default; adds `-c http.version=…` to the HTTPS fetch, push and read-back). A mistyped value keeps the default and is
   printed once at start. For SSH, after the content scan: `ssh-keygen` makes an ed25519 pair in a 0700 folder under
   `/dev/shm` (else the temp folder), key file 0600, never read by worker code; the broker adds the public key; the push
   (and large-push parts and temporary-ref cleanup) run with `GIT_SSH_COMMAND` = `ssh -F /dev/null -i <key>
   IdentitiesOnly, BatchMode, StrictHostKeyChecking=yes, UserKnownHostsFile=<pinned GitHub keys only>,
   GlobalKnownHostsFile=/dev/null …` and `-c protocol.ssh.allow=always`; the folder is deleted, then the broker removes
   the key (3 tries); a removal still failing is written to `<storage>/.remote-ssh-cleanup/<key id>.json` (claim, broker
   address, key id; no key material) and retried by the minute timer for up to 24 h / 50 calls. An SSH push that gets no
   answer is read back over HTTPS: refs already at the new values = done; still at the old values = the same leased
   atomic push over HTTPS, saying why. The read-back and mirror refreshes stay on HTTPS.
2. **Broker (`src/git-remote/api.js` op=key, `src/git-remote/deploy-keys.js`).** Signed claim as every hook call; only
   for the push whose change-log row this claim opened. `add`: only while that row is pending and the claim is live, only
   on the owner's own connection (a delegated pass falls back to HTTPS: a deploy key is an access change it was not
   given); sweeps marked keys older than 15 minutes first; `POST /repos/{owner}/{repo}/keys` with `read_only: false`;
   403/404 → "cannot add deploy keys (GitHub needs Administration write)", 422 with the disabled message → "organization's
   policy turns deploy keys off". `remove`: GET, refuse any title not matching `^GitHub Unleashed push [a-f0-9]{12}
   \(auto-removed\)$`, DELETE, GET again (404 = gone); allowed for 24 h after the claim and after the session key expired
   or was revoked; `sweep: true` (the timer) also sweeps. Same credential as the push (`robinsonAs` app/me). Each add,
   removal, failed removal and sweep removal is a change-log row (tool `github_git_remote_deploy_key`, access change,
   repository, `acted_as`). op=report stores `transport`, `transport_note`, `http_version`, `deploy_key_removed` and
   `timing` (`scan_ms`, `key_ms`, `push_ms`, `readback_ms`, `total_ms`). The last `op` in the query wins (the worker
   appends its step to `?op=broker`).
3. **Image and PC kit.** `openssh-client` in the worker image (pinned Debian snapshot); `deploy/pc/compose.yaml` passes
   the three settings; `deploy/pc/.env.example` documents them with `https` defaults; `docs/PC-WORKER.md` explains it.

Not in scope: fetches over SSH (they would need a read key per refresh; HTTPS stays), and a global sweep of every
repository (the worker holds no standing credentials; leftovers are swept per repository at that repository's next SSH
push and by the retry timer).

## Constraints honoured (docs/AI-PR-READ-FIRST.md)

- Credentials: the private key never leaves the worker's temporary folder, is never read by worker code, never logged,
  returned, journaled or persisted; only the public key travels (to the broker, then GitHub). GitHub tokens are handled as
  before. Test fixtures make keys at runtime; no key-shaped literal is committed.
- Access: the deploy key is limited to one repository and one push, made with the push's own credential (never wider),
  journaled as an access change with actor and repository, removed and read back as absent, and swept by an exact title
  marker only. Delegated passes never add one.
- Host authenticity: GitHub's published host keys are pinned with source links; strict checking is always on; a test
  checks the pinned keys hash to GitHub's published fingerprints and that the real ssh refuses a server with another key.
- Every existing rail (content scan, guard gates, lease/temp-ref parts, atomic final push, ls-remote read-back, change
  log, replay nonces) is unchanged; HTTPS stays the default everywhere.
- Request shapes: deploy-key create/get/delete/list pass the fake GitHub validated against the vendored OpenAPI.

## Tests

`tests/unit/git-ssh-leg.test.js`: add → push over SSH → get/delete/get order; removal after GitHub refuses the push;
SSH unreachable → read-back → HTTPS; fallback on 403 and 422 with the reason in `remote:` and the change log; failed
removal recorded and retried by the timer; the sweep removes only marked keys older than 15 minutes; HTTP version reaches
the change log; settings parsing; title marker agreement; pinned fingerprints, strict options and a real `ssh` against a
local `sshd` with an unknown host key; the private key in no output, log, request, change row or report; timing fields.
`tests/shapes/deploy-key-shapes.test.js`: the four deploy-key requests against the pinned schema.

## Release

Owner sequencing note (2026-11-03): the SSH transport and the HTTP-version experiment both default to off (HTTPS, git's
own HTTP version) on every host, including the PC, so each can be turned on and timed on its own after the release.

After merge and Chris's release: `/srv/robinson-git/pc-worker update` on the PC with `NATIVE_GIT_GITHUB_TRANSPORT=ssh`
and `NATIVE_GIT_GITHUB_SSH_PORT=443` in `/srv/robinson-git/.env`; then time a 150 MB push to
robinson-ai-scratch/upload-probe and check its change-log rows.

## Drift check

Builds on GIT-REMOTE-1 (hook, broker, claims, nonces, change log), GIT-DIRECT-1 (parts, renewals) and PC-WORKER-1/-2
(PC kit). New: worker env `NATIVE_GIT_GITHUB_TRANSPORT` / `NATIVE_GIT_GITHUB_SSH_PORT` / `NATIVE_GIT_GITHUB_HTTP_VERSION`,
hook env `ROBINSON_REMOTE_TRANSPORT` / `ROBINSON_REMOTE_GITHUB_SSH` / `ROBINSON_REMOTE_HTTP_VERSION`, broker `op=key`,
change-log tool name `github_git_remote_deploy_key`, report fields `transport` / `transport_note` / `http_version` /
`deploy_key_removed` / `timing`, the worker volume folder `.remote-ssh-cleanup`, and `openssh-client` in the image. No
database migration, no tool schema change, no worker protocol change; HTTPS stays the default.
