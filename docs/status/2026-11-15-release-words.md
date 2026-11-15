# 2026-11-15: a refused release says what was missing

- Owner feedback 2026-11-15: a manual release (`owner_release`) without `expected_main_sha` failed with
  "Scheduled or explicitly owner-authorized checked main only", which did not name the missing input.
- Now: the release step names the reason (here: "needs expected_main_sha", plus main's current commit to copy),
  and the workflow's input descriptions say `expected_main_sha` is required with either release switch. The rule
  itself is unchanged: an owner release still ships only the exact commit named.
- Tests: `.github/release/promote-live.test.mjs` (RELEASE-WORDS-1).
