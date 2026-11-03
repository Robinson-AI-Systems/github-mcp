# BRAND-UNLEASHED-1 — the product is "GitHub Unleashed by Robinson AI Systems" everywhere people see it

## Owner direction 2026-11-03

Chris ordered the rename (relayed by his assistant, verified live): the company website already says "GitHub
Unleashed" while the live server still called itself "Robinson GitHub MCP" / "Robinson MCP for GitHub". Every public
surface uses the brand spec's name (docs/UNLEASHED-BRAND-SPEC.md §4), its disclaimer (§6.3) and this product's Arctic
`#4DDFFF` accent (§3, claims registry D-005). Stable identifiers never churn.

## Outcome and acceptance

Outcome: the MCP server title, home page, My connection and its sub-pages, sign-in/consent pages (owner and private
pilot), Marketplace connect page, `github_server_status` (`product`), error text, and the README/START-HERE/legal/listing/website docs all read
"GitHub Unleashed by Robinson AI Systems" (short form "GitHub Unleashed" where space is tight), with the required
disclaimer on every page footer, connect page, website button and the README front page; the shared page
CSS uses the Arctic accent with Charcoal text on it.
Accepted when tests/unit/brand-unleashed-1.test.js passes (name on serverInfo/pages, disclaimer present, accent
contrast above 7:1, `serverInfo.name`/package/server.json name unchanged, every tool still `github_*` and in the
catalog), the updated name tests pass, and the browser home/sign-in tests pass at phone width.

## What stays (stable identifiers)

`serverInfo.name` `robinson-github-mcp` (clients may key on it; only `title` changes), tool names, package name,
server.json `name`, the domain and endpoint paths, OAuth clients and registrations, the registered GitHub App and its
name/slug on GitHub (the pages now say "the GitHub Unleashed app"), database and environment variable names, the
`Robinson Playground` / `Robinson's Toolkit` product names (other products), and dated history (status notes, merged
cards, archive). AGENTS.md is the rules file and is left for Chris to reword.

## Drift check

Presentation and text only: no new tool, setting, credential, request shape or data change. One additive output
field: `github_server_status` adds `product` (the display name). The accent is the spec's claimed colour; pages that
have their own plain style (consent, setup) gain the disclaimer but no new colours.

## Surfaces restored after PUSH-FIXTURE-1

The push gate first refused files that hold the repository's documented FAKE test tokens. PUSH-FIXTURE-1 (#568) fixed
that, so this PR also renames: the private owner setup page title and heading, plus the disclaimer at its foot
(`src/github/setup-html.js`); the `/api` status JSON `name` (`api/index.js`); the `acting_as` words in tool results
("GitHub Unleashed app", `src/github/act-as.js`); the Git login prompt name (`GIT_REALM`, now "GitHub Unleashed git",
`src/git-remote/wire.js`) and the push refusal text (`workers/native-git/remote-hook.mjs`). The tests for each were
updated, and tests/unit/brand-unleashed-1.test.js covers them.

## Still on the old name (follow-up)

The wiki commit author name in `src/github/wiki-git.js`. That file still trips a separate false positive in the gate (an
auth callback line that the database-password rule reads as a password), so its text is left unchanged. See
docs/ROADMAP.md, "Content protection follow-ups".
