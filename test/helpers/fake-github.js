// Built for github-mcp (A-1). A fake GitHub HTTP server reached through Octokit's `request.fetch` — no network.
// Every request is recorded as { method, route, path, params, query, body, headers }, where `route` is the matched
// OpenAPI template (e.g. 'PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge'). A-4: the route table is every
// operation in the vendored GitHub description (plus POST /graphql), every REST request is validated against its
// operation (path, query, JSON body) and every GraphQL document against the vendored schema. A request that does not
// match is answered with 422 (REST) or a GraphQL `errors` array, recorded in `invalid`, and tests assert `invalid` is empty.

import { operations, validateRestRequest, validateGraphql } from './github-descriptions.js';

/** Templates the A-1 fake knew; they are all in the vendored description too (kept for `validate: false` use). Each `{name}` matches one path segment, except `{path}` (file paths span segments). */
export const A1_ROUTES = [
  'GET /user',
  'GET /repos/{owner}/{repo}',
  'GET /repos/{owner}/{repo}/contents/{path}',
  'PUT /repos/{owner}/{repo}/contents/{path}',
  'GET /repos/{owner}/{repo}/pulls/{pull_number}',
  'POST /repos/{owner}/{repo}/pulls',
  'PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge',
  'GET /repos/{owner}/{repo}/commits/{ref}/check-runs',
  'POST /graphql'
];

const MULTI_SEGMENT = new Set(['path']);

// Reads that production code makes on every CI judgement but that most tests do not care about. A test that does care
// configures the route itself with when(); otherwise these neutral answers apply. (2026-11-12: ciState also reads the
// workflow runs at the head commit; "none" is the neutral answer.)
const DEFAULT_REPLIES = {
  'GET /repos/{owner}/{repo}/actions/runs': { status: 200, body: { total_count: 0, workflow_runs: [] } }
};

function compile(route) {
  const [method, template] = route.split(' ');
  const names = [];
  const source = template.split('/').map((segment) => segment.replace(/\{([^}]+)\}/g, (_m, name) => {
    names.push(name);
    return MULTI_SEGMENT.has(name) ? '(.+)' : '([^/]+)';
  })).join('/');
  return { route, method, names, regex: new RegExp(`^${source}$`) };
}

function decode(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

function lowerHeaders(headers) {
  if (!headers) return {};
  const entries = headers instanceof Headers || Array.isArray(headers)
    ? [...new Headers(headers).entries()] : Object.entries(headers);
  return Object.fromEntries(entries.map(([k, v]) => [String(k).toLowerCase(), String(v)]));
}

function parseBody(body) {
  if (body === undefined || body === null || body === '') return undefined;
  if (typeof body !== 'string') return body;
  try { return JSON.parse(body); } catch { return body; }
}

function json(status, body, headers = {}) {
  const noBody = status === 204 || status === 304;
  // Bytes (a Buffer) are sent as they are, for downloads such as log archives; everything else is JSON.
  return new Response(noBody ? null : Buffer.isBuffer(body) ? body : JSON.stringify(body ?? {}), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers }
  });
}

/**
 * @param {{ routes?: string[], baseUrl?: string, validate?: boolean }} [options] extra route templates; `validate`
 *   (default true) loads the vendored description, knows all its routes and validates every request.
 * @returns {{ fetch: Function, calls: object[], unmatched: object[], invalid: object[], graphql: object[], when: Function, routes: string[] }}
 */
export function makeFakeGitHub({ routes = [], baseUrl = 'https://api.github.com', validate = true } = {}) {
  const described = validate ? operations().map((o) => o.route) : [];
  // Explicit test-only provider-documented routes absent from the pinned schema
  // can be supplied by a focused fixture. Every pinned route still validates
  // unchanged; callers of external fixtures assert the exact request shape.
  const outsidePinned = new Set(routes.filter(r => !described.includes(r)));
  // Most specific first: fewer {parameters}, then longer templates, so '/pulls/comments' beats '/pulls/{pull_number}'.
  const specificity = (route) => [route.split('{').length, -route.length];
  const table = [...new Set([...A1_ROUTES, ...described, ...routes])]
    .sort((a, b) => { const [pa, la] = specificity(a); const [pb, lb] = specificity(b); return pa - pb || la - lb; })
    .map(compile);
  const known = new Set(table.map((r) => r.route));
  const replies = new Map();
  const calls = [];
  const unmatched = [];
  const graphql = [];
  const invalid = [];

  function when(route) {
    if (!known.has(route)) throw new Error(`fake GitHub does not know route "${route}"`);
    return {
      /** reply(status, body | (request) => body, headers?) */
      reply(status, body = {}, headers = {}) {
        replies.set(route, { status, body, headers });
        return this;
      },
      /** replyWith((request) => ({ status, body?, headers? })) answers each call from the test's own state (still validated first). */
      replyWith(fn) {
        if (typeof fn !== 'function') throw new TypeError('replyWith needs a function');
        replies.set(route, { dynamic: fn });
        return this;
      },
      /** replySequence([{ status, body?, headers? }, …]) answers each call in turn; the last entry repeats. */
      replySequence(steps) {
        if (!Array.isArray(steps) || !steps.length) throw new TypeError('replySequence needs at least one step');
        let index = 0;
        replies.set(route, { sequence: () => steps[Math.min(index++, steps.length - 1)] });
        return this;
      }
    };
  }

  // Wiki git traffic (https://github.com/<o>/<r>.wiki.git/...) is not the REST API; a test may hand it to its own git server.
  let wikiHandler = null;
  async function fetch(input, init = {}) {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (wikiHandler && url.origin === 'https://github.com' && url.pathname.includes('.wiki.git/')) return wikiHandler(input, init);
    const method = String(init.method || input.method || 'GET').toUpperCase();
    const base = new URL(baseUrl);
    const rawPath = url.pathname.startsWith(base.pathname.replace(/\/$/, '') + '/')
      ? url.pathname.slice(base.pathname.replace(/\/$/, '').length) : url.pathname;
    const request = {
      method,
      route: null,
      path: rawPath,
      params: {},
      query: Object.fromEntries(url.searchParams),
      body: parseBody(init.body),
      headers: lowerHeaders(init.headers)
    };
    // Asset uploads are the only API calls made to the separate GitHub uploads host.
    const trustedUpload = url.origin === 'https://uploads.github.com' && method === 'POST' &&
      /^\/repos\/[^/]+\/[^/]+\/releases\/\d+\/assets$/.test(rawPath);
    const hit = url.origin === base.origin || trustedUpload
      ? table.find((r) => r.method === method && r.regex.test(rawPath)) : undefined;
    if (!hit) {
      const record = { ...request, unmatched: true };
      calls.push(record);
      unmatched.push(record);
      return json(404, { message: `Not Found (fake GitHub has no route for ${method} ${rawPath})`, status: '404' });
    }
    const values = rawPath.match(hit.regex).slice(1);
    request.route = hit.route;
    request.params = Object.fromEntries(hit.names.map((name, i) => [name, decode(values[i])]));
    calls.push(request);
    if (hit.route === 'POST /graphql') {
      graphql.push({ query: request.body?.query, variables: request.body?.variables ?? {} });
      if (validate) {
        const problems = await validateGraphql(request.body?.query);
        if (problems.length) {
          request.invalid = problems;
          invalid.push(request);
          return json(200, { errors: problems.map((message) => ({ message })) });
        }
      }
    } else if (validate && !outsidePinned.has(hit.route)) {
      const problems = validateRestRequest(hit.route, request);
      if (problems.length) {
        request.invalid = problems;
        invalid.push(request);
        return json(422, { message: `fake GitHub: ${hit.route} request does not match the vendored OpenAPI description`, errors: problems });
      }
    }
    const reply = replies.get(hit.route) ?? DEFAULT_REPLIES[hit.route];
    if (!reply) {
      return json(501, { message: `fake GitHub: no reply configured for ${hit.route}` });
    }
    const step = reply.dynamic ? await reply.dynamic(request) : reply.sequence ? reply.sequence() : reply;
    const body = typeof step.body === 'function' ? await step.body(request) : step.body;
    return json(step.status, body, step.headers);
  }

  return { fetch, calls, unmatched, invalid, graphql, when, routes: [...known], serveWiki(handler) { wikiHandler = handler; } };
}
