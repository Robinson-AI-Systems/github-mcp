# Native workspace idle leases — release and acceptance, 2026-10-29

Owner outcome: new workspaces use four hours of inactivity by default. Authorized native workspace requests renew the original selected window. Chat messages, local-only work, PR/CI requests, workspace inventory and health/capability checks do not renew it. Existing explicit durations are preserved; timeout/close never extends provider or service grants, revives closed workspaces or creates another clone.

PR #467 exact head d54807dd046dc69f1d228f2afec2ee77c16563de passed all CI families (40889183000), isolated PostgreSQL renewal contract, image (40889182935), release policy and review with no unresolved threads. Expected-head merge: 6739c45f94c799df0ecb7b09c04c1189afa837e9. Local proof: 128 native/contract/worker/snapshot/fake-database tests plus 30 shared write/owner tests; assembled checks used actual base 0c81e59af616e5c7a4c91fe946edf19a7d2d7273. Local PostgreSQL was unavailable; CI supplied real SQL proof.

The owner checklist was reconciled, with the complete old file archived. Completed public setup, installed credentials and old duplicate unchecked items are not new chores. The 56 existing accepted rows, 15 specific remaining required prerequisites and two optional Hub checks remain honest. No paid feature was enabled, no grant revoked or broadened, and the declined budget-deletion test remains declined. The helper package needs installation on its external fleet host; independent off-host backup destination/schedule/key custody remain external inputs. Dokploy migration remains optional and requires verified signed capacity plus disk continuity.

The Render connector cannot select a commit, and its service follows live with auto-deploy off. Dashboard access required a separate sign-in, so no credentials or browser handoff were requested. Coordinate checked live promotion with one matching worker deployment, preserving the persistent disk, public verifier, instance/plan and four-request setting. Protocol 3 requires signed idle metadata; a new client refuses an old worker before execution, while the new worker accepts old protocol-2 requests with fixed expiry during rollout. Native requests may briefly be unavailable during the persistent-disk deployment. This is not a claim of zero downtime.

Actual provider source, live idle/continuity evidence and cleanup are recorded below only after verification.

## Actual deployment and provider verification

Owner-authorized checked manual release 40889760959 completed successfully at source 6739c45f94c799df0ecb7b09c04c1189afa837e9. Both the actual Vercel serving alias and the Render live deployment were independently observed at that exact source. Signed capabilities confirmed protocol 3, workspace_lease=idle-v1, Git 2.39.5 and max_concurrent=4. Provider readback confirmed the same existing disk, plan and instance count, live-linked branch and auto-deploy-off configuration. No hosting migration, resource increase, verifier/credential change or new paid service.

A private run-marked disposable repository was created (journal 4011). Before deployment a 30-minute workspace received an uncommitted marker (4012/4013). After deployment its exact SHA-256 remained 1fe84ec8d77a557306c04ce4f0a5e6d9a68d3586100f18a4e490a7a1d31ed0f4, HEAD remained 02e80b3e3a04f69aec7d306ef7a07b00048b2d7c, generation remained 1, and the adopted original window was 1800000 ms. This proves workspace continuity and legacy-duration adoption, rather than assuming persistence from the configured volume alone.

Four concurrent client clone/write/readback lanes succeeded. Their chosen idle windows were one minute, the new four-hour default, five minutes and one minute. Every lane returned the exact written bytes and SHA-256 386aee86e07a91150770668b7c3b316981c891038a6dafcebb36d42c6e67feca. New default expiry was exactly last_activity_at + 14400000 ms; writes advanced each Git generation once. Journals 4016–4023. These small fixtures are concurrency proof, not a benchmark for four large application repositories.

## Timed activity and idle expiry

A one-minute manual fixture expired while test preparation was idle; the service correctly returned no active workspace. A first automated attempt was interrupted by the AI client's usage-limit pause, and no passing result is inferred from that attempt. The final timed harness persisted each observation and completed independently of the chat's pacing.

| Observation | Last authorized activity (epoch ms) | Returned expiry (epoch ms) | Git generation |
| --- | --- | --- | --- |
| Timed read 1 | 1793285076560 | 1793285136560 | 1 |
| Timed read 2 | 1793285103646 | 1793285163646 | 1 |
| Timed read 3 | 1793285131046 | 1793285191046 | 1 |

The original creation deadline was 1793285106984. The final activity occurred 24062 ms after that deadline, and each returned expiry equaled that request's activity plus 60000 ms. The workspace remained ready, the Git generation stayed 1 and file SHA-256 was 063f709928673ac101e4a6379c67a1b2cf375667b19d365a2ca64702e7536340. This also exercises database renewal: the connection-bound job remained readable beyond its original deadline. Journals 4041/4042/4043. After explicit close, the same open intent returned historical/disposed with done=false and no new clone.

The untouched one-minute fixtures became unavailable and were absent from complete workspace inventory. Filesystem pruning, lock exclusion and no-renew inventory/health/foreign/revoked cases are independently exercised by the virtual-clock real-filesystem source tests. No direct read of Render's filesystem is claimed for the deployed expiry sweep.

## Cleanup and remaining work

Marker/default/five-minute workspaces were explicitly disposed (journals 4024–4026); the final timed workspace was explicitly disposed (4043). Short idle/interrupted fixtures expired. A complete current workspace inventory contained none of this run's repository/workspaces. The private repository was re-read against its exact unique run marker before deletion (4045), then independently returned 404 through the same previously authorized provider path. No unrelated agent's workspace was inspected or modified.

The source and runtime change are complete. This follow-up records evidence only and needs no additional runtime release. Existing accepted Git/provider/scanner/PR proof is retained separately; no synthetic test, preserved old acceptance or current connected session is relabeled a new human sign-in, grant revocation or paid-feature acceptance. Remaining external prerequisites remain individually reconciled: helper installation on the external host, independent backup destination/schedule/key custody, disposable identity/grant fixtures and any explicitly selected eligible provider/paid-feature scenarios. The owner-declined budget deletion stays declined; the two Hub checks remain optional.
