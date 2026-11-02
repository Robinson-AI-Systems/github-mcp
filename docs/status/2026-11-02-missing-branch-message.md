# 2026-11-02 — a missing branch is reported as missing (ERR-REF-1)

Owner-relayed review note: a branch that does not exist produced "this credential cannot see it … check the App is
installed", pointing agents at permissions. `src/tools/errors.js` now returns kind `ref_not_found` with the branch name
for GitHub's 404 "Branch not found" / "No commit found for the ref …", 422 "No commit found …" / "Reference does not
exist", and a plain 404 on a branch/ref URL: "does not exist yet, was deleted, or is misspelled — not a permissions
problem when the repository itself can be read", with next step "list branches or create it first". A plain 404 elsewhere
keeps the existing access wording. Tests: `tests/unit/errors.test.js`.
