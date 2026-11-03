# GIT-DIRECT-1 — Direct git host on the worker: no hosting-proxy limits, pushes beyond GitHub's 2 GB

## Owner decision 2026-11-02 18:24 MST (in chat)

"Build it and beat GitHub's push." Context: GIT-REMOTE-1/-2 made the MCP domain a git remote, but every request goes
through Vercel's proxy: live, pushes up to about 25 MB work (with `http.postBuffer`), 40 MB gets HTTP 502, and git
defaults fail above about 4 MB. Built-in AI-sandbox git talks straight to github.com and gets GitHub's limits (2 GB per
push, 100 MB per file, LFS beyond that).

## Outcome and acceptance

Outcome: when the owner points a domain such as `https://git.<domain>` at the native worker (`GIT_DIRECT_ORIGIN`),
`github_git_remote_setup` returns a remote URL on that host, and plain git clone/fetch/push stream straight to the worker
with every GIT-REMOTE-1 rail; a push over GitHub's 2 GB limit is sent on in parts and still lands atomically, and a file
over 100 MB is refused plainly with a Git LFS explanation. Accepted when the tests below pass (real git, real worker and
hook, real control-plane handlers, fake GitHub with a lowered per-push limit) and `ci` + `release-policy` are green at
the exact head; until the domain is configured everything works through the MCP domain unchanged.

## Design (and why)

**One PR.** The direct door, its authorization, the setup change and the large-push behaviour are one usable outcome; a
direct host without parts or without the setup change would not be usable, and the domain door's behaviour is unchanged.

**Two doors, one core** (`workers/native-git/remote.js` `serveRemote`). The domain door (Routing Middleware → signed
claim in a header → `/v1/remote/*`) is unchanged. The direct door (`workers/native-git/direct.js`) is a second HTTP
server in the worker process on its own port (`GIT_DIRECT_PORT`, default 3001) serving only
`/git/<owner>/<repo>.git/{info/refs,git-upload-pack,git-receive-pack}` and `/health`, only for its configured host name
(421 otherwise). Both doors hand a claim to the same core (mirror, refresh, upload-pack, receive-pack with the worker's
own pre-receive hook). Each door accepts only its own claims: version 1 (domain, unchanged so a worker that was not yet
redeployed keeps working) and version 2 (`door: "direct"`, pack step valid 8 h because a slow link may stream for hours).

**Authorization on the direct host.** The worker has no database, so for every request it asks the control plane:
`POST /api/git-remote?op=authorize` (`src/git-remote/api.js` `directAuthorize`).
- It sends only the session key's id and SHA-256 (computed in the worker from HTTP Basic), owner, repository, service
  and step. The key itself is never logged, never stored and never put in an onward request.
- The request is signed (header `x-robinson-git-worker`: timestamp, nonce, Ed25519 signature over a purpose label,
  timestamp, nonce and the canonical fields) with a key the worker generates on its own volume
  (`.git-direct/identity.pem`, 0600). The worker reports the public half in its answer to the control plane's signed
  capabilities call; `github_git_remote_setup` pins it (`git_remote.direct_worker`, root setting: origin + public key,
  no secret). Why not a shared secret: it would be one more value the owner must generate and type into two places;
  this way there is none, and the trust is the same as every worker call (the configured HTTPS worker origin).
- The control plane checks the timestamp (±60 s), the signature against the pinned key, refuses a reused nonce (one row
  in the key's `git_remote_uses`), then runs exactly the domain door's check (`src/git-remote/authorize.js`, now shared
  with Routing Middleware): hash (constant time), revocation, expiry, repository, access, live connection, read-only
  connection refuses push; every check logged (detail "direct host"). It answers with the signed claim and the stored
  per-push limit. Why a claim and not a GitHub credential: the broker then mints credentials per step exactly as on the
  domain door, so guard gates, journaling and attribution are untouched.
- Without the pin (or after the worker's key changed) the direct host answers plainly "not set up yet; call setup again
  or use the fallback address".

**Failed-attempt limit.** Per source, at most 20 failed key attempts (malformed key, or the control plane's 401: unknown,
revoked, expired) in 10 minutes; then 429 with `Retry-After` and a plain sentence until the window passes. No key at all
is not a failure (git asks its helper after a 401). The source is the peer address, or, only when the peer is a
private/loopback address (the reverse proxy on the Docker network), the last `X-Forwarded-For` entry. Memory-bounded
(10,000 sources). Keys are 256-bit random, so this is defence in depth.

**Large pushes stream to disk.** On the direct door a push is read in order: the small command list first (≤ 64 KiB),
then receive-pack is spawned and every chunk is written with backpressure into Git's quarantine on the volume; nothing is
buffered whole. Limits:
- Per push: stored setting `git_remote.push_limit` `{ "max_push_bytes": n }` (1 MiB–64 GiB), default **2 GiB**, GitHub's
  own limit, so this service is never the tighter limit by default. Raising it is what lets a single push be larger
  than GitHub's limit (sent on in parts, below). Over it: refused while streaming.
- Volume: the worker keeps `reserveBytes` (512 MiB) free. The ref advertisement of a push is refused (507, plain text)
  when free space is already under the reserve; a declared length that would not fit is refused before receive-pack
  starts; during streaming free space is measured every 16 MiB and the push is refused if it would cross the reserve.
- Resource admission: the worker's measured memory/disk/responsiveness check runs first for every request, as on the
  domain door.
- Every mid-stream refusal reads (and discards) the rest of the request so git is listening, then answers in Git's own
  protocol: `remote:` lines (side band 2) and `ng <ref> <reason>` for every ref, so git prints
  `! [remote rejected] … (push-too-large|storage-full)` after the plain explanation.
- Time: the direct server has no total request deadline (a slow link may take hours), closes a connection idle for 2
  minutes, and the push itself (receive-pack + hook) is capped at 12 h. Keys last at most 24 h.

**Beyond GitHub's 2 GB per push** (`workers/native-git/remote-hook.mjs`, direct door only). After the scanner has
passed every new object, the hook measures the new history (`git rev-list --objects --disk-usage <new tips> --not
--all`). At or under 90 % of GitHub's limit it pushes once exactly as before. Above it:
- Plan: along each pushed ref's first-parent chain (where each later commit reaches everything the earlier ones do), a
  binary search finds the furthest commit whose not-yet-sent history stays under 90 % of the limit; repeat. A single
  commit over the limit cannot be split and is refused with a plain next step (split that commit); more than 26 parts,
  or merged-in history that remains over the limit, is refused likewise. Nothing is sent before the plan exists.
- Send: each part goes to its own temporary ref `refs/robinson-git-remote/<random>/<n>` (not a branch or tag, so no
  workflow, branch rule or notification is triggered by it), leased on "absent". Before each later part the hook asks
  the broker for a fresh credential (`phase: "renew"`; same actor as the push, only while that push's change-log row is
  pending; numbered, single use), because App tokens last an hour.
- Land: one `--atomic` push moves every pushed ref (leased on what the client saw, so GitHub's branch rules and
  protections decide as always) and deletes every temporary ref in the same transaction. Git answers "ok" only after
  that and the `ls-remote` read-back.
- A failed part: the hook deletes the temporary refs it created, reads back GitHub, and refuses with exactly what GitHub
  has now ("main: at 1a2b3c… (unchanged)", "the 1 temporary part ref(s) were removed again" or the list left over),
  GitHub's words as repository text, and the next step. The change-log row is REJECTED with "part k of n: …".
- Note: parts of a refused push have been on GitHub briefly under the temporary refs (they passed the scanner first).

**Files over 100 MiB** (both doors). The scanner's size check is now a plain refusal before anything reaches GitHub:
the file name and size, that GitHub accepts files that large only with Git LFS (pointer in the repository, file stored
outside), that GitHub LFS has a free quota and use beyond it is paid, that this git remote does not carry LFS uploads
and will not set it up or buy anything, and how to remove the file from the commits. Real LFS support is owner-decision
scope (`docs/ROADMAP.md`).

**Setup** (`src/tools/git-remote.js`). With `GIT_DIRECT_ORIGIN` set on the control plane and the worker reporting
`git_direct: { version: "v1", origin: <the same>, worker_key }` in its signed capabilities answer, the result's
`remote_url` is on the direct host and `fallback_url` is the same repository on the MCP domain. The command (a `set -e`
subshell, so the key variable never reaches the person's shell) configures the store helper and `useHttpPath` for both
hosts, `postBuffer` for the MCP host only (the direct host streams), exchanges the code once and approves the
credential for both hosts. `push_note` gives the stored limit; `if_blocked` says to allow the MCP domain (needed for
setup and enough for everything through `fallback_url`) and the direct domain, and that `*.<parent>` covers both only if
the AI's allowlist accepts wildcards (we do not claim any AI does). Otherwise the result and command are byte-identical
to GIT-REMOTE-2. The always-visible digest stays within 1,200 bytes (the two-host command is about 860 characters on the
real domains; optional fields drop first). Compact listing unchanged (the tool's description is unchanged).

## Measured (locally)

Through a TLS terminator (Traefik's role) to the worker's direct port, real worker and hook, fake GitHub:
- 256 MiB incompressible push, git's default chunked encoding: 47.9 s end to end (5.3 MiB/s including the content scan
  of every byte and the push on to the GitHub stand-in); its clone 9.8 s. Test-process memory (worker, terminator and
  stand-in relay all in it) did not grow measurably (0.1 MiB at peak; the assertion is < 96 MiB) — the push streams to
  disk.
- Parts: 8 commits × 1.5 MiB with a 5 MiB "GitHub limit" went in 3+ parts, every pack GitHub received ≤ 5 MiB.
Not measured: the live Dokploy/Traefik path and a real >2 GB push to GitHub (needs the release, the DNS record, and a
large push of free scratch data; recorded as live acceptance).

## Tests

`tests/unit/git-direct.test.js`: setup returns the direct URL, the fallback, and a command for both hosts; clone, fetch,
push and the fallback clone; the key is in no log line, control-plane request, change row, use row or GitHub request;
setup falls back when the direct host is not configured here, not served by the worker, or different (or not https);
every refusal as `remote:` lines (no key, bad key, expired, revoked, wrong repository, read-only key, read-only
connection; other paths and other host names refused); GitHub protected branch, scanner, guard gates; the >100 MiB
refusal with a lowered limit; parts with a lowered 5 MiB GitHub limit (every received pack ≤ limit, final ref, no
temporary refs, journal confirmed, renewals between parts); a mid-part failure report (unchanged refs, temporary refs
removed, REJECTED journal) and the single-commit-too-large refusal; the stored per-push limit, the volume filling while
streaming and nearly full at the advertisement; the failed-attempt limit and source attribution; op=authorize refuses
a stranger's signature, no signature, a replay and an unpinned worker, and setup re-pins; each door refuses the other
door's claim; push-command parsing and the refusal report format; the 256 MiB measurement. Existing GIT-REMOTE-1 tests
(domain door, nine write-contract checks through every door, store on fake and PostgreSQL) pass unchanged.

## Release

Control plane (daily release): `op=authorize`, setup change. Set `GIT_DIRECT_ORIGIN` on Vercel only after the worker side
works. Worker redeploy with `GIT_DIRECT_ORIGIN`, `GIT_DIRECT_CONTROL_ORIGIN` (and `GIT_DIRECT_PORT` 3001), a Dokploy
domain on port 3001 with HTTPS, Traefik's entry-point `readTimeout` raised for long uploads, and the DNS record
(owner steps: `docs/OWNER-CHECKLIST.md`, `docs/GO-LIVE-CHECKLIST.md`). Then call `github_git_remote_setup` once (it
pins the worker key). No new secret, no table, no GitHub API version, permission, plan or spend change.

## Drift check

Builds on GIT-REMOTE-1/-2 (same keys, exchange, broker, hook, mirror and claim purpose; Routing Middleware's check moved
into `src/git-remote/authorize.js` unchanged; `src/git-remote/wire.js` holds the parsing both doors share and is copied
into the worker image and the coding-workspace image, which packages the worker as the dedicated broker). New: worker route set on a second port, worker identity file, root settings
`git_remote.direct_worker` and `git_remote.push_limit`, broker phase `renew`, report accepted up to 24 h after its claim
expired (it only closes a change-log row), claim version 2.
