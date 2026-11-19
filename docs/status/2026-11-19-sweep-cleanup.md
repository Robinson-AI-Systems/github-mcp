# 2026-11-19: automatic Playground clean-up (SWEEP-CLEANUP-1)

- **The slow sweep was one offline computer, not old records.** The every-minute clean-up waited 20 s each run for potato
  (offline since Nov 18) to confirm a runtime was removed. It now checks briefly and moves on. (This corrects REVIEW-1119.)
- **Nothing waits forever**: an unanswered removal is re-sent, or after a week offline the record closes as "unconfirmed",
  and the runtime is ordered removed if that computer comes back still running it.
- **Old records are cleared**: closed records are deleted a week after closing once their workspace is gone (120 waiting).
- **Unused workspaces on the Git machines** are always cleared, including folders with damaged metadata, and one bad
  folder no longer stops the clean-up.
- **Also**: a machine can be switched off by name (`NATIVE_GIT_WORKER_OFF`, used for the deleted Workshop); the retired
  pool's relay route is gone; merge-when-green waits up to 70 s per call; pairing refusals no longer say "uncertain".
