# ERR-REF-1 — A missing branch is reported as missing, not as access

## Owner approval 2026-11-02

Chris relayed the review note in chat on 2026-11-02 05:26 MST ("the error for a branch that doesn't exist says the
credential cannot see it … points you toward a permissions problem when the branch just hasn't been created yet").

## Outcome and acceptance

Outcome: GitHub's missing-branch/ref answers explain the branch is absent and suggest listing or creating it. Accepted when
`tests/unit/errors.test.js` covers the 404/422 message forms and the URL form, and a generic 404 is unchanged.

## Drift check

Wording only; no tool, credential, permission or request change.
