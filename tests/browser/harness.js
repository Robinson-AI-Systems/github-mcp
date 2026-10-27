// Real-browser sign-in harness. Runs the REAL api/*.js handlers inside one local HTTPS server, a fake GitHub and a fake
// assistant app (ChatGPT/Claude stand-in) on separate sites, and drives a real browser (Chromium as an Android phone,
// WebKit as an iPhone when available) through the whole connect flow. Nothing here talks to the internet:
// * the browser reaches every site through a local proxy that tunnels to this server (so the three sites really are
//   different sites, with real cookie, redirect and form rules applied by the browser engine);
// * the server's own calls to GitHub go to the same fake GitHub through a stubbed global fetch;
// * the database is a throwaway local PostgreSQL reached through a stand-in for the Neon HTTP driver.
// Fake values only. No real credential, account or network service is used.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import pg from 'pg';

export const HOSTS = Object.freeze({ server: 'connect.example.test', github: 'github.com', api: 'api.github.com', app: 'chat.example.test' });
export const ORIGIN = 'https://' + HOSTS.server;
export const APP_CALLBACK = 'https://' + HOSTS.app + '/oauth/callback';
export const APP_ID = 970001;
export const APP_SLUG = 'robinson-github-mcp-test';

// ---------------------------------------------------------------- database: a Neon-shaped driver over local PostgreSQL
let pool = null;
export function setPool(p) { pool = p; }
const build = (strings, values) => {
  let text = strings[0];
  for (let i = 0; i < values.length; i++) text += '$' + (i + 1) + strings[i + 1];
  return { text, values };
};
/** Stand-in for `neon(url)`: a tagged template that runs on await, plus `.transaction([...])` and `.query(text, values)`.
 * Every URL reaches the same throwaway database; tenant isolation comes from the code's own search_path transaction. */
export function fakeNeon() {
  const sql = (strings, ...values) => {
    const q = build(strings, values);
    let running = null;
    const run = () => (running ??= pool.query(q.text, q.values).then((r) => r.rows));
    return { ...q, then: (ok, bad) => run().then(ok, bad), catch: (bad) => run().catch(bad), finally: (f) => run().finally(f) };
  };
  sql.query = (text, values = []) => pool.query(text, values).then((r) => r.rows);
  sql.transaction = async (queries) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const out = [];
      for (const q of queries) out.push((await client.query(q.text, q.values)).rows);
      await client.query('COMMIT');
      return out;
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
  };
  return sql;
}

/** A brand-new database on the throwaway server, dropped afterwards. */
export async function freshDatabase(baseUrl) {
  const url = new URL(baseUrl);
  // A GitHub Actions *job container* connects to its disposable postgres
  // service by the Docker service hostname (not localhost). Never accept an
  // arbitrary remote DB address, including in CI.
  const localhost = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
  const actionsService = process.env.GITHUB_ACTIONS === 'true' &&
    url.hostname === 'postgres' && url.port === '5432';
  if (!localhost && !actionsService) throw new Error('Refusing non-local PostgreSQL.');
  const name = 'browser_' + randomBytes(5).toString('hex');
  const admin = new pg.Client({ connectionString: baseUrl });
  await admin.connect();
  await admin.query('CREATE DATABASE ' + name);
  await admin.end();
  url.pathname = '/' + name;
  return { url: url.toString(), name, async drop() {
    const a = new pg.Client({ connectionString: baseUrl }); await a.connect();
    await a.query('DROP DATABASE IF EXISTS ' + name + ' WITH (FORCE)').catch(() => {}); await a.end();
  } };
}

// ---------------------------------------------------------------- fake GitHub (browser pages + REST API)
/** People and their installations. `signedIn` is who the fake github.com thinks the browser is; `authorized` says
 * whether they approved the App before (then GitHub signs them in silently, the case that once broke the hand-back). */
export function createFakeGithub() {
  const state = {
    signedIn: null,
    people: new Map(),
    codes: new Map(),
    tokens: new Map(),
    nextInstall: 50001,
    log: []
  };
  const addPerson = ({ login, id, orgs = {}, authorized = false }) => {
    const person = { login, id, orgs, authorized, installs: [], token: 'ghu_FAKE' + randomBytes(12).toString('hex') };
    state.people.set(login, person);
    state.tokens.set(person.token, person);
    return person;
  };
  const accountFor = (person, target) => target === person.login
    ? { id: person.id, login: person.login, type: 'User' }
    : { id: person.orgs[target]?.id, login: target, type: 'Organization' };
  const install = (person, target) => {
    // An install is visible to everyone who can see that account (owner, org admins and members).
    const account = accountFor(person, target);
    const row = { id: state.nextInstall++, app_id: APP_ID, account, repository_selection: 'all', suspended_at: null, target_type: account.type };
    for (const p of state.people.values())
      if (p === person || (account.type === 'Organization' && p.orgs[target])) p.installs.push(row);
    return row;
  };
  /** A classic token (the optional master token) for a person: answers /user with the scopes header. */
  const classicToken = (person, scopes = ['repo', 'notifications', 'gist']) => {
    const token = 'ghp_FAKE' + randomBytes(14).toString('hex');
    state.tokens.set(token, { ...person, classicScopes: scopes, ref: person });
    return token;
  };
  const issueCode = (person) => {
    const code = 'code' + randomBytes(10).toString('hex');
    state.codes.set(code, person);
    return code;
  };
  const page = (title, body) => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body><h1>${title}</h1>${body}</body></html>`;

  /** Browser side of github.com. */
  function browser(req, res, url, body) {
    state.log.push(req.method + ' github.com' + url.pathname);
    if (url.pathname === '/login/oauth/authorize') {
      const person = state.people.get(state.signedIn);
      if (!person) return send(res, 200, page('Sign in to GitHub', '<p>Not signed in.</p>'));
      const back = new URL(url.searchParams.get('redirect_uri'));
      const finish = () => {
        person.authorized = true;
        back.searchParams.set('code', issueCode(person));
        back.searchParams.set('state', url.searchParams.get('state'));
        res.writeHead(302, { location: back.toString() }); res.end();
      };
      if (req.method === 'POST' || person.authorized) return finish();
      return send(res, 200, page('Authorize Robinson GitHub MCP', `<form method="post"><button id="gh-authorize">Authorize</button></form>`));
    }
    const installPath = new RegExp('^/apps/' + APP_SLUG + '/installations/new$');
    if (installPath.test(url.pathname)) {
      const person = state.people.get(state.signedIn);
      if (!person) return send(res, 200, page('Sign in to GitHub', ''));
      if (req.method === 'GET') {
        const targets = [person.login, ...Object.keys(person.orgs).filter((o) => person.orgs[o].role === 'admin')];
        return send(res, 200, page('Install Robinson GitHub MCP', '<form method="post">' +
          targets.map((t) => `<button name="target" value="${t}" id="gh-install-${t}">Install on ${t}</button>`).join('') + '</form>'));
      }
      const row = install(person, body.target);
      const back = new URL(ORIGIN + '/api/github/setup');
      back.searchParams.set('installation_id', String(row.id));
      back.searchParams.set('setup_action', 'install');
      if (url.searchParams.get('state')) back.searchParams.set('state', url.searchParams.get('state'));
      res.writeHead(302, { location: back.toString() }); return res.end();
    }
    if (url.pathname === '/settings/tokens/new') return send(res, 200, page('New personal access token (classic)', ''));
    return send(res, 404, page('Not found', ''));
  }

  /** Server side: what the MCP server's own fetch() sees. */
  async function api(input, init = {}) {
    const url = String(typeof input === 'string' ? input : input.url);
    const json = (status, value) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
    if (url === 'https://github.com/login/oauth/access_token') {
      const params = init.body instanceof URLSearchParams ? init.body : new URLSearchParams(String(init.body));
      const person = state.codes.get(params.get('code'));
      state.codes.delete(params.get('code'));
      if (!person) return json(200, { error: 'bad_verification_code' });
      return json(200, { access_token: person.token, refresh_token: person.token + '_refresh', expires_in: 28800, refresh_token_expires_in: 15897600, token_type: 'bearer' });
    }
    const auth = String(new Headers(init.headers ?? {}).get('authorization') ?? '');
    const person = state.tokens.get(auth.replace(/^(Bearer|token) /i, ''));
    if (!url.startsWith('https://api.github.com/')) throw new Error('fake GitHub: unexpected address ' + url);
    if (!person) return json(401, { message: 'Bad credentials' });
    const path = url.slice('https://api.github.com'.length);
    state.log.push('API ' + path);
    if (path === '/user') {
      const res = json(200, { id: person.id, login: person.login, type: 'User' });
      if (person.classicScopes) res.headers.set('x-oauth-scopes', person.classicScopes.join(', '));
      return res;
    }
    if (path.startsWith('/user/installations')) return json(200, { total_count: person.installs.length, installations: person.installs });
    if (path.startsWith('/user/memberships/orgs?'))
      return json(200, Object.entries(person.orgs).map(([login, o]) => ({ state: 'active', role: o.role, organization: { id: o.id, login } })));
    const m = /^\/user\/memberships\/orgs\/([^/?]+)$/.exec(path);
    if (m) {
      const o = person.orgs[m[1]];
      return o ? json(200, { state: 'active', role: o.role, organization: { id: o.id, login: m[1] } }) : json(404, { message: 'Not Found' });
    }
    // GOD-5 extra places: who an owner is, and a repository the person can read (any repository of an organization they belong to).
    const u = /^\/users\/([^/?]+)$/.exec(path);
    if (u) {
      const o = person.orgs[u[1]];
      if (o) return json(200, { id: o.id, login: u[1], type: 'Organization' });
      return u[1] === person.login ? json(200, { id: person.id, login: person.login, type: 'User' }) : json(404, { message: 'Not Found' });
    }
    const r = /^\/repos\/([^/?]+)\/([^/?]+)$/.exec(path);
    if (r && person.orgs[r[1]]) return json(200, { name: r[2], owner: { login: r[1] }, permissions: { pull: true } });
    return json(404, { message: 'fake GitHub has no route for ' + path });
  }

  return { state, addPerson, install, classicToken, browser, api };
}

// ---------------------------------------------------------------- the local "internet": one HTTPS server, a proxy
function send(res, status, html) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}
function selfSignedCert() {
  const dir = mkdtempSync(join(tmpdir(), 'browser-cert-'));
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=browser-test',
      '-addext', 'subjectAltName=DNS:' + Object.values(HOSTS).join(',DNS:'),
      '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem')], { stdio: 'ignore' });
    return { key: readFileSync(join(dir, 'k.pem')), cert: readFileSync(join(dir, 'c.pem')) };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Vercel's request/response helpers on top of Node's. */
function vercelize(req, res, url, body, query) {
  req.query = query;
  req.body = body;
  req.cookies = Object.fromEntries(String(req.headers.cookie ?? '').split(/;\s*/).filter(Boolean).map((c) => [c.split('=')[0], c.slice(c.indexOf('=') + 1)]));
  res.status = (code) => { res.statusCode = code; return res; };
  res.send = (value) => { res.end(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)); return res; };
  res.json = (value) => { if (!res.getHeader('content-type')) res.setHeader('content-type', 'application/json; charset=utf-8'); res.end(JSON.stringify(value)); return res; };
}

const readBody = (req) => new Promise((resolve) => {
  const parts = [];
  req.on('data', (c) => parts.push(c));
  req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
});
const parseBody = (req, text) => {
  const type = String(req.headers['content-type'] ?? '').split(';')[0];
  if (!text) return undefined;
  if (type === 'application/x-www-form-urlencoded') return Object.fromEntries(new URLSearchParams(text));
  if (type === 'application/json') { try { return JSON.parse(text); } catch { return text; } }
  return text;
};

/** Maps a path on our server to its api/ file, honouring vercel.json rewrites (exact sources) and [param] files. */
export function createRouter({ handlers, rewrites }) {
  return (pathname, query) => {
    for (const r of rewrites) {
      if (r.source === pathname) {
        const dest = new URL(r.destination, ORIGIN);
        for (const [k, v] of dest.searchParams) query[k] = v;
        pathname = dest.pathname;
        break;
      }
    }
    if (handlers[pathname]) return handlers[pathname];
    const parts = pathname.split('/');
    const parent = parts.slice(0, -1).join('/');
    for (const [key, handler] of Object.entries(handlers)) {
      const m = /^(.*)\/\[(\w+)\]$/.exec(key);
      if (m && m[1] === parent) { query[m[2]] = parts.at(-1); return handler; }
    }
    return null;
  };
}

/** Starts the HTTPS server for all three sites and a CONNECT proxy for the browser. */
export async function startInternet({ route, github, app }) {
  const cookieLog = [];
  const tls = selfSignedCert();
  const server = https.createServer(tls, async (req, res) => {
    try {
      const host = String(req.headers.host ?? '').split(':')[0];
      const url = new URL(req.url, 'https://' + host);
      const text = await readBody(req);
      const body = parseBody(req, text);
      if (host === HOSTS.github) return github.browser(req, res, url, body ?? {});
      if (host === HOSTS.app) return app(req, res, url);
      if (host !== HOSTS.server) return send(res, 404, 'unknown site');
      // A browser that keeps no cookies for this site (some in-app browsers, private tabs, strict settings): it never
      // sends any and ignores every Set-Cookie. Marked per browser context with a test-only header.
      { const set = res.setHeader.bind(res);
        res.setHeader = (name, value) => { if (String(name).toLowerCase() === 'set-cookie') cookieLog.push(url.pathname + ' ' + String(value)); return set(name, value); }; }
      if (req.headers['x-test-no-cookies'] === '1') {
        delete req.headers.cookie;
        const set = res.setHeader.bind(res);
        res.setHeader = (name, value) => (String(name).toLowerCase() === 'set-cookie' ? res : set(name, value));
      }
      if (process.env.HARNESS_TRACE) console.log('TRACE', req.method, url.pathname, 'cookie=' + (req.headers.cookie ? 'yes' : 'no'));
      const query = Object.fromEntries(url.searchParams);
      const handler = route(url.pathname, query);
      if (!handler) return send(res, 404, 'no route');
      vercelize(req, res, url, body, query);
      await handler(req, res);
      if (!res.writableEnded) res.end();
    } catch (error) {
      if (!res.headersSent) send(res, 500, 'harness error: ' + String(error?.stack ?? error).slice(0, 2000));
      else res.end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const httpsPort = server.address().port;
  const proxy = http.createServer((req, res) => { res.writeHead(405); res.end(); });
  proxy.on('connect', (req, socket, head) => {
    const host = String(req.url).split(':')[0];
    if (!Object.values(HOSTS).includes(host)) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    const upstream = net.connect(httpsPort, '127.0.0.1', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head?.length) upstream.write(head);
      upstream.pipe(socket); socket.pipe(upstream);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
  });
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
  return {
    proxyServer: 'http://127.0.0.1:' + proxy.address().port,
    httpsPort, cookieLog,
    async close() { await new Promise((r) => proxy.close(r)); server.closeAllConnections?.(); await new Promise((r) => server.close(r)); }
  };
}

/** The assistant app's own callback page: records whatever arrives. */
export function createFakeApp() {
  const received = [];
  const handler = (req, res, url) => {
    if (url.pathname === '/oauth/callback') {
      received.push(Object.fromEntries(url.searchParams));
      return send(res, 200, '<!doctype html><title>App</title><h1 id="app-done">The app received the sign-in</h1>');
    }
    return send(res, 404, 'not found');
  };
  return { received, handler };
}

/** A server-to-server request to our site (what the assistant app does for registration, tokens and MCP calls). */
export function serverCall(port, { method = 'GET', path, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body));
    const req = https.request({ host: '127.0.0.1', port, method, path, servername: HOSTS.server, rejectUnauthorized: false,
      headers: { host: HOSTS.server, ...(data !== undefined && !headers['content-type'] ? { 'content-type': 'application/json' } : {}), ...headers } }, (res) => {
      const parts = []; res.on('data', (c) => parts.push(c));
      res.on('end', () => {
        const text = Buffer.concat(parts).toString('utf8');
        let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (data !== undefined) req.write(data);
    req.end();
  });
}
