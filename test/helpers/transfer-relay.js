// A local stand-in for Vercel's edge in front of middleware.js: it runs the real middleware
// (handleTransfer) on each request WITHOUT its body (as `skipMiddlewareRequestBody` does), then acts
// on the middleware's answer the way Vercel's proxy does: a non-rewrite answer is returned as is;
// a rewrite is proxied to the destination with exactly the overriding request headers, streaming
// the body both ways and never following a redirect. Only destination hosts are mapped to local
// fixture origins (the public test hostnames do not resolve).
import { createServer, request as httpRequest } from 'node:http';
import { handleTransfer } from '../../src/native-git/relay.js';

export async function startTransferRelay({ env, now = Date.now, publicOrigin = 'https://mcp.example.test', destinations = {} }) {
 const seen = [];
 const server = createServer(async (req, res) => {
  const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  const answer = await handleTransfer(new Request(publicOrigin + req.url, { method: req.method, headers }), env(), now());
  const target = answer.headers.get('x-middleware-rewrite');
  if (!target) { req.resume(); res.writeHead(answer.status, Object.fromEntries(answer.headers)); return res.end(Buffer.from(await answer.arrayBuffer())); }
  const forwarded = {};
  for (const name of (answer.headers.get('x-middleware-override-headers') ?? '').split(',').filter(Boolean)) forwarded[name] = answer.headers.get('x-middleware-request-' + name);
  const destination = new URL(target), local = destinations[destination.origin];
  seen.push({ destination: target, headers: forwarded });
  if (!local) { req.resume(); res.writeHead(502); return res.end(); }
  const upstream = httpRequest(local + destination.pathname + destination.search, { method: req.method, headers: forwarded }, reply => { res.writeHead(reply.statusCode, reply.headers); reply.pipe(res); });
  upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  // A client that drops mid-body drops the proxied request too (as a real proxy does).
  req.on('close', () => { if (!req.complete) upstream.destroy(); });
  req.pipe(upstream);
 });
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
 const origin = `http://127.0.0.1:${server.address().port}`;
 return { origin, seen, local: url => url.replace(publicOrigin, origin), close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
