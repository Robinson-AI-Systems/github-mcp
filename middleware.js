// SINGLE-DOMAIN-1: Vercel Routing Middleware for one-time transfers on this service's own domain.
// It only checks the address (src/native-git/relay.js) and answers with a rewrite to the worker or
// the dedicated runtime broker; Vercel's proxy streams the bytes. `skipMiddlewareRequestBody` in
// vercel.json keeps request bodies (git push, curl --upload-file) out of this code entirely.
// Docs: https://vercel.com/docs/routing-middleware , https://vercel.com/docs/routing-middleware/js-reference
import { planTransferRelay } from './src/native-git/relay.js';

export const config = { matcher: ['/v1/transfer/:path*'], runtime: 'nodejs' };

// The documented `rewrite()` helper of @vercel/functions (3.10.x) is exactly these headers:
// x-middleware-rewrite names the destination; x-middleware-override-headers plus
// x-middleware-request-<name> REPLACE the upstream request headers with only the listed ones.
export function rewriteResponse(destination, headers) {
 const out = new Headers({ 'x-middleware-rewrite': destination });
 const names = [];
 for (const [name, value] of headers) { out.set('x-middleware-request-' + name, value); names.push(name); }
 out.set('x-middleware-override-headers', names.join(','));
 return new Response(null, { headers: out });
}

export function handleTransfer(request, env = process.env, now = Date.now()) {
 const plan = planTransferRelay({ method: request.method, url: request.url, headers: request.headers }, env, now);
 if (!plan.ok) return new Response(plan.message, { status: plan.status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
 return rewriteResponse(plan.destination, plan.headers);
}

export default function middleware(request) { return handleTransfer(request); }
