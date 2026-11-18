# Map

The relational system map for this repository lives in
[docs/relational-map/](relational-map/README.md) — start with its
overview, then the area file for whatever you are changing:

- [Overview](relational-map/README.md) — the whole system in one picture
- [MCP endpoint and the tool catalogue](relational-map/mcp-and-tools.md)
- [Auth, connection flow, tenancy and storage](relational-map/auth-tenancy-and-storage.md)
- [GitHub backend, rate limiting, summaries and safety](relational-map/github-backend-and-safety.md)
- [Workspaces, git remote, playground and fleet](relational-map/workspaces-playground-and-fleet.md)
- [Hosting, entrypoints and release](relational-map/hosting-and-release.md)

`docs/ARCHITECTURE.md` remains the detailed runtime-facts record; the
relational map is the readable diagram of how the parts connect.
Keeping the map current is a landing rule — see `docs/RULES.md`.
