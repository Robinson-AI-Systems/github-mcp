// Shared set-up for the real-browser sign-in tests: database, env, the real api/ handlers, fake GitHub, fake app, browser.
import { randomBytes, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { chromium, webkit, devices } from 'playwright';
import { APP_CALLBACK, APP_ID, APP_SLUG, HOSTS, ORIGIN, createFakeApp, createFakeGithub, createRouter, freshDatabase,
  serverCall, setPool, startInternet } from './harness.js';

/** Browsers people really use to connect. WebKit is Safari's engine (iPhone). */
export const PROFILES = [
  { name: 'Android phone (Chrome)', engine: 'chromium', device: devices['Pixel 7'] },
  { name: 'iPhone (Safari engine)', engine: 'webkit', device: devices['iPhone 15'] },
  { name: 'Desktop Chrome', engine: 'chromium', device: devices['Desktop Chrome'] }
];

const launched = new Map();
/** Launches (once) the browser engine for a profile. Returns null when the engine is not installed on this machine;
 * CI sets REQUIRE_ALL_BROWSERS=1 so a missing engine fails there instead of being skipped. */
export async function browserFor(engine, proxyServer) {
  if (launched.has(engine)) return launched.get(engine);
  let browser = null;
  try {
    const type = engine === 'webkit' ? webkit : chromium;
    const executablePath = engine === 'chromium' ? process.env.BROWSER_CHROMIUM_PATH || undefined : undefined;
    browser = await type.launch({ headless: true, executablePath, proxy: { server: proxyServer },
      args: engine === 'chromium' ? ['--no-sandbox', '--disable-dev-shm-usage'] : [] });
  } catch (error) {
    if (process.env.REQUIRE_ALL_BROWSERS === '1') throw error;
    browser = null;
  }
  launched.set(engine, browser);
  return browser;
}

export async function startWorld() {
  const base = process.env.TEST_DATABASE_URL;
  if (!base) throw new Error('Disposable TEST_DATABASE_URL is required (npm run test:browser starts one).');
  const db = await freshDatabase(base);
  const pool = new pg.Pool({ connectionString: db.url, max: 8 });
  setPool(pool);
  const key = randomBytes(32).toString('base64url');
  const env = {
    VERCEL_ENV: 'production', PUBLIC_BASE_URL: ORIGIN, DATABASE_URL: db.url, TOKEN_ENCRYPTION_KEY: key,
    GITHUB_PRIVATE_TENANT_PILOT: 'enabled', GITHUB_PUBLIC_CONNECT: 'enabled', GITHUB_PILOT_APP_ID: String(APP_ID),
    GITHUB_TENANT_ROUTING_KEY: randomBytes(32).toString('base64url'), ADMIN_PASSPHRASE: 'fake-passphrase-for-tests-only'
  };
  const saved = {};
  for (const [k, v] of Object.entries(env)) { saved[k] = process.env[k]; process.env[k] = v; }
  for (const k of ['GITHUB_PILOT_APP_CLIENT_ID', 'GITHUB_PILOT_APP_CLIENT_SECRET']) { saved[k] = process.env[k]; delete process.env[k]; }

  // Every server-side call to GitHub goes to the fake GitHub, and nothing else may leave this machine. This must happen
  // before the api/ modules load, because some capture fetch when they load.
  const github = createFakeGithub();
  const app = createFakeApp();
  const realFetch = globalThis.fetch;
  globalThis.fetch = github.api;

  // The service's GitHub App, stored the way the owner setup stores it (encrypted with fake values).
  const { createDb } = await import('../../src/db.js');
  const { encryptSecret } = await import('../../src/core/crypto.js');
  const { fakeNeon } = await import('./harness.js');
  const root = createDb(fakeNeon());
  await root.initSchema();
  const secret = (text, kind) => encryptSecret(text, { aad: `github-mcp/app/${APP_ID}/${kind}`, key: Buffer.from(key, 'base64url') });
  await root.saveApp({ id: APP_ID, slug: APP_SLUG, ownerLogin: 'robinson-test-owner', ownerType: 'Organization', clientId: 'Iv1.fakeclient0001',
    clientSecretEnc: secret('fake-client-secret', 'client_secret'), privateKeyEnc: secret('-----BEGIN FAKE KEY-----', 'private_key'),
    webhookSecretEnc: secret('fake-webhook-secret', 'webhook_secret'), permissions: { contents: 'write', metadata: 'read' } });


  const handlers = {};
  for (const [path, file] of Object.entries({
    '/api/oauth/authorize': 'oauth/authorize.js', '/api/oauth/token': 'oauth/token.js', '/api/oauth/register': 'oauth/register.js',
    '/api/github/[action]': 'github/[action].js', '/api/tenant/optional': 'tenant/optional.js', '/api/mcp': 'mcp.js', '/api/index': 'index.js',
    '/api/well-known/oauth-authorization-server': 'well-known/oauth-authorization-server.js',
    '/api/well-known/oauth-protected-resource': 'well-known/oauth-protected-resource.js'
  })) handlers[path] = (await import('../../api/' + file)).default;
  const { rewrites } = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
  const net = await startInternet({ route: createRouter({ handlers, rewrites }), github, app: app.handler });
  const call = (opts) => serverCall(net.httpsPort, opts);

  return {
    env, github, app, call, proxyServer: net.proxyServer, pool, cookieLog: net.cookieLog,
    async close() {
      for (const b of launched.values()) await b?.close().catch(() => {});
      launched.clear();
      await net.close();
      await pool.end();
      await db.drop();
      globalThis.fetch = realFetch;
      for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  };
}

/** What an assistant app does before opening the browser: register itself and build the sign-in address. */
export async function appStartsSignIn(world, { name = 'ChatGPT' } = {}) {
  const reg = await world.call({ method: 'POST', path: '/api/oauth/register', body: { redirect_uris: [APP_CALLBACK], client_name: name, token_endpoint_auth_method: 'client_secret_post' } });
  if (reg.status !== 201) throw new Error('registration failed ' + reg.status + ' ' + reg.text);
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const nonce = randomBytes(12).toString('hex');
  const url = new URL(ORIGIN + '/api/oauth/authorize');
  for (const [k, v] of Object.entries({ response_type: 'code', client_id: reg.json.client_id, redirect_uri: APP_CALLBACK, code_challenge: challenge,
    code_challenge_method: 'S256', state: nonce, resource: ORIGIN + '/api/mcp' })) url.searchParams.set(k, v);
  return { client: reg.json, verifier, nonce, url: url.toString() };
}

/** What the app does after the browser comes back: swap the code for tokens, then talk MCP with them. */
export async function appFinishes(world, started, received) {
  if (!received?.code) throw new Error('the app never received a sign-in code');
  if (received.state !== started.nonce) throw new Error('state mismatch');
  const form = new URLSearchParams({ grant_type: 'authorization_code', code: received.code, redirect_uri: APP_CALLBACK, code_verifier: started.verifier,
    client_id: started.client.client_id, client_secret: started.client.client_secret, resource: ORIGIN + '/api/mcp' });
  const tok = await world.call({ method: 'POST', path: '/api/oauth/token', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString() });
  if (tok.status !== 200) throw new Error('token exchange failed ' + tok.status + ' ' + tok.text);
  return tok.json;
}

/** Calls one MCP tool with the app's bearer token and returns the parsed tool result. */
export async function mcpTool(world, accessToken, name, args = {}) {
  const headers = { authorization: 'Bearer ' + accessToken, accept: 'application/json, text/event-stream', 'content-type': 'application/json' };
  const init = await world.call({ method: 'POST', path: '/api/mcp', headers, body: { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'browser-test', version: '1' } } } });
  if (init.status !== 200) throw new Error('MCP initialize failed ' + init.status + ' ' + init.text.slice(0, 300));
  const session = init.headers['mcp-session-id'];
  const res = await world.call({ method: 'POST', path: '/api/mcp', headers: { ...headers, ...(session ? { 'mcp-session-id': session } : {}) },
    body: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } } });
  const text = res.text.includes('data:') ? res.text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : res.text;
  const msg = JSON.parse(text);
  if (msg.error) throw new Error('MCP error ' + JSON.stringify(msg.error));
  const toolText = msg.result?.content?.[0]?.text ?? 'null';
  let content = msg.result?.structuredContent;
  if (content?.full_payload_location === 'content[0].text') content = JSON.parse(toolText);
  if (content === undefined) { try { content = JSON.parse(toolText); } catch { content = toolText; } }
  return { isError: msg.result?.isError === true, content };
}

export { HOSTS, ORIGIN, APP_CALLBACK };
