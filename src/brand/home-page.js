// The public home page "/": what the service does, the one address to paste, and how to connect each kind of AI app.
// No scripts (the address is plain selectable text), strict CSP, fits a 412 px phone. Client steps were checked against each
// client's own official documentation on 2026-10-24; the pages are cited in the HTML comments below.
import { BRAND, BRAND_CSS, brandHeader, brandFooter } from './brand.js';
import { escapeHtml as h } from '../core/http.js';
import { MUSE_PUBLIC_CLIENT_ID } from '../tenancy/muse-client.js';

export const HOME_CSP = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'";
export const SERVER_ADDRESS = (origin) => `${origin}/api/mcp`;

const STYLE = BRAND_CSS + 'main{max-width:640px}.addr{display:block;background:var(--surface);border:1px solid var(--brand);border-radius:12px;padding:14px;margin:10px 0 18px;font:600 15px/1.4 ui-monospace,Menlo,Consolas,monospace;word-break:break-all;user-select:all}' +
  'pre{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px;overflow-x:auto;white-space:pre-wrap;word-break:break-all;margin:8px 0 14px;font:14px/1.5 ui-monospace,Menlo,Consolas,monospace}' +
  'section{border-top:1px solid var(--border);padding-top:14px;margin-top:18px}h2{font:700 19px/1.3 Inter,-apple-system,sans-serif;margin:0 0 8px}ol{padding-left:22px;margin:0 0 12px}li{margin:4px 0}' +
  'a.button{display:block;text-align:center;font:600 16px Inter,-apple-system,sans-serif;color:#fff;background:var(--grad);border-radius:50px;padding:13px 20px;text-decoration:none;margin:14px 0}ul.links{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:6px 18px}';

/** @param {string} origin the public https address of this service, no trailing slash */
export function renderHome(origin = 'https://github.robinsonaisystems.com') {
  const address = h(SERVER_ADDRESS(origin));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${h(BRAND.product)}</title>
<meta name="description" content="Let your AI assistant work with your GitHub safely: repositories, pull requests, issues and more. Free."><style>${STYLE}</style></head><body><main>${brandHeader()}
<h1>Let your AI assistant work with your GitHub, safely</h1>
<p>${h(BRAND.product)} connects Claude, ChatGPT and other AI apps to your GitHub account. You sign in with GitHub and choose what the assistant may do.</p>
<ul><li>Read and manage repositories, files, branches, pull requests, issues and Actions.</li>
<li>Read-only mode prevents all changes. Sensitive changes involving production, access, notifications or spending require preview and confirmation; routine permitted changes may execute directly.</li>
<li>Free. You can disconnect and delete your data at any time.</li></ul>
<p><small>Not affiliated with or endorsed by GitHub.</small></p>
<section id="connect"><h2>Connect your AI app</h2><p>Paste this address into your AI app when it asks for a server or connector address:</p>
<code class="addr" id="address">${address}</code>
<!-- Steps below checked on 2026-10-24 against each client's official documentation:
  Claude: https://www.claude.com/docs/connectors/custom/remote-mcp (Claude can add a connector from its phone app, confirmed by the owner 2026-10-24 and 2026-10-30; Customize > Connectors > Add custom connector > paste the URL > Add > Connect).
  ChatGPT: https://developers.openai.com/api/docs/guides/custom-mcp-server (ChatGPT cannot add one from its phone app: add it in the phone's web browser, then use it in the app, owner 2026-10-30. ChatGPT Plugins > plus > Add custom MCP server > name and URL > OAuth > confirm > Create as a plugin; install it before use).
  Claude Code: https://code.claude.com/docs/en/mcp (claude mcp add --transport http <name> <url>; run /mcp to sign in).
  Cursor: https://cursor.com/docs/context/mcp (.cursor/mcp.json or ~/.cursor/mcp.json, "mcpServers" with a "url").
  VS Code: https://code.visualstudio.com/docs/copilot/reference/mcp-configuration (.vscode/mcp.json, "servers" with "type": "http" and "url").
  Meta Muse Code: https://dev.meta.ai/docs/muse-code/extending (streamable_http and muse mcp login).
  Meta Muse personal assistant: https://about.fb.com/news/2026/09/introducing-muse-small-business/ (custom connectors); https://platform.muse.ai/docs (Meta catalog review). -->
<h2>Claude (web, desktop and phone app)</h2><ol><li>Open Claude on the web, or in the desktop or phone app, and go to <b>Customize</b>, then <b>Connectors</b>.</li><li>Choose <b>Add custom connector</b> and paste the address above.</li><li>Choose <b>Add</b>, then <b>Connect</b>, and sign in with GitHub.</li></ol>
<p><small>On a team or company plan, an owner adds it first under Organization settings, then members choose Connect.</small></p>
<h2>ChatGPT</h2><p><small>On a phone, add it from the phone's web browser at chatgpt.com. Once added, you can use it in the ChatGPT app too.</small></p><ol><li>Open ChatGPT on the web and go to <b>Plugins</b>.</li><li>Choose the plus button, then <b>Add custom MCP server</b>.</li><li>Enter a name and paste the address above. For authentication choose <b>OAuth</b>.</li><li>Confirm the warning, choose <b>Create as a plugin</b>, then install it and sign in with GitHub.</li></ol>
<h2>Claude Code</h2><pre>claude mcp add --transport http github-robinson ${address}</pre><p><small>Then type /mcp inside Claude Code and sign in.</small></p>
<h2>Cursor</h2><p>Add this to <code>.cursor/mcp.json</code> (or <code>~/.cursor/mcp.json</code>), then sign in when asked:</p>
<pre>{
  "mcpServers": {
    "github-robinson": { "url": "${address}" }
  }
}</pre>
<section id="meta-muse"><h2>Meta Muse (personal assistant — Android, iPhone and web)</h2>
<p>In Muse, open <b>Settings → Connectors → Add custom connector</b>. For the server address, paste the full HTTPS MCP URL:</p>
<code class="addr" id="muse-address">${address}</code>
<p>Muse may register automatically. If it instead shows the <b>Secure credentials store</b> screen asking for a Client ID and Secret, use this <b>public, nonsecret client ID</b> (the same for everyone):</p>
<code class="addr" id="muse-client-id">${h(MUSE_PUBLIC_CLIENT_ID)}</code>
<p><b>Client Secret: leave blank.</b> Then choose Add. Muse should open GitHub sign-in, where each person signs in to <em>their own GitHub account</em>, approves the App installation on their chosen repositories if needed, and approves Muse. The browser returns to Muse automatically. Never enter a GitHub password, access token, or the service owner's credentials in Muse.</p>
<p>You can also ask Muse to create the connector for you:</p>
<pre id="muse-connector-request">Create a custom connector named Robinson MCP for GitHub.
Service: ${address}
Protocol: remote Streamable HTTP MCP.
Authentication: OAuth authorization code with S256 PKCE (public client, no secret).
If a Client ID is required, use ${h(MUSE_PUBLIC_CLIENT_ID)} and leave Client Secret blank.
Let me approve my own GitHub account in the browser. Never request GitHub passwords or tokens in chat.
Once connected, show my tools; make changes only after I ask.</pre>
<p><small>The Client ID identifies Muse, not any GitHub user, and gives no access by itself. Each user's OAuth session, tenant, GitHub installation and permissions are kept separate. If Muse cannot reach the sign-in page, use Muse Code below or the official GitHub connector. This service is not a Meta-reviewed or Meta-listed connector. Live Muse acceptance is pending.</small></p>
<h2>Meta Muse Code (coding assistant)</h2>
<p>In Muse Code's <code>~/.config/muse/settings.json</code>, add this entry to <code>mcp_servers</code> (keep your existing settings):</p>
<pre id="muse-code-config">{
  "mcp_servers": {
    "github-robinson": {
      "transport": "streamable_http",
      "url": "${address}",
      "enabled": true,
      "mode": "optional"
    }
  }
}</pre>
<p>Then run <code>muse mcp login github-robinson</code> and approve the GitHub sign-in in your browser. In Muse Code, type <code>/mcp</code> to check the connection. You can log out with <code>muse mcp logout github-robinson</code>.</p>
<p><small>Both paths use the same independently secured GitHub service. No Meta special access, credentials in chat, or approval bypass is needed.</small></p></section>
<h2>VS Code</h2><p>Add this to <code>.vscode/mcp.json</code>, then sign in when asked:</p>
<pre>{
  "servers": {
    "github-robinson": { "type": "http", "url": "${address}" }
  }
}</pre></section>
<section><h2>Already connected?</h2><a class="button" href="/connection">Open My connection</a>
<ul class="links"><li><a href="/limits">Free use limits</a></li><li><a href="/privacy">Privacy</a></li><li><a href="/terms">Terms</a></li><li><a href="/security">Security</a></li><li><a href="/support">Support</a></li></ul></section>
${brandFooter()}</main></body></html>`;
}
