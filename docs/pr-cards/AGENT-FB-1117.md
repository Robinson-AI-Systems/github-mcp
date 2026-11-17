# AGENT-FB-1117: problems found while retiring Dokploy, fixed

## Owner request 2026-11-17

Chris: "deal with the things that are still open and address all the problems that you found."

## Outcome and acceptance

- **ARCHIVED-ERR-1.** A write to an archived repository answers `archived_repository`, which says the repository is archived and read-only and how to unarchive it. It no longer says "the credential lacks access / SAML". Acceptance: `tests/unit/errors.test.js`.
- **REPLAY-STALE-1.** A repeat that falls inside the 10-minute replay window is sent as a new change only when all of these hold:
  - the same tool changed the same target in between (archive, unarchive, archive);
  - the earlier change finished;
  - the target's current state no longer matches what the earlier change left.
  An immediate repeat, a caller's own `requestKey`, an unfinished change and resumable tools all keep the plain replay, so a retried create can never become a duplicate. Acceptance: `tests/unit/write-core.test.js`, the REPLAY-STALE-1 cases.
- **DOWNLOAD-REUSE-1.** `github_repo_download` skips a reused workspace that is no longer ready (expired, stopped) and clones a fresh copy. A clone the worker cannot prepare becomes a plain refusal that says why, never "unconfirmed" with no address. Acceptance: `tests/unit/repo-download-contract.test.js`.
- **SEARCH-EXACT-1.** A zero-hit code search scoped to one repository returns `exact_search`: the `github_repo_download` call plus the `grep` to run, because the code index can miss files. Acceptance: `tests/unit/f3-search.test.js`.
- **SCAN-ALL-FILES-1.** A push refused by the content scanner names every refused file, so one round of fixes clears them all. Acceptance: `tests/unit/git-remote.test.js`.
- **NO-SHARED-HOST-1.** With Dokploy retired, every Git machine is owner-only. A non-owner now gets a plain, non-retryable `native_no_shared_host` answer that names the API tools that still work, instead of "busy, try again in a minute". Acceptance: `tests/unit/worker-pool-owner-hosts.test.js`.

## Drift check

Changes:
- `src/tools/errors.js`
- `src/core/write.js`, `src/db.js`, `test/helpers/fake-db.js`
- `src/tools/native-git.js`
- `src/tools/search.js`
- `workers/native-git/remote-hook.mjs`
- `src/native-git/pool.js`, `src/native-git/pool-audience.js`
- tests and docs

No migration: the new query reads existing `change_log` columns.
