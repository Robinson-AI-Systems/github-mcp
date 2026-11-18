# CONN-FIX-1118: fixes for the problems found while shipping RETURNED-COUNT-1

## Owner request 2026-11-18

Chris: "Fix them" (the connector problems reported after RETURNED-COUNT-1 / WORKSPACE-LIST-2), and: "Its job-log reader briefly returned 'connection is temporarily busy' and succeeded on retry. Returning a retry interval with that response would improve automated recovery."

## Outcome and acceptance

- **FULL-ROWS-1** (`src/core/result-rules.js` `fitToBudget`): `github_pr_list` with `detail: 'full'` answered `items: []` because one full PR object is larger than the 8 KB reply. Now long texts are shortened and, if a single row is still too big, the first row comes back with its largest fields listed in `_left_out`. A list reply is never empty while rows exist.
- **KEEP-PART-1** (`src/tools/dispatch.js`): the same call said "could not be kept". Cause: a private connection keeps saved results up to 256 KB (`resultMaxBytes`), and 82 full PRs are bigger. The refusal now has reason `too_large`; the reply keeps the rows that fit (`kept_rows`, `of_rows`, `partial_note`), and `continue` pages through them. When nothing can be kept, the note says why and what to ask for instead.
- **CALL-ARGS-1** (`src/tools/meta.js`): `github_call` and `github_batch` accept `arguments` as well as `args` (Rack Control's `rack_call` uses `arguments`). Both with different values is refused.
- **CALL-ARGS-2** (follow-up, `src/tools/dispatch.js` `parseObjectArgs`): checking CALL-ARGS-1 live, the client still had the old tool list and sent `arguments` as JSON text, answered "arguments must be an object". Any top-level argument the schema calls an object is now parsed from JSON text first (as Rack Control's CALL-ARGS-2 does).
- **BUSY-RETRY-1** (`src/tenancy/runtime-limits.js`, `api/mcp.js`, `api/tenant/optional.js`): "temporarily busy" now says "Retry in N seconds", where N is the time until the budget window reopens (it used to be the whole window length, 60 s). `retry_after_seconds` and `Retry-After` carry the same N, plus `retryable: true`.
- Tests: read-pipeline (+2), meta-tools (+1), pub-3-runtime (+1 and the updated checks).

## Drift check

No tool added or removed. One optional argument on two meta tools, reply fields on cut lists, wording and wait value on busy refusals.
