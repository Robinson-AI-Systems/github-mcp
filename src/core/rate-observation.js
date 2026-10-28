// Rate hints come only from actual provider responses made within this dispatch.
export function withRateObservations(reply, entries) {
  if (!entries?.length) return reply;
  const unique = new Map();
  for (const item of entries) unique.set(item.account + ':' + item.credential + ':' + item.resource, item);
  const observations = [...unique.values()].slice(-3).map(item => ({
    account: item.account, credential: item.credential, resource: item.resource,
    fresh: true,
    ...(item.remaining === null ? {} : { remaining: item.remaining }),
    ...(item.reset_at ? { reset_at: item.reset_at } : {}),
    ...(item.blocked_until ? { blocked_until: item.blocked_until } : {})
  }));
  if (!reply?.structuredContent && reply?.isError)
    return { ...reply, structuredContent: { meta: { rate: { observations } } } };
  const original = reply?.structuredContent;
  if (!original || typeof original !== 'object' || Array.isArray(original)) return reply;
  const data = { ...original, meta: { ...(original.meta ?? {}), rate: { observations } } };
  return { ...reply, structuredContent: data,
    ...(!reply.isError && reply.content?.length === 1 && reply.content[0]?.type === 'text'
      ? { content: [{ type: 'text', text: JSON.stringify(data) }] } : {}) };
}
