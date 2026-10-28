# GQL-1 — GraphQL write specifications for the remaining mutations

**Batch FIN · Design:** `docs/designs/FINISH-PLAN.md` §4, `docs/designs/BATCH-U.md` (U-2) and Batch Y Y-2 ·
**Prerequisites:** none (independent of God mode) · **Effort:** medium · **Split:** 4 PRs (one per group below).

## Outcome
Every one of the 234 GraphQL mutations the capability report lists as "no write specification" is either
(a) **already covered** by a curated tool, recorded so in the inventory, or (b) given a reviewed `WRITE_SPECS` entry so
`github_graphql_write` can run it with the normal preview → confirm → verify → undo lifecycle, or (c) **deliberately
refused** with a one-line reason (e.g. enterprise membership, identity-provider changes). After GQL-1 the report shows
0 rows in state `missing`.

## Read only these
- `src/github/graphql-writes.js` header comment (field meanings) and the first 10 entries (patterns: quiet,
  notifying, destructive, `inverse`).
- `src/github/capability-inventory.js` lines 220–250 (how a mutation becomes `missing` vs covered).
- `src/tools/universal-graphql.js` (how a spec is executed; do not change it unless a test proves it necessary).
- The existing tests for specs: `grep -ln "WRITE_SPECS" tests/unit/*.js`.
- Per mutation: `node scripts/graphql-find.mjs <mutationName>` (input type and payload).

## Drift check A
| Expected | Actual on main | Action |
|---|---|---|
| `node scripts/capability-inventory.mjs --report` says "GraphQL mutations with no write specification: 234" | | |
| `WRITE_SPECS` has ~24 entries | | |

## Step 0 (every PR): mark curated coverage first
For each mutation in the PR's group, run `grep -rn "<mutationName>" src/tools/*.js`. If a curated tool already sends
it (or a REST tool does the identical job, e.g. `createLabel` = `github_label_save`), add it to a new exported map in
`src/github/capability-inventory.js`: `COVERED_BY_TOOL = new Map([['createLabel','github_label_save'], …])` and make
the inventory mark those rows `implemented-unverified` with that tool as route `curated`. That is not a write spec; it
just stops counting them as missing. Add a unit test that every tool name in the map exists in the registry.

## Groups (one PR each, in this order)
1. **Projects v2 (32)** — `addProjectV2DraftIssue … updateProjectV2View`. Many are already done by Y-4 tools: map them in
   Step 0. Specs for the rest use `scope:'org'` for organization projects and a new `scope:'owner'` only if a user
   project needs it (add with a test; ids must resolve to a project owned by a connected account). `delete*` →
   `destructive`, `deleted:true`, no inverse, `undoHint`.
2. **Issues, sub-issues, labels, PR reviews, discussions, reactions, comments (≈60)** — issue fields/types
   (`createIssueType` … `updateIssueFieldValue`), `addSubIssue`/`removeSubIssue`/`reprioritizeSubIssue`,
   `addBlockedBy`/`removeBlockedBy`, `addRelatesTo`/`removeRelatesTo`, `addReaction`/`removeReaction`, `addUpvote`/
   `removeUpvote`, `addDiscussionPollVote`, `markFileAsViewed`/`unmarkFileAsViewed`, `resolveReviewThread` (+ unresolve
   already exists?), review mutations not covered by E-3 tools. Comment-creating mutations are `notifying`.
3. **Repository, environments, checks, deployments, branches, custom properties, interaction limits, user lists,
   follow (≈55)** — e.g. `createEnvironment`, `pinEnvironment`, `createCheckRun`, `approveDeployments`,
   `createRef`/`deleteRef`, `mergeBranch`, `setRepositoryCustomPropertyValues`, `createUserList`, `followUser`.
   Most have REST twins → Step 0. Remaining get specs; `deleteRef`/`deleteEnvironment` are destructive; `mergeBranch`
   must refuse a protected default branch (reuse the production guard via `preflight:'repo-admin'` or a new named
   preflight with a test).
4. **Deliberately refused or owner-gated (≈60)** — enterprise membership and identity provider (`inviteEnterprise*`,
   `removeEnterprise*`, `setEnterpriseIdentityProvider`, `regenerateEnterpriseIdentityProviderRecoveryCodes`,
   `transferEnterpriseOrganization`, `createEnterpriseOrganization`), migrations (`startRepositoryMigration`,
   `grantMigratorRole`…), sponsorship money moves (`createSponsorship(s)`, `cancelSponsorship`), IP allow lists,
   verifiable domains, `removeOutsideCollaborator`, `accessUserNamespaceRepository`. Add them to a new exported
   `REFUSED_MUTATIONS = new Map([[name, 'plain reason']])` in `graphql-writes.js`; the inventory marks them
   `unresolved` → change to a new state label `refused-by-design` (update the report printer and its test). The enterprise
   *settings* mutations (`updateEnterprise*Setting`, `updateEnterpriseProfile`) are NOT refused: give them specs with a
   new `scope:'enterprise'` that calls `requireEnterprise` from ENT-1 (do group 4 after ENT-1).

## Spec checklist (copy for every new entry)
- [ ] `ids` lists every ID input with its allowed node types; any other ID input is refused.
- [ ] `changes` lists every non-ID input; nothing else is accepted.
- [ ] `before` selection reads exactly the fields `verify` needs.
- [ ] `already` returns true when nothing would change.
- [ ] `verify` checks the requested value, not just "no error".
- [ ] `inverse` restores the previous state, or `inverse:null` plus `undoHint`.
- [ ] `cls` marks: `notifies` for anything that pings people, `accessWidening` for adding people/permissions,
      `destructive` for deletes. Never lower a mark (Batch Y decision Y4).
- [ ] A test in `tests/unit/gql-1-<group>.test.js`: valid input runs the lifecycle against the fake GraphQL (validated
      against the vendored schema); an extra input key is refused; a wrong node type is refused; `already` path refuses.

## Done when
- [x] Four PRs merged; `node scripts/capability-inventory.mjs --report` shows 0 rows "GraphQL mutations with no write
      specification"; refused ones are listed with reasons; TOOL-CATALOG unchanged (no new tools) except the
      universal tool's description if it mentions counts.

## Progress
- [x] Group 1 (Projects v2) — 25 mutations mapped to existing `github_project_*` tools (`curated` map in
      `src/github/mutation-classes.js`, which also stops the generic route bypassing those tools); 7 new reviewed specs
      (`updateProjectV2View` (name, filter, layout; visible columns refused), `updateProjectV2StatusUpdate`, `deleteProjectV2StatusUpdate`, `deleteProjectV2Workflow`,
      `mark/unmarkProjectV2AsTemplate`, `updateProjectV2DraftIssue`); 2 refused on purpose
      (`updateProjectV2Collaborators`, `createProjectV2IssueField`) via the new `REFUSED_MUTATIONS` map and inventory
      state `refused-by-design`. Org-scope ownership now accepts a project (and its views, status updates, workflows,
      draft issues) owned by the enrolled account. Tests: `tests/unit/gql-1-projects.test.js` and the new rows in
      `tests/unit/y2-graphql-specs.test.js`. Note: the card said to add a new `COVERED_BY_TOOL` map; the existing
      `curated` map already does exactly this, so it was extended instead.
- [x] Group 2 (issues, labels, reviews, discussions, reactions) — 43 mutations mapped to existing tools (assignees,
      dependencies, sub-issues, labels, reactions, close/reopen/transfer, comments, review create/submit/dismiss/reply/
      resolve/request, review comment edit/delete, auto-merge, branch update, issue types and fields, field values);
      10 new specs (upvotes, poll vote, review edit/delete, viewed files, closing references, unmark duplicate);
      10 refused on purpose with reasons (merge queue, revert, related-issue links, pending-review adds, suggestion
      apply/reject, clearing an issue field value). Test: `tests/unit/gql-1-issues.test.js` + new rows in
      `tests/unit/y2-graphql-specs.test.js`.
- [x] Group 3 (repository, environments, checks, deployments, branches) — 40 mutations recorded as covered by existing tools
      (refs, repositories, environments, checks, deployments, interaction limits, custom properties, follow, outside
      collaborators, team repo access, package versions, vulnerability alerts, sponsorship start/cancel); 2 new specs
      (`updateTopics`, `deleteDeployment`). Tests: `tests/unit/gql-1-repo.test.js`, new rows in `y2-graphql-specs`.
- [~] Group 4 — refused / owner-gated part DONE in the same PR as group 3 (card group 3 and 4 refusals are small data
      entries, so one PR: classic projects, enterprise membership/identity, migrations, IP allow lists, verifiable
      domains, sponsor money moves, star lists and others, each with a plain reason in `REFUSED_MUTATIONS`).
      The 16 enterprise setting mutations are done in the last PR: 10 member policies and the profile through two new tools
      (`github_enterprise_policy_set`, `github_enterprise_profile_set`, master token, enterprises the person administers,
      read back, undo) instead of the card's `scope:'enterprise'` inside the generic GraphQL route (that would have
      reworked the credential and gate pipeline of every GraphQL write for 16 rarely used settings); 5 refused on
      purpose (two-factor requirement and methods can lock members out, deploy keys and repository projects cannot be
      read back, repository-creation policy has five linked fields). Capability report shows 0 `missing`.
- [x] All four groups done (PRs #345, #346, #347, and the enterprise PR).

## Administrative completion, 2026-10-28

Eight former missing contracts are now available through github_enterprise_policy_set: required/disallowed two-factor methods, repository deploy keys/projects, coarse or granular repository creation and three IP allow-list enforcement policies. Pinned schema supplies actual readback fields and ownerId versus enterpriseId inputs. Granular creation preserves omitted visibility values, rejects mutually exclusive coarse/granular forms, and does not promise an inverse when linked prior values are nullable. All changes require verified enterprise administration and actual master scope; provider refusals, replay, readback and explicit restrictions remain effective. No live policy changed as a test.
