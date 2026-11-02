# 2026-11-01 — Outside coding agent report (neon-mcp) and follow-ups

A separate coding agent used the live Playground end to end on Robinson-AI-Systems/neon-mcp: open, provision, attach,
`npm ci`, lint/security, full unit suite, disposable PostgreSQL tests, commit and push, merged PR. Its notes:

- First attach said the runtime was not reachable; a retry worked. **Change:** attach now waits up to ~10 s
  (4 × 2.5 s, bounded) for a just-provisioned runtime before answering "not reachable yet".
- `github_git_workspace_close` came back UNCONFIRMED (change log 8456, `after: null`) though the workspace was gone;
  the native job stayed `pending`. Most likely the worker briefly refused the read-only readback under load (other
  agents saw resource-pressure refusals the same day). **Change:** the readback retries busy/transport answers up to
  3 times before calling the outcome uncertain. Test: `native-git-service.test.js` "confirms a close even when the
  worker is briefly busy…" (fails without the fix).
- No dependencies preinstalled (by design; `npm ci` works); best-effort resources (owner-chosen mode).
- Not yet tested (its list, agreed): heavy parallel agent load, sustained pressure, recovery after interruption,
  verified resource isolation. Single-command memory pressure and expiry cleanup were tested live earlier today.
