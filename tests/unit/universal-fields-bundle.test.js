import { describe, expect, it } from 'vitest';
import { createDispatch } from '../../src/tools/dispatch.js';
import { mergeNamespaces } from '../../src/core/registry.js';
import * as meta from '../../src/tools/meta.js';
import { createFakeDb } from '../../test/helpers/fake-db.js';

const data = { id: 42, title: 'Visible', body: 'Long excluded body '.repeat(400),
  nested: { name: 'inner', ignored: { key: 'hide' } }, untrusted: true };
const read = { name: 'github_t_plain_universal', area: 'code', audience: ['B'],
  description: 'Read generic object without defineRead-specific result metadata.',
  inputSchema: { type: 'object', properties: { fields: { type: 'array',
    items: { type: 'string' }, maxItems: 20 } }, additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } };
const registry = mergeNamespaces([meta, { tools: [read],
  handlers: { [read.name]: async () => data } }]);
const connection = Object.freeze({ client_id: 'cid', default_account: 'org', accounts: ['org'],
  mode: 'preview', profile: 'read_only', listing: 'catalog' });
async function call(name, args) {
  const db = createFakeDb();
  await db.initSchema();
  return createDispatch({})({ registry, name, args, connection, db });
}
describe('C-13: field projection applies uniformly to generic reads', () => {
  it('keeps only requested dotted fields and safety markers from a direct read', async () => {
    const result = (await call(read.name, { fields: ['title', 'nested.name'] })).structuredContent;
    expect(result).toMatchObject({ title: 'Visible', nested: { name: 'inner' }, untrusted: true });
    expect(result.body).toBeUndefined();
    expect(result.nested.ignored).toBeUndefined();
  });
  it('enforces identical projection through github_call', async () => {
    const result = (await call('github_call', {
      name: read.name, args: { fields: ['title', 'nested.name'] } })).structuredContent;
    expect(result.body).toBeUndefined();
    expect(result.title).toBe('Visible');
  });
  it('reports unknown fields instead of quietly including a huge object', async () => {
    const result = (await call(read.name, { fields: ['title', 'not_a_field'] })).structuredContent;
    expect(result.unknown_fields).toEqual(['not_a_field']);
    expect(result.body).toBeUndefined();
  });
});
