# MAP-CLAIMS-1: every count, date and policy claim in the relational map is tied to its source

## Owner request 2026-11-20

The Second Shift run #2 findings (second-shift-20261120-094156) were handed over at Chris's direction: the relational map stated counts, dates, live-state claims and policy rules that nothing re-checked.

## Outcome and acceptance

- `scripts/check-map-counts.mjs` is the same dependency-free file in vercel-mcp, stripe-mcp, google-workspace-mcp, neon-mcp and github-mcp. Its new checks:
  - Counts are checked as number+label pairs (each `counts.json` entry has a `label`), so two counts swapping numbers is caught.
  - A count is still recognised with an identifier between the number and the noun ("253 registered vercel_* tools"). MAP-COUNTS-1 missed exactly this form.
  - Grouped numbers (1,243), approximations ("~", "about") and prefixed forms (-243, 0.243) never pass as the plain statement.
  - New `docs/relational-map/claims.json` ties each dated, live-state or policy claim to a source file and pattern (a STATUS entry, a code constant, a workflow line or a test name). The checker fails if the map no longer states the claim or the source no longer says it.
  - Every date (YYYY-MM-DD) in a map file must sit inside a registered claim. A date with no source fails the check.
- Proof the check bites: putting back a stale count, or adding an untied date, fails with the reason.

## Drift check

Docs and a check only; no tool or behaviour change.

## This repo

- Finding 11: already answered by MAP-COUNTS-1 (#669). `scripts/count-catalog.py` and `scripts/profile-counts.mjs` regenerate the counts in CI. This PR adds labels, so the three profile counts can't silently trade places. It also registers the "6 universal tools" count, which was stated but never checked.
- The five github lows:
  - "~29 tables" and "~173 modules / ~500 tools" were already replaced by checked exact counts in #669;
  - the login lockout (5 attempts per 15 minutes) is now tied to `MAX_FAILED_LOGINS` / `LOCKOUT_WINDOW_MINUTES` in `src/core/oauth.js`;
  - the rack-hosting date is tied to `docs/STATUS.md` (Hosting, 2026-11-08);
  - the 20:07 America/Denver promotion is tied to `daily-live.yml`.
  - "The rack serves `live`" is a fact about the rack, not this repo, so CI can't check it. It was checked live on 2026-11-20: Rack Control's branch tracking shows github production following `live`, released at 1a47dd60.
- The root `README.md` tools line now states its counts as checkable pairs too.
