// BRAND-UNLEASHED-1: the product is "GitHub Unleashed by Robinson AI Systems" on every surface people and apps see, the
// brand spec's disclaimer is present, the Arctic accent stays readable, and the stable identifiers did not change.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BRAND, BRAND_CSS, brandFooter, brandHeader, serverInfo } from '../../src/brand/brand.js';
import { renderHome } from '../../src/brand/home-page.js';
import { createGithubPolicy } from '../../src/oauth/policy.js';
import { registry } from '../../src/tools/index.js';

const PRODUCT = 'GitHub Unleashed by Robinson AI Systems';
const DISCLAIMER = 'GitHub Unleashed is a Robinson AI Systems product. It is not affiliated with, endorsed by, or sponsored by GitHub.';
const OLD = /Robinson GitHub MCP|Robinson MCP for GitHub|Connect GitHub MCP/;
const read = (path) => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');

// WCAG relative luminance and contrast ratio, from the hex tokens the pages use.
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

describe('BRAND-UNLEASHED-1 product name', () => {
  it('the MCP front door shows the new display name and keeps the machine name clients key on', () => {
    const info = serverInfo('https://github.robinsonaisystems.com');
    expect(info.title).toBe(PRODUCT);
    expect(info.name).toBe('robinson-github-mcp');
    expect(BRAND.product).toBe(PRODUCT);
    expect(BRAND.productShort).toBe('GitHub Unleashed');
    expect(JSON.parse(read('server.json'))).toMatchObject({ name: 'com.robinsonaisystems/github', title: PRODUCT });
    expect(JSON.parse(read('package.json')).name).toBe('@robinson-ai-systems/github-mcp');
  });

  it('the shared header, footer and home page carry the name and the disclaimer, never the old name', () => {
    expect(brandHeader()).toContain(`<b>${PRODUCT}</b>`);
    expect(brandFooter()).toContain(DISCLAIMER);
    const home = renderHome('https://github.robinsonaisystems.com');
    expect(home).toContain(`<title>${PRODUCT}</title>`);
    expect(home).toContain(DISCLAIMER);
    expect(home).toContain(`Create a custom connector named ${PRODUCT}.`);
    expect(home).not.toMatch(OLD);
  });

  it('the sign-in (consent) page carries the name and the disclaimer', () => {
    const consent = createGithubPolicy({ env: {} }).page({ params: {}, choices: [] });
    expect(consent).toContain(`<h1>Connect ${PRODUCT}</h1>`);
    expect(consent).toContain(DISCLAIMER);
    expect(consent).not.toMatch(OLD);
  });

  it('the website button and the docs front page carry the disclaimer', () => {
    expect(read('docs/website/connect-button.html')).toContain(DISCLAIMER);
    expect(read('README.md').split('\n').slice(0, 4).join('\n')).toContain(DISCLAIMER);
  });
});

describe('BRAND-UNLEASHED-1 accent', () => {
  it('uses the Arctic accent from the brand spec and keeps text on it readable', () => {
    expect(BRAND.arctic).toBe('#4DDFFF');
    expect(read('docs/UNLEASHED-BRAND-SPEC.md')).toContain('| GitHub Unleashed | Arctic | `#4DDFFF` |');
    expect(BRAND_CSS).toContain('--accent:#4DDFFF');
    expect(BRAND_CSS).toMatch(/button\{[^}]*color:var\(--on-accent\);background:var\(--accent\)/);
    expect(BRAND_CSS).toContain('a{color:var(--accent)}');
    // Button text (Charcoal) on the accent, and accent links on both page surfaces: WCAG AA (4.5:1) with room to spare.
    expect(contrast(BRAND.charcoal, BRAND.arctic)).toBeGreaterThan(7);
    expect(contrast(BRAND.arctic, BRAND.graphite)).toBeGreaterThan(7);
    // White text on the accent would be unreadable, which is why the pages never use it.
    expect(contrast('#FFFFFF', BRAND.arctic)).toBeLessThan(3);
    expect(BRAND_CSS).not.toMatch(/color:#fff;background:var\(--accent\)/);
  });
});

describe('BRAND-UNLEASHED-1 stable identifiers', () => {
  it('every tool keeps its github_ name and the catalog still lists each one', () => {
    const catalog = new Set(read('docs/TOOL-CATALOG.md').match(/`github_[a-z0-9_]+`/g).map((n) => n.slice(1, -1)));
    for (const t of registry.tools) {
      expect(t.name).toMatch(/^github_[a-z0-9_]+$/);
      expect(t.name).not.toMatch(/unleashed/);
      expect(catalog.has(t.name), t.name).toBe(true);
      expect(String(t.description ?? '')).not.toMatch(OLD);
    }
  });
});
