# RELAY-OWNER-1 — Mid-size git pushes through the service domain arrive intact; Chris's own tenant connection gets his PC

Two live git-remote routing bugs found 2026-11-03, fixed together because both decide how a git remote request is routed.

## Outcome and acceptance

Outcome: a plain `git push` through `https://<service>/git/<owner>/<repo>.git` arrives byte-exact at every size, and
Chris's own connection from claude.ai (a public-connect tenant) is treated as the owner for the PC, while other people and
every pass stay off it. Accepted when `tests/unit/git-remote-push-sizes.test.js` and the new cases in
`tests/unit/worker-pool-owner-hosts.test.js`, `tests/db/pub-1-tenancy.test.js` and `tests/db/pub-2-pilot-identity.test.js`
pass, the existing git-remote / git-direct / transfer-relay / worker-pool suites pass, and `ci` + `release-policy` are green
at the exact head; live acceptance follows a release and one protected setting.

## Bug 1: mid-size pushes corrupted or cut off

Live (2026-11-03, robinson-ai-scratch/upload-probe): 8 KB ok; 20 KB "unexpected disconnect while reading sideband
packet"; 60 KB "unpacker error" + "inflate: data stream error"; 200 KB inflate error then a hang; 800 KB and 2 MB ok.
Reproduced again by this card: a 16 KB pack got `HTTP/2 200` with an empty body.

**Cause (code):** `workers/native-git/remote.js` (domain door, push) wrote and flushed the `200` response header
*before* reading the request body ("so a proxy in front sees the response begin"). In front of the PC worker is
Tailscale Funnel, a Go `net/http` reverse proxy. Go's HTTP/1.x server, when a handler's response header is written while
the request body is still unread, does this in `(*chunkWriter).writeHeader`: if less than `maxPostHandlerReadBytes`
(256 KiB) is unread it reads and discards the rest itself (racing the proxy's own copy of the body, so the worker gets a
short or spliced pack); if more is unread it only closes the connection after the reply and the copy carries on. That is
exactly the window seen live: tiny bodies were already forwarded before the header came back, bodies over ~256 KiB were
untouched, everything between was damaged. The direct host (`directReceive`) already waited for Git's first byte and was
not affected.

**Fix:** the domain-door push reply now starts with Git's first output byte (`replyWhenGitWrites`), as the direct host
does. `receive-pack` writes nothing until it has read the whole pack; its keepalives (`receive.keepAlive`) begin right
after, during the pre-receive hook, so a long GitHub push still shows progress. No guard, limit or check changed.

**Test:** `tests/unit/git-remote-push-sizes.test.js` pushes real packs of 8 KB, 20 KB, 60 KB, 200 KB, 800 KB and 2 MB with
the local git client and the exact setup command (postBuffer included) through the real Routing Middleware and a stand-in
for the Go front (`test/helpers/go-front-proxy.js`: network-paced forwarding plus Go's discard rule), to the real worker
and hook, and checks byte-exact delivery (SHA-256 and length of what the client sent equal what the worker got; GitHub
has the same commit and file content). With the old worker code the same test fails at 60 KB with "unexpected disconnect
while reading sideband packet".

The 2 KB push whose file held a documented FAKE token and was "cut off with no remote: message" (another agent's report)
was not reproduced here; it is consistent with the same early-header race (one small body split across records), and will
be re-checked live after release.

## Bug 2: Chris's own connection was not the owner

WORKER-POOL-2 treated as owner only the operator's direct full connector (PUB-8 `operator` mark) with no tenant scope.
Chris connects from claude.ai through public connect, so his connection is a tenant (`gh_t_…` schema). His decision
"Only my work on my PC" means his own work, from any of his own connections.

**Rule:** `ownerCaller(ctx)` is also true for a full, non-pass connection in a tenant database whose
**provider-verified numeric GitHub user id** equals the protected setting **`OPERATOR_GITHUB_USER_ID`**. The id comes only
from the identity row (`gh_tenant_identities.provider_subject`, written by the verified GitHub sign-in) joined with the
live membership (`directory.authorized` / `authorizedPilotIdentity`), attached to the opened tenant database as a
non-enumerable `verifiedGithubSubject` (not in `playgroundScope`, which is stored in index rows). Logins, accounts,
arguments and anything client-supplied are never consulted. A git remote key in such a tenant is the owner's key
(`ownerKey`), re-derived on every request from the live membership.

Why a new setting and not `PUBLIC_UNLIMITED_SUBJECTS`: that list exempts *any* named person from fair-use limits (it may
hold several ids); being exempt must not put someone's work on Chris's PC. One single id, plainly named, is the owner.
Unset or not a number → nobody new is the owner (exactly WORKER-POOL-2's behaviour).

Unchanged: other people (public, private tenant, Marketplace) never get the PC; every service pass, including one Chris
issued, stays off it; background maintenance stays off it; pinned workspaces and keys keep their host.

## Settings to set (not in this repository: it is public and holds no ids)

- Vercel production: `OPERATOR_GITHUB_USER_ID` = Chris's numeric GitHub user id — the same number already saved in
  `PUBLIC_UNLIMITED_SUBJECTS`, or the `id` field of `https://api.github.com/users/christcr2012`. Takes effect with the next
  deployment.

## Drift check

Builds on GIT-REMOTE-1 (domain door), GIT-DIRECT-1 (direct host's streamed reply), WORKER-POOL-2 (`ownerCaller`,
`ownerKey`), PUB-2/PUB-8 (verified identity, operator mark). New: `replyWhenGitWrites`, `operatorGithubId`,
`ownerIdentityDb`, `verifiedSubject` on memberships, `verifiedGithubSubject` on tenant databases, test stand-in
`go-front-proxy.js`, setting `OPERATOR_GITHUB_USER_ID`.
