// Adapted from Robinson-AI-Systems/stripe-mcp scripts/check-budgets.mjs @ e2f90e8; completed for C-2 (BATCH-C C7).
// Budgets are tests: fails when a listed description is over 160 characters, a tool's schema is over 1,500 tokens, the compact
// listing is over 6,000 tokens or the everyday catalog listing is over 22,000. Tokens are counted with a pinned tokenizer
// (gpt-tokenizer) on exactly what `tools/list` sends (`listedTool`). The counts are printed so CI shows the trend.
import path from 'node:path';
import { encode } from 'gpt-tokenizer';
import { listedDescription } from '../src/core/registry.js';
import { toolListingPages } from '../src/core/tool-pages.js';

export const DESCRIPTION_LIMIT = 160;
export const SCHEMA_TOKEN_LIMIT = 1500;
// Raised from 5,000 on 2026-11-02 (SINGLE-DOMAIN-1): the owner asked for the whole-repository download and
// workspace transfer tools in the default list (docs/DECISIONS.md). Still about half the everyday catalog page.
export const COMPACT_TOKEN_LIMIT = 6000;
export const EVERYDAY_CATALOG_TOKEN_LIMIT = 22000;
export const countTokens = (value) => encode(JSON.stringify(value)).length;

/** Token counts for each listing a connection can get. */
export function listingTokens(tools) {
  const registry = { tools };
  const of = (profile, listing) => Math.max(0, ...[...toolListingPages(registry, profile, listing)].map(p => countTokens(p.tools)));
  return { compact: of('full', 'compact'), everyday: of('everyday', 'catalog'), full: of('full', 'catalog'), read_only: of('read_only', 'catalog') };
}

/** @returns {string[]} failures for the given tool definitions. */
export function checkBudgets(tools, { count = countTokens } = {}) {
  const failures = [];
  for (const t of tools) {
    if (listedDescription({ ...t, description: t.description || '' }).length > DESCRIPTION_LIMIT) failures.push(`${t.name}: description over ${DESCRIPTION_LIMIT} characters`);
    if (t.inputSchema && count(t.inputSchema) >= SCHEMA_TOKEN_LIMIT) failures.push(`${t.name}: schema over ${SCHEMA_TOKEN_LIMIT} tokens`);
  }
  const registry = { tools };
  const compact = Math.max(0, ...[...toolListingPages(registry, 'full', 'compact')].map(p => count(p.tools)));
  if (compact >= COMPACT_TOKEN_LIMIT) failures.push(`compact listing is ${compact} tokens, limit ${COMPACT_TOKEN_LIMIT}`);
  const everyday = Math.max(0, ...[...toolListingPages(registry, 'everyday', 'catalog')].map(p => count(p.tools)));
  if (everyday >= EVERYDAY_CATALOG_TOKEN_LIMIT) failures.push(`everyday catalog page is ${everyday} tokens, per-page limit ${EVERYDAY_CATALOG_TOKEN_LIMIT}`);
  return failures;
}

async function main() {
  const { registry } = await import('../src/tools/index.js');
  const tools = registry.tools;
  if (!tools.length) { console.log('Token budgets: 0 tools registered — nothing to check'); return; }
  const failures = checkBudgets(tools);
  const t = listingTokens(tools);
  if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
  else console.log(`Token budgets pass for ${tools.length} tools (standard MCP cursor pagination; no missing tools)`);
  console.log(`Listing tokens: compact ${t.compact}/${COMPACT_TOKEN_LIMIT}, largest everyday catalog page ${t.everyday}/${EVERYDAY_CATALOG_TOKEN_LIMIT}, full catalog ${t.full}, read_only catalog ${t.read_only}`);
}
if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) await main();
