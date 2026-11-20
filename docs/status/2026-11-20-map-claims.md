# 2026-11-20: the map's dates and rules are now tied to their sources (MAP-CLAIMS-1)

The Second Shift review (run #2) found that the relational map states dates, live-state claims and rules (the login lockout, the release time) that nothing re-checks. The map check now also reads `docs/relational-map/claims.json`: each claim names the file and pattern that backs it, and CI fails if the map or the source changes without the other. Every date in the map must be tied to a source.

The count check is stricter too. Each count must appear with its label, so two numbers can't silently trade places. A count written with an identifier before its noun is caught. The "6 universal tools" count was stated but never checked, and is now checked. No tool change.
