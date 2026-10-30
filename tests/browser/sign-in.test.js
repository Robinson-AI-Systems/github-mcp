// Real-browser tests of connecting and of "My connection". Every test drives a real browser engine through the real
// server code, a fake GitHub and a fake assistant app, then proves the result by using the connection over MCP.
// These are the checks that used to need Chris's phone.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('@neondatabase/serverless', async () => { const h = await import('./harness.js'); return { neon: () => h.fakeNeon() }; });
import { randomBytes } from 'node:crypto';
import { PROFILES, ORIGIN, appFinishes, appStartsSignIn, browserFor, mcpTool, startWorld } from './setup.js';

let world, people = 0;
beforeAll(async () => { world = await startWorld(); });
afterAll(async () => { await world?.close(); });

/** A fresh person on the fake GitHub, signed in in the fake GitHub's browser session. */
function person({ authorized = false, installed = true, orgs = {} } = {}) {
  people++;
  const login = 'person' + people;
  const p = world.github.addPerson({ login, id: 7000 + people, authorized, orgs });
  if (installed) world.github.install(p, login);
  world.github.state.signedIn = login;
  return p;
}
async function open(profile, { cookies = true } = {}) {
  const browser = await browserFor(profile.engine, world.proxyServer);
  if (!browser) return null;
  const context = await browser.newContext({ ...profile.device, ignoreHTTPSErrors: true,
    ...(cookies ? {} : { extraHTTPHeaders: { 'x-test-no-cookies': '1' } }) });
  const page = await context.newPage();
  return { context, page };
}
/** PUB-5 C: every public page forbids framing and scripts, and sends no sniffing or referrer leaks. */
function sendsSecurityHeaders(response, where) {
  const h = response.headers();
  expect(h['content-security-policy'], 'CSP on ' + where).toContain("default-src 'none'");
  expect(h['content-security-policy'], 'framing on ' + where).toContain("frame-ancestors 'none'");
  expect(h['content-security-policy'], 'no scripts on ' + where).not.toMatch(/script-src|'unsafe-eval'/);
  expect(h['x-content-type-options'], 'nosniff on ' + where).toBe('nosniff');
  expect(h['referrer-policy'], 'referrer policy on ' + where).toMatch(/^(no-referrer|same-origin)$/);
}
const arrived = (from) => world.app.received.slice(from);
/** Nothing on our pages may be wider than the screen (a phone would have to scroll sideways, and buttons get covered). */
async function fitsScreen(page) {
  const { wide, view } = await page.evaluate(() => ({ wide: document.documentElement.scrollWidth, view: window.innerWidth }));
  expect(wide, 'page wider than the screen: ' + page.url()).toBeLessThanOrEqual(view);
}
async function waitForApp(page, from) {
  await page.waitForURL((u) => u.host === 'chat.example.test', { timeout: 15000 });
  const got = arrived(from);
  expect(got).toHaveLength(1);
  return got[0];
}
/** The whole connect journey as the person sees it; returns the app's tokens. */
async function connect(page, { readOnly = false, expectInstall = false, installOn = null, appName } = {}) {
  const started = await appStartsSignIn(world, appName ? { name: appName } : {});
  const from = world.app.received.length;
  await page.goto(started.url);
  if (await page.title() === 'Authorize Robinson GitHub MCP') await page.click('#gh-authorize');
  if (expectInstall) {
    await page.waitForSelector('#install');
    expect(await page.title()).toBe('One more step');
    await fitsScreen(page);
    await page.click('#install');
    await page.click('#gh-install-' + installOn);
  }
  await page.waitForSelector('#approve');
  expect(await page.title()).toBe('Approve the connection');
  await fitsScreen(page);
  expect(await page.textContent('main')).toContain('chat.example.test');
  if (readOnly) await page.check('#ro');
  await page.click('#approve');
  const received = await waitForApp(page, from);
  return { started, tokens: await appFinishes(world, started, received) };
}

describe('connecting from an assistant app', () => {
  for (const profile of PROFILES) {
    it(`${profile.name}: first-time person installs the App inside the sign-in and is connected`, async () => {
      const b = await open(profile);
      if (!b) return console.warn('browser engine not installed here: ' + profile.engine);
      const p = person({ installed: false });
      const { tokens } = await connect(b.page, { expectInstall: true, installOn: p.login });
      const who = await mcpTool(world, tokens.access_token, 'github_whoami');
      expect(who.content.accounts.map((a) => a.login)).toEqual([p.login]);
      expect(who.content.mode).toBe('PRODUCTION');
      expect(who.content.my_connection_page).toBe(ORIGIN + '/connection');
      await b.context.close();
    });

    it(`${profile.name}: returning person, GitHub signs in silently, browser keeps NO cookies`, async () => {
      const b = await open(profile, { cookies: false });
      if (!b) return;
      const p = person({ authorized: true });
      const { tokens } = await connect(b.page, { readOnly: true });
      const who = await mcpTool(world, tokens.access_token, 'github_whoami');
      expect(who.content.accounts.map((a) => a.login)).toEqual([p.login]);
      expect(who.content.mode).toBe('PREVIEW');
      expect(who.content.profile).toBe('read_only');
      // Read-only refuses even a small, non-production change (review finding on #337)
      const write = await mcpTool(world, tokens.access_token, 'github_branch_create', { owner: p.login, repo: 'demo', branch: 'x', fromRef: 'main' });
      expect(write.isError).toBe(true);
      expect(JSON.stringify(write.content)).toMatch(/unknown|unavailable|read_only|cannot/i);
      await b.context.close();
    });
  }

  it('sets no cookie anywhere in the sign-in', async () => {
    const before = world.cookieLog.length;
    const b = await open(PROFILES[0]);
    if (!b) return;
    person({ authorized: true });
    await connect(b.page);
    expect(world.cookieLog.slice(before)).toEqual([]);
    await b.context.close();
  });

  it('Cancel tells the app the person said no, and gives it nothing', async () => {
    const b = await open(PROFILES[0]);
    if (!b) return;
    person({ authorized: true });
    const started = await appStartsSignIn(world);
    const from = world.app.received.length;
    await b.page.goto(started.url);
    await b.page.click('#cancel');
    const got = await waitForApp(b.page, from);
    expect(got.error).toBe('access_denied');
    expect(got.code).toBeUndefined();
    expect(got.state).toBe(started.nonce);
    await b.context.close();
  });

  it('a sign-in someone else started gives their app nothing unless the person approves it, and approving twice fails', async () => {
    const b = await open(PROFILES[0]);
    if (!b) return;
    person({ authorized: true });
    const attacker = await appStartsSignIn(world, { name: 'Totally Legit App' });
    // The attacker's own browser follows their sign-in link as far as GitHub, then sends the victim that GitHub address.
    const res = await world.call({ path: new URL(attacker.url).pathname + new URL(attacker.url).search });
    expect(res.status).toBe(302);
    const githubLink = res.headers.location;
    expect(githubLink.startsWith('https://github.com/login/oauth/authorize')).toBe(true);
    const from = world.app.received.length;
    await b.page.goto(githubLink);
    await b.page.waitForSelector('#approve');
    expect(await b.page.textContent('main')).toContain('Totally Legit App');
    expect(arrived(from)).toEqual([]);
    const handle = await b.page.getAttribute('input[name=handle]', 'value');
    await b.page.click('#cancel');
    await waitForApp(b.page, from);
    // The same page cannot be used again (one use, server-side).
    const again = await world.call({ method: 'POST', path: '/api/oauth/authorize', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: ORIGIN },
      body: new URLSearchParams({ step: 'approve', handle, choice: 'approve' }).toString() });
    expect(again.status).toBe(403);
    expect(again.text).toContain('This step has expired');
    expect(arrived(from).filter((r) => r.code)).toEqual([]);
  });

  it('a form posted from another site is refused even with a real handle', async () => {
    const b = await open(PROFILES[0]);
    if (!b) return;
    person({ authorized: true });
    const started = await appStartsSignIn(world);
    await b.page.goto(started.url);
    await b.page.waitForSelector('#approve');
    const handle = await b.page.getAttribute('input[name=handle]', 'value');
    const res = await world.call({ method: 'POST', path: '/api/oauth/authorize', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://evil.example.test' },
      body: new URLSearchParams({ step: 'approve', handle, choice: 'approve' }).toString() });
    expect(res.status).toBe(403);
    await b.context.close();
  });

  it('an organization member who is not an owner is told to ask an owner, and nothing is connected', async () => {
    const b = await open(PROFILES[0]);
    if (!b) return;
    const owner = world.github.addPerson({ login: 'org-owner-1', id: 6901, orgs: { 'acme-co': { id: 8801, role: 'admin' } } });
    world.github.install(owner, 'acme-co');
    person({ authorized: true, installed: false, orgs: { 'acme-co': { id: 8801, role: 'member' } } });
    const started = await appStartsSignIn(world);
    await b.page.goto(started.url);
    await b.page.waitForSelector('#install');
    expect(await b.page.textContent('main')).toContain('not installed on any account you own');
    await b.context.close();
  });
});

describe('one sign-in for everyone', () => {
  it('an app on the retired private-pilot sign-in is told to connect again; the old passphrase form is not offered to it', async () => {
    const res = await world.call({ path: '/api/oauth/authorize?client_id=tcl_' + 'a'.repeat(40) + '&response_type=code' });
    expect(res.status).toBe(410);
    expect(res.text).toContain('Connect again');
    expect(res.text).not.toMatch(/passphrase/i);
  });
  it('a new app registration always gets the public sign-in', async () => {
    const started = await appStartsSignIn(world);
    expect(started.client.client_id).toMatch(/^pcl_/);
    const res = await world.call({ path: new URL(started.url).pathname + new URL(started.url).search });
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^https:\/\/github\.com\/login\/oauth\/authorize\?/);
  });
});

describe('My connection', () => {
  it('adds an account later, and the app already connected gets it without reconnecting', async () => {
    const b = await open(PROFILES[0]);
    if (!b) return;
    const p = person({ authorized: true, installed: false, orgs: {} });
    world.github.state.people.get(p.login).orgs['side-co'] = { id: 8811, role: 'admin' };
    world.github.install(p, 'side-co');
    const { tokens } = await connect(b.page);
    expect(await b.page.title()).toBe('App'); // back in the app
    let who = await mcpTool(world, tokens.access_token, 'github_whoami');
    expect(who.content.accounts.map((a) => a.login)).toEqual(['side-co']);

    await b.page.goto(ORIGIN + '/connection');
    await b.page.click('#manage-sign-in');
    await b.page.waitForSelector('#add-' + p.login);
    expect(await b.page.title()).toBe('My connection');
    await b.page.click('#add-' + p.login);
    await b.page.click('#gh-install-' + p.login);
    await b.page.waitForSelector('#save-zone');
    expect(await b.page.textContent('main')).toContain(p.login);
    who = await mcpTool(world, tokens.access_token, 'github_whoami');
    expect(who.content.accounts.map((a) => a.login).sort()).toEqual([p.login, 'side-co'].sort());
    await b.context.close();
  });

  it('adds an extra place with the master token: starts read-only, shows on a phone, can allow changes and be removed', async () => {
    const b = await open(PROFILES[0], { cookies: false });
    if (!b) return;
    const p = person({ authorized: true });
    world.github.state.people.get(p.login).orgs['acme-co'] = { id: 9911, role: 'member' };
    const { tokens } = await connect(b.page, { appName: 'Claude' });
    await b.page.goto(ORIGIN + '/connection');
    await b.page.click('#manage-sign-in');
    await b.page.waitForSelector('#master');
    // without a master token the section only explains
    expect(await b.page.textContent('main')).toContain('Extra places need your master token');
    await b.page.click('#master');
    await b.page.waitForSelector('input[name=value]');
    await b.page.fill('input[name=value]', world.github.classicToken(p));
    await b.page.click('button[type=submit]');
    await b.page.waitForSelector('#optional-done');
    await b.page.click('text=Back to My connection');
    await b.page.click('#manage-sign-in');
    await b.page.waitForSelector('#add-place');
    await b.page.fill('#place-value', 'acme-co');
    await b.page.click('#add-place');
    await b.page.waitForSelector('#place-changes-acme-co');
    expect(await b.page.textContent('.notice')).toContain('starts read-only');
    expect(await b.page.textContent('main')).toContain('read-only');
    await fitsScreen(b.page);
    let who = (await mcpTool(world, tokens.access_token, 'github_whoami', { detail: 'full' })).content;
    const place = who.accounts.find((a) => a.login === 'acme-co');
    expect(place).toMatchObject({ allow_changes: false, allowed_repos: 'whole account', setup: 'extra place (your master token)' });
    await b.page.click('#place-changes-acme-co');
    await b.page.waitForSelector('#remove-place-acme-co');
    expect(await b.page.textContent('main')).toContain('changes allowed');
    who = (await mcpTool(world, tokens.access_token, 'github_whoami', { detail: 'full' })).content;
    expect(who.accounts.find((a) => a.login === 'acme-co').allow_changes).toBe(true);
    await b.page.click('#remove-place-acme-co');
    await b.page.waitForSelector('.notice');
    who = (await mcpTool(world, tokens.access_token, 'github_whoami')).content;
    expect(who.accounts.map((a) => a.login)).not.toContain('acme-co');
    await b.context.close();
  });

  it('read-only switch, time zone, master token and disconnect all work from the page (no cookies)', async () => {
    const b = await open(PROFILES[0], { cookies: false });
    if (!b) return;
    const p = person({ authorized: true });
    const { tokens } = await connect(b.page, { appName: 'Claude' });
    await b.page.goto(ORIGIN + '/connection');
    await b.page.click('#manage-sign-in');
    await b.page.waitForSelector('#read_only');
    await fitsScreen(b.page);
    await b.page.click('#read_only');
    await b.page.waitForSelector('.notice');
    let who = (await mcpTool(world, tokens.access_token, 'github_whoami')).content;
    expect([who.mode, who.profile]).toEqual(['PREVIEW', 'read_only']);
    await b.page.click('#allow_changes');
    await b.page.waitForSelector('#read_only');
    who = (await mcpTool(world, tokens.access_token, 'github_whoami')).content;
    expect([who.mode, who.profile]).toEqual(['PRODUCTION', 'full']);

    await b.page.selectOption('select[name=value]', 'America/Denver');
    await b.page.click('#save-zone');
    await b.page.waitForSelector('.notice');
    expect(await b.page.textContent('.notice')).toContain('America/Denver');

    await b.page.click('#master');
    await b.page.waitForSelector('input[name=value]');
    expect(await b.page.title()).toBe('Master token');
    await fitsScreen(b.page);
    await b.page.fill('input[name=value]', world.github.classicToken(p));
    await b.page.click('button[type=submit]');
    await b.page.waitForSelector('#optional-done');
    await fitsScreen(b.page);
    who = (await mcpTool(world, tokens.access_token, 'github_whoami')).content;
    expect(who.master_token.added).toBe(true);

    await b.page.click('text=Back to My connection');
    await b.page.click('#manage-sign-in');
    await b.page.waitForSelector('[id^=disconnect-]');
    expect(await b.page.textContent('main')).toContain('never runs out');
    expect(await b.page.textContent('#master-unlocks')).toContain('Gists');
    expect(await b.page.textContent('#master-unlocks')).toContain('unlocked');
    await fitsScreen(b.page);
    // GOD-6: with a master token the page shows who GitHub will record, and the switch works
    await b.page.waitForSelector('#act-as-me');
    expect(await b.page.textContent('#act-as-state')).toContain('you');
    await b.page.click('#act-as-me');
    await b.page.waitForSelector('.notice');
    await b.page.waitForSelector('#act-as-me');
    expect(await b.page.textContent('#act-as-state')).toContain('Robinson GitHub MCP app');
    await b.page.click('#act-as-me');
    await b.page.waitForSelector('.notice');
    expect(await b.page.textContent('#act-as-state')).toContain('you');
    await fitsScreen(b.page);
    await b.page.click('[id^=disconnect-]');
    await b.page.waitForSelector('.notice');
    const gone = await world.call({ method: 'POST', path: '/api/mcp', headers: { authorization: 'Bearer ' + tokens.access_token,
      accept: 'application/json, text/event-stream', 'content-type': 'application/json' }, body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
    expect(gone.status).toBe(401);
    await b.context.close();
  });

  it('a person who never connected is told to connect from their app first', async () => {
    const b = await open(PROFILES[0]);
    if (!b) return;
    person({ authorized: true });
    await b.page.goto(ORIGIN + '/connection');
    await b.page.click('#manage-sign-in');
    await b.page.waitForSelector('h1');
    expect(await b.page.title()).toBe('Nothing connected yet');
    await b.context.close();
  });

  it('delete my data: sign in, confirm, and the connection stops working', async () => {
    const b = await open(PROFILES[1].engine === 'webkit' && await browserFor('webkit', world.proxyServer) ? PROFILES[1] : PROFILES[0], { cookies: false });
    if (!b) return;
    person({ authorized: true });
    const { tokens } = await connect(b.page);
    await b.page.goto(ORIGIN + '/api/oauth/authorize?forget=1');
    await b.page.click('#forget-start');
    await b.page.click('#delete');
    // WebKit may expose the proxy's loading document (which also has an h1)
    // before the POST navigation commits. Wait for the exact completed page.
    await b.page.waitForFunction(() => document.title === 'Your data is deleted');
    expect(await b.page.title()).toBe('Your data is deleted');
    const gone = await world.call({ method: 'POST', path: '/api/mcp', headers: { authorization: 'Bearer ' + tokens.access_token,
      accept: 'application/json, text/event-stream', 'content-type': 'application/json' }, body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
    expect(gone.status).toBe(401);
    await b.context.close();
  });
  it('shows the limits page in plain words and it fits a phone; My connection links to it', async () => {
    for (const profile of PROFILES) {
      const b = await open(profile, { cookies: false });
      if (!b) continue;
      await b.page.goto(ORIGIN + '/connection');
      await b.page.click('a[href="/limits"]');
      await b.page.waitForSelector('h1');
      expect(await b.page.title()).toBe('Limits');
      const text = await b.page.textContent('main');
      expect(text).toContain('Assistant calls');
      expect(text).toContain('120 a minute per app');
      expect(text).toContain('Saved results');
      expect(text).toContain('up to 50');
      await fitsScreen(b.page);
      await b.context.close();
    }
  });
  it('a key change does not sign people out: old connections keep working, new ones use the new key', async () => {
    const b = await open(PROFILES[0], { cookies: false });
    if (!b) return;
    person({ authorized: true });
    const { tokens } = await connect(b.page);
    const before = await mcpTool(world, tokens.access_token, 'github_whoami');
    expect(before.content.accounts.length).toBeGreaterThan(0);

    // The documented procedure (docs/GO-LIVE-CHECKLIST.md): old key into _PREVIOUS, new key into TOKEN_ENCRYPTION_KEY, release.
    const oldKey = process.env.TOKEN_ENCRYPTION_KEY, newKey = randomBytes(32).toString('base64url');
    try {
      process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS = oldKey;
      process.env.TOKEN_ENCRYPTION_KEY = newKey;
      const after = await mcpTool(world, tokens.access_token, 'github_whoami');
      expect(after.content.accounts.map((a) => a.login)).toEqual(before.content.accounts.map((a) => a.login));

      // Someone who connects after the change works too (sealed with the new key), on the same page flow.
      const second = await open(PROFILES[0], { cookies: false });
      person({ authorized: true });
      const again = await connect(second.page);
      const who = await mcpTool(world, again.tokens.access_token, 'github_whoami');
      expect(who.content.accounts.length).toBeGreaterThan(0);
      await second.context.close();
    } finally {
      process.env.TOKEN_ENCRYPTION_KEY = oldKey;
      delete process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS;
    }
    await b.context.close();
  });

  it('serves the privacy, terms, security and support pages with a draft banner, and the footer links to them', async () => {
    const b = await open(PROFILES[0], { cookies: false });
    if (!b) return;
    for (const [path, title] of [['/privacy', 'Privacy notice'], ['/terms', 'Terms of use'], ['/security', 'Security'], ['/support', 'Support']]) {
      sendsSecurityHeaders(await b.page.goto(ORIGIN + path), path);
      expect(await b.page.title()).toBe(title);
      const text = await b.page.textContent('main');
      expect(text).toContain('DRAFT');
      expect(text).toContain('support email coming soon');
      await fitsScreen(b.page);
    }
    sendsSecurityHeaders(await b.page.goto(ORIGIN + '/connection'), '/connection');
    sendsSecurityHeaders(await b.page.goto(ORIGIN + '/limits'), '/limits');
    await b.page.goto(ORIGIN + '/connection');
    await b.page.click('footer a[href="/privacy"]');
    expect(await b.page.title()).toBe('Privacy notice');
    await b.context.close();
  });
});
