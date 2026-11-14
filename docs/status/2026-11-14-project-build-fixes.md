# 2026-11-14 — fixes from a project build (cleaning-desk)

Reported by an agent building a new project from the rack's starter:

| Problem | Fix |
|---|---|
| Scanner refused a sign-in form's password box (its autoComplete ternary picking the new-password or current-password token) | FORM-LABEL-1: a literal that only names a password is never an assigned password |
| Scanner refused the starter's reset-password email line (every project from that starter, on first push) | PROSE-PASSWORD-1: wording and code interpolations are not connection-string passwords |
| Scanner exceptions took four tries, each refusal naming one more field | SCANNER-ALLOW-1: `github_secret_scanner` action `allow` (repo, path, blobSha, reason — one call) and action `describe` (every action's arguments + example); allow names all missing arguments at once |
| Repo search refused because it hit a linked account it cannot read | ACCOUNT-ORDER-1: default account first; unreadable accounts are skipped and named |
| `github_repo_find` wants `text`, `github_search_github` wants `query` | ARG-NAMES-1: both take either |
| `fields: ["name"]` on repo lists returned nothing (summaries had only `full_name`) | Repository summaries carry `name` |
| No branch rules on private repos of a free organization, so "merge only when green" was enforced by nothing for the owner's own merges | PLAN-RULES-1: `github_pr_merge` enforces green itself where GitHub reports rules unavailable on the plan; `github_workflow_merge_anyway` stays the deliberate exception. GitHub-side enforcement (for merges made outside Unleashed) still needs a paid plan — recorded for the owner, not a blocker |

Tests: `tests/unit/fixes-2026-11-14.test.js` (13). Existing scanner, merge, ci-state, search and alias suites pass.

Follow-up (same day): `describe` answered with every action's full schema (~20 KB, live check). It is now compact
by default (what, required arguments, example per action, under 6 KB) and `{action:"describe", args:{action:"<name>"}}`
gives one action's full arguments.
