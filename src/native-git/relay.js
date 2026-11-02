// SINGLE-DOMAIN-1: one-time transfer addresses on the MCP's own public origin.
//
// An AI sandbox (Claude's, for example) reaches only the hosts on its network allowlist. The
// person already allows this service's own domain, so every one-time upload/download address
// is issued on it: https://<PUBLIC_BASE_URL host>/v1/transfer/<kind>/<route>/<mac>/<capability>.
// Routing Middleware (middleware.js) checks the address and hands the request to Vercel's proxy
// with a rewrite; the bytes never pass through a function (no 4.5 MB function body cap).
//
// It can never become an open proxy:
//  - the destination is never read from the request: <route> only selects the configured worker
//    origin ("w", or "p" for the previous one) or names a dedicated runtime broker host that must
//    have the exact Playground shape on a configured ingress address;
//  - <mac> is a server-side HMAC binding kind + destination + capability, so a valid capability
//    cannot be pointed at another destination, and a route cannot be reused with another capability;
//  - the capability itself is verified here exactly as the worker verifies it (signature, purpose,
//    expiry) before anything is forwarded;
//  - only an allowlist of transfer headers is forwarded: cookies, Authorization and every other
//    header are dropped; the issued commands also tell Git and curl not to follow redirects.
import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { readEncryptionKey } from '../core/crypto.js';
import { publicOrigin } from '../core/http.js';
import { nativeWorkerPublicKey } from './signing.js';
import { workerUrl, verifyDownloadCapability, verifyUploadCapability, DOWNLOAD_SESSION_MS } from './protocol.js';

export const TRANSFER_PREFIX = '/v1/transfer/';
const KIND = { d: { path: '/v1/download/', pack: '/git-upload-pack', service: 'git-upload-pack', methods: ['GET', 'POST'] },
 u: { path: '/v1/upload/', pack: '/git-receive-pack', service: 'git-receive-pack', methods: ['GET', 'POST', 'PUT'] } };
const BROKER_HOST = /^ras-pg-[a-f0-9]{32}-(\d{1,3}-\d{1,3}-\d{1,3}-\d{1,3})\.sslip\.io$/;
// Only what a Git smart-HTTP client or curl needs. Everything else (Cookie, Authorization,
// Proxy-Authorization, x-robinson-*, forwarding headers) is dropped before the proxy hop.
export const FORWARDED_HEADERS = Object.freeze(['accept', 'accept-encoding', 'content-encoding', 'content-length', 'content-type', 'git-protocol', 'user-agent']);

function macKey(env) { return Buffer.from(hkdfSync('sha256', readEncryptionKey(env), Buffer.from('robinson-native-git/v1'), Buffer.from('transfer-relay-mac'), 32)); }
const mac = (env, kind, origin, capability) => createHmac('sha256', macKey(env)).update(JSON.stringify(['robinson-native-relay/v1', kind, origin, capability])).digest('base64url').slice(0, 32);

/** The relay is used when this service's public origin is configured, unless explicitly switched off. */
export function relayOrigin(env) {
 if (env?.NATIVE_GIT_TRANSFER_RELAY === 'off') return null;
 try { return publicOrigin(env); } catch { return null; }
}

/** Configured ingress addresses of Playground pools (protected settings, never the request). */
function ingressAddresses(env) {
 const out = new Set(); if (typeof env?.PLAYGROUND_INGRESS_IPV4 === 'string') out.add(env.PLAYGROUND_INGRESS_IPV4);
 try { for (const pool of JSON.parse(env?.PLAYGROUND_POOLS ?? '[]')) if (typeof pool?.ingress === 'string') out.add(pool.ingress); } catch { /* invalid pools allow no broker */ }
 return [...out].filter(ip => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip));
}
const workerOrigin = (env, previous) => {
 const raw = previous ? env?.NATIVE_GIT_PREVIOUS_WORKER_URL : env?.NATIVE_GIT_WORKER_URL;
 if (!raw) return null;
 try { return new URL(workerUrl({ ...env, NATIVE_GIT_WORKER_URL: raw })).origin; } catch { return null; }
};

/** Which route segment names this exact destination origin, or null when it is not eligible. */
export function routeFor(env, destinationOrigin) {
 if (destinationOrigin === workerOrigin(env, false)) return 'w';
 if (destinationOrigin === workerOrigin(env, true)) return 'p';
 let url; try { url = new URL(destinationOrigin); } catch { return null; }
 const m = BROKER_HOST.exec(url.hostname);
 if (url.protocol !== 'https:' || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !m || url.origin !== destinationOrigin) return null;
 return ingressAddresses(env).includes(m[1].replaceAll('-', '.')) ? 'b.' + url.hostname : null;
}
function resolveRoute(env, route) {
 if (route === 'w') return workerOrigin(env, false);
 if (route === 'p') return workerOrigin(env, true);
 if (!route.startsWith('b.')) return null;
 const origin = 'https://' + route.slice(2);
 return routeFor(env, origin) === route ? origin : null;
}

/** Builds the single-domain address for a signed capability, or null when the relay is not available. */
export function transferUrl(env, { kind, destinationOrigin, capability }) {
 const origin = relayOrigin(env), route = origin && routeFor(env, destinationOrigin);
 if (!origin || !route || !KIND[kind]) return null;
 return `${origin}${TRANSFER_PREFIX}${kind}/${route}/${mac(env, kind, destinationOrigin, capability)}/${capability}`;
}

const refuse = (status, message) => ({ ok: false, status, message: message + '\n' });
// The worker's own capability key: a shared secret (HMAC) for the configured worker when one is
// set, otherwise the Ed25519 control-plane key; dedicated brokers always pin the Ed25519 key.
const capabilityKey = (env, route) => route.startsWith('b.') || !env.NATIVE_GIT_WORKER_KEY || env.NATIVE_GIT_WORKER_KEY.startsWith('ed25519:') ? nativeWorkerPublicKey(env) : env.NATIVE_GIT_WORKER_KEY;

/**
 * Decides one relayed request. Returns { ok: true, destination, headers } for the proxy hop, or
 * { ok: false, status, message } (a plain sentence; nothing from the request is echoed back).
 * @param {{ method: string, url: string, headers: Headers | Record<string,string> }} request
 */
export function planTransferRelay(request, env = process.env, now = Date.now()) {
 let url; try { url = new URL(request.url); } catch { return refuse(404, 'Not found.'); }
 const m = /^\/v1\/transfer\/(d|u)\/(w|p|b\.[a-z0-9.-]{1,200})\/([A-Za-z0-9_-]{32})\/([A-Za-z0-9_-]{1,2048}\.[A-Za-z0-9_-]{1,200})(\/info\/refs|\/git-upload-pack|\/git-receive-pack)?$/.exec(url.pathname);
 if (!m) return refuse(404, 'Not found.');
 const [, kind, route, tag, capability, suffix = ''] = m, spec = KIND[kind];
 if (suffix && suffix !== '/info/refs' && suffix !== spec.pack) return refuse(404, 'Not found.');
 if (!spec.methods.includes(request.method)) return refuse(405, 'This address only serves one-time Git or file transfers.');
 const query = suffix === '/info/refs' ? `?service=${spec.service}` : '';
 if (url.search !== query) return refuse(404, 'Not found.');
 const destination = resolveRoute(env, route);
 if (!destination) return refuse(404, 'This transfer address is not valid here. Ask for a new one.');
 let expected; try { expected = mac(env, kind, destination, capability); } catch { return refuse(503, 'Transfers are not configured on this service.'); }
 if (!timingSafeEqual(Buffer.from(tag), Buffer.from(expected))) return refuse(403, 'This transfer address is not valid. Ask for a new one.');
 try {
  const key = capabilityKey(env, route);
  if (kind === 'd') verifyDownloadCapability(capability, key, now, { graceMs: DOWNLOAD_SESSION_MS }); else verifyUploadCapability(capability, key, now);
 } catch (error) { return refuse(403, /expired/.test(error?.message) ? 'This transfer address has expired. Ask for a new one.' : 'This transfer address is not valid. Ask for a new one.'); }
 const source = request.headers instanceof Headers ? request.headers : new Headers(request.headers ?? {});
 const headers = new Headers();
 for (const name of FORWARDED_HEADERS) { const value = source.get(name); if (value !== null) headers.set(name, value); }
 return { ok: true, destination: `${destination}${spec.path}${capability}${suffix}${query}`, headers };
}

/** The plain-English note for a person whose AI sandbox cannot reach the transfer host. */
export function blockedNote(url) {
 let host = 'this service'; try { host = new URL(url).hostname; } catch { /* keep generic */ }
 return `If this fails because the sandbox cannot reach ${host} (host not allowed, proxy 403, DNS error), add that one domain to your AI's network allowlist (for Claude: the Capabilities / network access allowed-domains setting), then ask for a new link. Same domain for every repository and transfer; nothing is lost.`;
}

/** Keeps an always-visible digest within the write layer's 1200-byte bound by dropping optional fields first. */
export function fitDigest(value, optional = [], limit = 1200) {
 const out = { ...value };
 for (const key of optional) { if (Buffer.byteLength(JSON.stringify(out)) <= limit) break; delete out[key]; }
 return out;
}
