// SINGLE-DOMAIN-1: Vercel Routing Middleware for one-time transfers on this service's own domain.
// It only checks the address (src/native-git/relay.js) and answers with a rewrite to the worker or
// the dedicated runtime broker; Vercel's proxy streams the bytes. `skipMiddlewareRequestBody` in
// vercel.json keeps request bodies (git push, curl --upload-file) out of this code entirely.
// GIT-REMOTE-1: /git/<owner>/<repo>.git is the git remote: the session key is checked here
// (src/git-remote/edge.js, loaded only for those requests) before the same kind of rewrite.
// Docs: https://vercel.com/docs/routing-middleware , https://vercel.com/docs/routing-middleware/js-reference
import { handleTransfer } from './src/native-git/relay.js';

export { handleTransfer, rewriteResponse } from './src/native-git/relay.js';
export const config = { matcher: ['/v1/transfer/:path*', '/git/:path*'], runtime: 'nodejs' };
export default async function middleware(request) {
 if (new URL(request.url).pathname.startsWith('/git/')) {
  const { handleGitRemote } = await import('./src/git-remote/edge.js');
  return handleGitRemote(request);
 }
 return handleTransfer(request);
}
