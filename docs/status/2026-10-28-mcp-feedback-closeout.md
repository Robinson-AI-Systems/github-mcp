# 2026-10-28 — Complete GitHub MCP coding-agent feedback issue sweep (source acceptance)

Ten original issue IDs **#427, #428, #429, #430, #431, #432, #433, #434, #435, #436** were each read directly from GitHub and each returned **state `closed`, reason `completed`**.

| Issue(s) | Verified delivery |
|---|---|
| #427 | Byte-exact large-file retrieval, earlier checked PR |
| #428 | Single-copy large results, earlier checked PR |
| #429 + #434 | Read aliases and versioned direct manifest, earlier checked PR |
| #430 + #436 | Resumable repository ZIP and universal read selectors, PR #440, exact head `1de458e131e1f214abd85533bcef386ef327841d` |
| #432 + #433 | Inline exact-head CI errors, native merge-arming inspection, PR #441, exact head `8a6e52a3378bff65a8e0067e529d9c3962157f90` |
| #435 | Credential-specific observed rate metadata, PR #442, exact head `2a9b028a71ebc3e562824ba868199c9e5a6b2d30` |
| #431 | Guarded sequential write batch with 1-call branch/commit/PR and durable PG lease/replay; PR #443, exact head `fa49ffe85f28f876e39e30a84043ea898b37a88c` |

For PRs #441, #442 and #443, required `ci` and `release-policy` were observed **green at each final exact source head**, no blocking review threads remained, the custom GitHub MCP confirmed merged, and issue states were independently verified. PR #443's final CI run ID is `40640116922`, all jobs succeeded; final main merge commit `32d5bfb3ed94dfbd365fd8fe59ab2701e98cb5cc`. PR #440's check/merge/closure were independently verified in the prior checkpoint. There were intermediate red CI runs and review fixes; none were bypassed, disabled, weakened or called passing before verification.

Historical C-13 grouped #435 on paper, but PR #440 only delivered #430/#436; #435 was delivered and closed separately in C-15/PR #442. The work index now marks C-13/C-14/C-15/C-16 merged with their actual PRs; plans, owner guide, status, roadmap and database notes reflect checked source acceptance.

**Remaining outside this completed issue sweep:** standard checked release under the repository's existing policy (no manual release authorized here), installed connector tool refresh, real-world client/agent smoke tests and performance measurement. No production data, customer messaging, payment or external-project settings were changed. This PR modifies documentation only.
