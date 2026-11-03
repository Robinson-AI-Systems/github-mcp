# AGENT-FB-1 — agent feedback fixes (fetch bridge, one setup call, kept-result continuations)

## Owner approval 2026-11-02

Chris relayed his coding agents' improvement list in chat on 2026-11-02 22:16 MST and then said "Fix it all in the
appropriate repos." The items for this repository are the High and two Medium rows below; the two Vercel rows are in
`Robinson-AI-Systems/vercel-mcp` (AUD-PROV-1 there).

## Outcome and acceptance

Outcome: an agent working in a native Git workspace can check publication, bring up a Playground runtime and read any
long result or log to its end without guessing the next call. Accepted when:

1. **Read-only fetch bridge (High).** `npm run session:prepare -- --publish` fetches `main` from a fresh one-time read-only
   address held only in the `SESSION_FETCH_URL` environment variable (from `github_repo_download` / 
   `github_git_workspace_download`, mode `git`) instead of the single-use clone address in `origin`. Only credential-free
   `https` addresses are accepted; the address is never printed, logged or stored in Git config; redirects are refused.
   Without it, a failed `origin` fetch says how to get one. Covered by `scripts/session-prepare.test.mjs`.
2. **One setup call (Medium).** `github_playground_workspace` operation `setup` works out where the runtime is and takes
   the existing idempotent steps itself — provision, replace a stalled runtime, attach the repository, resume a stopped
   runtime — never starts a replacement behind a user dispose, never waits for a deployment, and a repeat with the same
   `requestKey` continues it (resumable replay). `provision`, `attach`, `resume`, `preview` and `dispose` are unchanged.
   Covered by `tests/unit/playground-setup.test.js` and the handler check in `tests/unit/playground-allocations.test.js`.
3. **Pagination and continuation (Medium).** A cut result's `kept_result` carries `continue` (next page) and
   `text_continue` (the next characters of a long text, or the first lines of a log that kept only its tail); every
   `github_get_result` page says `complete` and gives its own `continue`; `github_get_result` gains `startLine`/`endLine`
   (one text field named in `fields`, up to 500 lines or about 24,000 characters a call, `next_window` to carry on).
   Covered by `tests/unit/result-continuation.test.js`.

## Not done here

Server-issued repo-scoped fetch keys (the approved git-address design) are the larger bridge; this card uses the
existing one-time address and adds no new credential. Real-account use of `setup` on a live runtime is untested here and
recorded as unverified until the release is live.

## Drift check

Checklist A/B/C of `docs/implementation-contracts/DRIFT-PROTOCOL.md` applied: no migration, no new credential, no
change to guards, access or spend; `github_get_result` stays read-only and connection-scoped; the compact listing
budget is re-checked by `npm run check`.
