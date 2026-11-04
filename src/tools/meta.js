import { redact } from './util.js';
// The meta-tools (C-2): find a tool, read its instructions, run any tool by name through the same guards, or read several things at once.
// They see only the tools the connection's profile includes. `github_call` and `github_batch` run tools through the dispatcher itself
// (`ctx.callTool`), so every check - arguments, profile, production switch, protected list, people, spend, change log - still applies.
import { createHash } from 'node:crypto';
import { areaOf, describeTool, kindOf, marksOf, searchTools } from '../core/meta.js';
import { isOperatorConnection } from '../core/authority.js';
import { listedDescription, toolsForProfile, toolsForListing } from '../core/registry.js';
import {OptionalConsentRequired} from '../tenancy/optional-challenge.js';
import { KEEP_WHOLE } from '../core/result-envelope.js';

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const visible = (ctx) => toolsForProfile(ctx.registry, ctx.connection.profile, ctx.connection);
const find = (ctx, name) => visible(ctx).find((t) => t.name === name);

// CAP-6: on the production doors the dispatcher hands in `ctx.offered`, which keeps only the runner, merge-queue and
// Copilot families an account really has and says, per family and account, why one was left out.
const offeredView = async (ctx, list) => (typeof ctx.offered === 'function' ? ctx.offered(list) : { tools: list, hidden: [] });

/** How a tool is reached from this connection: in its direct tool list, or only through github_call. */
const accessOf = (ctx, name) => (toolsForListing(ctx.registry, ctx.connection.profile, ctx.connection.listing ?? 'compact', ctx.connection)
  .some((t) => t.name === name) ? 'direct' : 'github_call');

async function searchHandler(args, ctx) {
  if (!args.query && !args.area && !args.audience) throw new TypeError('Say what you want to do (query), or narrow by area or audience.');
  const all = searchTools(visible(ctx), { ...args, limit: 25 });
  const { tools: shown, hidden } = await offeredView(ctx, all);
  const found = shown.slice(0, args.limit ?? 10);
  const out = {
    count: found.length,
    tools: found.map((t) => ({ name: t.name, what: listedDescription(t), kind: kindOf(t), area: areaOf(t), safety: marksOf(t), access: accessOf(ctx, t.name) })),
    ...(hidden.length ? { hidden_families: hidden } : {}),
    next: 'github_describe_tool shows the arguments; github_call runs a tool that is not in your list.'
  };
  // Census honesty: a keyword that matches nothing this connection may call can still match tools that
  // exist under another profile. Name them (in a separate field, never as callable results) instead of
  // letting the search report an empty catalog that is not empty.
  if (!found.length && args.query) {
    const callable = new Set(visible(ctx).map((t) => t.name));
    const catalog = ctx.registry.tools.filter((t) => !callable.has(t.name) && (t.operatorOnly !== true || isOperatorConnection(ctx.connection)));
    const matches = searchTools(catalog, { ...args, limit: 25 });
    if (matches.length) {
      out.catalog_matches = matches.map((t) => ({ name: t.name, what: listedDescription(t), kind: kindOf(t), area: areaOf(t),
        profiles: t.profiles ?? null, note: 'Exists in the full catalog; this connection\'s profile cannot call it.' }));
      out.note = 'No tool this connection can call matched those words. catalog_matches names what the full catalog has; a connection with a listed profile can call those.';
    }
  }
  return out;
}

// Profile-visible direct tools only. Sorted stable digests allow clients to
// check for changes without downloading every schema during ordinary work.
const MANIFEST_CHANGELOG = Object.freeze([
  {revision:'2026-10-28',changes:'Add compact secret-scanner gateway with repository tuning, verification receipts and profile offers.'},
  { revision: '2026-10-27', changes: 'Add direct-tool manifest and documented read argument aliases (#429, #434).' }
]);
const digest = (data) => createHash('sha256').update(JSON.stringify(data)).digest('hex');
function manifestHandler(_args, ctx) {
  const direct = toolsForListing(ctx.registry, ctx.connection.profile, 'compact', ctx.connection);
  const tools = direct.map((tool) => ({
    name: tool.name, kind: kindOf(tool),
    version: '1-' + digest({ schema: tool.inputSchema, annotations: tool.annotations,
      writes: tool.writes === true, profiles: tool.profiles ?? null }).slice(0, 12)
  })).sort((a, b) => a.name.localeCompare(b.name));
  return {
    format_version: 1, changelog_hash: digest(MANIFEST_CHANGELOG),
    manifest_hash: digest(tools), count: tools.length, tools
  };
}

async function describeHandler(args, ctx) {
  const tool = find(ctx, args.name);
  if (!tool) throw new TypeError(`Unknown or unavailable tool: ${redact(String(args.name)).slice(0, 80)}. Search with github_search_tools.`);
  const access = accessOf(ctx, tool.name) === 'direct' ? { access: 'direct' }
    : { access: 'github_call', call_with: { tool: 'github_call', arguments: { name: tool.name, args: 'the arguments described here' } } };
  const { tools: shown, hidden } = await offeredView(ctx, [tool]);
  if (!shown.length) {
    const why = hidden[0]?.accounts?.map((a) => `${a.account}: ${a.reason}`).join(' ') ?? '';
    return { ...describeTool(tool), ...access, offered: false, hidden_because: why.slice(0, 1200) };
  }
  return { ...describeTool(tool), ...access };
}

const callable = (ctx, name) => { const t = find(ctx, name); return t && (!t.usesRegistry || t.name==='github_secret_scanner' || (t.area === 'workflow' && (Array.isArray(t.delegatedWrites) || t.annotations?.readOnlyHint === true))) ? t : null; };

async function callHandler(args, ctx) {
  if (!callable(ctx, args.name)) {
    return { isError: true, content: [{ type: 'text', text: `Unknown or unavailable tool: ${redact(String(args.name)).slice(0, 80)}. Search with github_search_tools.${find(ctx, args.name) ? ' The tool-finding tools are called directly, not through github_call.' : ''}` }] };
  }
  return ctx.callTool(args.name, args.args ?? {});
}

async function batchHandler(args, ctx) {
  const calls = args.calls;
  const notReads = calls.filter((c) => { const t = callable(ctx, c.name); return !t || t.writes === true || t.annotations?.readOnlyHint !== true; });
  if (notReads.length) throw new TypeError(`github_batch runs read tools only. Not a read tool you can use: ${notReads.map((c) => String(c.name).slice(0, 60)).join(', ')}. Use github_call for a change.`);
  // Bounded waves avoid N serialized remote reads without overwhelming GitHub or the
  // shared database. Each call still re-enters the normal dispatcher, authorization
  // and redaction path. Promise.all preserves request order inside each wave.
  const results = [];
  for (let offset = 0; offset < calls.length; offset += 3) {
    const wave = await Promise.all(calls.slice(offset, offset + 3).map(async (call) => {
      const r = await ctx.callTool(call.name, call.args ?? {});
      if (r._meta?.['mcp/www_authenticate']) throw new OptionalConsentRequired(r);
      if (r.isError) return { name: call.name, ok: false, error: r.content?.[0]?.text ?? 'The call failed.' };
      // A whole file or an explicit window (fullText, startLine, byte range) is the caller's choice to receive large text; a
      // batch reply is capped like any other result, so such text would be cut. Say how to get it whole instead of cutting it
      // (owner feedback 2026-11-02: "github_batch truncates bodies to 4000 characters and fullText overflows").
      if (r[KEEP_WHOLE] && JSON.stringify(r.structuredContent ?? null).length > BATCH_ITEM_CHARS)
        return { name: call.name, ok: true, omitted: 'too_large_for_batch', characters: JSON.stringify(r.structuredContent).length,
          call_alone: { name: call.name, args: call.args ?? {} }, note: 'This whole-text result is too large to share a batch reply. Call that tool on its own (directly or with github_call) to receive it whole.' };
      return { name: call.name, ok: true, result: r.structuredContent ?? null };
    }));
    results.push(...wave);
  }
  const cut = results.some((x) => x.omitted || x.result?.kept_result);
  return { count: results.length, results, ...(cut ? { note: 'Long text in a batch is cut at about 4,000 characters per field. A cut result carries kept_result.handle: read the rest with github_get_result, or call that tool on its own for whole text.' } : {}) };
}
const BATCH_ITEM_CHARS = 3500;

const CALL_ITEM = { type: 'object', properties: { name: { type: 'string', maxLength: 80 }, args: { type: 'object', additionalProperties: true } }, required: ['name'], additionalProperties: false };

export const tools = [
  {
    name: 'github_tool_manifest', area: 'meta', audience: ['B', 'O', 'Op'], compact: true, usesRegistry: true,
    description: 'Versioned direct-tool list with contract and changelog hashes.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: readOnly, keepsResult: false
  },
  {
    name: 'github_search_tools', area: 'meta', audience: ['B', 'O', 'Op'], compact: true, usesRegistry: true,
    description: 'Find tools by plain words, area or audience: name, one line, kind and safety marks.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', maxLength: 120 }, area: { type: 'string', maxLength: 40 }, audience: { type: 'string', enum: ['B', 'O', 'Op'], description: 'B builder, O owner, Op operator' }, limit: { type: 'integer', minimum: 1, maximum: 25 } }, additionalProperties: false },
    annotations: readOnly
  },
  {
    name: 'github_describe_tool', area: 'meta', audience: ['B', 'O', 'Op'], compact: true, usesRegistry: true,
    description: 'Full instructions and arguments for one tool, with its safety marks.',
    inputSchema: { type: 'object', properties: { name: { type: 'string', maxLength: 80 } }, required: ['name'], additionalProperties: false },
    annotations: readOnly
  },
  {
    name: 'github_call', area: 'meta', audience: ['B', 'O', 'Op'], compact: true, usesRegistry: true, passthrough: true,
    description: 'Run a visible tool with its original guards.',
    inputSchema: { type: 'object', properties: { name: { type: 'string', maxLength: 80 }, args: { type: 'object', additionalProperties: true, description: 'That tool\'s arguments' } }, required: ['name'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  },
  {
    name: 'github_batch', area: 'meta', audience: ['B', 'O', 'Op'], compact: true, usesRegistry: true,
    description: 'Batch up to 10 reads; writes use github_call.',
    inputSchema: { type: 'object', properties: { calls: { type: 'array', items: CALL_ITEM, minItems: 1, maxItems: 10 } }, required: ['calls'], additionalProperties: false },
    annotations: readOnly
  }
];
export const handlers = { github_tool_manifest: manifestHandler, github_search_tools: searchHandler, github_describe_tool: describeHandler, github_call: callHandler, github_batch: batchHandler };
