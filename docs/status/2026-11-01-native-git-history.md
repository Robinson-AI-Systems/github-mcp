# Native Git — historical rollout notes (moved 2026-11-01)

These sections were moved verbatim out of `docs/NATIVE-GIT-OPERATIONS.md` during the 2026-11-01 documentation audit. They are history, not instructions. Where they conflict with the current guide or code, the current guide wins (for example: the worker has no fixed request count; capabilities report `max_concurrent:null`, and the current protocol is 3).

## External route verification and historical Dokploy blocker

The earlier Dokploy-specific blocker led to a historical Render fallback; the corrected Dokploy route is now active for new workspaces. No host-wide changes were needed. See [historical Render evidence](2026-10-28-render-native-git-acceptance.md) and [Render setup](../../workers/native-git/RENDER.md). Before sending repository credentials to any replacement host, verify its public route from outside the host:

```sh
curl --fail --show-error "$WORKER_ORIGIN/health"
```

Expect HTTP 200 with service=robinson-native-git and protocol=3 for the current activity-lease worker. Then call github_git_workspace_read with operation=capabilities and require worker.ready=true plus the actual native Git version. Do not open another clone to troubleshoot an unavailable route. Healthy Docker status alone proves only internal health.

If it times out, the authorized host/network operator must provide publicly reachable TLS routing to this project's native-git service on port 3000, or an owned outbound tunnel. Verify DNS, the TLS proxy/tunnel and the service route; a generated sslip.io hostname does not open the host's firewall/NAT or tunnel ingress. Keep Docker/host administration private. When the origin changes, set NATIVE_GIT_WORKER_URL and deploy that configuration through the checked release process; retain the public key pin and persistent data. Existing project-level connection permissions cannot grant missing server-wide/network authority. Backing-volume capacity monitoring remains an operator prerequisite for ongoing active use.

## Scanner policy transport upgrade

The scanner-tuning release uses worker protocol 2, so an older worker cannot silently ignore project protection settings. Rebuild the worker from the same checked release before enabling native operations; retain the data volume and pinned public verifier. Protocol 1 requests are refused by the updated worker and the old worker refuses protocol 2 before running an operation. Workspace storage/snapshot format is unchanged. The MCP sends the current repository policy inside each signed lease; native file reads, diagnostics and command-output redaction use that policy. The historical Dokploy ingress problem was resolved operationally by moving the active origin to Render; the signed protocol remains portable.

## Dokploy routing correction and activated migration, 2026-10-29

The host operator identified the prior timeout cause: generated hostnames used the server's outbound address, while inbound web forwarding reaches a different address. Per-project routing and the healthy container already existed. The corrected project hostname now passes HTTPS health (200, protocol 2) and rejects unsigned workspace calls (401); the provider deployment record identifies worker source 454f6d4d6168c6608e1a3ddcbbd1ea3f19bb93c3. This supports Dokploy viability; it does not prove a signed production cutover.

For each project, point its real domain's DNS at the operator-confirmed public **ingress** address, or correct the address embedded in an auto-generated hostname. Route that hostname to the service's actual internal port (3000 for this worker), enable TLS, and verify both health and unsigned rejection. A different application port alone does not fix incorrect destination DNS. No host-wide routing change is required by this finding.

The Dokploy cutover and eight-lane acceptance are now complete for new workspaces; see [current proof and cleanup](2026-10-29-dokploy-native-cutover.md). Keep Render and its original disk for older workspaces during the drain. Retain the pinned public verifier and protected snapshot key. Do not put private credentials in compose files or chat. Existing work must either finish naturally or be drained, exported/restored and independently checked against its exact workspace/ref/file/intent state using the existing encrypted snapshot/whole-volume procedure. Protected per-workspace host routing below preserves continuity while both hosts exist. Do not cancel Render or claim cost savings before all old-host jobs are gone or migration is verified. Independent off-host backup configuration remains a separate requirement.

## Activity lease rollout (protocol 3)

Prefer deploying the checked worker first, preserving its disk, verifier and configured request capacity, then release the matching MCP. If the connected deployment tool cannot pin a commit and the service follows live, coordinate the checked live promotion with one worker deploy; protocol 3 refuses an older worker before running operations during any brief version mismatch. Verify both serving sources and signed idle-v1/four-request capabilities before claiming readiness. Persistent-disk worker deployments can briefly interrupt native requests; do not claim zero downtime or discard uncertain receipts. Protocol 3 requires a signed idle duration and independently returned activity/deadline metadata; a protocol-2-only worker rejects it before operations. The new worker temporarily accepts authenticated protocol-2 requests with their original fixed-expiry behavior, allowing the old control plane to continue through rollout. Project scanner policy remains mandatory for both. Each admitted protocol-3 workspace request renews its original window at entry and completion without advancing the Git generation; database metadata is admitted before the bounded worker request and synchronized to its confirmed returned deadline afterward. Failure to verify/synchronize the lease stays an error or uncertain mutation, never a false success. Close preflight/readback does not prolong or revive a disposed workspace.


## No daily workspace creation quota

There is no daily job-creation allowance, either per connection or across a tenant. Old32/128/200 stored daily job settings do not govern new requests. Eight simultaneous native requests on the current worker and existing active metadata reservations remain separate capacity controls; closing/idle expiry frees active resources. A capacity refusal identifies an active-workspace constraint and never invents a daily reset. Real provider rate limits and chosen delegated grants remain in force.
