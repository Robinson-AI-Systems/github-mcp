# Render native Git: live acceptance and scanner completion

## Serving deployment and paid scope

Owner approved the existing My Workspace and approximately $7.25/month initial compute/storage, then applied the prepared Blueprint in Render after the ChatGPT browser handoff repeatedly ended on Android. PR #457's exact head `b718537b1ddc6076337b8e2d604151bf35a641b5` passed CI 40815851568, release policy 40815851623 and worker image 40815851569, no review threads; merged `8004b9e857f16b4027ecf380d9e43abddf3c959f`.

Render initially deployed worker source `0e4c5007f6c8a5f80512285c2513db89a6c2a3d5`, then a controlled redeploy moved it to `8004b9e857f16b4027ecf380d9e43abddf3c959f`. Both are independently reported live by Render. One Docker web service, Virginia, 0.5c-512mb, one instance, one concurrent workspace, 1 GB disk at /data, automatic deploys off. No other paid resource or workspace upgrade was created. The approved amount is a starting estimate before taxes/overages, not a hard bill cap or measured workload capacity.

Production NATIVE_GIT_WORKER_URL was changed to `https://robinson-github-native-git.onrender.com` and independently read back. Checked manual release 40818137226 succeeded after exact main CI 40817546282 and policy 40817546327. Production alias independently READY at `8004b9e857f16b4027ecf380d9e43abddf3c959f`; public /api/contract agrees. Existing Vercel/Neon hosting and credentials remain in place. No worker private signing key or standing GitHub credential was copied. Dokploy volume/container remain preserved; no existing workspace is assumed migrated by changing the origin.

## Actual custom MCP observations

All native operations below ran through this repository's authenticated service-issued MCP connection, PRODUCTION/full, on the serving revision above; underlying Git was real native Git 2.39.5. This is not inference from unit/container tests.

- Public HTTPS /health: 200, service=robinson-native-git, protocol=2. Unsigned POST /v1/workspace: 401 invalid_worker_lease. Signed capabilities: ready=true, protocol=2, native Git 2.39.5, max_concurrent=1.
- Created one exact private scratch repository (journal 3337); cloned its main branch into an isolated worker workspace (3338, ready/generation 0). Disk was writable by the existing non-root image.
- Wrote acceptance.txt, staged, committed and pushed main (3339–3342). Push independently verified remote ref; a separate GitHub App GET confirmed main `8a6b8d31565911e8f45ee008fc4d6eec83005f03`. Repeating the same push intent returned replayed, without another mutation. A stale generation was refused with HTTP 400; no stale write was accepted.
- Created two conflicting local branches/commits. Merge reported actual conflict, acceptance.txt unmerged and MERGE_HEAD present (3355); overall result was correctly unconfirmed, not a successful merge. Explicit merge_abort (3356) independently restored clean state, generation 15, HEAD `7760d9b321856ba7770e0c3548855e91805a043a`.
- Persistence: with no Git mutation active, triggered one controlled Render redeploy. After it became live, the same workspace retained generation 15, the same HEAD, clean status and exact file bytes. SHA-256 before/after: `6403203dd5a0867eb14d104ee8a73730bd72dd9ad92e78d996a6dba0a5dcfc01`. A later write/add/commit/push also succeeded (3359–3363), proving the restored state remained writable.
- Repository scanner transport: configured one synthetic prefix rule with pinned before=false/after=true verification, revision 1 (3365). Native protection_check received policy revision 1 and returned one value-free fingerprint; native byte reading refused the match. An offer to the MCP repository included the portable rule, excluded file exceptions and applied=false; separate destination read remained revision 0/defaults. Tested rollback (3366) restored source defaults at revision 2 and native file bytes became exact again.
- Exact created workspace disposed (3368) and created repository deleted (3369), both independently confirmed. Separate GitHub GET returned 404 for the deleted repository. Workspace inventory no longer included this test workspace. Other connection-owned workspace rows were not modified or removed.

## Earlier scanner receipt correction: completed live probe

The earlier JSONB-order correction from #456 is live. Exact synthetic file exception was saved and independently confirmed at revision 3 (3324), with before=true/after=false receipt; replay returned replayed. Full and byte reads returned all 199 expected bytes. Custom rule configuration was confirmed at revision 4 (3326). Two-case tested rollback restored defaults at revision 5 (3334), then the exact earlier scanner fixture was deleted (3335). Its separate repository read returned 404. No real credential value was retrieved or validated, no provider credential rotated and no useful grant revoked. These results do not retroactively relabel the original unconfirmed journal 3032.

## Remaining boundaries

The former native-worker public-ingress/lifecycle prerequisite is satisfied by the Render route and the observed lifecycle above. Fifteen other required historical acceptance rows retain their own documented prerequisites; they are not closed by these tests. Fresh human OAuth, separately narrowed/revocation grants, paid/destructive provider fixtures and optional Hub routes remain distinct. No full provider-scanner or every-Git-feature parity claim follows.

This is one small stateful worker, not an autoscaling pool. Larger/slow clones may exceed its existing watchdog or storage/compute budget. Keep one process on its disk, explicit expected generations/ref heads, manual deployments and measured resource checks before capacity changes. Disk services have deployment interruptions. Retained Dokploy storage is not an independent encrypted off-host backup; configure and verify that separately before relying on unrecoverable work. The typed advanced Git limitations in the operations guide remain.
