# 2026-11-01 — PUB-8 follow-up: "Delete my data" cancels GitHub sign-ins first

- **Built (PR #524, branch `ai/claude/pub-8-self-delete-revokes`):** when a person deletes their own data, each saved GitHub
  sign-in is first cancelled at GitHub and checked gone (the same step the owner's `github_tenant_remove` uses). Only then
  is their data deleted. If GitHub refuses, nothing is deleted and the page says plainly to try again.
- **Verified:** real-PostgreSQL tests (success, refusal, still-valid token, retry) and a real-browser page test (refusal page,
  retry, connection stops working). Not run live.
- **Next:** nothing for this item; the daily release carries it.
