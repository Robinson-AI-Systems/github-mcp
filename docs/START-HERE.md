# Start here

Robinson GitHub MCP lets your AI (Claude and others) work in your GitHub accounts. It is live at `https://github.robinsonaisystems.com`. Nothing here needs you to code.

## What to read

1. [OWNER-CHECKLIST](OWNER-CHECKLIST.md): the short list of things only you can do.
2. [OWNER-GUIDE](OWNER-GUIDE.md): what you can ask for, and your safety switches.
3. [DEPLOY](DEPLOY.md): how the server is set up, and what to do if it breaks.
4. [GO-LIVE-CHECKLIST](GO-LIVE-CHECKLIST.md) and [OWNER-INPUTS](OWNER-INPUTS.md): switches and your recorded decisions.

Current progress is in [STATUS](STATUS.md). The governing decision is [OWNER-DECISION-2026-10-27](OWNER-DECISION-2026-10-27.md).

## Connect from Claude on your phone

Claude's phone apps can use a connector but cannot add one. Add it once on the web or desktop, then use it on your phone. Source: [Claude help article](https://support.claude.com/en/articles/11503834). Needs a Pro, Max, Team or Enterprise plan.

1. On claude.ai (or Claude Desktop), open **Customize**, then **Connectors**. (Menu names move around; on the desktop app it is Settings, then Connectors.)
2. Choose **Add custom connector**.
3. Paste `https://github.robinsonaisystems.com/api/mcp` and choose **Add**.
4. Choose **Connect**. Your browser opens the sign-in page on our server (`/api/oauth/authorize`).
5. On that page, pick your GitHub account or accounts, the default account, the **Mode**, the **Profile** (Read only, Everyday or Full) and the tool listing. Type your administrator passphrase and press **Authorize this connection**.
6. Open Claude on your phone, start a chat, turn the connector on, and ask: "Which GitHub accounts am I connected to?"

Notes:

- On a team plan, an owner adds the connector first, then members press Connect.
- If the sign-in page instead says "Sign in with GitHub" and then shows an **Approve** page, that is the public sign-in. Press **Approve** (tick Read-only if you want no changes). The code switches between the two pages with the `GITHUB_PUBLIC_CONNECT` setting (`src/oauth/routes.js:16-30`). Which one production uses today: unverified.
- Adding the connector from the phone app itself: unverified. The owner reported it worked on 2026-10-24 (comment in `src/brand/home-page.js:30`), but Claude's help article says it is not supported.
- Use a full browser (Chrome, Safari), not an app's built-in browser, for the sign-in and setup pages.
- Disconnect or change permissions later at `/connection` (public sign-in only).

## For agents

Read [AGENTS.md](../AGENTS.md) first. Then [SESSION-START](SESSION-START.md), [STATUS](STATUS.md) and [MASTER-ROADMAP](MASTER-ROADMAP.md). Tool list: [TOOL-CATALOG](TOOL-CATALOG.md). Runtime facts: [ARCHITECTURE](ARCHITECTURE.md). Older dated notes and `docs/archive/` are history, not instructions.
