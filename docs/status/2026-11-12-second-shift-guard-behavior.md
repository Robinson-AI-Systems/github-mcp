# Second Shift resolver-guard behavioural tests — 2026-11-12

State: IN PROGRESS — branch `ai/vivienne/second-shift-guard-behavior`, PR
pending at note time; head and CI recorded in the PR.

What changed: the 2026-11-12 Second Shift review's #611 test finding verified
REAL — `tests/unit/worker-resolv-guard.test.js` asserted only source text
(grep-shaped checks that the script *says* the right things), so a behavioural
regression in the resolver guard would pass its own suite. New file
`tests/unit/worker-resolv-guard-behavior.test.js` runs the REAL
`deploy/pc/worker-resolv-guard.sh` end to end in a temp worker home with the
outside world stubbed on PATH (docker inspect/exec/compose, curl, ss) and
pins the three behaviours the guard exists for: a healthy probe is a quiet
no-op (no compose call, no receipt); a poisoned probe is detected, admission
closes, the worker restarts, and the heal is journaled (`healed_restart`)
with admission reopened; and a drain that never empties hits the cap and
DEFERS — nothing is stopped, the guard's own pause is removed, the deferral
is journaled. The source-shape tests stay: they pin the install/provisioning
contract text, which is a different surface. One inherited assumption, stated
in the test header: the host's own /etc/resolv.conf carries a nameserver
(true on the benches and on CI runners); the empty-host-file boot-race
deferral is not simulated.

The sibling finding on `worker-autoupdate.test.js` (same grep-only class) is
NOT in this PR: the updater's harness needs a temp git remote plus a stubbed
`pc-worker` swap control on top of the same stub pattern, and is recorded as
the follow-up; the updater's behaviour is additionally evidenced live by the
PC receipts verified in the Second Shift pass (finding [18]).

Proof: targeted suite on the bench via the fleet ledger before push; `ci` +
`release-policy` at the exact head gate the merge. No release in this PR.
