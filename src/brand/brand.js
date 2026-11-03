// Robinson AI Systems look for the pages this server shows people (tokens copied from robinsonaisystems.com/assets/brand.css:
// charcoal surfaces, emerald-to-teal gradient, Mist White text). System fonts only, so no outside font request is made.
import { createRequire } from 'node:module';
import { ICON_256_PNG_BASE64, ICON_64_PNG_BASE64, UNLEASHED_GITHUB_256_PNG_BASE64 } from './assets.js';

// One version number for the package, the MCP server info and server.json.
export const VERSION = createRequire(import.meta.url)('../../package.json').version;

export const BRAND = Object.freeze({
  name: 'Robinson AI Systems', product: 'Robinson MCP for GitHub', website: 'https://www.robinsonaisystems.com',
  tagline: 'Practical software. More capable AI.',
  emerald: '#00B67A', teal: '#00E3C2', charcoal: '#0C0C0C', graphite: '#1E1E1E', mist: '#F8FAF8', grey: '#9FA5A3'
});
export const ICON_PATH = '/brand/icon-256.png';
/** The product mark for page headers: GitHub Unleashed (Arctic shard), per docs/UNLEASHED-BRAND-SPEC.md. The company R above stays the favicon and the MCP server icon. */
export const PRODUCT_MARK_PATH = '/brand/unleashed-github.png';
export const productMarkBytes = () => Buffer.from(UNLEASHED_GITHUB_256_PNG_BASE64, 'base64');
export const iconBytes = (size) => Buffer.from(size === 64 ? ICON_64_PNG_BASE64 : ICON_256_PNG_BASE64, 'base64');

/** Page CSS: dark surface, gradient primary button, emerald focus ring, readable on a phone. */
export const BRAND_CSS = `:root{--bg:${BRAND.charcoal};--surface:${BRAND.graphite};--text:${BRAND.mist};--muted:${BRAND.grey};--border:#333;--brand:${BRAND.emerald};--teal:${BRAND.teal};--grad:linear-gradient(90deg,${BRAND.emerald},${BRAND.teal});--err:#FF5F5F}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.65 'IBM Plex Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
main{max-width:520px;margin:0 auto;padding:28px 18px 48px}header.brand{display:flex;align-items:center;gap:12px;margin-bottom:22px}header.brand img{width:44px;height:44px;border-radius:10px}header.brand b{display:block;font:700 18px/1.2 Inter,-apple-system,'Segoe UI',sans-serif}header.brand small{color:var(--muted)}
h1{font:700 26px/1.2 Inter,-apple-system,'Segoe UI',sans-serif;margin:0 0 12px;letter-spacing:-.02em}p{margin:0 0 14px}small,.muted{color:var(--muted)}
form{display:grid;gap:14px;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:18px;margin:18px 0}
label{display:grid;gap:6px}input[type=text],input[type=password],input:not([type]),select{font:inherit;color:var(--text);background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:11px}
input:focus,select:focus,button:focus-visible{outline:2px solid var(--teal);outline-offset:2px}
.choice{display:flex;gap:10px;align-items:flex-start;padding:12px;border:1px solid var(--border);border-radius:12px}.choice:has(input:checked){border-color:var(--brand);box-shadow:0 0 20px rgba(0,182,122,.25)}.choice input{margin-top:6px;accent-color:var(--brand)}.choice label{gap:2px}
button{font:600 16px Inter,-apple-system,'Segoe UI',sans-serif;color:#fff;background:var(--grad);border:0;border-radius:50px;padding:13px 20px;cursor:pointer}button:hover{box-shadow:0 0 20px rgba(0,182,122,.35)}
footer{margin-top:28px;color:var(--muted);font-size:14px}a{color:var(--teal)}`;

export const brandHeader = () => `<header class="brand"><img src="${PRODUCT_MARK_PATH}" alt="" width="44" height="44"><div><b>${BRAND.product}</b><small>${BRAND.tagline}</small></div></header>`;
export const brandFooter = () => `<footer>Operated by <a href="${BRAND.website}" rel="noopener noreferrer">${BRAND.name}</a>. Not affiliated with or endorsed by GitHub. We never ask for your GitHub password here. <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/security">Security</a> · <a href="/support">Support</a></footer>`;
/** MCP server icons: shown by apps next to the connection. */
export const serverIcons = (origin) => [
  { src: `${origin}${ICON_PATH}`, mimeType: 'image/png', sizes: ['256x256'] },
  { src: `${origin}/brand/icon-64.png`, mimeType: 'image/png', sizes: ['64x64'] }
];
/** The release an agent is talking to: the deployed commit (Vercel provides it), so agents can tell whether a fix is live. */
export function serverRelease(env = process.env) {
  const sha = /^[0-9a-f]{40}$/.test(String(env.VERCEL_GIT_COMMIT_SHA ?? '')) ? String(env.VERCEL_GIT_COMMIT_SHA) : null;
  return sha
    ? { version: `${VERSION}+${sha.slice(0, 12)}`, commit: sha, source: `https://github.com/Robinson-AI-Systems/github-mcp/commit/${sha}`,
        what_changed: 'Merged changes up to this commit are live. Read the live branch history (github_commit_list owner Robinson-AI-Systems repo github-mcp ref live) to see recent changes.' }
    : { version: VERSION, commit: null, note: 'This server did not report its release commit.' };
}
export const serverInfo = (origin) => ({ name: 'robinson-github-mcp', title: BRAND.product, version: serverRelease().version,
  websiteUrl: BRAND.website, description: 'Operate GitHub accounts safely from your AI assistant.', ...(origin ? { icons: serverIcons(origin) } : {}) });
