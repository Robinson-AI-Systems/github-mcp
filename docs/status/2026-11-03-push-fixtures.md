# 2026-11-03 Push and write gates accept the documented FAKE test tokens (PUSH-FIXTURE-1)

- Pushing or writing a test file that uses FAKE-prefixed GitHub tokens (what AGENTS.md tells builders to use) is no
  longer refused by the git remote, workspace upload, direct git host, `github_repo_change` or workspace `write_file`.
  Every other credential shape is still refused, and text returned to AIs still hides the fakes.
- Two comments in `src/github/content-protection.js` were reworded (owner-approved) so that file passes the gate that is
  live on `main`; before this the scanner's own source could not be pushed through it.
- Verified: `tests/unit/push-fixture-tokens.test.js` (7 tests, including an end-to-end git push), the git remote,
  git direct, repo change, native upload and content-protection suites, the full unit suite and `npm run check`; every
  changed file was also scanned with main's gate.
- Not done: merged source is not released; the fix reaches agents after the next daily release to `live`.
