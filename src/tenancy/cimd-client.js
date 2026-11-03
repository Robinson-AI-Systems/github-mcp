// CIMD (Client ID Metadata Documents, MCP 2025-11-25): some apps do not
// register through the sign-up door and carry no fixed client id here.
// Their client_id IS the https address of a metadata document they host
// (Claude: https://claude.ai/oauth/mcp-oauth-client-metadata, ChatGPT:
// https://chatgpt.com/oauth/client.json). The server fetches that document
// at connect time, checks it names itself, and admits the app as a public
// ("none") client — the pattern PenPal runs in production
// (resolveCimdClient in Robinson-AI-Systems/penpal src/oauth.mjs).
//
// PenPal's convicted trap (its PR #45, 2026-11-01) is designed out here:
// ChatGPT's document headlines token_endpoint_auth_method
// "private_key_jwt" (singular) while listing ["none","private_key_jwt"]
// in token_endpoint_auth_methods_supported (plural). Acceptance is the
// INTERSECTION of the document's supported methods (plural first,
// singular as fallback) with this server's own methods: "none" in the
// intersection admits the app as a public client; an empty intersection
// refuses. Full private_key_jwt support is out of scope, as on PenPal.
import { isIP } from 'node:net';
import { validRedirectUri } from '../core/oauth.js';

export const CIMD_TIMEOUT_MS = 5000;
export const CIMD_MAX_BYTES = 65536;
const CACHE_MS = 60 * 60 * 1000;
const SERVER_METHODS = ['client_secret_post', 'none'];

const cache = new Map(); // client_id URL -> { client, at }
export const clearCimdClientCache = () => cache.clear();

/** Hosts a metadata document may never live on: this machine or a LAN. */
export function isBlockedCimdHost(hostname) {
  const host = String(hostname ?? '').toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost')) return true;
  const kind = isIP(host);
  if (kind === 4) {
    const [a, b] = host.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127);
  }
  if (kind === 6) {
    const h = host.replace(/^\[|\]$/g, '');
    return h === '::1' || h === '::' || h.startsWith('fe8') || h.startsWith('fe9') ||
      h.startsWith('fea') || h.startsWith('feb') || h.startsWith('fc') || h.startsWith('fd') ||
      h.startsWith('::ffff:127.') || h.startsWith('::ffff:10.') || h.startsWith('::ffff:192.168.');
  }
  return false;
}

/** A client_id is a CIMD identifier only when it is a fetchable public https URL. */
export function isCimdClientId(clientId) {
  if (typeof clientId !== 'string' || clientId.length < 10 || clientId.length > 2000) return false;
  let url;
  try { url = new URL(clientId); } catch { return false; }
  return url.protocol === 'https:' && !url.username && !url.password && !url.hash &&
    Boolean(url.hostname) && !isBlockedCimdHost(url.hostname);
}

/** The document's supported token methods: plural field first, singular as fallback. */
export function cimdSupportedMethods(doc) {
  if (Array.isArray(doc?.token_endpoint_auth_methods_supported) &&
      doc.token_endpoint_auth_methods_supported.every((m) => typeof m === 'string'))
    return doc.token_endpoint_auth_methods_supported;
  return [typeof doc?.token_endpoint_auth_method === 'string' ? doc.token_endpoint_auth_method : 'none'];
}

/** "none" must be a method both the document and this server support. */
export const cimdAdmitsPublicClient = (doc) =>
  cimdSupportedMethods(doc).some((m) => m === 'none' && SERVER_METHODS.includes(m));

/**
 * Fetch + validate the metadata document for `clientId`. Any failure —
 * unreachable, oversized, malformed, self-mismatched, no usable redirect,
 * no shared auth method — resolves to null, which callers turn into the
 * ordinary "unknown client" refusal. Nothing about the fetch is revealed.
 * The returned record mirrors the public-client row shape; its display
 * name is the document HOST (the document's client_name is self-asserted,
 * so consent names the host instead — Anthropic's CIMD guidance).
 */
export async function resolveCimdClient(clientId, { fetchImpl = fetch, timeoutMs = CIMD_TIMEOUT_MS, maxBytes = CIMD_MAX_BYTES } = {}) {
  if (!isCimdClientId(clientId)) return null;
  const cached = cache.get(clientId);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.client;
  let doc;
  try {
    const res = await fetchImpl(clientId, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error',
    });
    if (!res?.ok) return null;
    const text = await res.text();
    if (typeof text !== 'string' || text.length > maxBytes) return null;
    doc = JSON.parse(text);
  } catch { return null; }
  if (!doc || typeof doc !== 'object' || doc.client_id !== clientId) return null;
  if (!Array.isArray(doc.redirect_uris) || doc.redirect_uris.length < 1 || doc.redirect_uris.length > 8 ||
      new Set(doc.redirect_uris).size !== doc.redirect_uris.length ||
      !doc.redirect_uris.every((u) => typeof u === 'string' && validRedirectUri(u))) return null;
  if (!cimdAdmitsPublicClient(doc)) return null;
  const client = Object.freeze({
    client_id: clientId,
    client_name: new URL(clientId).hostname,
    redirect_uris: Object.freeze([...doc.redirect_uris]),
    token_endpoint_auth_method: 'none',
    client_secret_hash: null,
  });
  cache.set(clientId, { client, at: Date.now() });
  return client;
}
