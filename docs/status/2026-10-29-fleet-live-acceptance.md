# Fleet repair and live acceptance — 2026-10-29

The recovery checkpoint was unfinished implementation. PRs #462, #463, #464 and #465 complete branch contracts/lifecycle, atomic manifests/new destinations, complete diagnostic reads/shared aliases/merge diagnostics, and durable clone retry identity. Source tests, merged source, deployed source and actual acceptance are distinct below.

## Delivery and review

| PR | Result | Exact reviewed head | Required CI / policy / image |
| --- | --- | --- | --- |
| #462 | Native operation aliases, actionable no-send previews, independent branch refs, historical replay, actual merge graph | d1e0a63dfcd930b930a93f27ce63672fad203924 | 40865138627 / 40865138830 / 40865138609 |
| #463 | Atomic 1–50-file Git-data manifest, explicit missing-branch creation, blob/parent/tree/ref verification | 645255143a360a2d06bc7ba02a32921cb7363d0b | Required checks passed before expected-head merge; merge 3fe1ae0063cd2c65e2f52b2e299b962fbd8e97c0 |
| #464 | Full logs, exact artifact bytes, paginated trees, canonical review payloads, aliases, rule/error diagnostics | 97901008269ff5a113f90563da2b8d38d25e8a3b | 40871044556 / 40871044452 / 40871044485 |
| #465 | Clone keys survive ten-minute buckets; scoped legacy recovery or explicit no-clone refusal | 2507c0d84ab1efe33f75fa25f11f4389da5324c0 | 40875254833 / 40875316914 / 40875254880 |

The complete diffs were self-reviewed and posted findings resolved before expected-head merges. #464 review found cursor loss after budget trimming; cursor calculation and already-bounded result handling were corrected and tested before final review. #465 initial CI caught missing card/catalog reconciliation; both were added and final committed-tree checks passed. Its isolated PostgreSQL contract passed in the CI database job; local PostgreSQL was unavailable. No failed revision is represented as green.

## Actual custom-service acceptance

Checked release 40871791220 served READY source 454f6d4d6168c6608e1a3ddcbbd1ea3f19bb93c3. Matching Render source was independently live with signed capabilities protocol 2, Git 2.39.5 and max_concurrent 4. The existing instance, persistent disk and verifier were preserved. The following authenticated calls used this custom MCP and exact disposable run-owned scratch fixtures:

- A single Git-data call created a missing branch with 29 text/binary paths, one executable, independent submitted/confirmed counts of 29, commit be51cd4364016d4e0c71ce63b72342116f147474 and parent e07168e3874b5a112fe0f3b4a48471ec788bbf42. Independent GitHub tree/blob SHA/mode comparison confirmed all 29 entries. Journal 3860. This is a file snapshot with actual remote ancestry; it does not import a local merge graph.
- Native clone; 256-character branch creation, rename and deletion with independent refs; branch creation/switch; exact file bytes; stage/commit; fetch a separately advanced branch; genuine two-parent merge; push to a missing branch with independent exact remote head confirmation. Native and remote merge commit c60c40f60e329cb41622d6c57bd6a39770cafe67 had parents 5ceaea1b0ef7673cb598c45b501d0fafa9868947 and f28bc369a9a9bd44ff48a75050a9b023e425995d. No synthetic parent substitution.
- Unsupported staged option on branch_create returned preflight_failed, no_change_sent and no confirmation request; generation was unchanged. Closed clone retry remained historical/disposed; a fresh intent opened a separate workspace. Acceptance then found the older ten-minute edge, fixed separately in #465 rather than declaring the lifecycle complete prematurely.
- Full redacted job log: 22,166 characters in six continuous hash-pinned windows; hash e8e448b107efebbb6381eba1c0d5f36a969a1911d1d943032ba1511205a73b48. Actual aliases job_id/run_id/limit/artifact_id worked. A failed run's summary named its real failing jobs and linked full logs.
- Recursive immutable repository tree: all 1,207 unique file entries across 29 budget-safe pages, beyond the former 500-entry result cap. Count independently matches Git at the same source.
- Artifact entry: 148 exact bytes reconstructed from two windows and independently hashed to 4d82a89d898959b8e37cb0a0154996d58f626c7961b5d63b0575dc64c4303f62. One read transport timed out; a read-only retry completed. This does not claim unlimited artifact size or credential-bearing archive export.
- App-only check creation read back independently with app.slug robinson-github-mcp, completed/success at the exact seed SHA; ordinary repository creation used the person's actor. This adds GOD6 actor evidence without claiming its OFF/read-only setting matrix is complete.

## Helper localization and honest alternatives

The supplied external helper was inspected and its 29-file false-success behavior reproduced with controlled tests: it advanced past unconfirmed later batches, then reported every requested file and exit zero. The corrected external helper stops nonzero on partial/unconfirmed writes, validates batch receipts and counts, checks the final complete remote tree, deliberately creates missing branches via the negotiated server contract, and preserves copy sources. Ten offline tests passed. The repaired package is delivered separately; installation and the original fleet client transport have not been claimed proven.

Snapshot publishing transfers file trees, not local commits or merge parents. Native fetch/merge/push, or the corrected helper's native sync command, is the ancestry-preserving path. No merge parent is fabricated. CI investigation distinguishes actual event subscriptions, branch/path filters, conflicting PRs, credential behavior and exact-SHA runs. This repository's API-published PR events started CI automatically; merged main push events also started CI. There is no claimed universal push-event fix and no hidden workflow dispatch. An explicit dispatch remains an explicit dispatch.

Strict-base diagnostics name current base, required check policy, compare evidence and blocking rule; actual GitHub rules remain authoritative. Native workspaces provide typed Git, not a terminal/test runner. Existing 512 MB memory / 1 GB shared disk and leases remain; save/push before expiry. Advanced Git and scanner limits and concrete local/Actions alternatives remain documented. Neither custom scanner nor synthetic scanner fixtures claim proprietary/Gitleaks equivalence.

## Remaining prerequisites

The existing ledger retains 56 passes, 15 specifically prerequisite-dependent required rows and two optional Hub rows. The exact ID-by-ID prerequisites are reconciled in the native lifecycle note; no useful grant was revoked, paid entitlement purchased, fresh human sign-in fabricated, or owner-declined budget deletion reopened. GOD6 actor proof is partial and does not promote its whole row. Independent off-host backup destination, scheduling and key custody remain unconfigured; Render snapshots are not independent restore proof.

The durable retry correction merged as c02b1998e964428ca26a147a505d57fa24cce941. Checked release 40875671569 waited for exact main CI, then promoted that source. This follow-up changes only control-plane retry/journal code: all ten transitive local source modules loaded by the worker entry point are unchanged from deployed worker 454f6d4d. No second worker deploy/restart is needed. Preserve the separate worker source observation rather than claiming matching commit IDs.

## Final live durability and cleanup

After the second checked release, Vercel's actual serving alias was independently READY at c02b1998e964428ca26a147a505d57fa24cce941. Existing legacy keys from bucket 2988794 were retried in a later bucket: the original closed workspace returned the same historical receipt with done=false/disposed, and the still-open workspace returned its original ID/current ready state. Neither retry cloned again. A genuinely fresh intent produced a stable rmcp_native_open key and separate workspace (journal 3941); closing it and retrying returned historical/disposed. Signed capabilities still report four concurrent requests and protocol 2.

All three exact run-owned workspace IDs were disposed. The exact private scratch repository was re-read against its unique run marker before deletion (journal 3945), then independently checked absent. Workspace inventory contained none of this run's IDs. Other agents' workspaces, credentials, worker disk/verifier and infrastructure settings were untouched. No acceptance fixture remains from this run.

Operational handoff: live/control-plane source c02b1998e964428ca26a147a505d57fa24cce941; worker source 454f6d4d6168c6608e1a3ddcbbd1ea3f19bb93c3 with identical executed worker modules. This evidence-only follow-up requires no release to change runtime behavior. The corrected fleet helper needs installation on the external fleet host, followed by its own disposable client acceptance. Existing 15 required external prerequisites and two optional Hub checks remain explicit; no owner action is invented for the declined budget test.

## New operator report: Dokploy candidate

The operator corrected generated hostnames that used the wrong outbound IP rather than public ingress. Read-only verification after the report: corrected HTTPS endpoint health 200/protocol 2, unsigned workspace POST 401, and Dokploy deployment metadata names source 454f6d4d. No infrastructure mutation, restart, origin switch, credential change or Render cancellation was performed. The current checked Compose file defaults to two requests; four-request configuration/signed proof and active-workspace disk continuity are mandatory before a future cutover. Concrete DNS/port/TLS and migration steps are in native operations. The earlier timeout is not evidence that Dokploy itself cannot host this worker.
