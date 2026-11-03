# 2026-11-02 — public client check widening is race-safe (PUB-10 follow-up)

Found while reading a red `browser (home-page)` shard on PR #558: the PUB-10 schema step that widens
`gh_public_clients_client_id_check` dropped and re-added it in two statements, so concurrent schema starts could fail with
Postgres 42710 and the sign-in registration answered 503 (reproduced on main 8da56e71, about half of local runs). Fixed
in `src/tenancy/directory.js` with one idempotent `DO` block; new `tests/db/public-clients-check-race.test.js` (fails
before the fix, passes after); browser load smoke 6/6 locally. Production is affected the same way until released.
Next: merge, then merge main into PR #558.
