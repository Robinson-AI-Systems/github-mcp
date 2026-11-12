# Second Shift sweep-orphan hardening — 2026-11-12

State: IN PROGRESS — branch `ai/vivienne/second-shift-sweep-orphan`, PR pending at
note time; head and CI recorded in the PR.

What changed: the 2026-11-12 Second Shift review's Critical finding (PR #608,
SWEEP-ORPHAN-1) verified REAL against the shipped code and hardened in place —
`src/playground/manager.js` (full-identity inventory matching + a second confirming
read before any orphan retirement; see the SWEEP-ORPHAN-1 card addendum) and
`tests/unit/playground-sweep-orphan.test.js` (four new cases, one updated).

Live-state check (2026-11-12, read-only via the connector): the one record the
shipped logic has ever retired is the genuine Nov-8 orphan `job_b4dc31759005e8d8`
(read back 2026-11-11: exactly one orphan-retired row store-wide); it no longer
exists as an active workspace. The risk was in the logic, not in a past misfire.

Proof so far: bench run `ss608-sweep-tests2` (fleet ledger) — the sweep-orphan,
manager-repin, stuck and warm-runtimes suites, 49/49 green on the assembled tree.
Full `npm run check` and the complete unit suite run on the bench before push;
`ci` + `release-policy` at the exact head gate the merge. No release is performed
by this pass — the fix rides the normal train.

AI-PR-READ-FIRST, for this guard change: no credentials, accounts or access are
touched; no journal/replay surface changes (the terminal write is the existing
orphan write plus an evidence field); the change narrows what may be retired
(existence wins over tidiness), never widens it; tests use fakes only.
