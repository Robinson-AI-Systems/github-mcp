import { describe, expect, it } from 'vitest';
import { deduplicateLargeEnvelope } from '../../src/core/result-envelope.js';
import { completeDispatchResult } from '../../src/rtc/http.js';
import { createDispatch } from '../../src/tools/dispatch.js';
import { mergeNamespaces } from '../../src/core/registry.js';
import { defineRead } from '../../src/tools/define-read.js';
import { createFakeDb } from '../../test/helpers/fake-db.js';

const envelope = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value });
const full = (reply) => JSON.parse(reply.content[0].text);

describe('large tool-result dual-channel cost (#428)', () => {
  it('puts a 4 KB PR body only in text, leaving lightweight structured fields', () => {
    const reply = envelope({ mode: 'PREVIEW', number: 7, head_sha: 'a'.repeat(40),
      body: 'hello\n'.repeat(700), merged: false, checks: { green: true } });
    const packed = deduplicateLargeEnvelope(reply);
    expect(packed.structuredContent).toMatchObject({
      mode: 'PREVIEW', number: 7, merged: false, checks: { green: true },
      full_payload_location: 'content[0].text', omitted_fields: ['body']
    });
    expect(packed.structuredContent).not.toHaveProperty('body');
    expect(full(packed)).toEqual(reply.structuredContent);
    expect(Buffer.byteLength(JSON.stringify(packed))).toBeLessThan(Buffer.byteLength(JSON.stringify(reply)) * 0.65);
  });
  it('keeps a describe schema retrievable through text while not duplicating its nested definitions', () => {
    const body = { name: 'github_pr_get', kind: 'read', area: 'pr', arguments: {
      type: 'object', properties: Object.fromEntries(Array.from({ length: 25 }, (_, i) =>
        ['p' + i, { type: 'string', description: 'details '.repeat(16) }]))
    } };
    const packed = deduplicateLargeEnvelope(envelope(body));
    expect(packed.structuredContent.name).toBe('github_pr_get');
    expect(packed.structuredContent).not.toHaveProperty('arguments');
    expect(full(packed)).toEqual(body);
  });
  it('rebuilds a complete RTC value from the same single public JSON copy', () => {
    const data = { name: 'github_pr_get', body: 'changed-file'.repeat(300), number: 12 };
    const packed = deduplicateLargeEnvelope(envelope(data));
    expect(completeDispatchResult(packed)).toEqual(data);
    expect(completeDispatchResult(envelope({ status: 'ok' }))).toEqual({ status: 'ok' });
    expect(() => completeDispatchResult({ structuredContent: packed.structuredContent,
      content: [] })).toThrow(/Incomplete/);
  });
  it('retains the small-result compatibility contract and never alters errors or unrelated text', () => {
    const small = envelope({ status: 'ok', count: 3 });
    expect(deduplicateLargeEnvelope(small)).toBe(small);
    const error = { ...envelope({ reason: 'x'.repeat(4000) }), isError: true };
    expect(deduplicateLargeEnvelope(error)).toBe(error);
    const unmatched = { content: [{ type: 'text', text: 'not json' }],
      structuredContent: { text: 'a'.repeat(4000) } };
    expect(deduplicateLargeEnvelope(unmatched)).toBe(unmatched);
  });
  it('keeps complete structured output for a delegated-write workflow', async () => {
    const db = createFakeDb();
    await db.initSchema();
    const largeText = 'workflow-draft '.repeat(400);
    const workflow = { tools: [{
      name: 'github_test_delegated_write_workflow', description: 'Synthetic write-capable workflow.',
      passthrough: true, usesRegistry: true, delegatedWrites: ['github_test_writer'],
      annotations: { readOnlyHint: false },
      inputSchema: { type: 'object', properties: {} }
    }], handlers: {
      github_test_delegated_write_workflow: async () =>
        envelope({ status: 'preview', draft: largeText, appNeedsText: largeText })
    } };
    const registry = mergeNamespaces([workflow]);
    const connection = { client_id: 'c', profile: 'full', mode: 'preview',
      default_account: 'example-org', accounts: ['example-org'] };
    const result = await createDispatch({})({
      registry, name: 'github_test_delegated_write_workflow', args: {}, connection, db
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent.draft).toBe(largeText);
    expect(result.structuredContent.appNeedsText).toBe(largeText);
    expect(result.structuredContent).not.toHaveProperty('full_payload_location');
  });
  it('deduplicates only outer replies, retaining full structured values inside delegated calls', async () => {
    const db = createFakeDb();
    await db.initSchema();
    const read = defineRead({ name: 'github_test_big_nested', description: 'Large fixture.',
      handler: async () => ({ id: 4, body: 'x'.repeat(3500) }) });
    let nested;
    const runner = { tools: [{ name: 'github_test_runner', description: 'Call another tool.',
      passthrough: true, usesRegistry: true, annotations: { readOnlyHint: false },
      inputSchema: { type: 'object', properties: {} } }],
      handlers: { github_test_runner: async (_args, ctx) => {
        nested = await ctx.callTool('github_test_big_nested', {});
        return nested;
      } } };
    const registry = mergeNamespaces([runner, {
      tools: [read.tool], handlers: { [read.tool.name]: read.handler }
    }]);
    const connection = { client_id: 'c', profile: 'read_only', mode: 'preview',
      default_account: 'example-org', accounts: ['example-org'] };
    const dispatch = createDispatch({});
    const response = await dispatch({ registry, name: 'github_test_runner', args: {}, connection, db });
    expect(nested.structuredContent.body).toHaveLength(3500);
    expect(response.structuredContent.body).toBeUndefined();
    expect(full(response).body).toHaveLength(3500);
  });
});
