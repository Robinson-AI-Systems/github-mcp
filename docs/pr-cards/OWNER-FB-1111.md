# OWNER-FB-1111 — Writes that worked say so; owner is found; inputs take either shape

## Owner approval 2026-11-11

Chris reported in chat on 2026-11-11 19:02 MST: several writes said "accepted, but reading it back did not show the expected result" though they had succeeded; PR status reads fail unless the organization is named; starting a workflow wants its inputs as a list, not the usual object.

## Outcome and acceptance

Outcome: a write is read back twice before it is called unconfirmed; a workflow start is confirmed by GitHub's 204; a call with no owner finds the single connected account that holds the repository; `inputs` accepts an object. Accepted when `tests/unit/owner-feedback-2026-11-11.test.js` covers each.

## Drift check

No permission, credential or confirmation rule changes. A change is never sent twice. Owner discovery only reads, and only picks an account the connection already has.
