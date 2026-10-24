# GOD-6 — "Act as me": with a master token, GitHub records the person, not the bot

**Batch FIN · Design:** this card · **Prerequisites:** GOD-1 (master token), GOD-2 (`personalCred`), GOD-5 (extra
places), all merged · **Effort:** medium–high (credentials, guards; read `docs/AI-PR-READ-FIRST.md`) · **Split:** one
PR. Reason: routing as the person, the branch-rule guard and the deliberate override (step 6) must ship together;
routing without the guard would let an admin's token skip branch rules silently. **Expected agent time:** 6–8 h.

## Owner decision (Chris, 2026-10-24) — already made

- **God mode off** (no master token): unchanged. Calls use the App (installation token `I`, App user token `U`), and
  GitHub shows the Robinson GitHub MCP app ("bot").
- **God mode on** (master token added): every GitHub call uses the person's master token (`M`), so GitHub records the
  person (for example `christcr2012`) as the one who started a workflow, merged, commented or changed a setting. This
  applies to every person who adds a master token, not only Chris.
- The few things only an App may do go through the bot automatically. Every result says who it acted as.
- The token expiring, being removed or being rejected switches back to the bot on its own and says so. No reconnecting.
- On by default once a master token is added; a switch on My connection turns it off ("Act as me").
- **Owners and admins must be able to override branch rules** (Chris, 2026-10-24: "the owner or the admin a lot of
  times needs to override those rules"). So rules are never skipped *silently*, but a person whom GitHub allows to
  skip them can do so *deliberately*: the call says `overrideRules: true` with a reason, the preview lists exactly
  which rules will be skipped, and the change needs confirmation. GitHub itself decides whether this person may skip
  them (bypass list, admin rights); the server never pretends someone has that right. A second switch on My
  connection, "Allow overriding branch rules" (on by default), turns the override off for that person.

**Consequence to state in the PR and the status note:** a check such as appliance-desk's "only Chris may start an
extra testing build" will accept any agent that uses Chris's God-mode connection, because GitHub sees Chris. That is
the requested behaviour; it means such checks no longer tell Chris and his agents apart.

## Outcome

With a master token and "Act as me" on, every tool call is made as the person, except App-only requests, read-only
connections and passes, which keep using the bot. Each result carries `acting_as`. `github_whoami` shows the mode,
the reason when the bot is used, and the person's own GitHub request allowance. A token that expires or is rejected
puts the connection back on the bot without an error loop, and a write is never silently repeated. Branch rules hold
by default even for admins; an owner or admin can override them on purpose, one confirmed change at a time, with the
skipped rules shown first and recorded.

## How it works today (read these, nothing else)

- `src/github/client.js` — the only place a token is chosen. `credentialFor(ctx, {owner, cred, scope})` (lines
  86–116) resolves the account, applies the refusals (passes, read-only and narrowed scopes never get `M`) and calls
  `ctx.credentials.token({account, cred, scope, profile})`. `githubFor` (147–215) builds one Octokit with that token
  and a `hook.wrap('request', …)` that runs the extra-place check, `authorizeOptionalRequest` for `K`/`P`/`M`, rate
  blocking (`assertNotBlocked`), write spacing (`takeWriteSlot`) and rate recording (`recordRate`), all keyed by
  `account`. In that hook `options.url` is still the route template (`/repos/{owner}/{repo}`), see the comment at
  line 170.
- `src/github/personal-cred.js` — `personalCred(ctx, needed)` already picks `M` over `U` for the person's own account
  when the master token covers the scope. Keep it; GOD-6 widens the same idea to every call.
- `src/tenancy/user-authorization.js` — the signed-in person's credential store: `token({cred:'M'})` (~line 315),
  `masterStatus()` (~line 307, returns `{enrolled, scopes, expires_at}`), `authorizeOptionalRequest` (~line 258; for
  `M` it only requires the GitHub API host).
- `src/github/credentials.js` line ~227 — owner-store connections refuse `M` ("only available on a signed-in
  connection"). Owner-store connections therefore never act as the person; nothing to change there.
- `src/tools/dispatch.js` — `createDispatch` builds the handler context (~line 88) and shapes every result (~lines
  96–113). Nested calls (`callTool`) come back through `dispatch`.
- `src/tools/server.js` — `github_whoami` (~lines 50–90) already shows `master_token`.
- `src/tenancy/public-connect.js` — My connection actions (`manageAction`, list at ~line 429; the `time_zone` action
  at ~line 442 is the pattern for a saved per-person setting with `db.setSetting`).
- `src/tools/pulls-merge.js` — merges check required CI themselves (`readPlan`, `why`), at the exact head.
- `src/db.js` — `change_log` (~line 307), its two `INSERT`s (~lines 1367, 1382) and `finishChange`; `server_settings`
  (~line 363, `getSetting`/`setSetting` ~line 1262) and `gh_rate_state` (~line 342) are per tenant.
- `src/tools/production-guard.js` (~lines 90–97) — how branch protection and rulesets are read.
- `src/tenancy/optional-setup.js` (~line 145–155) — where a saved master token is confirmed.

## Drift check A (fill in the PR description before coding)

| Expected | How to check | Actual | Action |
|---|---|---|---|
| `credentialFor` / `githubFor` as described, one token per Octokit | `sed -n 80,215p src/github/client.js` | | |
| `masterStatus()` returns `{enrolled, scopes, expires_at}`, no login | `grep -n "async masterStatus" -A6 src/tenancy/user-authorization.js` | | |
| No per-person "act as me" setting exists | `grep -rn "act_as" src \| head` | | |
| GitHub App-only routes per inventory: 12 operations under `/app` with `classic_pat: unsupported` | `node -e` over `buildCapabilityInventory().operations` (step 2) | | |
| `blockers(plan,args)` in `src/tools/pulls-merge.js` is pure and synchronous; `readPlan` reads through `octo` | `sed -n 20,48p src/tools/pulls-merge.js` | | |
| Settings and rate state are per tenant, not per person | `grep -n "server_settings\|gh_rate_state" src/db.js \| head` | | |

## Design (decided; implement in this order)

**Everything about "me" is per person, not per tenant.** A tenant (one store) can have several people
(`gh_tenant_memberships`, roles owner/admin/member). `server_settings` and `gh_rate_state` belong to the whole
tenant, so every "me" value is keyed by the person's numeric GitHub id ("subject"), never by tenant:
setting keys `act_as_me.<subject>`, `master_rejected_at.<subject>`, `master_login.<subject>` (they satisfy the
setting-key rule `^[a-z][a-z0-9_.]{0,62}$`; a UUID would not) and rate key `~me:<subject>` (no database check on
that column's format).

### 0. `masterStatus()` tells enough — `src/tenancy/user-authorization.js` (~line 307)

Return `{ enrolled, scopes, expires_at, subject, login }` where `subject` is the GitHub user id already read inside
`currentMaster` and `login` is setting `master_login.<subject>` (may be null). Today an expired token makes
`currentMasterReadback` (`src/tenancy/master-credential.js` ~lines 80–81) return null, so `masterStatus` says only
`{enrolled:false}`. Change: when the stored row is valid in every way except `expires_at <= now`, return
`{ enrolled: false, expired: true, expires_at, subject }`. Add `masterStatus` to the owner-store credentials as
`async () => ({ enrolled: false })` only if it is not already absent-safe (callers already check `typeof`).

### 1. When does a call act as the person? — `src/github/act-as.js` (new, ~150 lines)

Define a local `whole(text, fallback, max)` (same as the private helper in `src/tenancy/usage-cost.js`; it is not
exported anywhere). `export async function actAsFor(ctx, { cred, scope })` returns `{ on: true, subject, login }` or
`{ on: false, reason }` (`reason` may be null). Checks, in this order; the first that fails decides:
1. `cred` is `'I'` or `'U'`. Otherwise `{on:false, reason:null}` (explicit `K`/`P`/`M` stay exactly as today).
2. `masterStatus` exists and returns `enrolled: true` → otherwise `{on:false, reason:null}` (God mode off: no
   reason shown), except `expired: true` → reason "your master token expired on <date>; add a new one on My
   connection".
3. `ctx.connection.profile !== 'read_only'` → "read-only connections always use the app".
4. `ctx.connection.pass !== true` → "service passes always use the app".
5. no `scope.permissions`, `scope.repositories`, `scope.repository_ids` → "this tool asks for a narrowed token,
   which only the app can have". (The universal tools narrow to the target repository, so universal calls with
   `cred:'I'` use the app.)
6. scopes include `repo` (`scopeCovered` from `src/github/personal-cred.js`) → "your master token does not have the
   repo permission".
7. setting `act_as_me.<subject>` is not `'off'` → "Act as me is off on My connection".
8. setting `master_rejected_at.<subject>` is empty → "GitHub rejected your master token; add a new one on My
   connection".
9. rate state `~me:<subject>` / `core`: `remaining === null`, or `remaining > whole(env.GITHUB_PERSONAL_RATE_RESERVE,
   100, 5000)`, or its reset time has passed → else "your own GitHub allowance is nearly used up until <time>".
Cache the answer on the call context (`ctx.actAsCache`) so one tool call reads the settings once.
`export function createActorLog()` returns `{ record({as, note}), summary() }`; `summary()` gives
`{ as: 'you' | 'app' | 'mixed', notes: [≤3 distinct] }` or null when nothing was recorded.

### 2. App-only requests always use the app — `src/github/app-only-routes.js` (generated) + script

- `scripts/build-app-only-routes.mjs` exports `buildAppOnlyRoutes()` and, when run directly, writes
  `src/github/app-only-routes.js` with `APP_ONLY = Object.freeze([...])` of `'METHOD /template'` strings, sorted:
  (a) every operation in `buildCapabilityInventory().operations` with
      `credentialSupport.classic_pat.disposition === 'unsupported'`, as `o.operation.method + ' ' + o.operation.path`
      (today 12, all under `/app`);
  (b) a fixed list kept in the script, citing https://docs.github.com/en/rest/checks/runs and
      https://docs.github.com/en/rest/checks/suites (the inventory marks these `unknown`, so they must be listed):
      `POST /repos/{owner}/{repo}/check-runs`, `PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}`,
      `POST /repos/{owner}/{repo}/check-runs/{check_run_id}/rerequest`, `POST /repos/{owner}/{repo}/check-suites`,
      `PATCH /repos/{owner}/{repo}/check-suites/preferences`,
      `POST /repos/{owner}/{repo}/check-suites/{check_suite_id}/rerequest`,
      `POST /app-manifests/{code}/conversions`, plus every path starting `/installation/`.
  Re-check both docs pages with the web tool first; drop any route GitHub now allows for personal tokens and say so
  in the status note.
- Also export `APP_ONLY_GRAPHQL = ['createCheckRun', 'updateCheckRun', 'createCheckSuite', 'rerequestCheckSuite']`.
- `export function isAppOnly(method, url, query)`: take `new URL(url, 'https://api.github.com').pathname` (the
  parsed `url` from `octokit.request.endpoint.parse(options)`, client.js ~line 171; pagination's next pages are
  absolute URLs with a query string, and some callers pass expanded paths), match it against regexes built from the
  templates (`{param}` → `[^/]+`, anchored) for that method, or the `/installation/` prefix. For `POST /graphql`,
  true when `query` names one of `APP_ONLY_GRAPHQL` as a field.
- Test `tests/unit/god-6-app-only.test.js`: `buildAppOnlyRoutes()` equals the committed `APP_ONLY`; `isAppOnly` true
  for `POST /repos/a/b/check-runs`, `PATCH /repos/a/b/check-runs/5`, `GET /app`, `GET /installation/repositories`,
  `https://api.github.com/app/installations?page=2`, a `createCheckRun` mutation; false for `GET /repos/a/b`,
  `POST /repos/a/b/issues`, a `createIssue` mutation.

### 3. Choose the token per request — `src/github/client.js`

- `credentialFor`: for `cred` `I`/`U`, also call `actAsFor`. When `on`, read the master token with
  `ctx.credentials.token({ account, cred: 'M', profile })`; if that throws or is empty, treat as off with reason "your
  master token could not be read; using the app". Return `{ account, token: null, personal, place }` where
  `personal = { token, subject, login }`, and a function `botToken()` that runs today's path (the original
  `ctx.credentials.token({account, cred, scope, profile})`) once, lazily, and caches it. When not `on`, behave
  exactly as today (`token` filled, `personal` null).
- `githubFor`: build the Octokit **without** `auth` (verified: `@octokit/core` then installs no auth hook; retry
  and throttling re-send the same `options`, so the header survives; paginate and graphql go through
  `octokit.request`, so through this hook). At the top of the existing `hook.wrap('request')`, after the
  `endpoint.parse`, decide:
  `const forced = options.request?.robinsonAs; const asMe = personal && forced !== 'app' && !isAppOnly(method, url, options.query) && !(await mustUseAppForBranch(...))` (step 6),
  then `options.headers.authorization = 'token ' + (asMe ? personal.token : await botToken())`.
  `actual = asMe ? 'M' : cred`. Use `actual` everywhere below in the hook: `authorizeOptionalRequest` runs for
  `actual === 'M'` exactly as today; `takeWriteSlot(ctx.db, \`${account}:${actual}\`)`; rate key (step 4).
  `ctx.actor?.record({ as: asMe ? 'you' : 'app', note })` once per request.
- When there is no app credential (an extra place, GOD-5) the request is `M` as today; if step 6 says the app
  is required, refuse: "Branch rules apply to <branch>, and only the app may write there, but the app is not
  installed on <account>."
- A request needing the app inside the hook (step 6's branch read) is made with
  `octokit.request(route, { ...params, request: { robinsonAs: 'app' } })`, so it still gets the API-version header,
  rate blocking and recording, and never re-enters the "as me" decision.
- Request-shape test: the fake GitHub receives the master token for a normal request and the app token for a
  check-run request from the SAME Octokit, and exactly one `authorization` header each time.

### 4. The person's own request allowance

When `actual === 'M'` and `personal` is set, the rate key is `~me:<subject>` instead of `account` for
`assertNotBlocked`, `recordRate` and `asRateLimited` (extra-place calls without `personal` keep `account`). In the
message built by `rateLimited` (`src/github/rate.js`), show "your own GitHub login" instead of a key starting with
`~me:`.

### 5. Expired, removed or rejected token — back to the app without a loop

- Expired or removed: step 1 already turns it off with the reason.
- **401** to a request sent as `M` (in the hook's `catch`, before `asRateLimited`): save
  `db.setSetting('master_rejected_at.<subject>', ISO time)`. Then:
  - read (`!write`): send the same request once more with `robinsonAs: 'app'` and return that answer; note "GitHub
    rejected your master token; this answer came from the app".
  - write: never repeat (A8). Throw `GithubClientError('no_credentials', 'GitHub rejected your master token, so
    nothing was changed. Calls now use the app. Run it again, or add a new master token on My connection.')`. (A
    `GithubClientError` is classified `rejected` by `define-github-write.js` ~line 12, so the request key is released
    and running it again works.)
- **403/404** to a read sent as `M` (the token may lack a scope the app has): repeat once with the app and note "your
  master token could not read this; the app did". This is not a widening: it is exactly the answer the connection
  gets with God mode off. Writes are never repeated; if a write's 403 carries an `x-github-sso` header, add "Authorize
  your master token for SSO on GitHub, or turn Act as me off."
- **New token clears the rejection:** `enrollMasterCredential` (`master-credential.js` ~line 68) also returns
  `login: who.login`. In `src/tenancy/optional-setup.js`, right after the master save succeeds (~line 151, after
  `currentMasterReadback`), with `scope.db`: `setSetting('master_login.<subject>', login)` and
  `setSetting('master_rejected_at.<subject>', '')`.

### 6. Branch rules: held by default, overridden only on purpose

**6a. Default — rules hold.** An admin's personal token may be allowed by GitHub to skip branch protection or
rulesets that the app cannot skip. Without an explicit override (6b), the change of credential must not become a
silent bypass.
`async function mustUseAppForBranch(...)` in `act-as.js`, called from the hook only when the request would be `M`:
- **Always the app** (no read needed): tags and releases (`POST`/`PATCH .../releases…`, any git ref outside
  `refs/heads/`, `POST .../git/tags`), and the GraphQL mutations `mergePullRequest`, `mergeBranch`,
  `createCommitOnBranch`, `updateRef`, `updateRefs`, `createRef`, `deleteRef`, `updatePullRequestBranch`.
- **The app when the branch has any rule or protection**: `PUT`/`DELETE .../contents/{path}`,
  `POST`/`PATCH`/`DELETE .../git/refs…` on `heads/`, `POST .../merges`, `PUT .../pulls/{n}/merge`,
  `PUT .../pulls/{n}/merge-async` if present, `PUT .../pulls/{n}/update-branch`, `POST .../branches/{branch}/rename`,
  `POST .../merge-upstream`. Branch = `options.branch`, the `heads/<name>` part of `options.ref` or the URL, or
  `options.base`; for pull-request routes, read the PR with the app to get `base.ref`; when none is given, the
  repository's default branch (read with the app). Then read, with the app (`robinsonAs: 'app'`),
  `GET /repos/{owner}/{repo}/branches/{branch}` (`protected`) and
  `GET /repos/{owner}/{repo}/rules/branches/{branch}` (any entry) — the same two reads the production guard uses
  (`src/tools/production-guard.js` ~lines 90–97). Protected, any rule, or any read error → the app. Note "branch rules
  apply to <branch>, so this change was made by the app".
- This covers every tool, including the universal ones and any tool that asks for `M` explicitly, because it runs in
  the hook whenever the actual credential is `M` and the person is acting as themselves.
- **Merge tool, readable reason first** (`src/tools/pulls-merge.js`): in `readPlan` (~lines 24–31) set
  `plan.actsAsYou = (await actAsFor(ctx, { cred: 'I' })).on` and read the pull request with the app. In the pure
  function `blockers(plan, args)` (~line 34), when `plan.actsAsYou` is true and `mergeable_state` is not one of
  `clean`, `unstable`, `has_hooks`, add: for `unknown`/null "GitHub is still working out whether this can be merged;
  read the pull request again in a moment"; otherwise "GitHub's rules for <base> are not met yet (for example a
  required review). Acting as you could skip them, so it is not merged." (`workflows-merge.js` merges through
  `github_pr_merge` via `callTool`, so it needs no change.) When the merge does go ahead on a branch with rules, the
  hook sends it with the app anyway; that is intended: rules are enforced exactly as for the app.

**6b. Deliberate override by an owner or admin.**
- **New optional arguments** (shared helper `OVERRIDE_ARGS` in `act-as.js`, added to each tool's input schema):
  `overrideRules: boolean` and `overrideReason: string` (10–200 characters, required when `overrideRules` is true).
  Tools: `github_pr_merge`, `github_pr_merge_async` (`src/tools/pulls-merge.js`), `github_content_put_file`,
  `github_content_delete_file`, `github_content_push_files`, `github_git_update_ref` (`src/tools/code-write.js`),
  `github_branch_merge`, `github_branch_delete` (`src/tools/branches.js`). Others (tags, branch rename, update
  branch, universal tools) stay rule-bound; listed in ROADMAP.
- **Allowed only when ALL hold**, checked in `export async function overrideAllowed(ctx, args)` (in `act-as.js`), in
  this order, each with a plain refusal: `overrideReason` present → "Say why you are overriding the rules
  (overrideReason)"; `actAsFor(ctx,{cred:'I'}).on` → "Only your own GitHub login can skip branch rules; add your
  master token and turn Act as me on" (the app is never on a bypass list, so this is exact); setting
  `rule_override.<subject>` is not `'off'` → "Overriding branch rules is off on My connection"; connection mode is
  `production` → "Overriding rules needs a production connection". (Read-only connections and passes already fail
  `actAsFor`.) The production guard already classifies these branches as production, so `confirm: true` is required
  as usual; nothing new is needed for that.
- **Preview** (the `preview()` of each tool, before confirmation): read with the app
  `GET /repos/{owner}/{repo}/rules/branches/{branch}` and `GET /repos/{owner}/{repo}/branches/{branch}/protection`
  (a 404 means none; a 403 means the app may not read it: list "branch protection: could not be read") and, for merges, the existing `ciState`. List what will be skipped in plain words, for example:
  "Overrides on main: 1 required approval (0 given); required check 'ci' (failing). GitHub will record christcr2012 as
  skipping them. Reason: hotfix for outage." If nothing would be skipped, say "No rules would be skipped; the override
  is not needed" and proceed normally.
- **Merges with an override:** keep refusing a changed head (`expectedHeadSha`), a closed or merged pull request and
  conflicts (`mergeable === false`); turn "required checks not green" and the 6a `mergeable_state` refusal into
  preview lines instead. Send `PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge-async` with
  `{ sha: expectedHeadSha, merge_method, merge_action: 'direct_merge', bypass_rules: true }` (GitHub's own explicit
  bypass field; check the pinned description with `node scripts/openapi-find.mjs "merge a pull request
  asynchronously"`), as the person, with `request: { robinsonAs: 'me' }`. `github_pr_merge` with an override uses the
  same request and reports merged or pending like `github_pr_merge_async`. This is the ONLY place the server may send
  `bypass_rules`.
- **Direct branch writes with an override:** send as the person with `request: { robinsonAs: 'me' }`, which makes
  the hook skip `mustUseAppForBranch` for that one request (`robinsonAs: 'me'` is honoured only when `personal` is
  set; otherwise refuse as above). GitHub then applies its own rule for that person.
- **GitHub says no:** a 403/405/409/422 whose message mentions rules, protection or bypass → "GitHub does not let you
  skip the rules on <branch> (you are not on its bypass list, or the rule cannot be bypassed). Nothing was changed."
  Never repeat the write and never retry as the app.
- **Record it:** the change-log summary starts `OVERRIDE (<reason>):`, `acted_as = 'you'`, and the result has
  `rules_overridden: [<the preview list>]`.
- **Docs to change in the same PR:** `AGENTS.md` engineering rule "Never send `bypass_rules`" becomes "Never send
  `bypass_rules` except GOD-6's deliberate override (`overrideRules` with a reason, previewed, confirmed, as the
  person). Agents building this project never set `overrideRules` on Chris's real repositories; scratch only.";
  `docs/AI-PR-READ-FIRST.md` item 10 the same; the header comment and descriptions in `src/tools/pulls-merge.js`
  ("Rules are never bypassed" → "Rules are not bypassed unless you ask with overrideRules"); the test that greps
  the fake-GitHub log for `bypass_rules` now allows exactly the override merge request and nothing else.
- **My connection:** a second switch under Act as me, "Allow overriding branch rules: on/off" (action
  `rule_override`, setting `rule_override.<subject>`, default on), with the line "When on, your assistant can skip a
  branch's rules for one change at a time, only when it asks to, shows you which rules, and you confirm. GitHub still
  decides whether you may."

### 7. Show who acted — results, `github_whoami`, the change log

- **One actor log per top-level call:** `createDispatch` creates `actor = createActorLog()` only when the incoming
  call has none, passes it in the handler context, and passes the same `actor` into nested `dispatch` calls made by
  `callTool` (~line 87), so a workflow's result covers its inner calls.
- **Result field:** after shaping and before `containsCredential` (~lines 113–114), when `actor.summary()` is not
  null and `structuredContent` is an object, add `acting_as` and, if there is a note, `acting_as_note`, then rebuild
  the `content` text from the new `structuredContent`. Values: `'<login> (you)'`; `'Robinson GitHub MCP app'` when
  the app's installation token acted; `'<login> (you, through the app)'` when the app credential was the person's
  own App user token (`U`, as for invited members); for a mix, `'<login> (you); some steps by the app'`. If `login`
  is null, read `GET /user` once with `M`, save `master_login.<subject>`, and use it. Keep both fields short.
- **`github_whoami`** gains `acting_as: { mode: 'you' | 'app', login, reason?, personal_rate: { remaining,
  resets_at } }` from `actAsFor` and the `~me:<subject>` rate state. The existing expiry reminder stays.
- **Change log:** `ALTER TABLE change_log ADD COLUMN IF NOT EXISTS acted_as TEXT` in `src/db.js` `initSchema`.
  The INSERTs run before the request is sent, so fill it in `finishChange` (called from `src/core/write.js` ~lines
  217 and 230) with `ctx.actor?.summary?.()?.as ?? null` (`src/core` stays generic: it only passes a value from the
  context). Add it to `normalizeChange`/`changeView` so `github_recent_changes` shows it.

### 8. The switch on My connection

- New action `act_as_me` in `manageAction` (allowed list ~line 429 of `src/tenancy/public-connect.js`), value `'on'`
  or `'off'`, saved as `db.setSetting('act_as_me.' + subject, value)` where `subject` comes from the flow's
  `identityId` through the directory (`getPilotVerifiedSubject(tenantId, identityId)`, as `optional-setup.js`
  uses). Copy the `time_zone` action's shape.
- Shown only when a master token is added: "GitHub shows: **you (<login>)**" or "the Robinson GitHub MCP app", and a
  button "Act as me: turn off" / "turn on". Under it: "When on, GitHub records you as the one who made each change.
  Checks that only an app may post, and changes to branches with rules, still come from the app." Escape every
  value with `h()`; no scripts; fits a 412px phone.
- `docs/TOOL-CATALOG.md`: no new tool; update the `github_whoami` row ("shows who calls act as").

## Tests (fake GitHub; fake values only, e.g. `ghp_FAKEmaster…`)

`tests/unit/god-6-act-as.test.js` (copy the setup of the GOD-2 and GOD-5 unit tests:
`grep -ln "personalCred\|extra place" tests/unit/*.test.js | head -3`):
1. Master token added, switch default → `github_issue_create` reaches the fake with the master token; result
   `acting_as` `'<login> (you)'`; change log `acted_as = 'you'`.
2. No master token → app token, `acting_as` app, no `acting_as_note`.
3. Read-only connection and a service pass → app, reason in whoami, and no request ever carries the master token.
4. Universal GET (narrowed) → app with the narrowed-token reason.
5. One tool call that reads a commit and creates a check run → read as you, check run by the app, `acting_as` mixed.
6. Two people in one tenant: person A's switch off and A's rejected token do not affect person B.
7. Expired token → app with "expired on <date>".
8. 401 on a read as `M` → one repeat with the app, answer returned, `master_rejected_at.<subject>` saved, next call
   app; saving a new token clears it and the next call is as you.
9. 401 on a write as `M` → the fake records exactly one write request; plain "nothing was changed"; the same
   `requestKey` can run again.
10. 403 on a read as `M` → one app repeat; 403 on a write → no repeat; with `x-github-sso` the SSO sentence appears.
11. `~me:<subject>` remaining 50 → app with the reset time; app rate key untouched by `M` calls and vice versa.
12. Merge as you with green checks and `mergeable_state: 'blocked'` → refused, no merge request sent; `unknown` →
    "still working out"; `clean` → merged; without a master token → today's behaviour exactly.
13. Contents `PUT` as you: unprotected branch with no rules → master token; protected branch → app; rules non-empty →
    app; rules read fails → app. Release create and a `createCommitOnBranch` mutation → always app. Extra place with
    a protected branch → refused with the "app is not installed" message.
14a. Override merge: as you, `overrideRules: true` with a reason, failing checks and `mergeable_state: 'blocked'` →
    preview lists the skipped rules; confirm sends exactly one `merge-async` request with `bypass_rules: true` and the
    exact `sha`, carrying the master token; change log summary starts `OVERRIDE (`.
14b. Override refused: no reason; Act as me off (app); `rule_override.<subject> = 'off'`; preview-mode connection;
    each gives its message and sends no write.
14c. Override on a direct write: `github_content_put_file` to a protected branch with `overrideRules` → sent with the
    master token (not the app); without it → the app (6a).
14d. GitHub refuses the override (fake answers 403 "bypass not allowed") → plain message, exactly one write request,
    no app retry.
14e. The fake-GitHub log contains `bypass_rules` only in the 14a request across the whole suite.
14. Pagination: page 2 of an `/app/installations` list (absolute URL) is still recognised as app-only.
15. `github_workflow_merge_when_green` (nested `callTool`) result carries `acting_as` from its inner merge.
16. `github_whoami` shows `acting_as` (mode, login, personal_rate).
Browser (`tests/browser/sign-in.test.js`): My connection with a master token shows the switch; off/on works; the page
fits the phone (`fitsScreen`). Write-contract suites (`runWriteContract`) stay green unchanged (no master token, so the
app path).

## Done when
- [ ] All unit cases (1–16, 14a–14e) and the browser case pass; `npm run check`, `npm run test:db`, `npm run test:shapes`,
      `npm run test:browser` green; `ci` and `release-policy` green at the exact head.
- [x] `node scripts/build-app-only-routes.mjs` output committed and its in-sync test passes (`tests/unit/god-6-app-only.test.js`).
- [ ] Self-review records each `docs/AI-PR-READ-FIRST.md` constraint, in particular: no token in results or logs
      (`containsCredential` still runs), `M` never reaches read-only or pass connections, no write is repeated, branch
      rules cannot be skipped by the credential change.
- [x] Status note `docs/status/2026-10-24-god-6.md` (plain English) including the "only Chris" consequence above.
- [ ] After release, ACC-1 on the scratch account (production on there): one issue created and closed again acting as
      Chris, read back showing `user.login` = Chris; one check run on a scratch commit showing the bot; result in
      `docs/developer-evidence.json`.

## Not in this card (`docs/ROADMAP.md`)
A per-call "as the bot this once" argument; acting as the person for tools that narrow their token per call (would
need a URL-inside-target check like GOD-5's `assertPlaceRequest`); fine-grained personal tokens as the "me" credential.
