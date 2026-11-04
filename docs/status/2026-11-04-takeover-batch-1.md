# Takeover Batch 1 — reads and writes you can trust (2026-11-04)

State: built and locally verified on branch `ai/vivienne/takeover-batch-1`; PR and the
pre-authorized owner release follow in the same session. First batch under the fleet
takeover (the original builder stood down on the owner's order), formed from the
GitHub Unleashed findings log and shipped as ONE release under the owner's batching
rule (≥3 complex fixes; this batch carries 4 complex + 4 simple riders).

What changed, per findings-log item:

- **G5 (complex)** — `github_get_result` now pages and projects lists nested one level
  down (`listPathOf`/`pageOfBodyAt` in `src/core/result-rules.js`). Universal API reads
  keep the provider body under `data`, so their lists (e.g. `data.workflow_runs`) were
  invisible to the old top-level-only reader: every field selection came back unknown
  and the caller got the unusable wrapper. Pages now name `list_path`; `describeBody`
  names nested lists too. Top-level and root-list behavior is byte-identical.
- **G2 (complex)** — `github_search_tools` no longer reports a false empty catalog.
  When nothing the connection may call matches, it scans the full catalog and returns
  `catalog_matches` (name, line, kind, profiles) in a separate field — never as
  callable results — so profile-scoped visibility pins are unchanged and gibberish
  still returns count 0.
- **G1 (complex)** — `github_content_get_tree`: brace globs (`{a,b}`) now expand
  instead of silently matching nothing; malformed braces refuse loudly. An incomplete
  page carries the exact `continue` call (offset + expectedTreeSha), the page byte
  budget rose 6000 → 7000 with a `page_cut_by: 'bytes'` marker when it stops a page,
  and the continuation errors now distinguish a changed tree from a missing
  expectedTreeSha and name the remedy. The pinned-SHA integrity rule itself is kept.
- **G6+G10 (complex)** — evidence first: the 12-file cap in the old fleet lesson is
  already gone at HEAD (50 since 2026-10-29, commit 42a79e4) and the silent partial
  success is test-pinned shut (29-file full-manifest verification through all three
  doors; truncated/missing/wrong readbacks are never called complete). This batch
  makes the remaining limits self-describing: the over-50 refusal names the in-server
  chunked route (one `github_write_batch` of ≤50-file git-data steps, each expecting
  the previous step's branch head) and the tool description states up front that
  symlink and submodule entries are refused. NOT changed: symlink/submodule support
  itself (a deliberate refusal pinned by test — an owner design call), and the
  reported multi-file HTTP 500s were not reproduced (the door runs with
  `maxDuration: 60` while blob uploads are sequential — a hypothesis, recorded here,
  not a fix).
- **G3 (simple, outside the repo)** — the local helper's `ALLOWED_TOOLS`
  (`~/workspace/custom-connectors/custom.github-mcp/bin/client.py`) gained
  `github_commit_compare`, `github_workflow_find` and
  `github_workflow_ci_failure_summary` after schema review (all reads);
  `github_actions_list_runs` was added by another crew during this build. The helper
  change ships with the batch report, not this release.
- **G8 (simple)** — search results and `github_describe_tool` now mark each tool
  `access: 'direct'` or `access: 'github_call'` (with the exact `call_with` shape),
  computed from the connection's own listing. `github_tool_manifest` is unchanged:
  it is the direct list by definition.
- **G15 (simple)** — `github_workflow_pr_status` reports an absent checks payload
  (closed PR, or a large one cut for size mid-run) as an explicit unknown state
  (`green: null`, `items: []`, `unknown: …`), never a bare `checks: null`.
- **G16 (simple)** — `github_actions_dispatch` accepts `workflow_id` as the spelling
  of its `workflow` argument (scoped alias in `standardAliases`; other tools with a
  `workflow` argument are untouched).
- **G14 (conditional)** — one cheap reproduction attempted early: a dryRun of
  `github_collab_add` (invite `robinsoncaleb2013-afk`, pull, on
  Robinson-AI-Systems/robinson-ai-systems) returned a clean preview against the live
  server. The 500 did not reproduce at preview depth; the confirmed-apply leg was
  not fired as a test. G14 stays in the backlog with this evidence.

How it was checked: every fix landed with tests; with `src/` reverted and the new
tests kept, exactly the 9 new defect tests fail and all pre-existing tests in those
files pass (reproduction proof). Touched-area suites all green locally: result-rules,
read-pipeline, result-continuation, result-envelope, meta-tools, code-read,
workflows-pr-conveyor, workflows-maintenance, argument-aliases, actions-write,
git-data-commit, code-write, server-tools. Full repo check and the Vercel build loop
run once on the final tree before merge; CI at the exact head carries the full suite.
