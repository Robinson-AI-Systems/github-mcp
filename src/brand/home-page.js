// The public home page "/": what the service does, the one address to paste, and how to connect each kind of AI app.
// No scripts (the address is plain selectable text), strict CSP, fits a 412 px phone. Client steps were checked against each
// client's own official documentation on 2026-10-24; the pages are cited in the HTML comments below.
import { BRAND, BRAND_CSS, brandHeader, brandFooter } from './brand.js';
import { escapeHtml as h } from '../core/http.js';
import { MUSE_PUBLIC_CLIENT_ID } from '../tenancy/muse-client.js';

export const HOME_CSP = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'";
export const SERVER_ADDRESS = (origin) => `${origin}/api/mcp`;

const STYLE = BRAND_CSS + 'main{max-width:640px}.addr{display:block;background:var(--surface);border:1px solid var(--accent);border-radius:12px;padding:14px;margin:10px 0 18px;font:600 15px/1.4 ui-monospace,Menlo,Consolas,monospace;word-break:break-all;user-select:all}' +
  'code{word-break:break-all}pre{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px;overflow-x:auto;white-space:pre-wrap;word-break:break-all;margin:8px 0 14px;font:14px/1.5 ui-monospace,Menlo,Consolas,monospace}' +
  'section{border-top:1px solid var(--border);padding-top:14px;margin-top:18px}h2{font:700 19px/1.3 Inter,-apple-system,sans-serif;margin:0 0 8px}ol{padding-left:22px;margin:0 0 12px}li{margin:4px 0}' +
  'a.button{display:block;text-align:center;font:600 16px Inter,-apple-system,sans-serif;color:var(--on-accent);background:var(--accent);border-radius:50px;padding:13px 20px;text-decoration:none;margin:14px 0}ul.links{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:6px 18px}';

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
<p><small>${h(BRAND.disclaimer)}</small></p>
<section id="start"><h2>How connecting works</h2><ol><li><a href="#connect">Add the address below</a> to your AI app.</li><li>Your app opens GitHub's own sign-in. Sign in to <b>your</b> GitHub account and choose which repositories the app may reach. We never see or ask for your GitHub password.</li><li>On the last page, choose how much the app may do, then approve.</li></ol>
<p><small>Later, <a href="/connection">My connection</a> is where you change what an app may do, switch to read-only, or disconnect.</small></p></section>
<section id="connect"><h2>Connect your AI app</h2><p>Paste this address into your AI app when it asks for a server or connector address:</p>
<code class="addr" id="address">${address}</code>
<p><small>Leave any Client ID and Client Secret boxes blank (Muse is the one exception, below).</small></p>
<!-- Steps below checked on 2026-10-24 against each client's official documentation:
  Claude: https://www.claude.com/docs/connectors/custom/remote-mcp (Claude can add a connector from its phone app, confirmed by the owner 2026-10-24 and 2026-10-30; Customize > Connectors > Add custom connector > paste the URL > Add > Connect).
  ChatGPT: https://developers.openai.com/api/docs/guides/custom-mcp-server (ChatGPT cannot add one from its phone app: add it in the phone's web browser, then use it in the app, owner 2026-10-30. ChatGPT Plugins > plus > Add custom MCP server > name and URL > OAuth > confirm > Create as a plugin; install it before use).
  Claude Code: https://code.claude.com/docs/en/mcp (claude mcp add --transport http <name> <url>; run /mcp to sign in).
  Cursor: https://cursor.com/docs/context/mcp (.cursor/mcp.json or ~/.cursor/mcp.json, "mcpServers" with a "url").
  VS Code: https://code.visualstudio.com/docs/copilot/reference/mcp-configuration (.vscode/mcp.json, "servers" with "type": "http" and "url").
  Meta Muse Code: https://dev.meta.ai/docs/muse-code/extending (streamable_http and muse mcp login).
  Meta Muse personal assistant: https://about.fb.com/news/2026/09/introducing-muse-small-business/ (custom connectors); https://platform.muse.ai/docs (Meta catalog review).
  Added 2026-11-10, checked against current docs: OpenAI Codex https://developers.openai.com/codex/mcp (codex mcp add NAME --url URL; codex mcp login NAME; desktop app Settings > MCP servers > Add server > Streamable HTTP > Authenticate).
  Gemini CLI https://google-gemini.github.io/gemini-cli/docs/tools/mcp-server.html (gemini mcp add --transport http; /mcp auth NAME). Windsurf mcp_config.json "serverUrl". -->
<h2>Claude (web, desktop and phone app)</h2><ol><li>Open Claude on the web, or in the desktop or phone app, and go to <b>Settings</b> (called <b>Customize</b> in some versions), then <b>Connectors</b>.</li><li>Choose <b>+</b> or <b>Add</b>, then <b>Add custom connector</b>, give it a name and paste the address above.</li><li>Choose <b>Add</b>, then <b>Connect</b>, and sign in with GitHub.</li></ol>
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
<p>Muse may register automatically. If it instead shows the <b>Secure credentials store</b> screen asking for a Client ID and Secret, type this <b>Client ID</b> (the same for everyone, and nothing secret):</p>
<code class="addr" id="muse-client-id">muse</code>
<p class="hint">Set up before? The older long ID <code>${h(MUSE_PUBLIC_CLIENT_ID)}</code> still works.</p>
<p><b>Client Secret: leave blank.</b> Then choose Add. Muse should open GitHub sign-in, where each person signs in to <em>their own GitHub account</em>, approves the App installation on their chosen repositories if needed, and approves Muse. The browser returns to Muse automatically. Never enter a GitHub password, access token, or the service owner's credentials in Muse.</p>
<p>You can also ask Muse to create the connector for you:</p>
<pre id="muse-connector-request">Create a custom connector named ${h(BRAND.product)}.
Service: ${address}
Protocol: remote Streamable HTTP MCP.
Authentication: OAuth authorization code with S256 PKCE (public client, no secret).
If a Client ID is required, use muse and leave Client Secret blank.
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
}</pre><p><small>Or run <b>MCP: Add Server</b> from the Command Palette, choose <b>HTTP</b> and paste the address.</small></p>
<h2>OpenAI Codex (and the ChatGPT desktop app)</h2><pre>codex mcp add github-robinson --url ${address}
codex mcp login github-robinson</pre><p><small>In the desktop app instead: <b>Settings</b>, <b>MCP servers</b>, <b>Add server</b>, choose <b>Streamable HTTP</b>, paste the address, save, then <b>Authenticate</b>.</small></p>
<h2>Gemini CLI</h2><pre>gemini mcp add --transport http --scope user github-robinson ${address}</pre><p><small>Then start <code>gemini</code> and type <code>/mcp auth github-robinson</code> to sign in.</small></p>
<h2>Windsurf</h2><p>In <b>Windsurf Settings</b>, <b>Cascade</b>, <b>MCP servers</b>, choose <b>View raw config</b> and add:</p><pre>{
  "mcpServers": {
    "github-robinson": { "serverUrl": "${address}" }
  }
}</pre><p><small>Save and refresh; Windsurf opens the GitHub sign-in.</small></p>
<h2>Any other app</h2><p>Any app that can add a remote MCP server with sign-in (OAuth) works: paste the address and sign in with GitHub.</p></section>
<section id="for-agents"><h2>For AIs that run commands</h2>
<h3 id="whole-repository">Downloading or uploading a whole repository</h3><p>Ask your AI to download a repository (the <code>github_repo_download</code> tool). It gets a one-time <code>git clone</code> or download command on <code>${h(new URL(origin).hostname)}</code>, the same address for every repository and every transfer. If the command fails because your AI's sandbox cannot reach that address (for example "host not allowed", a 403 from a proxy, or a DNS error), add <b>${h(new URL(origin).hostname)}</b> once to your AI's network allowlist (in Claude: the Capabilities / network access allowed-domains setting), then ask again. Nothing is lost: an unused link simply expires.</p>
<h3 id="plain-git">Plain git clone, pull and push</h3><p>An AI that can run commands (Claude Code, Codex, a Claude sandbox) can use normal git with your repositories here: ask it to set up the git remote (the <code>github_git_remote_setup</code> tool). It runs one setup command once, then uses <code>git clone https://${h(new URL(origin).hostname)}/git/&lt;owner&gt;/&lt;repository&gt;.git</code>, <code>git pull</code> and <code>git push</code>. You do nothing else. Your GitHub sign-in never leaves this service: git gets a key for that one repository, which ends by itself (after 8 hours unless you ask for up to 24) and which you can cancel any time on <a href="/connection">My connection</a>. Pushes get the same checks as every other change (GitHub's branch rules, secret scanning, the change log). Same one address to allow as above.</p>
</section>
<section><h2>Already connected?</h2><a class="button" href="/connection">Open My connection</a>
<ul class="links"><li><a href="/limits">Free use limits</a></li><li><a href="/privacy">Privacy</a></li><li><a href="/terms">Terms</a></li><li><a href="/security">Security</a></li><li><a href="/support">Support</a></li></ul></section>
${brandFooter()}</main></body></html>`;
}
