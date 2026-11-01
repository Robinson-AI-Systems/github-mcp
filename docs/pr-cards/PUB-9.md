# PUB-9 — Fine-grained token tenants, offered only when enrolled

## Owner approval 2026-11-01

Chris approved items 1–9 on 2026-11-01 with self-aware gates. Design and gates: [GATED-EXPANSION](../designs/GATED-EXPANSION-2026-11-01.md).

## Outcome and acceptance

Outcome: people can enroll a fine-grained token on the protected page; the tools it unlocks come from its actual permissions; nothing is offered until one is enrolled.

Accepted when the gate is implemented as code with tests for both the on and off decision, the feature works through every door it is offered on, and docs/TOOL-CATALOG.md describes it.

## Drift check

No gate raises spend, widens access or opens public sign-up by itself. Secrets never pass through a tool.

## Delivered 2026-11-01 (source)

- Enrollment on the protected page only: My connection action `fine` makes a one-use link; `/api/tenant/optional?fine_link=…`
  shows the form (fits a 412 px phone); `src/tenancy/fine-grained-credential.js` verifies the token with GitHub (same person,
  fine-grained not classic, not expired, one owner, owner not already on the App or the master token), reads its permission
  set (`src/github/fine-grained.js`), encrypts it per tenant/person/owner (vault kind `F`, additive constraint widening) and opens
  the owner as a read-only extra place (`gh_accounts.place_cred = 'F'`, additive column).
- Gate: nothing in tool listings changes; `github_whoami` says nothing about fine-grained tokens until one exists, then reports
  `fine_grained_tokens` (status, expiry, repositories, permissions, unlocked areas) and credential type `F`.
- Selection order unchanged: App installation and user sign-in first; `F` only for its own extra place; never for read-only
  connections, service passes, narrowed scopes or the owner vault.
- Refusal before GitHub (`fineDecision`) from the vendored GitHub permission list plus the recorded set; a GitHub "not accessible
  by personal access token" refusal and a 401 are remembered (`noteFineOutcome`). My connection: Re-check, Remove, allow changes.
- Tests: `tests/unit/pub-9-fine-grained.test.js`, `tests/shapes/fine-grained-shapes.test.js`, `tests/db/pub-6-public-connect.test.js`
  (PUB-9 block, real PostgreSQL), `tests/browser/sign-in.test.js` (PUB-9, real browser at phone size).

## Not included

Write permissions cannot be read from GitHub without writing, so they are learned from GitHub's own refusals, never guessed.
One token per owner (GitHub gives a fine-grained token one owner). Real-account acceptance is an owner checklist row.

