# LIMITS-MATCH-GITHUB-1: GitHub Unleashed adds no usage limit of its own

## Owner ruling 2026-11-18

Chris, after learning the "busy" replies came from GitHub Unleashed's own limits, not GitHub's: "I think that's ridiculous ... The capability needs to match GitHub. If I ever decide to monetize, then I will probably monetize usage, and then I would gate different usage limits for monetization purposes."

## Outcome and acceptance

- **Defaults are now no limit of ours** (null) for: private-account calls per minute (was 120 per app, 600 total), public calls per day (was 5,000 — GitHub's hourly number), public changes per hour (was 300), saved-result bytes per day (was 8 MB / 40 MB) and active saved results (100 / 400), pending background jobs (8 / 64). GitHub's own limits (about 5,000 API calls an hour per account, plus its secondary limits) are the only limits; the connector already reports them and says when to retry.
- **Every knob stays settable** for paid tiers later: a tenant policy (`saveTenantRuntimePolicy`, owner setup page) or `PUBLIC_FREE_CALLS_PER_DAY` / `PUBLIC_FREE_WRITES_PER_HOUR` (`unlimited`, `none`, `off` or empty = no limit). A limit that is set is still enforced exactly as before.
- **Saving a policy stores only the limits actually set**: storing every field had frozen the defaults of the day into a tenant.
- **Kept on purpose**: sign-in attempt limits (30 / 150 a minute — guessing protection, not usage), the 24-hour life of saved results and jobs, a 16 MB technical ceiling per saved result (was 256 KB; a bigger list keeps the rows that fit, KEEP-PART-1), and the public spend pause (`PUBLIC_COST_PAUSE_CENTS`, a money guard, not usage).
- `/limits` says plainly that GitHub Unleashed adds no limit of its own and shows "No limit of ours; GitHub's own limits apply" for each unset knob.
- Tests: pub-3-runtime (+1), pub-5b-usage-hook, public-limits-page, read-pipeline, browser sign-in; database suite 289/289 on a throwaway Postgres (capacity tests now set an explicit tier and prove it is enforced).

## Drift check

No tool added or removed. Default capacity values, the limits page text, and policy storage.
