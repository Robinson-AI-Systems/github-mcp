// SINGLE-DOMAIN-1: Vercel Routing Middleware for one-time transfers on this service's own domain.
// It only checks the address (src/native-git/relay.js) and answers with a rewrite to the worker or
// the dedicated runtime broker; Vercel's proxy streams the bytes. `skipMiddlewareRequestBody` in
// vercel.json keeps request bodies (git push, curl --upload-file) out of this code entirely.
// Docs: https://vercel.com/docs/routing-middleware , https://vercel.com/docs/routing-middleware/js-reference
import { handleTransfer } from './src/native-git/relay.js';

export { handleTransfer, rewriteResponse } from './src/native-git/relay.js';
export const config = { matcher: ['/v1/transfer/:path*'], runtime: 'nodejs' };
export default function middleware(request) { return handleTransfer(request); }
