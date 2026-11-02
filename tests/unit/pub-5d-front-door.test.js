// PUB-5 D: the home page, the new name, the registry file and the version number.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import handler from '../../api/index.js';
import { BRAND, VERSION, brandFooter, serverInfo, serverRelease } from '../../src/brand/brand.js';
import { renderHome } from '../../src/brand/home-page.js';
import { call, request } from '../../test/helpers/http-harness.js';

const read = (path) => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const pkg = JSON.parse(read('package.json'));
const server = JSON.parse(read('server.json'));
const ORIGIN = 'https://github.robinsonaisystems.com';

describe('the registry file server.json', () => {
  it('has the right name, a short description, the real address and the package version', () => {
    expect(server.$schema).toBe('https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json');
    expect(server.name).toBe('com.robinsonaisystems/github');
    expect(server.description.length).toBeLessThanOrEqual(100);
    expect(server.version).toBe(pkg.version);
    expect(server.remotes).toEqual([{ type: 'streamable-http', url: ORIGIN + '/api/mcp' }]);
    expect(new URL(server.websiteUrl).origin).toBe(ORIGIN);
    expect(JSON.stringify(server)).not.toMatch(/ghp_|secret|token/i);
  });
  it('the server info reports the same version and the new name', () => {
    expect(VERSION).toBe(pkg.version);
    expect(serverInfo(ORIGIN).version).toBe(pkg.version);
    expect(serverInfo(ORIGIN).title).toBe('Robinson MCP for GitHub');
    expect(BRAND.product).toBe('Robinson MCP for GitHub');
  });
  it('tells agents which release they are talking to (deployed commit)', () => {
    const sha = 'a'.repeat(40);
    expect(serverRelease({ VERCEL_GIT_COMMIT_SHA: sha })).toMatchObject({ version: pkg.version + '+' + 'a'.repeat(12), commit: sha,
      source: 'https://github.com/Robinson-AI-Systems/github-mcp/commit/' + sha });
    expect(serverRelease({ VERCEL_GIT_COMMIT_SHA: sha }).what_changed).toMatch(/ref live/);
    expect(serverRelease({ VERCEL_GIT_COMMIT_SHA: 'not-a-sha' })).toMatchObject({ version: pkg.version, commit: null });
    expect(serverRelease({})).toMatchObject({ version: pkg.version, commit: null });
  });
});

describe('the home page', () => {
  it('shows the address, the not-affiliated line and a section for each app, with no scripts', () => {
    const html = renderHome(ORIGIN);
    expect(html).toContain(`<code class="addr" id="address">${ORIGIN}/api/mcp</code>`);
    expect(html).toContain('Not affiliated with or endorsed by GitHub.');
    for (const word of ['<h2>Claude (web, desktop and phone app)</h2>', '<h2>ChatGPT</h2>', '<h2>Claude Code</h2>', '<h2>Cursor</h2>', '<h2>VS Code</h2>']) expect(html).toContain(word);
    expect(html).toContain(`claude mcp add --transport http github-robinson ${ORIGIN}/api/mcp`);
    expect(html).not.toMatch(/<script/i);
    for (const page of ['/connection', '/limits', '/privacy', '/terms', '/security', '/support']) expect(html).toContain(`href="${page}"`);
    for (const source of ['claude.com/docs/connectors', 'developers.openai.com', 'code.claude.com/docs', 'cursor.com/docs', 'code.visualstudio.com/docs']) expect(html).toContain(source);
  });
  it('every page footer carries the not-affiliated line', () => { expect(brandFooter()).toContain('Not affiliated with or endorsed by GitHub.'); });
  it('a browser gets the page with a strict policy; a program still gets the plain status', async () => {
    const page = await call(handler, request('GET', {}, { accept: 'text/html,application/xhtml+xml' }));
    expect(page.statusCode).toBe(200);
    expect(page.headers['Content-Type']).toContain('text/html');
    expect(page.headers['Content-Security-Policy']).toContain("default-src 'none'");
    expect(page.body).toContain('Robinson MCP for GitHub');
    const plain = await call(handler, request('GET', {}));
    expect(plain.headers['Content-Type'] ?? 'application/json').toMatch(/json/);
  });
});

describe('the website pack', () => {
  it('is one paragraph and a link with no scripts or tracking', () => {
    const html = read('docs/website/connect-button.html');
    expect(html).not.toMatch(/<script|<img|<iframe|utm_/i);
    expect(html).toContain('Not affiliated with or endorsed by GitHub');
    expect(html).toContain('href="https://github.robinsonaisystems.com/"');
  });
});

it('SINGLE-DOMAIN-1: the home page tells people the one domain to allow for whole-repository transfers', () => {
 const html = renderHome('https://mcp.example.test');
 expect(html).toContain('id="whole-repository"');
 expect(html).toMatch(/add <b>mcp\.example\.test<\/b> once to your AI's network allowlist/);
 expect(html).toContain('Capabilities / network access allowed-domains');
});
