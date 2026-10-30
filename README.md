# Robinson GitHub MCP

A hosted MCP server that lets Chris Robinson's AI agents work in GitHub for every project: repositories, files, pull requests, CI, releases, issues, rules, security, members, apps and billing, plus Git workspaces (clone, edit, commit, push). It runs on Vercel with its own Neon database. It works fully on its own; Robinson's Toolkit (the hub) can optionally offer it too.

**Live address:** `https://github.robinsonaisystems.com`. Connect address for an AI app: `https://github.robinsonaisystems.com/api/mcp`.

**Tools:** 498 in the code today (208 for the Read-only profile, 295 for Everyday, all 498 for Full). Source: `src/tools/index.js`, counted by `python3 scripts/count-catalog.py`. The live home page shows the same counts.

## Where to start

- Chris: [docs/START-HERE.md](docs/START-HERE.md), then [docs/OWNER-GUIDE.md](docs/OWNER-GUIDE.md) and [docs/OWNER-CHECKLIST.md](docs/OWNER-CHECKLIST.md).
- Agents: read [AGENTS.md](AGENTS.md) first, then [docs/OWNER-DECISION-2026-10-27.md](docs/OWNER-DECISION-2026-10-27.md), which governs older restrictions.
- Current state: [docs/STATUS.md](docs/STATUS.md).

## Rules in one paragraph

Your own full connection runs what you ask in one call: it tells you the effect and any known or unknown cost, does it, logs it and reads the result back. GitHub's own permissions and repository settings still apply. Passes you hand to other agents keep the limits you chose for them. Secrets and keys never pass through an AI or a tool. Read-only connections stay read-only. Full detail: [owner decision](docs/OWNER-DECISION-2026-10-27.md).

## Other clients

- **Meta Muse Code:** add the connect address as a `streamable_http` server under `mcp_servers` in `~/.config/muse/settings.json`, run `muse mcp login github-robinson`, then `/mcp`. The live home page shows the exact JSON.
- **Meta Muse assistant (Android, iPhone, web):** add a custom connector with the connect address. If it asks for a Client ID, use the public, non-secret `pcl_meta_muse_public_client_20261026_v1xyz` and leave Client Secret blank. Each person signs in with their own GitHub. Live Muse acceptance is still unverified.
- Never paste a GitHub token or password into an AI chat.

## License

All rights reserved; see [LICENSE](LICENSE). Contributions: [CONTRIBUTING.md](CONTRIBUTING.md). Every PR is reviewed; nothing merges or deploys automatically. Hub rules: [docs/HUB-COMPATIBILITY.md](docs/HUB-COMPATIBILITY.md).
