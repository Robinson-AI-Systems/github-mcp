# Native Git worker: operations, deployment and migration

Real Git execution (clone, commit, merge, rebase, push…) in a private workspace, separate from GitHub's git-data API.
Vercel hosts the MCP, Neon holds workspace metadata, and a **native Git worker** container holds the files. **Dokploy is the
primary worker for new workspaces**; older workspaces pinned to the legacy Render host keep working there until they drain
(Render and its disk are not cancelled). Proof: [Dokploy cutover](status/2026-10-29-dokploy-native-cutover.md);
older [Render proof](status/2026-10-28-render-native-git-acceptance.md). Rollout history moved out of this page is in
[native Git history](status/2026-11-01-native-git-history.md). Always check signed capabilities rather than inferring
readiness from a configured URL. Future scale-out (several workers, device-hosted Git) is designed in
[RUNTIME-FLEET](designs/RUNTIME-FLEET-2026-11-01.md) §2.5 and is **not built**.

## User workflow

1. **Open** — `github_git_workspace_open` with owner/repo, optional branch, shallow `depth` (1–100,000), author name/email,
   `leaseMinutes` idle timeout (1–1440, default 240 = four hours) and optional `runtime` (`auto`, `none`, `small`,
   `medium`, `large`; see [right-sized runtimes](PLAYGROUND-OPERATIONS.md#right-sized-runtimes)). Before cloning, the MCP
   asks the primary worker for capabilities and refuses unless it reports resource-aware admission with room. It returns a
   connection-bound `workspace_id`, generation, HEAD and expiry.
   - Reuse the same `requestKey` only to recover the original intent; a replay returns the historical receipt plus
     `current_workspace` availability (`done=false` when disposed). A genuinely new workspace needs a fresh `requestKey`.
     Clone keys stay stable across the ten-minute key buckets. Legacy bucketed receipts are recovered only after checking
     the original client/pass workspace binding; missing ownership metadata refuses without cloning.
2. **Read** — `github_git_workspace_read`: status, log/show/diff/blame (log `max` 1–100, default 20), refs/remote_refs,
   conflict stages, stash/worktree/bisect inspection and exact file reads. `read_file` needs `options.path` and an explicit
   `byteLength` ≤ 32,768 (`byteOffset` defaults to 0); pass the returned `file_hash` as `options.expectedFileHash` for later
   windows — changed content refuses continuation. Credential-shaped files cannot be rebuilt through windows.
   `protection_check` with `options.path` reports matching scanner rules and the file hash without the matched values,
   including uncommitted files that GitHub has never seen.
3. **Run** — `github_git_workspace_run` with the current `expectedGeneration`, one typed operation and its options:
   binary write/remove (`write_file` ≤ ~1 MiB per call), staging/restore (`paths` 1–100), commit/amend (message ≤ 10,000
   characters, multiple paragraphs allowed), branch create/delete/rename/switch, tags, fetch/pull/push,
   merge/rebase/cherry-pick/revert with continue/abort, reset/clean, stash, detached worktrees (`options.worktree`) and manual
   bisect. Conflicts return the real unresolved paths; resolve, add, then continue or commit.
4. **Push** — choose `options.branch` and optional `expectedHead` (empty string = branch must not exist). `expectedHead` is
   an accuracy check, not permission to force: rewriting history needs `force=true` **and** an explicit `expectedHead`.
   Success requires an independent remote-ref readback. GitHub's own permissions and branch rules decide the outcome.
5. **Recover** — keep `requestKey` stable for the same intent; replays never resend. `operation_result` reads the historical
   receipt via `options.intentKey`. After a lost response or uncertain push, inspect local and remote refs before any new
   intent. A historical success does not mean the workspace has not changed since.
6. **List and close** — `github_git_workspace_list` pages active workspaces (`max` 1–20, default 10, `after`/`next_cursor`);
   each repository is freshly authorized, so omitted entries never prove absence. `github_git_workspace_close` deletes only
   the local workspace (never the GitHub repository) and verifies absence.

**Idle lease.** Authorized workspace reads and Git requests renew the idle window; responses carry `last_activity_at`,
`idle_timeout_ms` and `expires_at`. Listing, capabilities/health and close do not renew it, and neither do chat activity
or other tools (PR/CI). Renewal never extends the service sign-in grant or revives a disposed workspace. Workspaces created
before the idle lease keep their original duration. A background sweep every 60 seconds removes expired, unlocked
workspaces (up to 100 per sweep), skipping busy and operator-locked ones — push wanted work before going idle.

**Profiles.** Open, run and close require the **Full** profile (Everyday cannot clone). Read-only and Everyday connections
can read a workspace that already belongs to that same connection while repository access stays valid. For a separate
read-only grant, use your own local `git clone`. No pass ever gains another connection's workspace, credentials or grants.

## Branch switching and parallel agents

Switch with `operation:"switch", options:{branch:"topic"}` after creating the branch (`name`/`ref` are accepted aliases;
disagreeing values are refused before any change). Switching never guesses a remote tracking branch. Afterwards inspect
`branch`, `head` and `generation`. **Generation is a concurrency revision, not a success counter:** an executed command may
advance it even when Git refuses, conflicts or changes nothing. Detached worktrees report `branch=null`.

`branch_create`, `branch_rename` and `branch_delete` accept `options.branch` or `options.name`. For create, `options.ref` is
the start point (default HEAD) and creation does not switch; for rename it is the old name. Read `capabilities` with
`options:{name:"<operation>"}` for allowed options, required fields and an example. Unsupported options refuse before any
change; a failed dry run carries `preflight_failed:true` and is not a valid confirmation preview.

To update a topic branch after `main` moves: switch to it, `fetch`, `merge` with `options:{ref:"origin/main"}`, resolve
and commit any conflicts, then push with the observed remote `expectedHead`. A true merge keeps both parents (the API
content tools cannot import a local merge's parents).

**Concurrency.** Many workspaces can be open at once and the worker has **no fixed request count**: capabilities report
`max_concurrent:null` and `capacity_mode:"resource-aware"`. Each request is admitted only if the container has at least
32 MiB available memory, 64 MiB writable disk and ≤ 250 ms event-loop delay (defaults; see the settings table).
Refusals say which resource and that **no operation started**; retry the same intent after recovery (`Retry-After: 2`).
**Each workspace admits one request at a time, reads included** — a second request gets `workspace_busy` (409). There is
no durable queue and no automatic resend; keep the same `requestKey` for the same intent. Native workspaces are not
counted against any per-connection active-job or daily quota. (The "eight lanes" in the cutover proof were a tested load,
not a setting.)

Network, incomplete-body and invalid-response failures mean: inspect workspace state and the same intent receipt before a
new intent. Error messages are bounded and redacted, including worker paths.

## Limits (checked against code 2026-11-01)

| Limit | Value | Where |
|---|---|---|
| Git command watchdog | 45 s (includes clone; a very large clone can come back `uncertain`) | `workers/native-git/engine.js` |
| Command output kept | 2 MiB | engine |
| File read window | 32 KiB per window; whole file ≤ 20 MiB | engine, `safe-files.js` |
| Signed request validity | MCP signs for 60 s; worker accepts ≤ 90 s | `src/native-git/client.js`, `protocol.js` |
| MCP → worker | 50 s fetch timeout; 3 MiB response cap | `src/native-git/client.js` |
| Worker request body | 2 MiB (413 above); 15 s request timeout | `workers/native-git/server.js` |
| Snapshot export | ≤ 100 MiB raw, ≤ 100,000 files, no symlinks/special files; encrypted import ≤ 150 MiB | `snapshot.js` |

## API content-commit alternative

`github_content_commit_git_data` takes 1–50 UTF-8/base64/deletion operations, ≤ 1.5 MB per file and 2 MB total. Set
`expectedFileCount` from your manifest — a mismatch refuses the whole request before any provider call; it never silently
chunks. For more than 50 files use native Git or an explicitly planned series of individually verified commits.

For a missing branch supply `createFrom` (exact source commit) and `expectedHead:""`; blobs/tree/commit are created
first, then the ref only if still absent. An existing branch uses its exact `expectedHead`. `commit` is the new commit,
`branch_head` is independently observed, and `submitted_files`/`confirmed_files` separate requested from verified
delivery (exact commit, one parent, tree and every path/mode/blob). A tree snapshot does not import a local merge or
guarantee a workflow run.

## Deployment (Dokploy)

The owner permits the friend's Dokploy server for initial use, with an easy move to owned infrastructure. The worker is an
ordinary non-root container: no Docker socket, host credential mount, privileged mode or repository hook execution. **One
worker process owns each volume** (the per-workspace busy lock lives in memory), so this is not a distributed queue or an
autoscaling pool.

- Build `workers/native-git/Dockerfile` from the repository root (Node manifest pinned by digest; Git from signed Debian
  snapshots dated 2026-10-28). The image smoke test runs as the unprivileged user in CI; image CI never deploys.
- Import `workers/native-git/compose.yaml` into the GitHub MCP Dokploy project: persistent named volume, UID/GID 1000,
  read-only root, `cap_drop: ALL`, no-new-privileges, memory/CPU/PID (128) limits, internal port 3000, 64 MB noexec
  `/tmp`, 75-second stop grace. Monitor free space on the backing volume. One replica per volume.
- Pin the `public_key` from the MCP's `GET /api/native-git-key` as `NATIVE_GIT_CONTROL_PUBLIC_KEY` on the worker, and set
  `NATIVE_GIT_WORKER_URL` on the MCP to the worker's fixed HTTPS origin. The private signing key is derived on the MCP
  (HKDF, purpose-separated from the encryption root) and never leaves it. A legacy shared-key mode
  (`NATIVE_GIT_WORKER_KEY`) remains for internal fixtures only.
- The worker has **no standing GitHub token**. For network operations the MCP re-checks the grant and repository, then
  sends the real authorized credential only inside the signed request; Git receives it via its process environment, never
  remote URLs, config, receipts or snapshots. No redirects, system/global config, credential helpers, fsmonitor, executable
  hooks, submodule recursion, textconv/external diff or shell commands.
- `/health` returns `{service:"robinson-native-git", protocol:3}`: liveness only, never proof of a grant.

### Settings

| Setting | Side | Meaning |
|---|---|---|
| `NATIVE_GIT_WORKER_URL` | MCP | Primary worker HTTPS origin (new workspaces, capabilities) |
| `NATIVE_GIT_PREVIOUS_WORKER_URL` | MCP | Older origin kept during a drain |
| `NATIVE_GIT_WORKER_CUTOVER_AT` | MCP | Exact `YYYY-MM-DDTHH:MM:SS(.mmm)Z`; unpinned rows created before it use the previous origin. Required when a previous origin is set |
| `NATIVE_GIT_WORKER_DRAINING=true` | MCP | Temporarily pauses the **primary** origin only (also blocks new opens and capabilities there) |
| `NATIVE_GIT_WORKER_KEY` | both | Legacy shared-key fixtures only |
| `NATIVE_GIT_CONTROL_PUBLIC_KEY` | worker | Pinned MCP verification key |
| `NATIVE_GIT_STORAGE_ROOT`, `PORT` (3000) | worker | Data root and port |
| `NATIVE_GIT_MEMORY_LIMIT` (2g), `NATIVE_GIT_CPUS` (2.0) | worker compose | Whole-container ceilings shared by every workspace |
| `NATIVE_GIT_MIN_AVAILABLE_MEMORY_MB` (32), `NATIVE_GIT_MIN_AVAILABLE_DISK_MB` (64), `NATIVE_GIT_MAX_LOOP_DELAY_MS` (250) | worker | Admission floors |
| `NATIVE_GIT_SNAPSHOT_KEY` | operator CLI | 32-byte base64 snapshot key (environment only) |
| `NATIVE_GIT_SINGLE_WORKSPACE_ID`, `NATIVE_GIT_SINGLE_BINDING`, `NATIVE_GIT_AUTHORITY_URL` | Playground broker | Dedicated single-workspace broker mode inside a Playground allocation (adds `/v1/authority` and attachment export/import; disables the sweep). Set only by the Playground plan |
| `NATIVE_GIT_MAX_CONCURRENT` | — | **Retired and ignored** |

Friend-hosted compute has whatever cost/availability that host imposes; no $0 idle cost or measured production capacity is
claimed. Long term, use a Robinson-owned account with the same image/protocol and owned encrypted backups. No paid service
is created implicitly.

## Routing across hosts

Each new workspace stores a compact hash of the worker origin it was created on; the full origin never appears in tool
arguments. Routing, in order: a Playground-attached workspace goes to its dedicated broker; a pinned workspace goes to
whichever of `NATIVE_GIT_WORKER_URL` / `NATIVE_GIT_PREVIOUS_WORKER_URL` matches its pin; an unpinned legacy row uses the
cutover time. Unknown or removed pins refuse **before** any credential or request — no silent cross-host retry or
re-clone. **At most two shared worker origins are routable today** (current + previous). Retire an old host only after its
workspaces finished or were migrated, with independent proof, counting jobs across every tenant schema.

Before sending credentials to a new host, verify from outside it: `curl --fail --show-error "$WORKER_ORIGIN/health"`
(expect 200, protocol 3), then `github_git_workspace_read` operation `capabilities` and require `worker.ready=true`. A
timeout means the host operator must route public TLS to the service's port 3000 (or an owned outbound tunnel); point the
domain's DNS at the operator's **inbound** ingress address. Do not open more clones to troubleshoot.

## Moving the worker and recovering state

Workspace IDs and permissions live in the tenant-isolated database, not in the worker URL. To move: move the storage,
change the protected origin and public-key settings, keep the database mapping and exact workspace directories.

- **Bounded workspaces:** `snapshot-cli.js export WORKSPACE_ID ENCRYPTED_FILE` / `import ENCRYPTED_FILE` (keys from the
  environment, never argv). Export holds the mutation lock and includes objects, refs, index, stash, uncommitted files,
  conflict/rebase/bisect state, linked worktrees and intent receipts. Import authenticates the whole AES-GCM snapshot
  before writing, refuses traversal/overwrite and repairs worktree paths. Stop the service while importing. Import does
  not check bindings — import only into the matching deployment.
- **Larger or symlink-bearing workspaces:** stop the worker, archive the whole volume with the pinned image's `tar`
  (no link dereferencing), encrypt with authenticated tooling outside chat, verify before extracting, preserve UID/GID,
  run `git worktree repair`. Full runbook: [NATIVE-GIT-BACKUP-RUNBOOK](NATIVE-GIT-BACKUP-RUNBOOK.md).
- **Stuck lock:** stop the service, set `NATIVE_GIT_WORKER_STOPPED=yes`, run `snapshot-cli.js recover-lease WORKSPACE_ID`
  on the exact volume (uncertain receipts are kept), restart, re-authorize and inspect refs. Never repeat the old mutation
  blindly. Corrupt initialization is disposed and reopened with a new intent.

## Not supported (use your own trusted local Git)

LFS, submodules, executable hooks/filters, commit signing, custom remotes, arbitrary flags and `bisect run` are not
implemented in this isolated adapter. Capabilities name these alternatives. Do not describe the typed surface as every Git
feature or as proprietary scanner parity.

## Acceptance before production claims

Unit tests use real local Git/bare repositories, signed HTTP and fake GitHub identity; the job store also runs on
disposable PostgreSQL. Exact-head `ci`/`release-policy` and the native Git image workflow must pass. A production claim
additionally needs a real service-issued connection, the deployed worker/MCP source, a disposable owned repository,
clone/edit/commit/push with independent GitHub readback, denial/replay/conflict/recovery and cleanup.
