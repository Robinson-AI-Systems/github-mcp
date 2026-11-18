# 2026-11-18: the map's numbers are now checked (MAP-COUNTS-1)

The relational map (and the README) said how many tools each profile has, but nothing checked those numbers, and they had gone stale: 210/299/504 when the code and the live home page have 214/305/516. The table count was "~29" when it is 32.

A new check, run in CI, now computes every number the map states from the code and fails if any differ, or if the map states a number it doesn't check. The numbers are fixed.
