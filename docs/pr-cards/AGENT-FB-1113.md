# AGENT-FB-1113: three fixes from an agent's evening of use

## Owner request 2026-11-13

An agent reported three shortcomings while shipping development-rack #162/#163, and Chris asked for them fixed.

## Outcome and acceptance

- **Scanner exceptions.**
  - `github_security_scanner_configure` takes `changes.addSuppressions` and `changes.removeSuppressions`, which change the current list without resending it. `suppressions` still replaces the whole list, and its schema now says so.
  - A replacement that would drop existing exceptions without verifying them is refused with a message naming them and pointing to `addSuppressions`.
  - A missing verification now names the exception and the door it needs.
- **Errors.** A request this server refuses on its own checks reads as `invalid_request`, with the full reason, and is not retryable. Before, it read as "GitHub could not be reached", with the reason cut off at 160 characters. Real network failures (fetch failed, connection reset, timeouts) still read as network.
- **CI logs.**
  - `github_actions_get_job_log` takes `search` (plain text, case-insensitive), with `contextLines` and `maxMatches`.
  - Each match comes with numbered context lines and a `textOffset`, so the hash-pinned `fullText` window can continue from that exact spot.
  - It stays inside the bounded result size.
- **Merging.** `github_workflow_merge_when_green` names a red required check:
  - It returns `failed_checks` (by name) and `why_tool`, which points to `github_actions_get_run_logs_summary`. Its `next` starts with "Failed at this head: …".
  - The suggestion is to fix that check, not "add a CI workflow".
  - The owner-ruled (2026-11-11) deliberate fallback pointer stays.
  - The wait path no longer calls a red check "checks_running".

Accepted by `tests/unit/agent-fb-1113.test.js`.

## Drift check

Changes:
- `src/github/scanner-policy.js`;
- `src/tools/scanner-verification.js`;
- `src/tools/errors.js`;
- `src/tools/actions-read.js`;
- `src/tools/workflows-merge.js`.

Existing calls behave as before, apart from the clearer answers. Status note: `docs/status/2026-11-13-agent-fb-1113.md`.
