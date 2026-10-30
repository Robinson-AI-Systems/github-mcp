# Playground isolated ingress and controlled dependency downloads

Outcome in progress from main6f761067fa311885a6915482dc4e699ae61231f4 on ai/codex/playground-isolated-ingress-20261030.

Dokploy adds shared ingress networks to domain targets. Put domains on a separate gateway, never the executor. Gateway has no repository/control volume or provider credential, runs UID1000 with a read-only root and dropped capabilities, and only forwards fixed executor/broker paths. The executor stays on its single named internal bridge. Strict bounded YAML/JSON parsing checks actual converted networking and exact gateway policy rather than treating raw configuration as proof.

A gateway HTTP80/HTTPS443 proxy accepts only the private executor peer, pins public IPv4 DNS per connection, and rejects private/metadata/admin/ingress addresses. Command environments expose only its fixed URL; no orchestration credential is inherited. Gateway resources are deducted from the total workspace CPU/RAM budget. Programs ignoring proxy settings remain unable to access external downloads. No IPv6, arbitrary port or VM isolation claim is made.

Manager recovery requires idle exact-owned provider state and no deployment history, with a persisted dispatch version before once-only retry. Current-version uncertain dispatches never automatically repeat. New allocations derive immutable worker build source from the checked serving revision; existing manager/allocation plans remain pinned.

Validation: all16 Playground unit suites passed123 tests, including pressure/recovery. Actual-base npm run check passed; final gateway policy assertions are rechecked before publication. Dedicated image tests preserve UID1000 commands, replay, resource pressure, private Chromium/API/WebSocket, uncommitted repository attachment, daemon namespace termination and exact volume absence assertions. Local Docker/Postgres are unavailable; exact-head CI/image results must be recorded before merge. No new live allocation has been claimed working.

Next: finish actual-base checks, exact-head CI/policy/native/coding images, expected-head merge and checked release. Verify READY source, actual converted private executor networking and worker source, then run authenticated disposable integrated acceptance and exact cleanup. Prior owned allocation Compose/container absence is verified, but four-volume absence/source close remain unconfirmed; preserve all unrelated native/Render workspaces. Backup activation/restore and resource guarantees remain optional, never a reason to defer eligible engineering.

Tool catalog unchanged: existing execute/read/cancel/availability/preview contracts are retained; this outcome changes their private provider implementation.
