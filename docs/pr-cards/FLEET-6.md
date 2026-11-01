# FLEET-6 — Lean attachment: runtimes fetch history from GitHub, only local changes are copied

## Owner approval 2026-11-01

Chris approved "running Git directly on your own machines, which removes the 100 MB size limit there" (with FLEET-4 and
FLEET-5). Design: [RUNTIME-FLEET](../designs/RUNTIME-FLEET-2026-11-01.md) §2.5.

## Outcome and acceptance

Attaching a workspace to a Playground runtime — on a person's own machine or the shared pool — no longer copies the whole
repository: the runtime's Git broker fetches history from GitHub itself and receives only the local changes, after which
its Git operations run on that machine. Accepted when a real Git workspace with a 3 MiB committed file, an unpushed commit,
a stash, a staged new file, a modified and a deleted tracked file and an untracked file attaches with a sealed copy under
1 MiB and the broker reproduces the same HEAD, status, generation, file bytes, staged blob, stash and full object
connectivity; a missing network token is refused; a replay returns the completed result; shallow (and other ineligible)
workspaces fall back to the full copy.

## Delivered (source)

`workers/native-git/lean.js` (plan/export, scratch-repo fetch + unbundle + object move, checkout-index, verification);
lean mode in `snapshot.js` export/mounted import and `attachment.js` (background finish across requests);
`src/playground/attachment.js` asks for lean and passes a short-lived token only to the receiving broker
(`preferShortLived` in `src/native-git/client.js`). Tests: `tests/unit/native-git-lean-attachment.test.js`.

## Not included

Multiple shared native Git workers (not approved). Opening a workspace directly on a person's machine without the shared
worker first (attachment still starts from the shared worker's clone).

## Drift check

Keeps PLAY-1's sealed, generation-pinned, source-frozen attachment, the receiver-only import, exact verification before
routing switches and credential-free executors. The broker already receives a scoped network credential for Git network
operations; it now also uses one for the attach fetch.
