# 2026-11-03 — SSH leg to GitHub for git remote pushes (GIT-SSH-LEG-1)

Owner direction (relayed, approved in chat): pushes from the PC worker to GitHub over SSH, because GitHub's HTTPS git
door ran at ~0.34 MB/s from the house while SSH (22 or ssh.github.com:443) ran at ~8 MB/s for the same 150 MB.

Built: opt-in worker setting `NATIVE_GIT_GITHUB_TRANSPORT=ssh` (+ `NATIVE_GIT_GITHUB_SSH_PORT`, default 443). Each push
gets a fresh ed25519 key (ssh-keygen, /dev/shm, 0600, never read by code), the broker (`op=key`) adds it as a write deploy
key on that one repository with the push's own credential, the push goes over SSH with GitHub's host keys pinned, and the
key is removed and read back as gone; leftovers are retried by the worker timer and swept by exact title at the next SSH
push. HTTPS fallback with a plain reason on refusal or no SSH answer. Per-step timings and the transport in the change
log and one `remote:` line. Also `NATIVE_GIT_GITHUB_HTTP_VERSION`. Image gains openssh-client; PC compose/.env.example and
docs/PC-WORKER.md updated. Card: [GIT-SSH-LEG-1](../pr-cards/GIT-SSH-LEG-1.md).

Verified here: `tests/unit/git-ssh-leg.test.js` (12 tests, real git, real ssh/sshd for host-key refusal),
`tests/shapes/deploy-key-shapes.test.js`, the existing git-remote / git-direct / worker suites, `npm run check`.
Not verified: a real push to GitHub over SSH from the PC (needs the release, `pc-worker update` and the `.env` lines).

Read-only check: the App installation on robinson-ai-scratch has `administration: write`, and Chris's connection acts
as him with a classic token with `repo` scope, so either credential can add deploy keys there.

Next (after release): on the PC set `NATIVE_GIT_GITHUB_TRANSPORT=ssh` and `NATIVE_GIT_GITHUB_SSH_PORT=443` in
`/srv/robinson-git/.env`, run `pc-worker update`, push 150 MB to robinson-ai-scratch/upload-probe and read its change-log
rows (transport ssh, timings, key add + removal).
