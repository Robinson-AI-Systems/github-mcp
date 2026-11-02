# CONN-FB-1 — Connector feedback from the fac-ultra build (GitHub API side)

## Owner approval 2026-11-02

Chris relayed his coding agent's fix list in chat on 2026-11-02 after about twenty PRs on a collaborator repository reached
through an extra place. This card covers the GitHub API side of that list (items 3, 7, 8, 9, 11, 12, 14 for non-workspace
tools, 15, 17, 18, 19, 20) plus the coordinator's items "PR results short on detail" and "missing branch in PR/merge/push
tools". The native-workspace items (1, 2, 4, 5, 6, 10, 13, 14 for workspace tools, 16, 21) are another builder's card.

## Outcome and acceptance

Outcome: an agent can wait for CI inside the connector, push and merge on a collaborator repository reached through a
place limited to named repositories, commit npm lockfiles, and read clearer results and errors. Accepted when
`tests/unit/conn-fb-1.test.js` passes through the dispatcher against the schema-validated fake GitHub, the existing
credential-detector, extra-place, error-wording and write-contract tests still pass unchanged, and the compact listing
stays under its 6,000-token budget.

## What changed and why

| Item | Cause found | Change |
|---|---|---|
| Wait for CI (3) | No tool waited; agents polled by hand | `github_check_wait` (default list): polls the shared exact-head CI helper every 6 s for up to 45 s; red stops early; `still_running` carries `resume.arguments`. `merge_when_green` takes `waitForChecks`. "CI usually starts within a minute" wording. |
| Lockfile refused (7) | The database-password rule matched the npm package name `pgpass` (`"pgpass": "1.0.5"`, `"node_modules/pgpass": {`), both in text and in the parsed-JSON key walk | A version, version range or `{`/`[` assigned to such a key is not a password. Every existing positive test is unchanged; new lockfile negatives. `credentialLocations()` names line and rule; native `write_file` refusals use it. |
| Push refused on a place (9) | `assertPlaceRequest` refuses every GraphQL request on a place limited to named repositories; `github_content_push_files` uses GraphQL `createCommitOnBranch`, branch creation uses REST | `pinRepositoryQuery()` registers this server's own fixed documents with a selector for the one repository their variables name (repository/branch names only, never node ids). The client checks that repository against the place's list; the commit also gets the REST path's branch-rules check. Any other GraphQL text stays refused, now with a plain reason. |
| Threads "could not be verified" (8) | Same GraphQL refusal for `github_pr_get`'s thread query on a limited place | Thread queries pinned. Unknown threads still block; the reason is carried into the blocker. More than 100 threads with none unresolved on page one is reported unknown, not zero. |
| Stack "chain is broken" (8) | A sibling PR (same base) was listed | The refusal says the PR is a sibling, or which branch it is based on, and lists the chain. |
| Rate block lists other accounts (11) | The per-call collector records every request made during the call, including the people guard's member reads of every connected organization (a PR create reads all of them) | `meta.github_rate` keeps only the acting account(s) (owner arguments, else the default account); another account stays only when blocked or throttled. |
| Missing branch (12) | `GET /commits?sha=<missing>` answers 404 "No commit found for SHA"; the writers' own "The branch X does not exist" refusals had status 404 and were explained as access problems | Both forms are `ref_not_found`. |
| Terse wrong-shape errors (14) | Validator said only `Unknown argument: x.` | It lists the valid arguments (at that nesting level). The run-log summary accepts `pr`/`ref`. |
| Preview read like failure (15) | `open_pr` mapped every non-applied status to "do not retry an uncertain write" | Previews return `status: preview` with "Nothing was sent"; refusals carry their reason. |
| PR result detail | `open_pr`/`pr_create` returned few fields | number, URL, state, draft, head/base, head SHA, base SHA, head repository, mergeable/mergeable_state. |
| Thin failed-job logs (17) | Only the generic runner line was an error line | `lines_before_failure` (25 lines before it, from the job's own log); job log accepts response field names and returns a `continue` call. |
| Reading (18–20) | Line window needed both ends; batch cut whole-text results; list lacked `merged` | `startLine` alone reads 200 lines; folders point at `github_content_get_tree`; batch returns `call_alone`; `pr_list` adds `merged`. |

## Compact listing budget

`github_check_wait` is in the default list. The compact listing is about 5,930 of 6,000 tokens; the wait tool's `base`
argument was left out (it uses the PR base or default branch) to fit.

## Drift check

No new credential, permission, write path or owner setting. The place limit is unchanged: only the repositories the
person listed are reachable, now by the same rule for REST and for this server's pinned GraphQL documents.
