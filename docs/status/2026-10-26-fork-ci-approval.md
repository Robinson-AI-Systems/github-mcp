# 2026-10-26 FORK-CI-1 — guarded approval of public fork CI

Owner clarified protections prevent accidents/extra deployments, not intentional PR workflows. This branch adds a reviewed exact-PR/head/run first-time fork CI approval as a normal guarded operation, with owner confirmation, workflow safety inspection and readback. It does not weaken locked/protected rows, waive checks, spend on private CI, merge, or release.

Code and synthetic contract tests committed for required ci/release-policy on exact head. No local full-test runner is available to this connector session; no pass claimed until GitHub jobs finish. Database schema unchanged; existing journal handles repeats. The actual David2024patton #402/#403 runs remain unapproved, and live activation waits for scheduled checked deployment.
