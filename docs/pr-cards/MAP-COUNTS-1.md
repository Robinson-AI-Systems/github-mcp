# MAP-COUNTS-1: the relational map's numbers are checked against the code

## Owner request 2026-11-18

Chris: "Yes" to dealing with the Second Shift 48-hour run's relational-map findings (finding 1 here, the same shape in vercel-mcp, stripe-mcp, neon-mcp, google-workspace-mcp and penpal).

## Outcome and acceptance

- `scripts/check-map-counts.mjs` (no dependencies, the same file in every fleet repo) reads `docs/relational-map/counts.json`. For each count it computes the real value from the code at this commit (a file glob, a regex count, or a number from a command), checks the value matches, and checks the listed map files state it. Any other count in the map ("<n> tools/modules/tables/…") or any "~" approximation fails, so no unchecked number can slip in.
- It runs in `npm run check` (CI).
- Running it found real drift: the profile counts in the map **and in the README** said Read-only 210, Everyday 299, Full 504; the code and the live home page say 214, 305 and 516. "~29 tables" is really 32. Both fixed; "~173 modules" is now the exact, checked 173.
- `scripts/profile-counts.mjs` prints the per-profile counts from the registry (the same function as the home page).
- Proof the check bites: changing a value in `counts.json` makes it fail with the code's real number.

## Drift check

Docs and a check only; no tool or behaviour change.
