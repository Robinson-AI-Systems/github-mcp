// Compact only the *client-facing* structured duplicate of a large JSON tool
// result. The original full JSON remains byte-for-byte in content[0].text.
// Never apply this to nested dispatcher calls: workflows, batches and guards
// require full structured values before the final public boundary.
const bytes = (value) => Buffer.byteLength(JSON.stringify(value));
// Large payload fields have one canonical JSON copy. Small identity/status
// fields and continuation/navigation metadata remain available structurally.
// Consumers follow full_payload_location; nested calls and declared output
// schemas retain their full structured contract at the dispatcher boundary.
const NAVIGATION = new Set(['kept_result', 'continuation', 'page_info', 'meta']);

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
    if (!NAVIGATION.has(key) && (typeof value === 'string' ? Buffer.byteLength(value) > 200
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

/** Reconstruct the declared canonical payload for trusted server-side consumers. */
export function completeDispatchResult(output) {
  const value = output?.structuredContent;
  if (value?.full_payload_location !== 'content[0].text') return value;
  if (value.full_payload_format !== 'json' || output.content?.length !== 1 ||
      output.content[0]?.type !== 'text') throw new Error('Incomplete canonical result');
  const parsed = JSON.parse(output.content[0].text);
  if (!parsed || typeof parsed !== 'object') throw new Error('Invalid canonical result');
  return parsed;
}

/** Writers must preserve a guarded refusal instead of replacing it with unknown. */
export function guardedResultBody(output) {
  const value = completeDispatchResult(output);
  if (!output?.isError) return value ?? null;
  return { ...(value && typeof value === 'object' ? value : {}),
    status: value?.status ?? 'refused',
    error: value?.error ?? 'The guarded tool refused or failed; inspect its result before retrying.' };
}
