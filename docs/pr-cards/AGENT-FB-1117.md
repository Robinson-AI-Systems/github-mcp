# AGENT-FB-1117: problems found while retiring Dokploy, fixed

## Owner request 2026-11-17

Chris: "deal with the things that are still open and address all the problems that you found."

## Outcome and acceptance

- **ARCHIVED-ERR-1.** A write to an archived repository answers `archived_repository`, which says the repository is archived and read-only and how to unarchive it. It no longer says "the credential lacks access / SAML". Acceptance: `tests/unit/errors.test.js`. Since the Second Shift review (2026-11-18, finding 3) it matches only a 403 carrying GitHub's whole sentence "Repository was archived so is read-only" — the text real 403s for writes to archived repositories carry (seen verbatim in third-party client logs, e.g. Jira's DVCS connector `RequestException: Repository was archived so is read-only. (403)` and github/safe-settings PR 988) — not either half on its own, and never on another status.
- **REPLAY-STALE-1.** A repeat that falls inside the 10-minute replay window is sent as a new change only when all of these hold:
  - the same tool changed the same target in between (archive, unarchive, archive);
  - the earlier change finished;
  - the target's current state no longer matches what the earlier change left.
  An immediate repeat, a caller's own `requestKey`, an unfinished change and resumable tools all keep the plain replay, so a retried create can never become a duplicate. Acceptance: `tests/unit/write-core.test.js`, the REPLAY-STALE-1 cases.
  The cross-tool case is intentional (Second Shift review 2026-11-18, unproven item): when a *different* tool changed the target in between, the repeat is still a replay, because the server cannot tell "undo then redo" from "retry" across tools, and a duplicate create is the worse mistake. It is bounded: only inside the 10-minute window, and the answer says `status: "replayed"`, `replayed: true` with the original `requestKey`; a caller who means a new change passes its own `requestKey`.
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
