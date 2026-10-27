// Compact only the *client-facing* structured duplicate of a large JSON tool
// result. The original full JSON remains byte-for-byte in content[0].text.
// Never apply this to nested dispatcher calls: workflows, batches and guards
// require full structured values before the final public boundary.
const bytes = (value) => Buffer.byteLength(JSON.stringify(value));
// Only large, prose-like fields belong solely in content. Structured data
// such as account lists, CI states, tool results and navigation must remain
// available for older MCP clients that inspect structuredContent directly.
const LARGE_TEXT = new Set(['body', 'arguments', 'content', 'content_base64',
  'diff', 'patch', 'log', 'logs', 'output', 'stdout', 'stderr', 'text']);

export function deduplicateLargeEnvelope(reply, { threshold = 1600 } = {}) {
  if (!reply || reply.isError || !reply.structuredContent ||
      typeof reply.structuredContent !== 'object' || Array.isArray(reply.structuredContent) ||
      reply.content?.length !== 1 || reply.content[0]?.type !== 'text') return reply;
  const body = reply.structuredContent;
  const full = JSON.stringify(body);
  if (Buffer.byteLength(full) < threshold || reply.content[0].text !== full) return reply;
  const fields = {};
  const omitted = [];
  for (const [key, value] of Object.entries(body)) {
    const textLike = LARGE_TEXT.has(key);
    if (textLike && (typeof value === 'string' ? Buffer.byteLength(value) > 200
      : value !== null && typeof value === 'object' && bytes(value) > 600)) {
      omitted.push(key);
    } else {
      fields[key] = value;
    }
  }
  if (!omitted.length) return reply;
  return { ...reply, structuredContent: { ...fields,
    full_payload_location: 'content[0].text', full_payload_format: 'json',
    omitted_fields: omitted.slice(0, 20) } };
}
