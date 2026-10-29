# Native Git switch, parallel agents and final reconciliation

Plan committed before source changes. Outcome: branch switching has an explicit discoverable argument contract and actionable preflight errors; separate workspaces can execute in parallel on the existing Render plan without weakening same-workspace exclusion, generation/replay or scanner isolation. Reconcile current documentation and stabilize the unrelated database timing test without lowering its allocation-spacing assertion.

1. Reproduce the reported switch preflight failure through the dispatcher. Accept unambiguous branch/name/ref spellings, reject disagreement before any mutation, report safe validation/worker busy reasons, and independently verify the checked-out branch. Cover real Git, dispatcher, replay and invalid inputs.
2. Verify independent-workspace HTTP concurrency and same-workspace exclusion. Raise reviewed initial capacity from one to two only on the existing compute/disk, test bounded overload and retry guidance, and observe live metrics before claiming workload capacity. No paid upgrade, distributed queue or autoscaling claim.
3. Replace wall-clock-dependent DB remaining-delay assertions with a controlled-time allocation proof retaining real Postgres concurrency and the original >=900/<=1100 ms invariant. Reconcile obsolete top-level plan/status claims against completed source and dated live evidence, retaining historical findings.
4. Run focused checks, assembled check and exact-head CI/release policy/image, self-review and normal PR merge; release only the finished implementation. Deploy the worker on the checked source while respecting active work, then accept switch aliases/replay/denial and two isolated scratch workspaces. Remove exact fixtures. Reassess the existing acceptance ledger; do not fabricate new grants, buy entitlements or delete useful policy as tests.

Remaining operator durability work: encrypted off-host backup destination/key custody and a verified restoration schedule remain distinct from retained Dokploy storage and Render disk snapshots. Do not represent local snapshot code as an operating backup service.

## Reproduction and assembled source

Dispatcher regression reproduced the exact generic refusal with switch options.branch: the shared schema allowed branch/ref/name but the operation validator accepted only name. Earlier successful switches used name. The alias mismatch is now repaired without implying the user's exact hidden call arguments were retained in the journal. Three actual live refusal receipts 3405–3407 are confirmed; no mutation was sent. Missing/conflicting/unsafe arguments now have safe explicit preflight explanations. Checkout verification compares the independently read branch, and --no-guess avoids implicit remote-branch creation. Worker capacity errors remain distinguishable from invalid input.

Existing Render 60-second sampled metrics before the change showed about 24–34 MiB memory usage against a 512 MiB limit; these are sampled low-load observations, not transient peak or large-repository measurements. The existing engine already bounds Git pack threads/window memory. The reviewed two-request setting changes neither compute nor disk pricing. Tests hold two separate HTTP workspace inspections concurrently, verify same-workspace 409 and third-workspace 429/Retry-After, then verify clean reuse after release. No distributed queue is claimed.

DB CI failure on #458 observed 841 ms remaining after scheduler delay, despite an allocated one-second slot. The regression now holds PostgreSQL transaction time constant around overlapping actual slot claims, retains the original 900–1100 ms assertion and rolls back in finally. No runtime pacing policy or safety threshold changes.

Current docs now lead with actual live/merged evidence instead of obsolete task statements. Historical rows remain honest; 15 provider/grant/human-sign-in prerequisites are not supplied by Render. Independent encrypted off-host backups still require a destination and protected operator key custody; this session does not claim they are configured.

Source tests/checks, exact-head CI, merger, worker deployment, final checked release and live alias/concurrency acceptance remain pending below.
