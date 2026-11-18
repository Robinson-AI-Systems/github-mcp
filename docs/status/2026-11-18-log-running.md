# 2026-11-18: a running job's log no longer reads as "expired" (LOG-RUNNING-1)

Reading the log of a job that was still running said the log had expired or was never uploaded. It now says the job is still running and to read the log once it finishes.
- **Release no longer stalls on one runner** (RUNNER-DEADLOCK-1): promotion goes by the newest finished check, so a queued copy waiting for the only runner can't hold it up.
