import { describe, expect, it } from 'vitest';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';
import { makeWorld } from '../../test/helpers/write-contract.js';

const sha = 'a'.repeat(40);
const text = 'line é😀\n'.repeat(7000).slice(0, 61421);
const file = { type: 'file', path: 'src/db.js', size: Buffer.byteLength(text), sha,
  encoding: 'base64', content: Buffer.from(text).toString('base64') };
const value = reply => JSON.parse(reply.content[0].text);
const dispatch = w => createDispatch({ credentials: w.credentials, fetch: w.gh.fetch,
  now: w.ctx.now, sleep: w.ctx.sleep, gates: [] });
const call = (w, name, args) => dispatch(w)({ registry, name, args,
  connection: w.connection, db: w.db });

describe('replacement verification regressions', () => {
  it('returns all 61,421 source characters in one explicitly full call, one payload copy', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    w.gh.when('GET /repos/{owner}/{repo}/contents/{path}').reply(200, file);
    const reply = await call(w, 'github_content_get', { repo: 'hello', path: file.path, ref: sha, fullText: true });
    expect(reply.isError).not.toBe(true);
    expect(value(reply).content).toBe(text);
    expect(value(reply)).not.toHaveProperty('kept_result');
    expect(reply.structuredContent).not.toHaveProperty('content');
    expect(reply.structuredContent.full_payload_location).toBe('content[0].text');
    expect(w.gh.calls).toHaveLength(1);
    const narrow = value(await call(w, 'github_content_get', { repo: 'hello', path: file.path, ref: sha, fullText: true, fields: ['content'] }));
    expect(narrow.content).toBe(text);
    expect(w.gh.invalid).toEqual([]);
  });
  it('recovers the entire pinned blob even with unavailable retention and a moving branch', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    w.db.putResult = async () => { throw new Error('storage offline'); };
    w.gh.when('GET /repos/{owner}/{repo}/contents/{path}').reply(200, file);
    w.gh.when('GET /repos/{owner}/{repo}/git/blobs/{file_sha}').reply(200,
      { sha, size: file.size, encoding: 'base64', content: file.content });
    const first = value(await call(w, 'github_content_get', { repo: 'hello', path: file.path, ref: 'moving' }));
    expect(first.content_complete).toBe(false);
    expect(first.kept_result).not.toHaveProperty('handle');
    expect(first.continuation.arguments.blobSha).toBe(sha);
    const chunks = []; let offset = 0; let done = false;
    while (!done) {
      const page = value(await call(w, first.continuation.tool,
        { ...first.continuation.arguments, byteOffset: offset }));
      expect(page.encoding).toBe('base64');
      chunks.push(Buffer.from(page.content_base64, 'base64'));
      expect(page.next_byte_offset).toBeGreaterThan(offset);
      offset = page.next_byte_offset; done = page.complete;
    }
    expect(Buffer.concat(chunks).equals(Buffer.from(text))).toBe(true);
    expect(w.gh.invalid).toEqual([]);
  });
  it('accepts branch/ref aliases and rejects ambiguity without a provider request', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    w.gh.when('GET /repos/{owner}/{repo}/contents/{path}').reply(200, file);
    const r = await call(w, 'github_content_get', { repo: 'hello', path: file.path, branch: sha, fullText: true });
    expect(value(r).content).toBe(text);
    const count = w.gh.calls.length;
    const bad = await call(w, 'github_content_get', { repo: 'hello', ref: 'a', branch: 'b' });
    expect(bad.isError).toBe(true);
    expect(w.gh.calls).toHaveLength(count);
  });
  it('never describes an incomplete zero-hit search as verified absence', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    w.gh.when('GET /search/code').reply(200, { total_count: 0, incomplete_results: true, items: [] });
    const result = value(await call(w, 'github_search_github', { type: 'code', query: 'needle' }));
    expect(result).toMatchObject({ absence_verified: false, completeness: 'incomplete' });
    expect(result.warning).toMatch(/does not establish absence/);
  });
  it('offers repository-specific provider and Robinson fallback setup without changing settings', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    w.gh.when('GET /repos/{owner}/{repo}').reply(200, {
      full_name: 'example-org/hello', security_and_analysis: { secret_scanning: { status: 'disabled' } }
    });
    const result = value(await call(w, 'github_security_scan_guidance', { repo: 'hello' }));
    expect(result).toMatchObject({ parity: 'repository_alternative', installed: false,
      repository_clean: null, observed: { secret_scanning: 'disabled', secret_scanning_push_protection: 'not_returned_by_provider' } });
    expect(result.native_setup[0]).toMatchObject({ tool: 'github_security_set_feature', arguments: { enabled: true } });
    expect(result.official_engine.headers['X-MCP-Tools']).toBe('run_secret_scanning');
    const workflow = result.robinson_alternative.workflow;
    expect(workflow).toContain('contents: read');
    expect(workflow).toContain('fetch-depth: 0');
    expect(workflow).toContain('persist-credentials: false');
    expect(workflow).toContain('--redact=100');
    expect(workflow).not.toContain('pull_request_target');
    expect(workflow).not.toContain('secrets.');
    expect([...workflow.matchAll(/uses: ([^\s]+)@([^\s]+)/g)].every(m => /^[0-9a-f]{40}$/.test(m[2]))).toBe(true);
    expect(w.gh.calls.every(c => c.method === 'GET')).toBe(true);
    expect(w.gh.invalid).toEqual([]);
  });

  it('normalizes PR write aliases before provider requests and rejects conflicts', async () => {
    const w = await makeWorld({ profile: 'full' });
    w.gh.when('GET /repos/{owner}/{repo}/pulls/{pull_number}').reply(200,
      { number: 7, state: 'open', title: 'Example', head: { ref: 'feature' }, base: { ref: 'main' } });
    const preview = value(await call(w, 'github_pr_close', { repo: 'hello', pull_number: 7, dryRun: true }));
    expect(preview.status).toBe('preview');
    const reads = w.gh.calls.length;
    const conflict = await call(w, 'github_pr_close', { repo: 'hello', number: 8, pull_number: 7 });
    expect(conflict.isError).toBe(true);
    expect(w.gh.calls).toHaveLength(reads);
    expect(w.gh.invalid).toEqual([]);
  });

});
