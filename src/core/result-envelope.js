// Compact only the *client-facing* structured duplicate of a large JSON tool
// result. The original full JSON remains byte-for-byte in content[0].text.
// Never apply this to nested dispatcher calls: workflows, batches and guards
// require full structured values before the final public boundary.
const bytes = (value) => Buffer.byteLength(JSON.stringify(value));

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
    if (value === null || typeof value === 'boolean' || typeof value === 'number' ||
        (typeof value === 'string' && Buffer.byteLength(value) <= 200) ||
        (value && typeof value === 'object' && bytes(value) <= 280)) {
      fields[key] = value;
    } else omitted.push(key);
  }
  if (!omitted.length) return reply;
  return { ...reply, structuredContent: { ...fields,
    full_payload_location: 'content[0].text', full_payload_format: 'json',
    omitted_fields: omitted.slice(0, 20) } };
}
