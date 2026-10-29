# Repository scanner tuning: release and acceptance

Source: PR [#455](https://github.com/Robinson-AI-Systems/github-mcp/pull/455), final reviewed head `273eff544a83fd6aed64ecc195f6522f22a6ca3f`, merged as `9b302c1cb0ab6dfc6da977a7e0703276e39d1abf`. Final CI [40778968257](https://github.com/Robinson-AI-Systems/github-mcp/actions/runs/40778968257), release policy [40778968424](https://github.com/Robinson-AI-Systems/github-mcp/actions/runs/40778968424) and portable worker image [40778968520](https://github.com/Robinson-AI-Systems/github-mcp/actions/runs/40778968520) passed. No review threads. Local full unit suite: 295 files / 10,330 tests; final isolation regression set: 46 tests; local shape suite: 21 tests; final committed-tree `npm run check` passed. Compact listing remains 4,825/5,000 tokens.

## Release

Owner-authorized checked manual release [40779338062](https://github.com/Robinson-AI-Systems/github-mcp/actions/runs/40779338062) succeeded after main CI 40779323713 and policy 40779323695 passed. Independent ref readback confirms `live` at the exact merged source. Production alias READY/runtime revision and authenticated acceptance remain pending; branch promotion alone is not serving-release proof.

## Synthetic fixture and baseline

The custom MCP created a disposable private scratch repository (journal 3026), and committed two explicitly fake files (3027/3028). No real credential was fetched, checked or rotated. Database fixture blob `48a51db81f1eb7348a6220b5e0ab521aa0fb1a1e`, 199 bytes; project-format fixture blob `e93c2c90d0b89a49e58255b5745d75d537dbe7e8`, 96 bytes. Before release, the old serving source `53df99ef` returned the database fixture unchanged, reproducing the reported coverage gap with a harmless sample. Post-release behavior and cleanup remain pending below.

## Native worker

The existing scoped Dokploy compose rebuilt from exactly `9b302c1cb0ab6dfc6da977a7e0703276e39d1abf`; build logs show the scanner modules and pinned rule pack included, deployment completed and its replacement container reports healthy. Existing volume/public verifier were preserved, fresh volumes were not requested. This upgrades the worker to scanner-policy protocol 2. Public ingress remains a separate unresolved prerequisite; a healthy container is not proof of external Git clone/push. No server-wide controls or other projects were changed.

## Acceptance-discovered readback correction (plan before code)

Production alias independently READY at `9b302c1c`, public contract agrees and reports 494 tools. Authenticated custom MCP reproduced the fixed behavior: the database fixture now has one value-free database-connection-password finding, masks its sample password, retains the RTC identifier and refuses byte windows. Initial exact-file exception journal 3032 saved revision 1, recorded a passing before=true/after=false verification and enabled full/byte exact reads, but returned unconfirmed. PostgreSQL JSONB reordered nested object keys, exposing an order-sensitive JSON.stringify comparison in independent readback. No blind retry was sent. Settings/read/byte retrieval independently confirmed the saved revision. Explicit tested rollback journal 3033 restored defaults at revision 2 and confirmed successfully.

Correct by comparing normalized policy structures, including profile-collision and tune-coverage comparisons; preserve array order and all field values. Add a synthetic reordered-persistence full-write regression and a disposable real-PostgreSQL roundtrip equality test. Do not weaken readback or claim the initial unconfirmed mutation confirmed. Run focused checks, full exact-head CI/review, merge and checked corrective release, then resume the same pinned synthetic acceptance cases and clean up the exact created repository.

Live non-persisting preview: stored revision 2 found zero matches in the project-format fixture; a preview of `custom_rasdemo` found exactly one value-free location. Independent settings read remained revision 2 with no rules/suppressions. Live tool search finds the compact gateway. Corrective PR #456 source `65e5c9aa50b2cbcc8526071b0d3f076b93b8575c` carries structural readback equality and PostgreSQL regression; merge/release still pending.

Corrective PR #456 passed exact-head CI 40780206734, release policy 40780206706 and native image 40780206666; no review threads. Merged `0e4c5007f6c8a5f80512285c2513db89a6c2a3d5`; checked corrective release 40780698250 is waiting on main checks. Worker rebuilt from that exact corrective source and is healthy. Authenticated live `github_git_workspace_read` capabilities still returns worker ready=false/setup_required=true; no public native lifecycle pass is claimed.
