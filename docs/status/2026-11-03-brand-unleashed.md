# 2026-11-03 — rename to "GitHub Unleashed by Robinson AI Systems" (BRAND-UNLEASHED-1)

Branch `ai/claude/brand-unleashed` (card docs/pr-cards/BRAND-UNLEASHED-1.md). Every public surface now names the
product "GitHub Unleashed by Robinson AI Systems" (short "GitHub Unleashed" in tight places): MCP server title, home
page, My connection and its pages, both consent pages, Marketplace connect page, `github_server_status` (`product`),
error text, README/START-HERE/legal/listing/website docs. The
brand spec disclaimer is on every page footer, connect page, the website button and the README front page.
Shared page CSS uses the Arctic `#4DDFFF` accent (links, focus ring, chosen option, buttons with Charcoal text, 12:1).
Unchanged on purpose: `serverInfo.name`, tool names, package/server.json names, domain, paths, OAuth/App registrations,
database and environment names. Owner row 7 (optional App rename on GitHub) added. Takes effect on the next `live`
release; no owner step needed for the rename itself.

Not renamed (the push hook refuses edits to files holding fake test credentials; see the card's last section and the
ROADMAP item): private setup page title, `/api` status `name`, `acting_as` words in tool results, Git realm and push
refusal text, wiki commit author.
