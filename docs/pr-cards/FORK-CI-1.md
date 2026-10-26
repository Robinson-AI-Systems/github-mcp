# FORK-CI-1 — Owner-authorized first-time contributor CI approval

**Owner clarification (2026-10-26):** Protected-resource and hosting safeguards prevent accidents, surprise production changes and unwanted spending. They must not permanently deny an intentionally authorized owner/coding-agent operation. Approving an external contributor's GitHub Actions run lets ordinary required checks **run**; it does not bypass checks, merge, or deploy. The owner requested autonomous review of #402/#403 without visiting GitHub.

## Scope and acceptance (commit this before source edits)

1. Add a guarded, deliberate `github_actions_approve_fork_run` write using the pinned `POST /repos/{owner}/{repo}/actions/runs/{run_id}/approve` GitHub API. Target a named repository, exact open fork PR number, exact head SHA and exact run ID. Verify GitHub's live run is a still-unapproved `pull_request` run and matches that PR/head. Refuse stale, closed, same-repo, non-PR, already approved or mismatched run before any POST. Return no secrets.
2. Within `pr-only` repositories, allow **only that dedicated guarded tool** as a normal PR-conveyor step. Leave `locked` unchanged; do not touch the owner's protected-resources rows or allow generic universal API writes. Continue to refuse production/deployment workflows; check the workflow definition at the base branch, fail closed if unknown, preserve owner confirmation, full profile, existing credentials, journaling, replay and independent readback.
3. Add write-contract tests (all nine contract behavior lines) and concrete negative-path tests: fork/head/PR/run mismatch, stale recheck, production workflow and no bypass through universal API. Demonstrate no workflow approval POST for a refusal, preview or read-only connection.
4. Keep current `ci` and `release-policy` required **green at exact PR head for merging**, and the scheduled `live` release as-is. Approval never runs production deployment and never waives GitHub's own permission/approval checks.
5. Update the tool catalog, owner-facing guidance, status and decision note. Verify the existing catalog/PR-only inventory and no migration/credential handling is required. Run the full repo checks once on the finished branch and merge only after exact-head CI/review permits.

## Drift check — 2026-10-26

- The existing `pr-only` allow-list already permits rerun/dispatch/cancel but not a fork run approval; add just the new reviewed tool, not a generic allow-all.
- The GitHub-pinned `actions/approve-workflow-run` endpoint accepts a GitHub App user token with Actions write, with 201 on provider acceptance. Its approval does **not** satisfy CI checks or skip reviews.
- The write dispatcher currently performs provider `read` before journal replay, so a successful run can have advanced to `queued` when the same request arrives. Keep exact PR/run/head validation on read; require `action_required` again immediately before the POST, so a prior journal replay works but an unrelated already-approved run cannot be approved again.
- `docs/TOOL-CATALOG.md` section and total counts, registry test, work index and index-validator acceptance list need a synchronized update.

## Delivery boundary

This is a tool capability change, not approval of any particular untrusted fork run. The owner explicitly authorized approvals for #402 and #403; after a checked release, separately confirm the exact runs and act only where GitHub still presents them as approval-pending. No GitHub branch protection, repository access, Vercel release or spending setting may be weakened. No direct writes to main.
