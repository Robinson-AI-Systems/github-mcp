# FLEET-5 — Caches that make repeat work fast on people's own machines

## Owner approval 2026-11-01

Chris approved "caches that make repeat jobs fast". Design: [RUNTIME-FLEET](../designs/RUNTIME-FLEET-2026-11-01.md) §2.4.

## Outcome and acceptance

On a person's own computer or server, every Playground runtime shares a package-download cache and the Git broker shares an
object cache, so repeat installs and attachments download only what is new; nothing about the results changes. Accepted
when: the runtime hands `NPM_CONFIG_CACHE`/`PIP_CACHE_DIR`/`XDG_CACHE_HOME` etc. under a valid cache root and ignores an
invalid one (image smoke test); two lean attachments through one object cache both reproduce HEAD/status and pass fsck,
the cache gains a pack, and the attached repositories have no alternates on the cache
(`native-git-lean-attachment.test.js`); the agent creates both caches once (owned by UID 1000), mounts them, keeps them when
a runtime stops and deletes them on revocation (`fleet-dial-out.test.js`).

## Not included

Cross-runtime caches on the shared pool (different people share those hosts; isolation wins). Cache warming.

## Drift check

Caches live only on the machine owner's own host and only for that owner's work; executors still get no credentials, no
socket and no host paths. A broken cache never blocks an attachment.
