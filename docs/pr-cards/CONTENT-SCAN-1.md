# CONTENT-SCAN-1: the contents-API writers scan for secrets; the repository scans itself in CI

## Owner request 2026-11-14

Chris approved two items from the 2026-11-03 content-protection follow-ups: give `github_content_push_files` the same
content scan as every other write route, and have CI scan this repository's own source with the push gate.

## Outcome and acceptance

- **Contents-API writers.** `github_content_put_file`, `github_content_push_files` and `github_content_edit_files` now
  refuse credential-shaped text exactly as a git push does. They use the same rules (`blockingPushFindings`), allow
  documented FAKE fixtures, and honour the owner's exact push exceptions for that path. A value already in the file on
  the branch does not block an edit elsewhere in that file, because committing it again adds no new exposure. The
  refusal happens at preview time, before anything is written. It names the path, line and rule, never the value, and
  prints the exact `github_secret_scanner` exception call.
- **Self-scan in CI.** `scripts/self-scan.mjs` runs inside `npm run check` (under a second) over every tracked text
  file. Deliberate values are listed in `docs/scanner-self-exceptions.json` as value fingerprints with reasons:
  - the CI throwaway Postgres service password;
  - the scanner's own test samples.
- **The scanner itself (CODE-REF-1).** Code that passes a password along is no longer read as a password:
  `password: token })`, `password = basicPassword(...)` and `password = cfg.db.password`. These false positives had
  refused unchanged pushes of `src/github/wiki-git.js` and `workers/native-git/direct.js`. Real values are still
  flagged, in connection strings (`Password=abc;`) and in YAML-style config.
- **DOC-PLACEHOLDER-1.** On pushes, the bare word for a password in a sample address (`user:pass@`) counts as a
  placeholder. Reads still hide it.

Accepted by `tests/unit/content-scan-1.test.js` (7 tests). The scanner suites (474 tests) are unchanged and pass.

## Drift check

Changes: `src/tools/code-write.js`, `src/github/content-protection.js`, `scripts/self-scan.mjs`, `package.json`,
`docs/scanner-self-exceptions.json`, tests and docs.
