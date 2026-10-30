# PLAY-1 execution recovery

The development filesystem became accessible again after the unavailable-environment interruption. The unpublished checkout and all integration files survived. This local checkpoint is unfinished source, not merged, deployed or accepted implementation.

Recovered branch: ai/codex/playground-allocation-20261029, base dd4555857c6e33e0d9b4151841e951831e0f4f4c. The detailed remote recovery note remains on ai/codex/playground-recovery-20261030 at b033a6df61a7c6bbd57218438df770f332553082.

Fixed manager startup before resource admission so a first queued allocation can progress, and required both coding and broker ingress routes for recovery. Allocator suite: eight tests passed. Syntax checks for native snapshot/attachment and control attachment passed; git diff --check passed.

Broader focused run: 74 passed, one failed. The existing private text preview test receives worker_responsiveness_pressure through native Git. An isolated rerun reproduced the same refusal (five pass, one fail); no threshold or assertion was weakened. Next inspect actual event-loop delay versus test startup/transform timing, then finish attachment/cleanup/telemetry/browser tests and the remaining engineering listed in the recovery note. Full check, image CI, publication, merge and deployment have not run for this tree. PLAY-1 remains IN_PROGRESS. Preserve all unrelated workspaces and the existing hosting/resource decisions.


## Integrated publication and diagnosis

PR480 publishes the complete50-file integration tree at8a481e9573706e8d74f9509437b92653cc085bb5 (tree1d3f3001e9265ea6bbeb3edee5da2eeffbbef015), independently identical to the local source tree. Exact-head CI40998433056, release-policy40998433160 and native image40998433121 passed. Coding image40998433231 passed its existing image/connector scenarios but failed the new multi-container scenario: the CI Docker host has4CPUs and rejected a7.5CPU executor. The correction uses a real constrained2CPU/2GiB fixture, explicitly checks actual1.5CPU/1536MiB runtime cgroups and retains every file/UID/daemon/cleanup assertion. Fresh signed headroom can also select smaller production allocation ceilings before creation; existing allocations and leases are not shrunk.

The reproducible preview pressure refusal was measured361ms versus250ms policy. Readiness waits use the actual monitor without threshold changes. Existing focused suites86 pass. New lifecycle tool passes all21 write-contract checks across the three doors. Full local unit run:10511 passed, one existing synthetic wall-clock benchmark assertion failed under load (serial50.74ms versus parallel80.41ms). Its isolated5-test run passed; no benchmark assertion was changed. Full actual-base repository check passed; local DB/Docker are unavailable, with exact-head CI supplying those modes.

A second security review added same-origin checks for browser app requests and WebSocket upgrades to prevent sibling-origin session use. Correction-focused suites15 pass. The correction has not yet received exact-head CI/image proof. No merge, worker deployment, live release or authenticated live Playground acceptance is claimed. The operator quota/isolated-egress/continuous telemetry contract is documented in PLAYGROUND-OPERATIONS; configured driver names are never accepted as proof. All original acceptance obligations and unrelated workspace/Render volumes remain preserved.
