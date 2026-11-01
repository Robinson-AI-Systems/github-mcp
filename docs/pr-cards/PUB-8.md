# PUB-8 — Owner removal of a stranger's account and data by identity

## Owner approval 2026-11-01

Chris approved items 1–9 on 2026-11-01 with self-aware gates. Design and gates: [GATED-EXPANSION](../designs/GATED-EXPANSION-2026-11-01.md).

## Outcome and acceptance

Outcome: the owner can preview, confirm and journal removal of any person's tenant and data by identity (not only by account), with tokens revoked and readback proving removal.

Accepted when the gate is implemented as code with tests for both the on and off decision, the feature works through every door it is offered on, and docs/TOOL-CATALOG.md describes it.

## Drift check

No gate raises spend, widens access or opens public sign-up by itself. Secrets never pass through a tool.

## Built 2026-11-01 (PR #518)

What exists now:
- **Tool `github_tenant_remove`** (`src/tools/tenant-remove.js`, `defineGithubWrite`, `audience: ['Op']`, full profile).
  Give exactly one of `identity` (identity id) or `login` (personal GitHub login, resolved to an identity through the stored
  sign-ins, then through the person's own store; an organization name never identifies a person). Without `confirm: true` it
  only previews (journaled as a preview): spaces and their kind, stored GitHub sign-ins, saved keys, assistant connections,
  jobs, settings, Playground allocations and device pointers. With `confirm: true`: each stored GitHub sign-in is revoked
  at GitHub first (`DELETE /applications/{client_id}/token` with the service App's client) and GitHub is asked whether it
  still accepts it (`POST /applications/{client_id}/token`, 404 = gone); a refused revocation stops with nothing removed.
  Then the removal core runs and an independent readback proves absence. Journaled in the owner's change log; the same
  request repeated is a replay; a new request for a removed person sends nothing ("Nothing is stored").
- **Gate (always available to the owner, never listed to other people):** the tool is `operatorOnly`. `isToolVisible`
  (`src/core/registry.js`) hides it unless the connection is the operator's own (`isOperatorConnection`,
  `src/core/authority.js`): a full connector on the operator's database, marked `operator: true` only by that route in
  `api/mcp.js`. A person's tenant connection, a service pass, the Marketplace route and the RTC/HTTPS door never carry
  the mark, so tools/list, search/describe, `github_call`, `github_write_batch` and direct dispatch all say "unknown tool";
  the handler re-checks it.
- **Refusals:** the owner's own identity (made a private pilot, or its GitHub id/login is one of the owner's connected
  accounts) unless `includeOwnIdentity: true` is also given; a person sharing a space with other people; unknown people
  (nothing sent).
- **One removal core** (`src/tenancy/directory.js`): SQL `gh_remove_person_tenant(target)` deletes the row in every shared
  table with a `tenant_id` column (read from the catalog, so a table added later is covered), deletes Playground device
  routes and pairing selectors, marks a managed allocation's index row `cleanupRequested` (the regular sweep then disposes
  it through its existing "namespace removed" path) and records an allocation on the person's own computer as disposed
  with evidence `tenant_removed_device_authority_revoked` (its authority is gone; volumes unverified), drops the tenant
  namespace, and `gh_remove_person_identity` removes the identity once nothing uses it. `src/tenancy/tenant-removal.js`
  is the owner tool's store (resolve, preview counts, revocation tokens kept in memory only, removal, readback).
- **The person-facing "Delete my data" page and the owner setup page** already existed (PUB-6); both go through
  `gh_forget_public_tenant`, which now keeps its public-sign-in-only checks and calls the same core. No new page was built.
  That path does not revoke at GitHub (the person signed in to leave; their stored grants are deleted). The Marketplace
  cancellation keeps its own `gh_forget_marketplace_tenant` (subscription bookkeeping) — unchanged.

Acceptance, item by item:
1. Gate on/off as code with tests — `tests/unit/pub-8-tenant-remove.test.js` "is never listed to, and never callable by,
   anyone but the operator's own connection (every door)" and "only the operator route marks its connector connections".
2. Works through every door it is offered on — the nine write-contract checks through handler, dispatch and `github_call`
   ("write contract: github_tenant_remove through …"); the RTC/HTTPS door does not offer it.
3. Real PostgreSQL — `tests/db/pub-8-tenant-removal.test.js`: "previews, then revokes at GitHub first, removes every row of
   the person, reads back absence and leaves everyone else untouched" (asserts a fixture row in EVERY `tenant_id` table
   first); "refuses the owner's own identity (pilot space or own GitHub id) without the separate flag, and unknown people";
   "a person's own tenant connection cannot use it; a failed GitHub revocation removes nothing"; "the person-facing
   "Delete my data" path (gh_forget_public_tenant) runs the same core". Existing PUB-6 removal tests still pass.
4. `docs/TOOL-CATALOG.md` row added.

Not done / not verified: never run against a real tenant or the live deployment (deployed acceptance is a later row);
managed Playground allocations are disposed by the next sweep, not inside the call.
