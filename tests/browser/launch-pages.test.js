// PUB-7: the draft trust pages in real browsers at phone width (Pixel 7 is 412 px wide), and a small smoke run of the local-only
// load-test harness (the full run is `npm run test:load`). Fake GitHub, fake app, throwaway localhost Postgres; never production.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('@neondatabase/serverless', async () => { const h = await import('./harness.js'); return { neon: () => h.fakeNeon() }; });
import { PROFILES, ORIGIN, browserFor, startWorld } from './setup.js';
import { runPublicLoad } from '../load/public-load-run.js';
import { checkLoadRecord, loadTestRecord } from '../../src/launch/load-result.js';

let world;
beforeAll(async () => { world = await startWorld(); });
afterAll(async () => { await world?.close(); });

async function open(profile) {
  const browser = await browserFor(profile.engine, world.proxyServer);
  if (!browser) return null;
  const context = await browser.newContext({ ...profile.device, ignoreHTTPSErrors: true, extraHTTPHeaders: { 'x-test-no-cookies': '1' } });
  return { context, page: await context.newPage() };
}
async function fitsScreen(page) {
  const { wide, view } = await page.evaluate(() => ({ wide: document.documentElement.scrollWidth, view: window.innerWidth }));
  expect(wide, 'page wider than the screen: ' + page.url()).toBeLessThanOrEqual(view);
}
const PAGES = [['/privacy', 'Privacy notice'], ['/terms', 'Terms of use'], ['/security', 'Security'], ['/support', 'Support'], ['/status', 'Service status']];

describe('draft trust pages (PUB-7)', () => {
  for (const profile of PROFILES.slice(0, 2)) {
    it(`${profile.name}: every page is labelled a draft not in effect, fits the screen and runs no scripts`, async () => {
      const b = await open(profile);
      if (!b) return console.warn('browser engine not installed here: ' + profile.engine);
      for (const [path, title] of PAGES) {
        const response = await b.page.goto(ORIGIN + path);
        // Phones in these profiles are at most 412 px wide (Pixel 7); every page must fit that.
        expect(await b.page.evaluate(() => window.innerWidth), path).toBeLessThanOrEqual(412);
        expect(response.status(), path).toBe(200);
        const csp = response.headers()['content-security-policy'];
        expect(csp, path).toContain("default-src 'none'");
        expect(csp, path).not.toMatch(/script-src/);
        expect(await b.page.title()).toBe(title);
        const text = await b.page.textContent('main');
        expect(text, path).toContain('DRAFT — not yet reviewed by a lawyer; not in effect.');
        expect(text, path).not.toContain('Approved by the owner');
        expect(await b.page.locator('script').count(), path).toBe(0);
        await fitsScreen(b.page);
      }
      // The status page shows the current switches in plain words and is not linked from any page until Chris approves it.
      await b.page.goto(ORIGIN + '/status');
      expect(await b.page.textContent('main')).toContain('Right now');
      for (const path of ['/', '/connection', '/privacy']) {
        await b.page.goto(ORIGIN + path);
        expect(await b.page.locator('a[href="/status"]').count(), path).toBe(0);
      }
      await b.context.close();
    });
  }
});

describe('load-test harness smoke (PUB-7)', () => {
  it('a few simulated people sign in and call MCP at once against the local fake, and the result record passes only when big enough', async () => {
    const report = await runPublicLoad(world, { people: 4, atOnce: 2, calls: 2, prefix: 'smoke-', firstId: 950000 });
    expect(report.first_errors).toEqual([]);
    expect(report.errors).toBe(0);
    expect(report.sign_in.n).toBe(4);
    expect(report.whoami_calls.n).toBe(8);
    const record = loadTestRecord(report, { ranAt: new Date().toISOString() });
    // A smoke run is real but too small to count as the launch load test.
    expect(checkLoadRecord(record).problems.join()).toMatch(/only 4 simulated people/);
  });
});
