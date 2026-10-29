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

Source and live follow-through are complete; exact proof follows.


## Checked source and actual live acceptance

PR #459 head `cf776914b53b43f8ff73de60862f09d1c4ab9dac` passed exact-head CI 40823275153 (including all unit/DB/browser/RTC/shapes/check jobs), release policy 40823275149 and worker image 40823275166, with no review threads. The published tree exactly matched the locally checked tree. Local assembled check and 93 focused native service/worker/contract/snapshot/signing tests passed. Merged `0d75243923fd2e2eb7928bf2aafbf4f9b4a00867` (journal 3416). Main CI 40823539075 and policy 40823539185 passed; authorized checked manual release 40823575876 succeeded (3417).

Vercel independently reports that exact source READY on deployment dpl_w4gYGtsWif5UyYX372st2xwLQPEw with the production hostname alias; public /api/contract reports the same revision. Render deploy dep-dbhdk00473hc739mo0f0 is independently live on the same commit. Only NATIVE_GIT_MAX_CONCURRENT was merged into the existing service environment, set to 2; that update triggered the one worker deployment. Same compute, disk, verifier and manual source deployment policy; no additional paid resource. The expected disk-service interruption briefly returned capabilities ready=false, then signed capabilities returned ready=true/protocol2/native Git2.39.5/max_concurrent2.

Actual authenticated custom MCP, PRODUCTION/full, using exactly one run-created private scratch repository:

- Created fixture (3418), opened workspace A (3419), created topic at generation0 (3420). On the old serving source, switch with options.branch reproduced the reported generic preflight refusal without changing generation1. After the checked deployment, the same branch intent applied and independently verified acceptance-topic/generation2 (3422). The workspace survived the worker deployment.
- Repeated the identical successful switch request: replayed, confirmed, still generation2; no new mutation. Conflicting name/branch values produced “No change was sent. Switch branch arguments disagree; supply one exact branch.”
- Opened independent workspace B (3425). Issued concurrent custom-MCP calls for A switch via ref and B branch creation (3427/3426), then concurrent switches via name/branch (3428/3429). All applied and independently confirmed. A retained acceptance-topic, B retained second-agent-topic. This is live concurrent-call success; the deterministic held-request source test separately proves overlapping HTTP admission and 409/429 enforcement.
- Concurrently wrote agent.txt with different harmless two-byte contents (3431/3430). Independent parallel byte reads returned A\n (QQo=) in A and B\n (Qgo=) in B, with distinct SHA-256 hashes; no workspace crossed into the other. Inventory returned both independent IDs with proper ISO expiry strings.
- Disposed exact workspaces (3432/3433), then deleted exact repository (3434), all confirmed. Independent primary GitHub repository GET returned 404; accessible workspace inventory no longer included the fixtures. No other workspace was closed or migrated by this test.

The original 56 recorded passes and 15 historical prerequisite-dependent rows remain separate; this follow-through does not supply disposable revocation/narrow grants, fresh human OAuth, paid provider entitlements or independent administrative UI readbacks. The earlier no-further-budget-testing decision remains binding, not a new owner task. No source test is substituted for those observations.

## Durability boundary and next re-entry

Current Render documentation (https://render.com/docs/disks.md, retrieved 2026-10-28 MDT) documents encrypted automatic daily disk snapshots retained seven days, with full-disk destructive restore. That is provider behavior, not proof that a particular snapshot or restore has been observed for this newly created service. Existing encrypted workspace export/import has focused restoration tests; no independent off-host backup schedule/destination or operator key custody is configured here. Commit/push valuable work rather than relying on an expiring worker workspace as its only copy. Re-enter off-host backup operations when the owner-controlled destination and protected key custody are available; do not copy useful uncommitted work into an unapproved external store.

Two concurrent requests is the verified starting configuration, not measured capacity for large clones or arbitrary fleet size. More independent agents can retain workspaces and interleave calls; further capacity changes remain measurement-driven on the existing 1 GB/512 MB host.

Cleanup diagnostic caveat: an additional custom universal GET attempted a repository-narrowed App token after the fixture was deleted; GitHub refused token issuance with 422, so that call did not provide absence evidence. The separate primary GitHub GET supplied the 404 above. No installation or key was reset based on that misleading generic credential suggestion.
