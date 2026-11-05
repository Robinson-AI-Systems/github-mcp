# CAP-8 — Deployment-record delete (CAP-7 follow-on M2)

## Origin

[CAP-7](CAP-7.md)'s missing-with-plan row M2: "Delete a deployment record (map §9.1) — 1 leg;
the core's one clean symmetry break (create exists, delete does not). TO-BE-FILED: small card
adding the delete leg beside `github_deploy_create` with the confirmation discipline of
`github_actions_delete_run`, or a recorded deliberate refusal with the owner's word."
This card is that filing, and the leg is built in the same change that lands the card.

## Outcome and acceptance

Outcome: `github_deploy_delete` — a guarded named tool that permanently deletes one deployment
record, beside `github_deploy_create` / `github_deploy_set_status` in the G-4 deployments family.

Accepted when, in this change:

- the tool passes the nine write-contract checks through every door (the deployments write
  contract suite carries it), with `confirm: 'always'` — the `github_actions_delete_run`
  discipline: preview first unless the caller confirms, one DELETE, independent read-back;
- a deployment whose latest status is not `inactive` is refused BEFORE any write, with the one
  call that makes it deletable named (`github_deploy_set_status` to `inactive`) — GitHub only
  deletes inactive deployments, so the refusal replaces GitHub's post-confirmation 422;
- an unknown deployment id is refused before any write; after a delete, a fresh read must show
  the record gone or the outcome is reported unconfirmed, never applied;
- production classification comes from the deployment's own recorded environment and ref
  (the family's existing `productionReason` path), never from caller labels;
- the universal REST door defers to the named tool for the exact route
  (`DELETE /repos/{owner}/{repo}/deployments/{deployment_id}` in the hand-built map);
- the census credits the leg: the route's inventory row moves from unresolved to
  implemented-unverified (census unresolved 1,184 → 1,183 in this change, shared with the
  CAP-7 M4 tranche recorded in the session status note).

## What changed

- `src/tools/deployments-write.js` — the `github_deploy_delete` definition (read, classify,
  summarize, apply, readAfter, verify, present) beside the existing two legs.
- `src/github/hand-built-map.js` — the exact-route entry pointing the universal door at the
  named tool.
- `src/github/fine-grained.js` — the Deployments permission area names the new tool.
- `tests/unit/deployments-write.test.js` — the write contract for the delete leg through all
  doors, plus behavior tests: inactive delete verified gone; active latest status refused with
  nothing sent; unknown id refused with nothing sent.
- `docs/TOOL-CATALOG.md` — the deployments section carries the new row (11 tools).

## Not changed

- No existing deployment tool's behavior; `github_deploy_create` and `github_deploy_set_status`
  are untouched, including their classify legs.
- No deliberate-refusal route was needed: the owner's word was not required because the leg
  was buildable as planned.

## Drift check

Baselines re-verified before composing: the pinned REST catalog (2026-03-10) carries
`DELETE /repos/{owner}/{repo}/deployments/{deployment_id}` ("Delete a deployment"); the fake
GitHub in the contract suite validates every request against that same pinned catalog, so the
request shape is proven against the pin, not against memory. The change is one guarded write
tool and its records; it widens no access and adds no spend.
