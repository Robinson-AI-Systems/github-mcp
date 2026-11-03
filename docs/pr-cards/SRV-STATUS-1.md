# SRV-STATUS-1 — github_server_status

## Owner approval 2026-11-02

Chris asked in chat on 2026-11-02 20:48 MST: "Keep this feature permanently and expand it with a dedicated
github_server_status tool that reports build version, deployment timestamp, recent release notes, worker versions, and
health checks in one compact response." "This feature" is VER-1 (`server_release` in `github_whoami`); it stays.

## Outcome and acceptance

Outcome: one read tool, `github_server_status` (area `server`, audiences B/O/Op, default compact list), tells an agent
which release it is talking to, when it went live, what reached `live` recently, which worker builds serve it and
whether its dependencies answer, in under 2 KB by default. Accepted when `tests/unit/server-status.test.js` covers each
health state, the time bound, no secrets in output, the cache, untrusted marking, mismatch warnings, the `deployed_at`
source labels and zone formatting, `tests/shapes/server-status-shapes.test.js` validates its GitHub requests against
the pinned OpenAPI description, and `npm run check` (compact budget) passes.

## What it returns

- `release`: `version` (`<package>+<commit12>`), `commit`, `source` link (same source as VER-1 `serverRelease`).
- `deployed_at`: `local` (saved zone, UTC labelled when none), `utc`, `zone`, `source`, `source_note`. Sources, in
  order: `github_deployment_status` (the success status GitHub holds for this exact commit's Production deployment,
  which Vercel writes), `github_deployment_created`, then `live_branch_commit_date` (labelled fallback), else `unknown`.
  Vercel's documented system variables include no deployment or build time, and this project has no build step, so a
  build-time stamp was not added.
- `recent_changes`: `untrusted: true`, the last 5 first-parent `Merge pull request #N` commits on `live` (PR number and
  title; `detail: full` adds merge time and commit). One `GET /repos/{owner}/{repo}/commits?sha=live` read with the
  app's own installation token narrowed to read-only on this repository when the connection includes its owner
  account, anonymous otherwise (public repository). History and deployment time are cached 5 minutes per process.
- `workers.native_git`: protocol, `build_commit` (new read-only capabilities field; "not reported" for older images),
  feature switches (direct download/upload, chunked upload, upload apply, git_remote, git_direct). Never the worker
  origin, direct-host origin or worker key.
- `workers.playground`: runtime image tag and digest the control plane would pin for this release (the existing
  anonymous registry lookup), or `operator_pinned`; the manager's recorded phase and the commit it was built from.
- `health`: `overall` plus `database` (one trivial settings read), `worker` (signed capabilities call, latency),
  `direct_git` (`/health` when `GIT_DIRECT_ORIGIN` is set) and `playground_pool` (pool count and manager phase, no
  provider call). Each is `ok` / `degraded` / `down` with a fixed plain reason; all run in parallel inside 7 seconds.
- `warnings`: worker protocol or options differ, worker built from an older or different commit (counted on `live`),
  worker does not report its commit, runtime image pinned older than the release, no runtime image published yet —
  each with a plain `next` step.
- `fields` selects sections (dotted paths allowed); asking only for `release` makes no outside call.

## Compact budget

The compact page was 5,896 of 6,000 tokens. Compact read listings now also leave out string `maxLength`/`minLength`
(the full schema still validates every call; `github_describe_tool` shows them), which made room: 5,583 with the new
tool.

## Release steps

The worker reports `build_commit` only after it is rebuilt with the `SOURCE_COMMIT` build argument set to the live
commit (`workers/native-git/compose.yaml` passes it through; Render's `RENDER_GIT_COMMIT` is read when present). Until
then the tool warns "does not report the commit". Nothing else needs configuring.

## Drift check

Read-only. No new setting, credential, migration or write. GitHub requests: `GET /repos/{owner}/{repo}/commits`,
`GET /repos/{owner}/{repo}/deployments`, `GET /repos/{owner}/{repo}/deployments/{deployment_id}/statuses`.
