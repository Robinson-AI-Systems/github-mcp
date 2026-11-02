# SINGLE-DOMAIN-1 — One domain for every one-time transfer

## Owner approval 2026-11-02

Chris, in chat on 2026-11-02: "We need a way for this to work cleanly inside claude from any repository, without having
to add domain after domain after domain into claudes capabilities, and why would we refuse in a workspace with a runtime
attached?", "the clone repo option, or bulk download tool, should be in the default tool list, and if there is an
extremely common compound toolset that should be built with it, have that there too", and (05:11) "The simple
instructions to make this work in claude should be included with the tool so that public users arent hitting a wall".

## Outcome and acceptance

Outcome: every one-time download/upload command is issued on this service's own public domain (`PUBLIC_BASE_URL`),
works for workspaces attached to a Playground runtime, says in plain English what to allow when a sandbox blocks the
domain, and `github_repo_download` gets a whole repository in one call from the default tool list. Accepted when the
relay refusal, header, redirect, attached-runtime, write-contract and digest-bound tests below pass with real `git
clone`/`git push`/`curl` through the real middleware, and `ci` + `release-policy` are green at the exact head.

## Design

- **Relay** (`src/native-git/relay.js`, `middleware.js`, `vercel.json`): address
  `https://<public host>/v1/transfer/<d|u>/<route>/<tag>/<capability>[/info/refs|/git-upload-pack|/git-receive-pack]`.
  `<route>` is `w` (configured worker), `p` (configured previous worker) or `b.<host>` (a runtime broker host of the exact
  `ras-pg-<32 hex>-<ip>.sslip.io` shape on a configured ingress address). `<tag>` is an HMAC (key derived from
  `TOKEN_ENCRYPTION_KEY`) over kind + destination + capability. The middleware re-verifies the capability exactly like
  the worker (signature, purpose, expiry; brokers only the Ed25519 key), forwards only an allowlist of headers (no
  Cookie, Authorization, Proxy-Authorization or service headers), and answers with a Vercel rewrite; Vercel's proxy
  streams the bytes. `skipMiddlewareRequestBody` keeps bodies out of the middleware. Issued commands never follow
  redirects (`git -c http.followRedirects=false …`, curl without `-L`). `NATIVE_GIT_TRANSFER_RELAY=off` returns the old
  direct worker addresses.
- **Attached runtimes**: an attached workspace's authoritative copy is the runtime broker's (every native call already
  goes there after attach). Download/upload begin, status and apply go to the broker; the capability is signed with the
  Ed25519 key the broker pins. The runtime ingress now routes `/v1/download/…` and `/v1/upload/…` to the broker with a
  five-minute window and answers `GET /v1/ingress` so the control plane refuses plainly (with the fallback) on an older
  runtime image. Own-computer runtimes (mailbox relay) are refused plainly.
- **Compound** `github_repo_download` (owner, repo, mode git|archive, ref, fresh, maxMegabytes): reuses the newest open
  workspace of the same repository on this connection (or clones a Git-only one, 60-minute idle lease), then issues the
  same one-time download. A clone still running returns `state: opening` and the next call reuses it.
- **Default list**: `github_repo_download`, `github_git_workspace_download` and `github_git_workspace_upload` are in
  `COMPACT_DEVELOPER_TOOLS` with argument-only listing schemas; the compact budget moves from 5,000 to 6,000 tokens
  (`docs/DECISIONS.md`).
- **Guidance**: every transfer result has `if_blocked` (also in the ≤1200-byte `progress`), naming the one domain to
  allow; uploads also carry a labelled `direct_command` on the worker's own host for an HTTP 413 at the domain.

## Vercel limits (sources)

- Functions: 4.5 MB request/response body — https://vercel.com/docs/functions/limitations ("Request body size").
- Routing Middleware: 4 MB request body for requests it processes; runs on Node.js —
  https://vercel.com/docs/routing-middleware ("Limits on requests").
- `skipMiddlewareRequestBody`: "Vercel Functions and rewrite targets still receive the request body" —
  https://vercel.com/docs/project-configuration/vercel-json#skipmiddlewarerequestbody
- Rewrite helper semantics (headers overwrite the origin request headers) — https://vercel.com/docs/routing-middleware/js-reference
  and the `@vercel/functions` 3.10.x `rewrite()` source.
- Proxied request timeout 120 s, measured as the wait for the backend to start sending —
  https://vercel.com/docs/limits ("Proxied request timeout"), https://vercel.com/changelog/cdn-origin-timeout-increased-to-two-minutes
- External rewrites honor upstream cache headers; `x-vercel-enable-rewrite-caching: 0` opts out —
  https://vercel.com/docs/routing/rewrites

No documented body or response size limit for rewrite targets was found; whether the 4 MB middleware figure also applies
to bodies skipped with `skipMiddlewareRequestBody` is not stated, so uploads above 4 MB through the domain are
**untested until the live check**; `direct_command` is the labelled fallback.

## Tests

`tests/unit/transfer-relay.test.js`, `tests/unit/native-git-transfer-attached.test.js`,
`tests/unit/repo-download-contract.test.js`, updated `native-git-download-contract`, `native-git-upload-contract`,
`playground-ingress`, `code-read`, `check-scripts`.

## Release steps (owner/coordinator)

`PUBLIC_BASE_URL` must be the live HTTPS origin (it already is for OAuth). Deploy the control plane (middleware ships
with it). Rebuild/publish the runtime image so new runtimes carry the ingress routes; existing runtimes keep working for
everything else and get the plain fallback for transfers. Redeploying the shared worker is optional (header flush only).

## Not in scope (ROADMAP)

Upload → apply → commit → push in one call.

## Drift check

Builds on GIT-UPLOAD-1 / GIT-DOWNLOAD-1 claims unchanged (same purposes, fields and worker checks); no GitHub request,
credential, permission or database change. New: Routing Middleware on `/v1/transfer/*`, runtime ingress transfer
routes, one compound tool, three tools in the compact list and a 6,000-token compact budget.
