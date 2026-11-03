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
   connection-bound `workspace_id`, generation, HEAD and expiry — or `state: "opening"` for a large repository whose
   clone continues in the background; read `status` until it is `ready`.
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
   binary write/remove (`write_file` ≤ ~1 MiB per call; for more, use [direct uploads](#direct-uploads); to get everything out, [direct downloads](#direct-downloads)), staging/restore (`paths` 1–100), commit/amend (message ≤ 10,000
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

### One call for the common job (`github_repo_change`, NATIVE-ERGO-1)

`github_repo_change` does open (or reuse), branch, write, delete, add, commit, push and, optionally, open the PR in one
call — the owner's agent needed seven or eight calls for one file before. Call shape:

```json
{ "owner": "example-org", "repo": "hello", "branch": "fix/typo", "base": "main",
  "files": [{ "path": "README.md", "content": "…" }, { "path": "logo.png", "base64": "…" }],
  "deletePaths": ["old.txt"], "message": "Fix the typo",
  "pr": { "title": "Fix the typo", "body": "…", "draft": false },
  "expectedHead": "<sha you last saw, or \"\" for a new branch>", "allowMoved": false, "requestKey": "fix-typo-1" }
```

- **Workspace**: the one this intent already used (a retry), `workspace_id` if given, the newest open workspace of the
  repository on this connection when it is clean and its copy of the branch is absent or equal to GitHub's, otherwise a new
  Git-only clone (no runtime; `fresh: true` always clones). It reaches collaborator repositories exactly like the
  workspace tools.
- **Branch**: an existing branch is checked out at GitHub's head (fetch, then switch / fast-forward); a new one is made
  from `origin/<base>` (base defaults to the default branch). `expectedHead` refuses before any change when GitHub's head
  differs; a move discovered later refuses without committing. `allowMoved: true` builds on the moved head instead.
- **Change**: `files` (≤ 100, each ≤ about 1 MB, text `content` or `base64`), `deletePaths` (≤ 100; already-absent paths are
  counted, not refused), every changed path staged, one commit, one push with a lease on the head it read, read back from
  GitHub. Identical content gives `stage: "no_changes"` (nothing committed or pushed).
- **Larger or binary changes**: call with `upload: "archive"` (or `"git"`) — the branch is prepared and a one-time upload
  command is returned; run it, then call again with `workspace_id`, `upload_id`, `message` (and `deletePaths`).
- **PR**: `pr` opens it through `github_workflow_open_pr` (its own journal, guards and readback); an existing open PR for
  the same head/base is reused. The result has `pr.number` and `pr.url`.
- **Retries**: every native step has its own key derived from this intent's `requestKey`, so the same call again replays
  finished steps from the worker's receipts and continues an interrupted change; it never commits or pushes twice.
- **Result**: `stage` (`pushed`, `no_changes`, `awaiting_upload`, `cloning`, `stopped`), `commit`, `branch`, `base`,
  `workspace_id`, `pr`, and a short `progress` list, also in the always-visible `progress` digest.
- It uses only operations every deployed worker already runs, so it needs no worker update.

### Ergonomics and definite outcomes (NATIVE-ERGO-1)

- **Shortcuts**: `path`, `paths`, `branch`, `ref`, `message` and `all` are accepted at the top level of
  `github_git_workspace_run` (and `path`/`paths`/`ref` on `_read`); `owner`/`repo` are accepted and checked against the
  workspace. A wrong option names the valid ones.
- **add** `options.all: true` or `paths: ["."]` stages everything. **remove_file** takes `paths` (each must exist; none is
  removed otherwise). **fetch** takes `branch`/`branches`/`ref` (`origin/` or `refs/heads/` prefixes are fine), `remote:
  "origin"`, `prune`, `tags`. **merge** takes `ref` or `branch`, `message`, `noFastForward`, `fastForwardOnly`. **pull**
  takes `branch` or `ref`. **switch** `create: true` (+ `from`) makes and switches; a plain switch to a branch that exists
  only as `origin/<name>` (for example made with `github_branch_create`, then fetched) tracks it.
- **changed_files** (read) lists paths that differ from `options.ref` (default HEAD), committed or not, plus untracked files.
- **next_generation** is in every run result (and in `details` of a refusal); `quiet: true` returns only outcome, branch,
  head, counts and `next_generation`. A stale `expectedGeneration` says plainly that nothing changed and gives the value to
  send.
- **Definite outcomes**: a merge/rebase/cherry-pick/revert/stash pop that stops with conflicts is `applied` with
  `outcome: "conflict"`, the files and the next step (fix, add, commit/continue, or abort). Git refusing (for example
  `fatal: invalid reference`) and worker checks that refuse before any change are `rejected` with a plain next step (for a
  missing branch: fetch it by name, or `create: true`). Only genuinely unknown results (transport loss, unverified push)
  stay unconfirmed.
- **Upload**: `begin` ignores `expectedGeneration`; `apply` ignores `mode`/`maxMegabytes` and accepts `deletePaths` and
  `mirror: true` (archive mode: delete tracked files under `path` that the archive does not contain).
- **Worker versions**: add-all, fetch-by-name, merge `branch` and pull `ref` work on every worker (the MCP sends an older
  worker the same intent in its own shape). `remove_file` with several paths, `switch create`, merge
  message/fast-forward flags, fetch prune/tags, `changed_files` and upload `deletePaths`/`mirror` need a worker that
  reports `native_options: "ergonomic-v1"` / `upload_apply: "delete-v1"` in capabilities; until it is redeployed they are
  refused plainly with a fallback, before anything is sent.

**Idle lease.** Authorized workspace reads and Git requests renew the idle window; responses carry `last_activity_at`,
`idle_timeout_ms` and `expires_at`. Listing, capabilities/health and close do not renew it, and neither do chat activity
or other tools (PR/CI). Renewal never extends the service sign-in grant or revives a disposed workspace. Workspaces created
before the idle lease keep their original duration. A background sweep every 60 seconds removes expired, unlocked
workspaces (up to 100 per sweep), skipping busy and operator-locked ones — push wanted work before going idle.

**Profiles.** Open, run and close require the **Full** profile (Everyday cannot clone). Read-only and Everyday connections
can read a workspace that already belongs to that same connection while repository access stays valid. For a separate
read-only grant, use your own local `git clone`. No pass ever gains another connection's workspace, credentials or grants.

## Direct uploads

For more than about 1 MB of files, send them straight to the worker instead of through `write_file`
(`github_git_workspace_upload`, card [GIT-UPLOAD-1](pr-cards/GIT-UPLOAD-1.md)). The bytes never pass through Vercel, and
no GitHub credential is involved: the address carries a signed, single-use, ten-minute capability for one quarantine
area of one workspace.

```text
# Git mode: from your own clone whose commits build on the workspace HEAD
github_git_workspace_upload {workspace_id, operation:"begin", mode:"git", requestKey:"<fresh>"}   → url, upload_id
git push "<url>" HEAD:refs/heads/upload
github_git_workspace_upload {workspace_id, operation:"apply", upload_id, expectedGeneration:<current>}

# Archive mode: a folder of files (.tar.gz, .tar or .zip)
tar -czf files.tar.gz images/
github_git_workspace_upload {workspace_id, operation:"begin", mode:"archive", maxMegabytes:20, requestKey:"<fresh>"}
curl --fail --upload-file files.tar.gz "<url>"
github_git_workspace_upload {workspace_id, operation:"apply", upload_id, expectedGeneration:<current>, path:"assets"}
```

Then review (`status`/`diff`), `add`, `commit` and `push` with `github_git_workspace_run` as usual.

### Chunked, resumable uploads (CHUNK-UPLOAD-1)

Large single requests through the service's domain were not reliable (live 2026-11-02: a 20 MB upload got HTTP 502
`ROUTER_EXTERNAL_TARGET_CONNECTION_ERROR` from Vercel's proxy). When the worker (and, for a runtime, its ingress) supports
it, begin's `command` is a copy-paste shell line that needs only `split`, `curl`, `wc` and `sha256sum` (macOS:
`shasum -a 256`); `single_command` keeps the one-request form for uploads below about 8 MB.

```text
U="<url>";F=files.tar.gz;split -b4m -a4 $F .u.&&o=0&&for c in .u.????;do curl -fsS --retry 4 -o/dev/null -T $c "$U/chunk?offset=$o"||break;o=$((o+$(wc -c<$c)));done;rm -f .u.????;curl -sS -XPOST "$U/finish?size=$(($(wc -c<$F)))&sha256=$(sha256sum $F|cut -c1-64)"
# git mode: the same loop over a bundle of your commits since the workspace HEAD
git bundle create .u.b HEAD --not <base>&&U="<url>";F=.u.b;…;rm -f .u.b
```

- `PUT <url>/chunk?offset=N` stores one chunk of at most 8 MiB (the command sends 4 MiB). A retried identical chunk is
  answered `already_stored`; different bytes at a stored range, or an overlapping range, are refused (409). An optional
  `X-Content-SHA256` header is checked per chunk. A cut-off chunk is never stored.
- `GET <url>/status` reports `present` byte ranges, `chunks`, `bytes_present` and `accepts_chunks_until`; rerunning the
  command resumes (stored chunks come back as duplicates).
- `POST <url>/finish?size=N&sha256=H` refuses gaps (409 with `missing` ranges; the upload stays open), re-hashes every
  stored chunk, assembles the file and compares the whole-file SHA-256: a mismatch discards the upload (422). Git mode
  then fetches the bundle (fsck on) into the same quarantine repository a `git push` uses. Then apply as usual.
- The first chunk claims the address for chunks (a one-request upload then gets 410, and the reverse). The address must
  be first used within its 10 minutes; a chunked upload that started in time may keep sending, reading status and
  finishing for 20 more minutes (a 100 MiB upload over a slow link can take longer than ten minutes; nothing new can
  start late, and the capability still names exactly one quarantine). Size caps, credential scanning, quarantine-then-apply
  and "no GitHub credential in any URL" are unchanged.
- The one-request archive command sends `X-Content-SHA256`, so damaged bytes are refused when they arrive, not at apply;
  the worker also refuses a body shorter than its `Content-Length`.
- A refused apply never changes the quarantined upload: each apply expands a `.tar.gz` into its own scratch file and
  removes it. (Before this, a refused apply left `expanded.tar` behind and the corrected apply then reported "the gzip
  data is damaged": the cause of the live 20 MB failure.)
- Large `git push` through the domain is one long request like the old archive upload; use git mode's chunked command
  (a bundle) for big binary payloads.

- **begin** returns the URL once (a replay does not repeat it; begin again with a fresh `requestKey`). It works for one
  push session or one upload, within 10 minutes, up to `maxMegabytes` (1–100, default 50). A second use gets HTTP 410;
  an expired or altered address gets 403. Do not publish it.
- **Git mode** receives into a separate quarantine repository with full object checks; the workspace's branches, refs,
  config and hooks are never written by the push. **apply** fast-forwards the current branch only when the pushed commit
  descends from the workspace HEAD (otherwise: rebase onto that commit and push to a new upload), with no tracked
  changes in the workspace. Several pushed branches → pass `ref`.
- **Archive mode** extracts into the repository root or `path`. Refused before anything is written: absolute paths,
  `..`, `.git` anywhere, symlinks, hard links, devices, files over 100 MiB, more than 10,000 entries or 256 MiB expanded,
  more than 100× expansion, and destinations that go through a workspace symlink.
- Both modes scan every new byte with the repository's content protection (Git mode also scans intermediate commits and
  commit messages); credential-shaped content refuses the whole upload with its first location, never its value.
- apply bumps `generation` and returns files added/changed/deleted/unchanged and bytes. Unused or unapplied uploads are
  removed about 70 minutes after the address expired; closing the workspace removes them at once. Dedicated Playground
  broker workspaces are not supported (copy files inside the runtime instead).

**Operator notes.** The worker image must include this change (capabilities report `direct_upload: "quarantine-v1"`;
until then begin refuses and points to `write_file`). The upload route is on the same public HTTPS origin and port as
`/v1/workspace`; no new domain, port or setting. Traefik (Dokploy) does not buffer or cap request bodies by default, but
its entrypoint `respondingTimeouts.readTimeout` (60 s by default in Traefik v3) bounds how long one upload may take: about
7 Mbit/s for a 50 MiB upload. Raise it on the Dokploy Traefik configuration (for example to `300s`) only if agents need
large uploads over slow links. The worker itself allows each upload request 5 minutes and stores quarantines under
`$NATIVE_GIT_STORAGE_ROOT/.uploads` (counted by the normal disk admission; never on the 64 MB `/tmp`).

## Direct downloads

To get the whole workspace (or its uncommitted work) at once, ask for a one-time address instead of reading files one
by one (`github_git_workspace_download`, card [GIT-DOWNLOAD-1](pr-cards/GIT-DOWNLOAD-1.md)). For a repository you have
not opened yet, `github_repo_download {repo, mode}` does open-or-reuse plus the download in one call. No GitHub credential
is involved. Addresses are on this service's own domain (see [One domain](#one-domain-for-every-transfer)).

```text
# Git mode: a real clone of the workspace's local branches and tags (or only ref)
github_git_workspace_download {workspace_id, mode:"git", requestKey:"<fresh>"}            → progress.command
git -c http.followRedirects=false clone "<url>" repo
# …or bring one branch into an existing clone
github_git_workspace_download {workspace_id, mode:"git", ref:"main", requestKey:"<fresh>"}
git fetch "<url>" main:refs/remotes/workspace/main

# Archive mode: a .tar.gz of a branch/tag/commit (default HEAD), or of the current files with ref "worktree"
github_git_workspace_download {workspace_id, mode:"archive", ref:"worktree", requestKey:"<fresh>"}
curl -fsS "<url>" -o repo.tar.gz && mkdir -p repo && tar -xzf repo.tar.gz -C repo
```

- The command is in the result's always-visible `progress` (compact clients drop `result`). It works for one clone or
  fetch session (its few requests within 5 minutes) or one archive download, started within 10 minutes; reuse gets
  HTTP 410, an expired or altered address 403. A replay does not repeat it. Do not publish it.
- The snapshot is taken when you call the tool; later workspace changes are not included. The workspace itself is never
  changed. `maxMegabytes` (1–500, default 200) caps what is sent; a clone or download over the cap stops and fails.
- Git mode serves only the snapshot's refs (no filters, no unadvertised objects; pushing to the address is refused).
  The clone's `origin` is the expired address — send changes back with [direct uploads](#direct-uploads).
- Archive mode with a ref equals `git archive --format=tar` of that commit, gzipped. `ref:"worktree"` holds tracked and
  untracked-but-not-ignored files including uncommitted edits, never `.git`; in-tree symbolic links stay links, and a
  link pointing outside the repository (or a folder that is a link) refuses the download with its path.
- Workspaces attached to a Playground runtime are served from the runtime's copy (the authoritative one after attach);
  the runtime must run an image with the transfer ingress routes, otherwise the tool refuses plainly and suggests
  `github_repo_download` with `fresh: true`. Own-computer runtimes cannot be reached. Operator: the worker must report
  `direct_download: "one-time-v1"`; snapshots live under `$NATIVE_GIT_STORAGE_ROOT/.downloads` and are removed once
  served, by the 60-second sweep, or when the workspace closes. Same origin and port as `/v1/workspace`.

## One domain for every transfer

SINGLE-DOMAIN-1 ([card](pr-cards/SINGLE-DOMAIN-1.md)). Every one-time upload/download address is
`https://<PUBLIC_BASE_URL host>/v1/transfer/<d|u>/<route>/<tag>/<capability>`, so an AI sandbox with a network allowlist
needs only this service's own domain, for every repository and transfer. Routing Middleware (`middleware.js`) checks
the HMAC `<tag>` binding kind + destination + capability, verifies the capability like the worker does, forwards only
transfer headers (no cookies or authorization) and rewrites to the configured worker or a runtime broker of the exact
Playground host shape on a configured ingress address. Vercel's proxy streams the bytes; `skipMiddlewareRequestBody`
keeps bodies out of the middleware. Commands never follow redirects.

- If the sandbox cannot reach the domain (host not allowed, proxy 403, DNS error), the person adds that one domain to
  the AI's network allowlist once (for Claude: the Capabilities / network access allowed-domains setting). Each result's
  `if_blocked` says this with the exact host.
- Limits: Vercel's proxied-request wait is 120 seconds for the worker to start answering; downloads stream for as long as
  bytes flow. Uploads above about 4 MB through the domain are unverified until the live check (Routing Middleware lists a
  4 MB body limit; skipped bodies are documented as reaching the rewrite target). If the domain answers HTTP 413, use the
  upload result's `direct_command` (the worker's own host).
- `NATIVE_GIT_TRANSFER_RELAY=off` (protected setting) returns the worker-host addresses instead.

## Git remote (GIT-REMOTE-1)

[Card](pr-cards/GIT-REMOTE-1.md). `https://<PUBLIC_BASE_URL host>/git/<owner>/<repo>.git` is a normal git remote for
any repository the connection can reach. `github_git_remote_setup` (owner, repo, `access` read|write, `hours` 1–24,
default 8) returns `remote_url` and a one-time `command` (works once, within 10 minutes; the same on Linux and macOS)
that exchanges a code for a session key straight into `git credential approve`, with a store helper and `useHttpPath`
for this origin only. The key is never printed; only its SHA-256 is stored (`git_remote_keys`, per tenant database).

- **Requests.** Routing Middleware checks every Git request's key (hash, expiry, revocation, repository, access, live
  connection) before forwarding; the worker gets only a signed claim on `/v1/remote/*`. No key → 401 with a Basic
  challenge. Every check and broker step is a row in `git_remote_uses`.
- **Fetch.** The worker refreshes its per-connection bare mirror (`.remotes/<id>/mirror.git`) from GitHub with a
  credential the broker (`/api/git-remote?op=broker`) mints for that request (short-lived repository App token when
  available), then serves upload-pack. A first copy of a big repository that takes over 90 s answers 503 "run again in
  a minute" while it continues. Mirrors idle 48 h are removed.
- **Push.** Objects wait in Git's quarantine while the worker's own pre-receive hook runs: broker (guard gates per ref
  as `github_git_workspace_run push`, change-log row `github_git_remote_push`, credential with "Act as me" attribution),
  content protection on every new object, one `--atomic` push to GitHub leased on what the client saw (GitHub decides
  branch rules, protected branches and force pushes), read-back, outcome recorded. Only then does git get "ok".
  Refusals arrive as `remote:` lines with a next step; GitHub's own words are marked as repository text.
- **Size.** 100 MiB per push. Measured locally: 60 MiB push ≈ 9 s, its clone ≈ 2 s through the edge stand-in. Through
  Vercel's proxy a single push above about 20 MB may be cut off (a git push cannot be chunked); use
  `github_git_workspace_upload` (chunked) for huge binary payloads. Fetches stream.
- **Cancel.** My connection (tenant) or the setup page (owner's own connection) lists live keys with a cancel button;
  the next git request is refused. Disconnecting the app ends its keys.
- **Worker.** Capability `git_remote: "v1"`; no new setting. Not served by dedicated (single-workspace) brokers.
- **Direct host.** For pushes beyond about 25 MB, configure the [direct git host](#direct-git-host-git-direct-1).

## Direct git host (GIT-DIRECT-1)

[Card](pr-cards/GIT-DIRECT-1.md). Optional: the worker serves the same `/git/<owner>/<repo>.git` smart-HTTP endpoints
itself on `GIT_DIRECT_ORIGIN` (for example `https://git.<domain>`), so git traffic no longer passes Vercel's proxy (live
there: about 25 MB per push at most). Until it is configured, everything works through the MCP domain unchanged.

- **Setup.** With `GIT_DIRECT_ORIGIN` on the MCP and the worker reporting the same origin (`git_direct` in its signed
  capabilities answer), `github_git_remote_setup` returns `remote_url` on the direct host and `fallback_url` on the MCP
  domain; the command stores the key for both hosts only. The call also pins the worker's public signing key
  (root setting `git_remote.direct_worker`). The sandbox must allow the MCP domain (setup, fallback) and the direct
  domain; `*.<parent domain>` covers both only if that AI's allowlist accepts wildcards.
- **Every request is authorized by the control plane.** The worker hashes the HTTP Basic key and sends only its id and
  SHA-256, signed with its own Ed25519 key (`<storage>/.git-direct/identity.pem`, generated once), to
  `/api/git-remote?op=authorize` on `GIT_DIRECT_CONTROL_ORIGIN`. The control plane checks the signature (pinned key,
  ±60 s, single-use nonce) and runs the same key check as Routing Middleware, then returns a signed claim (version 2)
  and the per-push limit. From there the GIT-REMOTE-1 core serves it: mirror, quarantine, pre-receive hook, guard gates,
  scanner, change log, "Act as me" attribution, atomic leased push, `ls-remote` read-back, `remote:` refusals.
- **Failed attempts.** 20 failed keys per source per 10 minutes, then 429 with `Retry-After`. Behind the reverse proxy
  the source is the last `X-Forwarded-For` entry (trusted only from a private or loopback peer).
- **Size and storage.** Pushes stream to the quarantine on disk with backpressure (never held in memory). Per push:
  stored setting `git_remote.push_limit` `{ "max_push_bytes": n }`, 1 MiB–64 GiB, default 2 GiB (GitHub's limit).
  512 MiB of the volume is kept free: a push is refused at its ref advertisement when free space is already below that,
  before streaming when its declared length does not fit, and while streaming (checked every 16 MiB). Refusals arrive
  as `remote:` lines plus `[remote rejected] … (push-too-large|storage-full)`.
- **Over GitHub's 2 GB per push.** When the new history is over 90 % of GitHub's limit (only possible after raising
  `git_remote.push_limit`, or for a push close to 2 GB), the hook sends first-parent ranges, each under 90 % of the
  limit, to temporary refs `refs/robinson-git-remote/<random>/<n>`, renewing the GitHub credential between parts, then
  one atomic leased push moves the person's refs and deletes the temporary refs. A failed part removes the temporary
  refs and reports what GitHub has for every ref; nothing the person pushed changes. A single commit over the limit, more
  than 26 parts, or merged-in history over the limit is refused before anything is sent.
- **Files over 100 MiB** (both doors): refused before GitHub with the file name, its size and a Git LFS explanation
  (GitHub LFS beyond its free quota is paid; this remote does not carry LFS).
- **Time.** No total request deadline on the direct port; an idle connection closes after 2 minutes; receive-pack plus
  hook stop after 12 h; a direct claim's pack step lasts 8 h.
- **Measured locally:** 256 MiB push through a TLS terminator to the direct port in 47.9 s (5.3 MiB/s including the
  content scan and the push on to the GitHub stand-in), its clone 9.8 s, no measurable memory growth. Live: not yet.
- **Reverse proxy.** Dokploy's Traefik must not cut long uploads: its entry point's
  `transport.respondingTimeouts.readTimeout` defaults to 60 s since Traefik v2.11.2 (also v3), which would stop any push
  that takes longer to upload. Set it to `0s` (or several hours) on the HTTPS entry point (owner step).

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
| Git command watchdog | 45 s per command | `workers/native-git/engine.js` |
| Clone | waits up to 30 s inside the request, then continues in the background (`state: "opening"`) with its own watchdog, default 15 minutes (`NATIVE_GIT_CLONE_TIMEOUT_MS`, 45 s–60 min). Read status until `ready` or `failed`; work and close are refused while it runs; a worker restart marks an unfinished clone `failed` | engine |
| Command output kept | 2 MiB | engine |
| File read window | 32 KiB per window; whole file ≤ 20 MiB | engine, `safe-files.js` |
| Signed request validity | MCP signs for 60 s; worker accepts ≤ 90 s | `src/native-git/client.js`, `protocol.js` |
| MCP → worker | 50 s fetch timeout; 3 MiB response cap | `src/native-git/client.js` |
| Worker request body | 2 MiB (413 above); 15 s request timeout | `workers/native-git/server.js` |
| Direct upload | one push or archive per address, ≤ 10 min, `maxMegabytes` default 50, up to 100 MiB (+1 MiB Git commands); streamed to disk, never held in memory; 5 min per request; apply: ≤ 100 MiB per file, 256 MiB total, 10,000 entries, 5,000 commits. A 30 MB archive through the relay and worker is tested locally (`tests/unit/native-git-ergonomics.test.js`); the owner's 19.5 MB 502 predates the single-domain relay and matches the earlier worker-redeploy 502 (no lower limit exists in this code); 8.4 MB through the live relay passed on 2026-11-02. Larger live sizes are not yet verified | `workers/native-git/upload.js`, `archive.js` |
| `github_repo_change` | ≤ 100 files (each ≤ about 1 MB), ≤ 100 deletions per call; larger changes go through `upload` | `src/tools/repo-change.js` |
| Snapshot export | ≤ 100 MiB raw, ≤ 100,000 files, no symlinks/special files; encrypted import ≤ 150 MiB. Playground attachment uses the **lean** format when eligible (history fetched from GitHub; only local changes count) | `snapshot.js`, `lean.js` |

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
| `GIT_DIRECT_ORIGIN` | both | GIT-DIRECT-1 direct git host, e.g. `https://git.<domain>` (https origin, no path). On the worker it turns the direct host on and is its only accepted host name; on the MCP it makes setup prefer it when the worker reports the same origin. Unset = off |
| `GIT_DIRECT_CONTROL_ORIGIN` | worker | The MCP's own origin (`https://<PUBLIC_BASE_URL host>`), where the direct host asks `op=authorize`. Required with `GIT_DIRECT_ORIGIN` |
| `GIT_DIRECT_PORT` (3001) | worker | Port of the direct git host (the Dokploy domain points here) |
| `NATIVE_GIT_CLONE_TIMEOUT_MS` (900000) | worker | Background clone watchdog, clamped to 45 s–60 min |
| `NATIVE_GIT_OBJECT_CACHE` | Playground broker on a person's own machine | Per-machine Git object cache used by lean attachment (set by the host agent) |
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
