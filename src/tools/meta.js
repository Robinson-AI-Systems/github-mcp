import { redact } from './util.js';
// The meta-tools (C-2): find a tool, read its instructions, run any tool by name through the same guards, or read several things at once.
// They see only the tools the connection's profile includes. `github_call` and `github_batch` run tools through the dispatcher itself
// (`ctx.callTool`), so every check - arguments, profile, production switch, protected list, people, spend, change log - still applies.
import { createHash } from 'node:crypto';
import { areaOf, describeTool, kindOf, marksOf, searchTools } from '../core/meta.js';
import { listedDescription, toolsForProfile, toolsForListing } from '../core/registry.js';
import {OptionalConsentRequired} from '../tenancy/optional-challenge.js';

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const visible = (ctx) => toolsForProfile(ctx.registry, ctx.connection.profile);
const find = (ctx, name) => visible(ctx).find((t) => t.name === name);

async function searchHandler(args, ctx) {
  if (!args.query && !args.area && !args.audience) throw new TypeError('Say what you want to do (query), or narrow by area or audience.');
  const found = searchTools(visible(ctx), args);
  return {
    count: found.length,
    tools: found.map((t) => ({ name: t.name, what: listedDescription(t), kind: kindOf(t), area: areaOf(t), safety: marksOf(t) })),
    next: 'github_describe_tool shows the arguments; github_call runs a tool that is not in your list.'
  };
}

// Profile-visible direct tools only. Sorted stable digests allow clients to
// check for changes without downloading every schema during ordinary work.
const MANIFEST_CHANGELOG = Object.freeze([
  {revision:'2026-10-28',changes:'Add compact secret-scanner gateway with repository tuning, verification receipts and profile offers.'},
  { revision: '2026-10-27', changes: 'Add direct-tool manifest and documented read argument aliases (#429, #434).' }
]);
const digest = (data) => createHash('sha256').update(JSON.stringify(data)).digest('hex');
function manifestHandler(_args, ctx) {
  const direct = toolsForListing(ctx.registry, ctx.connection.profile, 'compact');
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
  return describeTool(tool);
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
      return r.isError
        ? { name: call.name, ok: false, error: r.content?.[0]?.text ?? 'The call failed.' }
        : { name: call.name, ok: true, result: r.structuredContent ?? null };
    }));
    results.push(...wave);
  }
  return { count: results.length, results };
}

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
