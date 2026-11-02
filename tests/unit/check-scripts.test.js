import { describe, expect, it } from 'vitest';
import { missingDocs } from '../../scripts/check-docs-updated.mjs';
import { checkWrites, parseCatalog, parseSafety } from '../../scripts/check-writes.mjs';
import { checkBudgets, listingTokens } from '../../scripts/check-budgets.mjs';

describe('docs check (DRIFT-PROTOCOL B)', () => {
  it('passes docs-only and tooling-only changes', () => {
    expect(missingDocs(['docs/PLAN.md', 'scripts/x.mjs'])).toEqual([]);
  });
  it('requires STATUS and a card when code changes', () => {
    expect(missingDocs(['src/github/client.js'])).toEqual(['docs/STATUS.md or a docs/status/ note', 'a PR card or docs/pr-cards/work-index.json']);
    expect(missingDocs(['src/github/client.js', 'docs/STATUS.md', 'docs/pr-cards/README.md'])).toEqual(['a PR card or docs/pr-cards/work-index.json']);
    expect(missingDocs(['api/mcp.js', 'docs/STATUS.md', 'docs/pr-cards/work-index.json'])).toEqual([]);
  });
  it('accepts a docs/status note in place of STATUS.md, but not the README', () => {
    expect(missingDocs(['src/github/client.js', 'docs/status/2026-10-22-x.md', 'docs/pr-cards/B-1.md'])).toEqual([]);
    expect(missingDocs(['src/github/client.js', 'docs/status/README.md', 'docs/pr-cards/B-1.md'])).toEqual(['docs/STATUS.md or a docs/status/ note']);
  });
  it('requires TOOL-CATALOG when src/tools changes', () => {
    expect(missingDocs(['src/tools/repo.js', 'docs/STATUS.md', 'docs/pr-cards/B-1.md'])).toEqual(['docs/TOOL-CATALOG.md']);
  });
  it('honours the written exception only with a reason', () => {
    expect(missingDocs(['src/x.js'], 'Docs-update: not needed — comment-only change')).toEqual([]);
    expect(missingDocs(['src/x.js'], 'Docs-update: not needed — ')).not.toEqual([]);
  });
});

describe('write-safety check (B-7)', () => {
  const DECL = { production: 'never', accessWidening: false, notifies: false, spend: false, confirm: 'when-needed', cred: 'I', profiles: ['everyday', 'full'] };
  const IN = { properties: { dryRun: {}, confirm: {} } };
  const write = (name, declarations = {}, extra = {}) => ({ name, audience: ['O'], writes: true, writeContract: 'defineWrite-v1', inputSchema: IN, priced: false, declarations: { ...DECL, ...declarations }, ...extra });
  const catalogOf = (rows) => parseCatalog(rows.map(([n, safety, cred, profile]) => `| \`${n}\` | What | ${safety} | N | ${cred} | O | ${profile} | B-7 |`).join('\n'));

  it('fails a write tool without dryRun/confirm, a write contract or declarations, and ignores reads', () => {
    const tools = [
      { name: 'github_repo_get', writes: false, audience: ['O'] },
      { name: 'github_label_create', audience: ['O'], writes: true, inputSchema: { properties: { name: {} } } },
      { name: 'github_pr_merge', audience: ['O'], writes: true, writeContract: {}, inputSchema: IN }
    ];
    expect(checkWrites(tools)).toEqual([
      'github_label_create: write tool without dryRun/confirm inputs',
      'github_label_create: write tool without a declared write contract (defineWrite)',
      'github_label_create: write tool without declarations',
      'github_pr_merge: write tool without declarations'
    ]);
  });

  it('parses catalog rows and Safety marks', () => {
    const c = catalogOf([['github_a', 'C·Prod*·A·M', 'I,U', 'F'], ['github_b', '—', 'I', 'R'], ['github_c', 'C (always)', '—', 'E'], ['github_d', 'as the tool', 'I', 'E']]);
    expect([...c.keys()]).toEqual(['github_a', 'github_b', 'github_c', 'github_d']);
    expect(parseSafety('C·Prod*·A·M')).toMatchObject({ confirmAlways: true, prod: 'when-target', access: true, notifies: true, spend: false });
    expect(parseSafety('P·$*')).toMatchObject({ preview: true, spend: true, confirmAlways: false });
    expect(parseSafety('C (always)')).toMatchObject({ confirmAlways: true });
    expect(parseSafety('—')).toEqual({ read: true });
    expect(parseSafety('as the tool')).toBeNull();
  });

  it('passes a tool that matches its row', () => {
    const c = catalogOf([['github_ok', 'P·Prod*·M', 'I', 'E'], ['github_big', 'C·$', 'I,U', 'F'], ['github_read', '—', 'I', 'R']]);
    expect(checkWrites([write('github_ok', { production: 'when-target', notifies: true }),
      write('github_big', { spend: true, confirm: 'always', cred: 'I,U', profiles: ['full'] }, { priced: true }), { name: 'github_read', audience: ['O'], writes: false }], c)).toEqual([]);
  });

  it('fails each kind of drift between a tool and its catalog row', () => {
    const c = catalogOf([['github_a', 'P', 'I', 'E'], ['github_b', 'C·Prod', 'I', 'F'], ['github_r', '—', 'I', 'R'], ['github_w', 'P', 'I', 'R']]);
    const bad = (tool) => checkWrites([tool], c);
    expect(bad(write('github_a', { production: 'always' }))).toEqual(['github_a: production is "always" but the catalog says "never" (P)']);
    expect(bad(write('github_a', { accessWidening: true }))[0]).toContain('accessWidening is true');
    expect(bad(write('github_a', { notifies: true }))[0]).toContain('notifies is true');
    expect(bad(write('github_a', { spend: true }, { priced: true }))[0]).toContain('spend is true');
    expect(bad(write('github_a', { confirm: 'always' }))[0]).toContain('preview only (P)');
    expect(bad(write('github_b', { production: 'always', confirm: 'when-needed', profiles: ['full'] }))[0]).toContain('always needs confirm (C)');
    expect(bad(write('github_a', { cred: 'U' }))).toEqual(['github_a: credential is "U" but the catalog says "I"']);
    expect(bad(write('github_a', { profiles: ['full'] }))[0]).toContain('profiles are ["full"] but the catalog says E');
    expect(bad(write('github_w'))[0]).toContain('not valid for a write tool');
    expect(bad(write('github_r'))[0]).toContain('catalog says read-only');
    expect(bad({ name: 'github_r', audience: ['O'], writes: false, annotations: {} })).toEqual([]);
    expect(bad({ name: 'github_a', audience: ['O'], writes: false })[0]).toContain('catalog says it changes things');
    expect(bad(write('github_a', {}, { audience: ['B'] }))).toEqual(['github_a: audience is B but the catalog says O']);
    expect(bad({ name: 'github_r', writes: false })).toEqual(['github_r: tool without an audience (B, O, Op)']);
    expect(bad(write('github_missing'))).toEqual(['github_missing: registered tool has no row in docs/TOOL-CATALOG.md']);
  });

  it('fails a spend tool that has no price function', () => {
    const c = catalogOf([['github_s', 'C·$', 'I', 'F']]);
    expect(checkWrites([write('github_s', { spend: true, confirm: 'always', profiles: ['full'] })], c)).toEqual(['github_s: spend tool without a price function']);
  });
});

describe('token-budget check (C-2)', () => {
  const words = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
  it('passes short descriptions and a small catalog', () => {
    expect(checkBudgets([{ name: 'github_ok', description: 'short', inputSchema: { type: 'object', properties: {} } }])).toEqual([]);
  });
  it('fails a description over 160 characters (counting the PRODUCTION / SPENDS MONEY prefix it is listed with)', () => {
    expect(checkBudgets([{ name: 'github_long', description: 'x'.repeat(161) }])).toEqual(['github_long: description over 160 characters']);
    const prefixed = { name: 'github_p', description: 'y'.repeat(150), writes: true, declarations: { production: 'always', spend: true } };
    expect(checkBudgets([prefixed])).toEqual(['github_p: description over 160 characters']);
  });
  it('fails a schema over 1,500 tokens', () => {
    const fat = { name: 'github_fat', description: 'd', inputSchema: { type: 'object', properties: { a: { type: 'string', description: words(1600) } } } };
    expect(checkBudgets([fat])).toEqual(['github_fat: schema over 1500 tokens']);
  });
  it('fails any compact page over 6,000 tokens or everyday catalog page over 22,000', () => {
    const compact = Array.from({ length: 120 }, (_, i) => ({ name: `github_c${i}`, compact: true, description: words(24), inputSchema: { type: 'object', properties: { a: { type: 'string', description: words(250) } } } }));
    expect(checkBudgets(compact).some((f) => f.startsWith('compact listing is'))).toBe(true);
    const catalog = Array.from({ length: 400 }, (_, i) => ({ name: `github_e${i}`, description: words(24), inputSchema: { type: 'object', properties: { a: { type: 'string', description: words(950) } } } }));
    expect(checkBudgets(catalog).some((f) => f.startsWith('everyday catalog page is'))).toBe(true);
    expect(listingTokens(compact).compact).toBeGreaterThan(5000);
    expect(listingTokens(catalog).compact).toBe(listingTokens([]).compact);
  });
});
