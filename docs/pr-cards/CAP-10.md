# CAP-10 — PR archive / unarchive / revert named tools (CAP-7 follow-on M3): filed with evidence

## Origin

[CAP-7](CAP-7.md)'s missing-with-plan row M3: "PR archive/unarchive + revert have no
dedicated tool (GraphQL block). TO-BE-FILED: a named-tool card in the PR line if the owner
wants them curated; DOOR-covered meanwhile. Not counted in the core MISSING total."
This card is that filing. It records why the legs are NOT clean single additions today, so
the owner's curation decision is made on evidence.

## Evidence (pinned sources, checked 2026-11-04 in Takeover Batch 2)

- The mutations exist in the pinned GraphQL schema (schema-2026-10-09):
  `archivePullRequest`, `unarchivePullRequest`, `revertPullRequest`
  (`scripts/graphql-find.mjs` returns all three).
- Archive/unarchive cannot satisfy this server's write contract: a write must be verified
  from an independent read-back, and the pinned schema exposes NO readable archived state
  on the PullRequest type (no `isArchived` or equivalent field in
  `vendor/github-graphql/schema.docs.graphql`; the schema's `isArchived` fields belong to
  Marketplace listings, classic project cards and other types). The universal door's
  recorded position stands for exactly this reason (`src/github/graphql-writes.js`,
  REFUSED_MUTATIONS: "GitHub offers no way to read the archived state of a pull request,
  so the change could not be confirmed."). A named tool built today would report every
  outcome unconfirmed by construction.
- Revert carries a different recorded gap: the mutation creates a new branch and pull
  request whose ownership cannot be proven beforehand under the scoped-write contract
  (same file: "It creates a new branch and pull request whose owner cannot be proven
  beforehand. Revert with github_content_push_files, then github_pr_create."). The
  composed alternative named there already works through existing tools.

## Disposition

NOT BUILT. The legs stay as they are (refused-by-design rows in the census's engineering
backlog — implementation gaps, not owner policy). Build when either:

- the pinned GraphQL schema gains a readable pull-request archived state (archive /
  unarchive then become ordinary verifiable named tools), or
- the owner directs curation anyway, accepting unconfirmed-by-construction outcomes for
  archive/unarchive and a bespoke ownership proof design for revert.

CAP-7's condition stands over this card: these are curated only if the owner wants them
curated.

## What changed

- This card and its work-index registration only. No source code, no tool registrations,
  no change to the refused-by-design records.

## Drift check

Baselines re-verified before composing: the schema searches and the refused-mutation
records were read at the Batch 2 head against the vendored pins. The filing changes no
behavior, raises no spend and widens no access; it converts an oral "not built" into a
recorded, evidence-carrying "not buildable as a verified tool yet".
