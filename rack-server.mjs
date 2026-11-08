#!/usr/bin/env node
// Development Rack entrypoint (RACK-STAGING S-2): the thin standalone
// HTTP server that runs this service outside Vercel. It reproduces,
// route for route, the platform contract the handlers are written
// against:
//
//   - filesystem binding: every api/**/*.js default export serves at
//     its /api/* path, exactly as Vercel binds function files (an
//     index.js also serves at its directory path); bracket segments
//     ([action], [handle], [name]) bind as query parameters, as
//     Vercel binds them;
//   - the vercel.json rewrites, verbatim (19): root onto the front
//     door, /git-remote/exchange onto the git-remote function with
//     ?op=exchange, the authorize-page family, the well-known
//     documents, the brand icons onto the front door with their
//     brand_icon query parameter, /api/openapi.json onto the OpenAPI
//     function;
//   - the Routing Middleware families (middleware.js, matcher
//     /v1/transfer/:path* + /git/:path*): the middleware's own
//     handlers run as a pre-router over a Web Request built from the
//     raw request (body NOT consumed here — vercel.json sets
//     skipMiddlewareRequestBody, and git pushes / transfer uploads
//     stream through). A middleware answer is either a plain Response
//     (refusals, challenges — answered as-is) or a rewrite response
//     (x-middleware-rewrite): the entrypoint then performs the proxy
//     hop Vercel's proxy performs — it streams the request body to
//     the destination with exactly the headers the middleware
//     forwarded (x-middleware-request-*), and streams the reply back,
//     with the vercel.json header rules for these paths (no-store,
//     rewrite caching off);
//   - the client-IP contract (dossier §1.1): src/core/oauth.js reads
//     x-vercel-forwarded-for first, then x-real-ip. The rack ingress
//     presents the real client IP under x-real-ip; this entrypoint
//     passes both headers through untouched (Node lowercases header
//     names; handlers read them case-insensitively through Node's
//     headers object), and never synthesizes either from the socket,
//     so login-lockout accounting keys on the real client, not the
//     tunnel;
//   - the (req, res) surface the handlers use: req.method / headers /
//     query / body and the chainable res.status / res.json / res.send
//     helpers on a real Node ServerResponse, so the MCP handler's
//     streaming transport keeps working untouched.
//
// Body contract, per route (the Workspace Phase-2 defect rule: an
// entrypoint must never consume a stream and then let a handler
// re-read it): the two bodyParser:false functions — the GitHub and
// Marketplace webhook receivers, which verify HMACs over the raw
// bytes — receive the buffered raw bytes as req.rawBody (the shape
// src/github/webhook.js reads first) and no parsed body. Every other
// function receives the buffered, parsed body exactly as Vercel
// presents it (JSON and form bodies as objects, anything else as a
// string, no body as undefined; a JSON parse failure is the
// platform's 400, answered before the handler), with Vercel's
// 4.5 MB function body limit. The middleware families are exempt
// from buffering entirely (see above).
//
// Cron: vercel.json schedules GET /api/marketplace/sweep hourly at
// :17. There is no Vercel cron on the rack: the rack-side systemd
// timer `rack-github-sweep.timer` calls the same route on the
// instance's local port with the same CRON_SECRET bearer the handler
// itself checks. The route and its gate are the application's own
// and are unchanged.
//
// Release identity: the front door reads the deployed commit from
// VERCEL_GIT_COMMIT_SHA, which Vercel sets per deployment and
// nothing sets on the rack. The rack build pins it: RACK_RELEASE_
// COMMIT (declared in the rack environment) or a release-commit.txt
// beside this file, written by the build recipe. pinReleaseCommit()
// runs before the server accepts traffic; with no valid pin the
// variable stays unset and the front door honestly reports a null
// SHA — the acceptance read-back then fails by design rather than
// passing on a synthesized value. The playground image pair follows
// the dossier §1.4 rack equivalent: PLAYGROUND_BUILD_SOURCE_SHA is
// carried by the rack environment and PLAYGROUND_IMAGE stays unset,
// so digest resolution (and its build-from-source fallback) behaves
// exactly as on Vercel.
//
// No application logic lives here; every non-middleware request is
// dispatched to the same handler module Vercel invokes. No per-route
// duration timer is imposed: Vercel's function durations are platform
// ceilings, and the rule for this entrypoint is only that it must not
// impose a SHORTER one — a standalone server imposes none.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import contract from './api/contract.js';
import developerConnect from './api/developer/connect.js';
import fleetCheckin from './api/fleet/checkin.js';
import fleetReport from './api/fleet/report.js';
import gitRemote from './api/git-remote.js';
import githubAction from './api/github/[action].js';
import githubWebhook, { config as githubWebhookConfig } from './api/github/webhook.js';
import frontDoor from './api/index.js';
import marketplaceMcp from './api/marketplace/mcp.js';
import marketplaceResource from './api/marketplace/resource.js';
import marketplaceSweep from './api/marketplace/sweep.js';
import marketplaceWebhook, { config as marketplaceWebhookConfig } from './api/marketplace/webhook.js';
import mcp, { config as mcpConfig } from './api/mcp.js';
import nativeGitKey from './api/native-git-key.js';
import oauthAuthorize from './api/oauth/authorize.js';
import oauthRegister from './api/oauth/register.js';
import oauthToken from './api/oauth/token.js';
import openapi from './api/openapi.js';
import playgroundEnroll from './api/playground/enroll.js';
import playgroundLifecycle from './api/playground/lifecycle.js';
import playgroundPreview from './api/playground/preview.js';
import playgroundSweep from './api/playground/sweep.js';
import resultHandle from './api/results/[handle].js';
import securityTxt from './api/security-txt.js';
import tenantOptional from './api/tenant/optional.js';
import tenantOauthAuthorize from './api/tenant/oauth/authorize.js';
import tenantOauthCallback from './api/tenant/oauth/callback.js';
import toolName from './api/tools/[name].js';
import toolsIndex from './api/tools/index.js';
import wellKnownAS from './api/well-known/oauth-authorization-server.js';
import wellKnownPR from './api/well-known/oauth-protected-resource.js';
import whoami from './api/whoami.js';
import middleware from './middleware.js';

const SHA40 = /^[a-f0-9]{40}$/;
const BODY_LIMIT = 4.5 * 1024 * 1024; // Vercel's function body limit.

// Pins the release identity for this process (see header). Returns
// the pinned commit, the platform-provided one, or null when no
// valid pin exists. Never overwrites a valid platform value, never
// synthesizes a commit.
export function pinReleaseCommit(env = process.env) {
  const existing = typeof env.VERCEL_GIT_COMMIT_SHA === 'string'
    ? env.VERCEL_GIT_COMMIT_SHA.trim()
    : '';
  if (SHA40.test(existing)) return existing;
  let candidate = typeof env.RACK_RELEASE_COMMIT === 'string'
    ? env.RACK_RELEASE_COMMIT.trim()
    : '';
  if (!SHA40.test(candidate)) {
    try {
      candidate = readFileSync(new URL('./release-commit.txt', import.meta.url), 'utf8').trim();
    } catch { candidate = ''; }
  }
  if (!SHA40.test(candidate)) return null;
  env.VERCEL_GIT_COMMIT_SHA = candidate;
  return candidate;
}

const pinnedCommit = pinReleaseCommit();

const route = (handler, config) => Object.freeze({ handler, config });

// Filesystem binding: file path -> route(s). An index.js also serves
// at its directory path, as Vercel binds it.
export const FILE_ROUTES = new Map([
  ['/api/contract', route(contract)],
  ['/api/developer/connect', route(developerConnect)],
  ['/api/fleet/checkin', route(fleetCheckin)],
  ['/api/fleet/report', route(fleetReport)],
  ['/api/git-remote', route(gitRemote)],
  ['/api/github/webhook', route(githubWebhook, githubWebhookConfig)],
  ['/api/index', route(frontDoor)],
  ['/api', route(frontDoor)],
  ['/api/marketplace/mcp', route(marketplaceMcp)],
  ['/api/marketplace/resource', route(marketplaceResource)],
  ['/api/marketplace/sweep', route(marketplaceSweep)],
  ['/api/marketplace/webhook', route(marketplaceWebhook, marketplaceWebhookConfig)],
  ['/api/mcp', route(mcp, mcpConfig)],
  ['/api/native-git-key', route(nativeGitKey)],
  ['/api/oauth/authorize', route(oauthAuthorize)],
  ['/api/oauth/register', route(oauthRegister)],
  ['/api/oauth/token', route(oauthToken)],
  ['/api/openapi', route(openapi)],
  ['/api/playground/enroll', route(playgroundEnroll)],
  ['/api/playground/lifecycle', route(playgroundLifecycle)],
  ['/api/playground/preview', route(playgroundPreview)],
  ['/api/playground/sweep', route(playgroundSweep)],
  ['/api/security-txt', route(securityTxt)],
  ['/api/tenant/optional', route(tenantOptional)],
  ['/api/tenant/oauth/authorize', route(tenantOauthAuthorize)],
  ['/api/tenant/oauth/callback', route(tenantOauthCallback)],
  ['/api/tools/index', route(toolsIndex)],
  ['/api/tools', route(toolsIndex)],
  ['/api/well-known/oauth-authorization-server', route(wellKnownAS)],
  ['/api/well-known/oauth-protected-resource', route(wellKnownPR)],
  ['/api/whoami', route(whoami)],
]);

// Bracket doors: pattern -> { handler, param } — the bracket value
// binds as that query parameter, as Vercel binds it.
export const BRACKET_ROUTES = Object.freeze([
  Object.freeze({ pattern: /^\/api\/github\/([^/]+)$/, handler: githubAction, param: 'action' }),
  Object.freeze({ pattern: /^\/api\/results\/([^/]+)$/, handler: resultHandle, param: 'handle' }),
  Object.freeze({ pattern: /^\/api\/tools\/([^/]+)$/, handler: toolName, param: 'name' }),
]);

// The vercel.json rewrite table, verbatim: source path -> the
// destination's route + the query its destination carries (the
// destination's query wins over the caller's, as on Vercel).
export const REWRITES = new Map([
  ['/', { route: '/api/index', query: {} }],
  ['/git-remote/exchange', { route: '/api/git-remote', query: { op: 'exchange' } }],
  ['/limits', { route: '/api/oauth/authorize', query: { page: 'limits' } }],
  ['/connection', { route: '/api/oauth/authorize', query: { manage: '1' } }],
  ['/privacy', { route: '/api/oauth/authorize', query: { page: 'privacy' } }],
  ['/terms', { route: '/api/oauth/authorize', query: { page: 'terms' } }],
  ['/security', { route: '/api/oauth/authorize', query: { page: 'security' } }],
  ['/support', { route: '/api/oauth/authorize', query: { page: 'support' } }],
  ['/status', { route: '/api/oauth/authorize', query: { page: 'status' } }],
  ['/.well-known/oauth-authorization-server', { route: '/api/well-known/oauth-authorization-server', query: {} }],
  ['/.well-known/oauth-protected-resource', { route: '/api/well-known/oauth-protected-resource', query: {} }],
  ['/.well-known/security.txt', { route: '/api/security-txt', query: {} }],
  ['/brand/icon-256.png', { route: '/api/index', query: { brand_icon: '256' } }],
  ['/brand/icon-64.png', { route: '/api/index', query: { brand_icon: '64' } }],
  ['/brand/unleashed-github.png', { route: '/api/index', query: { brand_icon: 'unleashed' } }],
  ['/favicon.ico', { route: '/api/index', query: { brand_icon: '64' } }],
  ['/favicon.png', { route: '/api/index', query: { brand_icon: '64' } }],
  ['/api/openapi.json', { route: '/api/openapi', query: {} }],
]);

const MIDDLEWARE_PATH = /^\/(?:v1\/transfer\/|git\/)/;

// Adds the chainable helpers Vercel's response object carries, on a
// real Node ServerResponse.
function presentResponse(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (value) => {
    if (!res.hasHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(value));
    return res;
  };
  res.send = (value) => {
    if (Buffer.isBuffer(value)) { res.end(value); return res; }
    if (value !== null && typeof value === 'object') return res.json(value);
    if (!res.hasHeader('Content-Type')) res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(value === undefined || value === null ? '' : String(value));
    return res;
  };
  return res;
}

async function readRaw(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// Presents the body the way Vercel does for one function route.
// Returns false when a platform-level answer (413 / 400) was already
// sent and the handler must not run.
async function presentBody(req, res, config) {
  if (config?.api?.bodyParser === false) {
    const raw = await readRaw(req);
    if (raw === null) {
      res.statusCode = 413;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Request Entity Too Large');
      return false;
    }
    req.rawBody = raw;
    req.body = undefined;
    return true;
  }
  const raw = await readRaw(req);
  if (raw === null) {
    res.statusCode = 413;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Request Entity Too Large');
    return false;
  }
  if (raw.length === 0) {
    req.body = undefined;
    return true;
  }
  const text = raw.toString('utf8');
  const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (contentType === 'application/json') {
    try {
      req.body = JSON.parse(text);
    } catch {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Bad Request');
      return false;
    }
  } else if (contentType === 'application/x-www-form-urlencoded') {
    req.body = Object.fromEntries(new URLSearchParams(text));
  } else {
    req.body = text;
  }
  return true;
}

// The proxy hop Vercel performs for a middleware rewrite: stream the
// request (body unconsumed — skipMiddlewareRequestBody) to the
// destination with exactly the headers the middleware forwarded,
// then stream the reply back.
function proxyRewrite(req, res, destination, headers) {
  const target = new URL(destination);
  const transport = target.protocol === 'https:' ? import('node:https') : import('node:http');
  return transport.then(({ request: send }) => new Promise((resolve) => {
    const out = send(target, { method: req.method, headers }, (upstream) => {
      res.statusCode = upstream.statusCode ?? 502;
      for (const [name, value] of Object.entries(upstream.headers)) {
        if (value !== undefined) res.setHeader(name, value);
      }
      res.setHeader('Cache-Control', 'no-store');
      upstream.pipe(res);
      upstream.on('end', resolve);
    });
    out.on('error', () => {
      if (!res.headersSent) {
        res.statusCode = 502;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      }
      res.end('The transfer could not be completed. Run the command again in a minute.\n');
      resolve();
    });
    req.pipe(out);
  }));
}

// Runs the Routing Middleware for /git/* and /v1/transfer/* and
// answers or proxies per its verdict. The Web Request is built
// without a body (the middleware never reads one; bodies stream
// through the proxy hop untouched).
async function runMiddleware(req, res, url) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(name, value);
    else if (Array.isArray(value)) for (const v of value) headers.append(name, v);
  }
  const request = new Request(url.toString(), { method: req.method, headers });
  const answer = await middleware(request);
  const rewrite = answer?.headers?.get?.('x-middleware-rewrite');
  if (!rewrite) {
    // A plain Response: a refusal, a challenge, or a direct answer.
    res.statusCode = answer.status;
    for (const [name, value] of answer.headers) res.setHeader(name, value);
    const body = Buffer.from(await answer.arrayBuffer());
    if (body.length) res.end(body); else res.end();
    // Drain any request body the middleware refused so the socket
    // closes cleanly.
    req.resume();
    return;
  }
  const override = String(answer.headers.get('x-middleware-override-headers') || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const forwarded = {};
  for (const name of override) {
    const value = answer.headers.get('x-middleware-request-' + name);
    if (value !== null) forwarded[name] = value;
  }
  await proxyRewrite(req, res, rewrite, forwarded);
}

export function createRackServer(env = process.env) {
  return createServer(async (req, res) => {
    presentResponse(res);
    try {
      const host = req.headers.host || 'rack.internal';
      const url = new URL(req.url || '/', `http://${host}`);

      if (MIDDLEWARE_PATH.test(url.pathname)) {
        await runMiddleware(req, res, url);
        return;
      }

      let entry = FILE_ROUTES.get(url.pathname);
      const query = Object.fromEntries(url.searchParams);
      if (!entry) {
        for (const bracket of BRACKET_ROUTES) {
          const match = bracket.pattern.exec(url.pathname);
          if (match) {
            entry = { handler: bracket.handler, config: undefined };
            query[bracket.param] = decodeURIComponent(match[1]);
            break;
          }
        }
      }
      if (!entry) {
        const rewrite = REWRITES.get(url.pathname);
        if (rewrite) {
          entry = FILE_ROUTES.get(rewrite.route);
          Object.assign(query, rewrite.query); // the destination's query wins
        }
      }
      if (!entry) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('The page could not be found\n\nNOT_FOUND\n');
        return;
      }
      req.query = query;
      if (!(await presentBody(req, res, entry.config))) return;
      await entry.handler(req, res);
    } catch {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      }
      if (!res.writableEnded) res.end('Internal Server Error');
    }
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';
  createRackServer().listen(port, host, () => {
    console.log(`GitHub Unleashed by Robinson AI Systems rack entrypoint listening on ${host}:${port} (release ${pinnedCommit ?? 'unpinned'})`);
  });
}
