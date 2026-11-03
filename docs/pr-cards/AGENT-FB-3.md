# AGENT-FB-3 — workspace ready report, Git access inside Playground, one-call operation tables

## Owner approval 2026-11-03

Chris's coding agents sent a second improvement list on 2026-11-03. Chris read this card's plan in chat and answered
"Yes, and yes" to doing the work and to the short-lived read-only Git key inside Playground. The Vercel items are in
`Robinson-AI-Systems/vercel-mcp` (AGENT-FB-2 there).

## Outcome and acceptance

Outcome: an agent opens a workspace, gets a Playground runtime attached, learns whether commands can really run and on
which branch, can fetch Git data from inside the runtime, and finds every Git operation's options in one answer.

1. **Ready report.** `github_playground_workspace` operation `setup`, once the repository is attached, returns `ready`:
   `execution_ready`, `mode`, `active_branch`, `limits`, runtime facts, `retryable` and a plain `note`. It comes from the
   runtime's own signed capabilities answer. It says `command_run: false` — no command is run by setup. A runtime that
   is not ready says why. `execution_available` is now true when that answer confirms it. Tests:
   `tests/unit/playground-ready.test.js`.
2. **Git access inside Playground.** Operation `git_access` (1–4 hours, default 2) mints a read-only key for this one
   repository, exchanges it itself, and sends it to the runtime over the signed channel; the runtime writes it where
   only the command user can read it, with a credential-helper entry for that one address. The key is never returned,
   logged or kept in a result; a runtime that refuses it gets the key cancelled. The attached repository's `.git` stays
   read-only by design, so commands `git clone`/`fetch` into a scratch folder. Service passes are refused. Tests:
   `tests/unit/playground-ready.test.js`, `workers/coding-workspace/smoke.test.js`.
3. **Operation options in one answer.** `github_git_workspace_read` `capabilities` now lists `operation_options` (every
   native Git operation and the options it accepts) and `preferred_workflow`; the existing per-call errors stay.
4. **Preferred path.** Native Git is the preferred engineering path; the REST commit tools and the REST Git fallback stay
   as fallbacks (nothing removed). The clone's playground hint now points at `setup`.

## Not done here

`git_access` needs the updated runtime image (the `git_credential` action in `workers/coding-workspace`) deployed to the
operator pool and device hosts; until then it answers that the runtime did not accept the key and cancels it. Live use on
a real runtime is unverified. `setup` does not run a command (a deliberate honest label, not a gap to hide).

## Drift check

Checklist A/B/C of `docs/implementation-contracts/DRIFT-PROTOCOL.md` applied: no migration; the key reuses the existing
git-remote key rows (read only, bound to one connection and repository, expires, revocable on My connection); no change
to guards, spend or access; compact listing budget re-checked by `npm run check`.
