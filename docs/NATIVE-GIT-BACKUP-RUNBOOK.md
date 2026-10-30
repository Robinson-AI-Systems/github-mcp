# Native Git backup activation and recovery

## Current owner decision2026-10-30: optional future activation

Backups and restore acceptance are optional future operations and do not block production GitHub MCP/Playground implementation or activation. The owner has selected an existing interim off-server S3-compatible destination with100GB capacity and Chris as encryption-key custodian; production restores require his approval of the exact target. Private endpoint/credentials are intentionally absent from this public document. The latest destination.all read still returns401 unauthorized for destination; no backup was started and no restore was attempted. Do not bypass that refusal, purchase storage or present an unverified backup as recovery proof. Resume this runbook only when backup activation is requested and destination access is available. The historical prerequisites below apply to that optional activation, not the production service.

This is the prepared operational procedure, not a claim that off-host backup is active. On 2026-10-29 the project-scoped Dokploy `volumeBackups.list` call returned no backup jobs for the GitHub worker. The pinned API can schedule volume backups with a destination ID, volume name, cron expression, retention count and optional service stop. Its create contract has no explicit client-side encryption/key-custody field; that alone cannot establish encrypted independent recovery. No existing destination credential was retrieved, and no raw backup was silently enabled.

## Inputs required before activation

- An owner-selected destination on a different machine/provider from the Dokploy worker, with a dedicated GitHub-worker prefix and confirmed storage/transfer cost. An already owned destination may be used without purchasing another service; unknown billable storage is not implicitly approved.
- Protected storage authorization enrolled in Dokploy's own destination/setup UI, never chat, public source or tool arguments. Record only the nonsecret destination ID and prefix in private operations records.
- A protected, independently recoverable snapshot encryption key, held by the chosen Robinson custodian outside the worker's sole failure domain. This is a separate key from GitHub tokens, the MCP encryption root and the public worker verifier. Never rotate those credentials to manufacture a backup test.
- A schedule and retention choice consistent with the four-hour default idle disposal. Start with an hourly proposal and seven-day retention, then adjust from actual size/transfer observations and the desired recovery window. Backup retention does not extend an active workspace lease or authorize reviving expired work.

## Prepared project-scoped configuration

Use the existing GitHub native worker Compose project and its current named `native-git-data` volume; obtain the resolved project volume name from the project configuration rather than guessing a host path. Preserve the original volume and verifier. Do not enable a second writer/worker replica on that volume.

The pinned Dokploy API fields needed for a scheduled volume backup are `name`, `volumeName`, `prefix`, `cronExpression`, `destinationId`, plus `serviceType:compose`, the exact existing `composeId`/`serviceName`, `turnOff`, `keepLatestCount` and `enabled`. Validate the current operation schema before writing. A raw volume-copy job is not the encrypted snapshot export below. Activate only a route whose encryption and key recovery have been independently established. Neither same-host storage nor destination transport encryption alone proves recovery after losing the server and its keys.

Choose a maintenance window if the chosen export requires stopping the worker. Do not schedule repeated worker stops in the middle of active agent work. The resource-aware worker has graceful HTTP drain; the MCP's protected primary-only maintenance setting can pause primary requests without changing grants or previous-host routing. Verify the actual READY configuration before draining and clear maintenance afterward. Check all tenant job schemas and preserve every unrelated workspace. No host-wide Docker, SSH or unrelated-volume access is required or authorized by this runbook.

## Encrypted workspace route already implemented

For each stable workspace up to the documented100 MiB snapshot limit, the existing `workers/native-git/snapshot-cli.js export WORKSPACE_ID ENCRYPTED_FILE` locks that exact workspace and writes an authenticated AES-GCM encrypted archive. The separate key is read from protected operator environment `NATIVE_GIT_SNAPSHOT_KEY`; it must never be put on the command line or echoed. The storage root is the exact project-mounted volume. Transfer only the encrypted output to the selected off-host destination, verify its checksum and record completion without contents or keys.

The exporter refuses busy, uninitialized, symlink-containing and oversized workspaces rather than omitting files. Such cases require a project-scoped stopped-volume archive that preserves links/modes, encrypted outside chat with authenticated backup tooling. Use the documented whole-volume migration route in [native operations](NATIVE-GIT-OPERATIONS.md). An operator capable of controlled project-volume export/restore is required; this cloud agent currently has no such remote execution surface. Do not bypass denied host administration to obtain it.

## Recovery acceptance, before calling backup complete

1. Create an exact disposable project/workspace with a unique run marker, tracked and uncommitted harmless bytes, known HEAD/refs and intent receipts. Keep its metadata binding and lease; the volume alone is not the entire service backup. Separately ensure the tenant-isolated Neon metadata and its recovery procedure are covered.
2. Export/encrypt and transfer to the chosen independent destination. Record encrypted checksum, successful upload and timestamp; do not expose a private download link or key.
3. Recover the archive from that destination into an empty disposable project volume. Import authenticates before writing and refuses overwrite/traversal; linked Git worktree paths are repaired after a changed mount path. Use a separate test mount and existing pinned image. Never restore over active production work.
4. Verify exact file hashes, HEAD/parents/refs, worktree state and receipt history. Verify that wrong-key/tampered archives fail. A restore preserves original expiry and permissions; it does not extend a disposed grant or replay an uncertain mutation.
5. Close/delete only exact run-owned fixtures. Keep the original volume until recovery proof is recorded. Read the schedule back and observe an actual scheduled run, then record one independently recovered off-host restore. Local/fake tests and Render snapshots do not substitute for these observations.

## Current external prerequisites

The destination, independent key custodian and project-scoped remote export/restore execution remain unconfigured/unavailable here. No paid resource, backup schedule, raw volume export, new credential or worker restart was created by preparing this guide. See the [finite work plan](status/2026-10-29-fleet-install-and-recovery-plan.md) and [owner checklist](OWNER-CHECKLIST.md).


## Verified access limitation and ready request for the server owner

A subsequent actual `destination.all` call returned upstream401, code UPSTREAM_UNAUTHORIZED: unauthorized to access resource destination. Project-scoped backup-job inventory is readable, but this connection cannot inspect/assign backup destinations. No destination credentials or configuration were returned. Do not bypass this by requesting host-wide Docker access or another person's API key.

Request to send to the Dokploy owner:

> Please assign an independent off-server backup destination to our GitHub MCP project, or enable the project-scoped destination permission needed to configure one. The project backup-job list works, but destination access currently returns unauthorized. We need the nonsecret destination ID/location, a project-scoped export/restore route, and a way to store the backup encryption key under Robinson's control outside the worker server. Please keep credentials in protected setup, not chat. If this adds cost, provide the specific storage/transfer price before creating anything paid. We do not need general server administration.
