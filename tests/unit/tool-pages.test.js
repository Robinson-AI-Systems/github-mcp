import { describe, expect, it } from 'vitest';
import { mergeNamespaces, isToolVisible, toolsForListing } from '../../src/core/registry.js';
import { pageToolsForListing, toolListingPages, TOOLS_PER_PAGE } from '../../src/core/tool-pages.js';
import { COMPACT_DEVELOPER_TOOLS, registry } from '../../src/tools/index.js';
import { checkBudgets, listingTokens, EVERYDAY_CATALOG_TOKEN_LIMIT } from '../../scripts/check-budgets.mjs';

const make = names => mergeNamespaces([{ tools: names.map(name => ({ name, description: 'Test', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } })),
  handlers: Object.fromEntries(names.map(name => [name, async () => null])) }]);
describe('MCP complete bounded catalog pagination', () => {
  it('returns all full-profile catalog tools once, in registry order, without missing functionality', () => {
    const pages = [...toolListingPages(registry, 'full', 'catalog')];
    const flattened = pages.flatMap(p => p.tools.map(t => t.name));
    // Operator-only tools (PUB-8) are listed only to the operator's own connection.
    expect(flattened).toEqual(registry.tools.filter(t => t.operatorOnly !== true).map(t => t.name));
    expect(registry.tools.filter(t => t.operatorOnly === true).map(t => t.name)).toEqual(['github_tenant_remove']);
    expect(new Set(flattened).size).toBe(flattened.length);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.slice(0, -1).every(p => p.tools.length === TOOLS_PER_PAGE && typeof p.nextCursor === 'string')).toBe(true);
    expect(pages.at(-1).nextCursor).toBeUndefined();
  });
  it('has one complete compact list and preserves every everyday tool through the cursor chain', () => {
    const compact = [...toolListingPages(registry, 'everyday', 'compact')];
    expect(compact.flatMap(p => p.tools.map(t => t.name))).toEqual(toolsForListing(registry, 'everyday', 'compact').map(t => t.name));
    const everyday = [...toolListingPages(registry, 'everyday', 'catalog')];
    expect(everyday.flatMap(p => p.tools.map(t => t.name))).toEqual(registry.tools.filter(t => isToolVisible(t,'everyday')).map(t => t.name));
    expect(checkBudgets(registry.tools)).toEqual([]);
    expect(listingTokens(registry.tools).everyday).toBeLessThan(EVERYDAY_CATALOG_TOKEN_LIMIT);
  });
  it('shows everyday developer workflows directly without profile, budget, or catalog bypass', () => {
    const names = new Set(registry.tools.map(t => t.name));
    expect(new Set(COMPACT_DEVELOPER_TOOLS).size).toBe(COMPACT_DEVELOPER_TOOLS.length);
    for (const name of COMPACT_DEVELOPER_TOOLS) {
      expect(names.has(name), name).toBe(true);
      expect(registry.tools.find(t => t.name === name).compact, name).toBe(true);
    }
    for (const profile of ['read_only', 'everyday', 'full']) {
      const pages = [...toolListingPages(registry, profile, 'compact')];
      expect(pages, profile).toHaveLength(1);
      expect(pages[0].nextCursor, profile).toBeUndefined();
      expect(pages[0].tools.length, profile).toBeLessThanOrEqual(TOOLS_PER_PAGE);
      const listed = pages[0].tools.map(t => t.name);
      expect(listed).toEqual(toolsForListing(registry, profile, 'compact').map(t => t.name));
      for (const name of COMPACT_DEVELOPER_TOOLS) {
        const tool = registry.tools.find(t => t.name === name);
        expect(listed.includes(name), profile + ' ' + name).toBe(isToolVisible(tool, profile));
      }
      expect(listed).not.toContain('github_repo_delete');
      expect(listed).not.toContain('github_secret_set');
      expect(listed).not.toContain('github_protection_remove');
    }
    const low = pageToolsForListing(registry, 'read_only', 'compact').tools.map(t => t.name);
    expect(low).toContain('github_content_get');
    expect(low).not.toContain('github_content_commit_git_data');
    expect(low).not.toContain('github_pr_create');
  });
  it('refuses stale, malformed, cross-profile and wrong-listing cursors without expanding visibility', () => {
    const page = pageToolsForListing(registry, 'everyday', 'catalog');
    expect(page.nextCursor).toBeTruthy();
    for (const [profile, listing, cursor] of [
      ['full', 'catalog', page.nextCursor],
      ['everyday', 'compact', page.nextCursor],
      ['everyday', 'catalog', '!bad'],
      ['everyday', 'catalog', Buffer.from(JSON.stringify([1, 'everyday', 'catalog', 1, registry.tools.length, 'fake'])).toString('base64url')]
    ]) expect(() => pageToolsForListing(registry, profile, listing, cursor)).toThrow(/cursor/i);
    const changed = make(Array.from({ length: 81 }, (_, i) => 'github_foo' + i));
    const c = pageToolsForListing(changed, 'everyday', 'catalog');
    expect(() => pageToolsForListing(make(Array.from({ length: 81 }, (_, i) => 'github_bar' + i)), 'everyday', 'catalog', c.nextCursor)).toThrow(/cursor/i);
  });
  it('terminates with empty registry and exactly one page at boundary', () => {
    expect([...toolListingPages(make([]), 'everyday', 'catalog')]).toEqual([{ tools: [] }]);
    expect([...toolListingPages(make(Array.from({ length: TOOLS_PER_PAGE }, (_, i) => 'github_foo' + i)), 'everyday', 'catalog')]).toHaveLength(1);
  });
});
