# Design — Batch C: Cheap on context (small results, compact listing, budgets)

Status: **APPROVED** (Chris, 2026-10-10). Written 2026-10-10. Scope and acceptance: `docs/PLAN.md` →
Batch C. Cards C-1, C-2. Depends on Batch B. Every later tool is built to these rules, so this batch comes before any
area tools.

Why: a 300-tool server listed the ordinary way costs tens of thousands of tokens before an agent does anything, and
GitHub's objects are large (a pull request object is ~25 KB, a run log can be megabytes, a diff unbounded). Same
approach as the Stripe MCP (its `docs/designs/BATCH-C.md`): tool search, progressive disclosure, small results, handles,
workflows, annotations.

## 0. Verify before starting

| # | Assumption | How to check |
|---|---|---|
| C1 | The MCP SDK in `package.json` supports tool `annotations`, `outputSchema` and `structuredContent` | `grep -rn "outputSchema\|annotations" node_modules/@modelcontextprotocol/sdk/dist/esm/types.d.ts \| head` |
| C2 | Each tool module exports registry metadata (`area`, `profiles`, `writes`, `production`, `cred`) from Batch B | `grep -n "writes:" src/tools/*.js \| head` |

## 1. Decisions

**C1. Two listing modes per connection.** `catalog` (default for claude.ai, whose client does tool search): every tool in
the profile, listing description ≤160 characters starting with the action (`PRODUCTION:` first for `Prod` tools,
`SPENDS MONEY:` first for `$` tools); longer guidance lives in property descriptions and `github_describe_tool`.
`compact` (default for every other client): the meta-tools, `github_whoami`, `github_api_search`/`github_graphql_read` (once Batch U
exists) and the `github_workflow_*` tools — about 25 tools, under 5,000 tokens, reaching everything.

**C2. Meta-tools.** `github_search_tools(query, area?, audience?, limit=10)` → names, one-line descriptions, safety marks;
`github_describe_tool(name)` → full schema and guidance; `github_call(name, args)` → dispatches into the **wrapped**
handler, so every guard applies; `github_batch(calls[≤10])` → reads only; `github_get_result(handle, page?, fields?)`.

**C3. Small results by default.** Every read tool gets `detail: 'summary'|'full'` (default summary) and `fields` (dotted
paths) from a registry layer. One summary mapper per GitHub object type in `src/tools/summaries.js` (6–14 fields a person
reads): repository, branch, commit, compare, pull request, review, review thread, issue, comment, label, milestone,
workflow, run, job, check run, status, artifact, release, deployment, environment, webhook, delivery, alert, member,
team, invitation, installation, budget/usage line, codespace. Lists return one page (default 20, max 100) with `next`.

**C4. Big text is capped, never dumped.** Bodies, comments, patches, diffs, file contents and logs carry a
`textLimit` (default 4,000 characters per field, 400 lines for logs) and say how much was left out; the rest is behind a
handle. Logs are summarised server-side (failing steps, error lines, annotations) — never base64 (audit G5).

**C5. Size cap and handles.** A result over 8 KB returns the first part, a count, a one-line summary ("37 open PRs, 4
failing CI, 2 drafts") and a handle `res_…`, kept 24 hours in `result_store`, readable only by the same connection or
pass.

**C6. Annotations and structured output.** Every tool sets `readOnlyHint`, `destructiveHint`, `idempotentHint`,
`openWorldHint` from its metadata. Workflow tools declare `outputSchema` and return `structuredContent` plus a short
plain-English text line.

**C7. Budgets are tests.** `scripts/check-budgets.mjs` (in `npm run check`) fails when: compact listing ≥5,000 tokens;
`everyday` catalog listing ≥22,000; any listing description >160 characters; any schema ≥1,500 tokens; any read tool's
default response on its 100-item fixture >8 KB without a handle. Token counts use a pinned tokenizer package and are
printed in CI.

## 2. Schema

```sql
CREATE TABLE IF NOT EXISTS result_store (handle TEXT PRIMARY KEY, connection TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL, summary TEXT, body JSONB NOT NULL);
CREATE INDEX IF NOT EXISTS result_store_expires ON result_store (expires_at);
```

Expired rows are deleted by the request path (`DELETE … WHERE expires_at < now()` limited to 100 rows), no cron.

## 4. Work units

### C-1 — Summaries, fields, detail, text caps, handles, annotations (M)
Files: `src/tools/summaries.js`, `src/core/result-rules.js`, `src/db.js`, `src/tools/server.js` (`github_get_result`).
Tests: field projection and unknown-path note; text cap reports what was cut; handle isolation between connections;
annotation consistency with metadata; size cap on fixtures.

### C-2 — Listing modes, meta-tools, budgets (M) — may group with C-1
Files: `src/core/meta.js`, `api/mcp.js` (listing per connection, `?listing=` override), `scripts/check-budgets.mjs`.
Tests: `github_call` passes the write-contract helper (door #2); refuses tools outside the profile; `github_batch`
refuses writes; budget script fails on a planted 161-character description (prove once).

### C-10 — Exact GitHub file retrieval without sacrificing compact defaults (2026-10-27)

Owner-approved response to real-world agent issue #427: ordinary file/log/PR results remain compact; an explicit `github_content_get` or `github_get_result` byte window of at most 32 KiB returns original file bytes encoded base64, with offset, total, next and EOF. The caller can continue to any size GitHub makes available through this retrieval path. Retained results stay scoped to their originating client/pass and expire after 24 hours. Scan complete source **before encoding/slicing** to preserve credential controls, rather than allowing a base64 bypass. Acceptance uses a 25 KB minified/UTF-8 test in ≤2 calls, binary test, missing/foreign handles, fake and PostgreSQL result stores. See `docs/pr-cards/C-10.md`.

## 5. Stop-and-ask points

1. The SDK lacks annotations or structured output (C1 false): build the rest; record the gap; amend.

## 6. Acceptance mapping

| PLAN Batch C line | Evidence |
|---|---|
| Compact <5k, everyday catalog <22k tokens | CI budget output |
| Every door enforces the same guards | write-contract through `github_call` |
| Handles isolated; text capped | `tests/db/result-store.test.js`, `tests/unit/result-rules.test.js` |

## Amendments

(Dated entries only.)
