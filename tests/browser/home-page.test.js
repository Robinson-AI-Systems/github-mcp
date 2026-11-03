// PUB-5 D: the home page in real browsers (Android Chrome, iPhone Safari engine, desktop Chrome), and the renamed pages.
// With MARKETPLACE_SHOTS=1 the same run also writes the Marketplace screenshots (fake data only) into docs/marketplace/.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('@neondatabase/serverless', async () => { const h = await import('./harness.js'); return { neon: () => h.fakeNeon() }; });
import { mkdirSync } from 'node:fs';
import { MUSE_PUBLIC_CLIENT_ID } from '../../src/tenancy/muse-client.js';
import { PROFILES, ORIGIN, appFinishes, appStartsSignIn, browserFor, startWorld } from './setup.js';

let world;
beforeAll(async () => { world = await startWorld(); });
afterAll(async () => { await world?.close(); });

async function open(profile, viewport) {
  const browser = await browserFor(profile.engine, world.proxyServer);
  if (!browser) return null;
  const context = await browser.newContext({ ...profile.device, ...(viewport ? { viewport } : {}), ignoreHTTPSErrors: true, extraHTTPHeaders: { 'x-test-no-cookies': '1' } });
  return { context, page: await context.newPage() };
}
async function fitsScreen(page) {
  const { wide, view } = await page.evaluate(() => ({ wide: document.documentElement.scrollWidth, view: window.innerWidth }));
  expect(wide, 'page wider than the screen: ' + page.url()).toBeLessThanOrEqual(view);
}

describe('home page', () => {
  for (const profile of PROFILES) {
    it(`${profile.name}: shows the address once in a box, the not-affiliated line, the connect steps and the links; fits the screen; no scripts`, async () => {
      const b = await open(profile);
      if (!b) return console.warn('browser engine not installed here: ' + profile.engine);
      await b.page.goto(ORIGIN + '/');
      expect(await b.page.title()).toBe('GitHub Unleashed by Robinson AI Systems');
      await fitsScreen(b.page);
      expect(await b.page.textContent('#address')).toBe(ORIGIN + '/api/mcp');
      expect(await b.page.locator('#address').count()).toBe(1);
      const text = await b.page.textContent('main');
      expect(text).toContain('GitHub Unleashed is a Robinson AI Systems product. It is not affiliated with, endorsed by, or sponsored by GitHub.');
      for (const word of ['Claude', 'ChatGPT', 'Claude Code', 'Cursor', 'VS Code', 'Meta Muse', 'Meta Muse Code']) expect(text).toContain(word);
      expect(text).toContain('claude mcp add --transport http github-robinson ' + ORIGIN + '/api/mcp');
      const museConfig = JSON.parse(await b.page.locator('#muse-code-config').textContent());
      expect(museConfig.mcp_servers['github-robinson']).toEqual({
        transport: 'streamable_http', url: ORIGIN + '/api/mcp', enabled: true, mode: 'optional'
      });
      const museRequest = await b.page.locator('#muse-connector-request').textContent();
      expect(museRequest).toContain(ORIGIN + '/api/mcp');
      expect(museRequest).toContain('OAuth authorization code with S256 PKCE');
      expect(museRequest).toContain(MUSE_PUBLIC_CLIENT_ID);
      expect(await b.page.locator('#muse-client-id').textContent()).toBe(MUSE_PUBLIC_CLIENT_ID);
      expect(await b.page.locator('#muse-address').textContent()).toBe(ORIGIN + '/api/mcp');
      expect(text).toContain('Client Secret: leave blank.');
      expect(museRequest).not.toMatch(/Bearer\s+|ghp_|github_pat_|client_secret/i);
      expect(text).toContain('muse mcp login github-robinson');
      expect(text).toContain('muse mcp logout github-robinson');
      expect(text).toContain('not a Meta-reviewed or Meta-listed connector');
      expect(await b.page.locator('script').count()).toBe(0);
      for (const href of ['/connection', '/limits', '/privacy', '/terms', '/security', '/support']) expect(await b.page.locator(`a[href="${href}"]`).count()).toBeGreaterThan(0);
      await b.context.close();
    });
  }

  it('programs that do not ask for a web page still get the plain status', async () => {
    const res = await world.call({ method: 'GET', path: '/' });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ status: 'service-online', endpoint: '/api/mcp' });
  });

  it('the sign-in approve page and My connection show the new name and fit a phone', async () => {
    const b = await open(PROFILES[0]);
    if (!b) return;
    const p = world.github.addPerson({ login: 'homey', id: 8101, authorized: true });
    world.github.install(p, 'homey'); world.github.state.signedIn = 'homey';
    const started = await appStartsSignIn(world, { name: 'Claude' });
    await b.page.goto(started.url);
    if (await b.page.title() === 'Authorize Robinson GitHub MCP') await b.page.click('#gh-authorize');
    await b.page.waitForSelector('#approve');
    expect(await b.page.textContent('header.brand b')).toBe('GitHub Unleashed by Robinson AI Systems');
    await fitsScreen(b.page);
    if (process.env.MARKETPLACE_SHOTS === '1') await shot(b.page, 'approve');
    await b.context.close();
  });
});

async function shot(page, name) {
  mkdirSync(new URL('../../docs/marketplace/', import.meta.url), { recursive: true });
  await page.screenshot({ path: new URL(`../../docs/marketplace/${name}.png`, import.meta.url).pathname });
}

/** Screenshots show the real public address instead of the test host (the page text only; nothing else is changed). */
async function realAddress(page) {
  await page.evaluate(({ from, to }) => { document.querySelectorAll('code, pre').forEach((el) => { el.textContent = el.textContent.split(from).join(to); }); },
    { from: ORIGIN, to: 'https://github.robinsonaisystems.com' });
}

describe.runIf(process.env.MARKETPLACE_SHOTS === '1')('marketplace screenshots', () => {
  it('home and My connection (signed in), 1280x800, fake data', async () => {
    const b = await open(PROFILES[2], { width: 1280, height: 800 });
    if (!b) return;
    await b.page.goto(ORIGIN + '/');
    await realAddress(b.page);
    await shot(b.page, 'home');
    const p = world.github.addPerson({ login: 'sample-person', id: 8102, authorized: true });
    world.github.install(p, 'sample-person'); world.github.state.signedIn = 'sample-person';
    const started = await appStartsSignIn(world, { name: 'Claude' });
    const from = world.app.received.length;
    await b.page.goto(started.url);
    if (await b.page.title() === 'Authorize Robinson GitHub MCP') await b.page.click('#gh-authorize');
    await b.page.waitForSelector('#approve');
    await b.page.click('#approve');
    await b.page.waitForURL((u) => u.host === 'chat.example.test', { timeout: 15000 });
    await appFinishes(world, started, world.app.received[from]);
    await b.page.goto(ORIGIN + '/connection');
    await b.page.click('#manage-sign-in');
    await b.page.waitForSelector('#read_only, #allow_changes', { timeout: 8000 }).catch(async () => { throw new Error('stuck on: ' + await b.page.title() + ' / ' + (await b.page.textContent('main')).slice(0, 300)); });
    await shot(b.page, 'my-connection');
    await b.context.close();
  });
});
