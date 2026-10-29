# PAR-3 — binary and parent-correct Git data commits

**Owner authorization:** 2026-10-26 feedback from real-world MCP use. This card records the MCP-side outcome. **No edits to Appliance Desk or its CI** in this card.

## Drift check

| Expectation on main | Verified before editing | Outcome |
| --- | --- | --- |
| Text-only multi-file writer | `src/tools/code-write.js` accepts UTF-8 only | Add dedicated Git Data binary path without replacing existing safe writer |
| No dedicated binary git object tool | 474-tool catalog and registry | Register and test `github_content_commit_git_data` |
| CI-run absence reported by users | PR status tool already checks exact SHA | Observe exact-head CI before any event/dispatch redesign; no invented provider race |

## Starting facts
- `github_content_push_files` already calls GitHub's GraphQL `createCommitOnBranch` with `expectedHeadOid`: it makes a real, parented Git commit, not a disconnected upload. Do not relabel this as broken or blame it for uninvestigated PR conflicts.
- The existing content tools accept UTF-8 text only; a binary IRS form cannot use them. The REST Git Data API can create binary blobs, a tree and a single commit with its parent set to the exact observed branch head.
- GitHub Actions start only for repository-configured events. A commit cannot guarantee a workflow run; an exact-head CI reader must report not observed without claiming success. The existing `github_actions_dispatch` can start a workflow only when that workflow declares `workflow_dispatch`, under all existing guards.

## Acceptance for this outcome
- [x] Add a guarded `github_content_commit_git_data` to commit 1–50 path operations on a named branch, with UTF-8 or strict base64 input for binary files and explicitly documented caps. No raw returned file bytes or secrets, no default-branch guessing, no force updates, and no production bypass.
- [x] In a single guarded write, GitHub blob(s) → a tree based on the current head's tree → a commit with exactly that head as its parent → a non-forced ref update. `expectedHead` fences stale callers and GitHub must reject a concurrent branch advance. Ref readback must prove the returned commit is now the head; leave verification unconfirmed otherwise.
- [x] Binary bytes survive base64 decode/encode unchanged. Reject invalid/noncanonical base64, duplicate/traversal paths, inconsistent delete/content, excessive sizes and no-op changes. Preserve existing branch ancestry, and say clearly that this API does not resolve an actual merge conflict against a diverged PR base.
- [x] Use the nine write-contract checks plus fake-GitHub API-shape tests: production guard, replay, exact parent, tree/deletes, race failure, binary PDF header, unconfirmed readback, invalid input and no direct changes to default branches.
- [x] Update catalog, registry, status note and owner guide; required source `ci` and `release-policy` pass on final reviewed head before merge. No local full repo checkout or real-user acceptance claimed.

## CI-start follow-up (investigate, do not misclaim)
Diagnose missing Actions runs at their exact PR SHA and identify workflow event filters, cancellation and permissions before changing the push path. Use `github_workflow_pr_status` and `github_actions_dispatch` where supported. A missing run is NOT proof of a push race; a manual run is impossible for a workflow that does not support dispatch. Add an evidence-backed autonomous recovery workflow as a separate complete outcome if the diagnosis warrants it.

## Out-of-repo findings
The `appliance-desk` history-wide scanner/ignore-list and Lane 6 browser sharding belong to that project's CI configurations, not to this server's `.github/workflows/ci.yml`. This card neither changes nor falsely claims to fix them.

## Atomic batch/missing-branch follow-up, 2026-10-29

[Current repair](../status/2026-10-29-atomic-git-data-fleet.md): up to 50 operations with unchanged byte limits; optional expectedFileCount detects submitted-count mismatch before requests. An absent branch can be created in the same call using createFrom (exact commit) and expectedHead="". Existing branch heads remain the sole parent; no local merge graph import is claimed. A full independent commit/parent/tree/requested-path readback gates confirmed counts, and incomplete/truncated/race results remain unconfirmed. These additions require exact-head CI/review/merge and separate deployed acceptance; external helper batching remains unlocalized without its source.
