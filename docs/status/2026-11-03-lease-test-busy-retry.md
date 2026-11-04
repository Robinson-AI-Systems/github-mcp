# 2026-11-03 Lease-activity test repeats only "busy, nothing started" refusals (main CI repair)

`main` at 61aedb87 went red in `unit (1/6)`: `tests/unit/native-git-lease-activity.test.js` got the fixture worker's real
`worker_responsiveness_pressure` refusal (event-loop delay over its 250 ms limit on a loaded runner; retryable,
`no_operation_started`). The same refusal hit this file on several CI runs today. The fixture deliberately keeps the
real resource monitor and its limits; the test is about which calls extend the idle lease, not about pressure.

Fix (test only): the file's `call` helper repeats a call, after 250 ms and at most 20 times, only when the worker answered
the retryable "busy, no operation was started" refusal, exactly as an agent is told to. Every other error and every
result reaches the assertions unchanged; no assertion or limit changed. Pressure behaviour stays covered by its own tests.

Verified: the file passes three runs in a row locally; `npm run check`.
