import { describe, expect, it } from 'vitest';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';
import { makeWorld, parse } from '../../test/helpers/write-contract.js';
import { detectCredentialPatterns, validScanPath, SCAN_LIMITS } from '../../src/tools/security-scan-files.js';

const ORG = 'example-org';
const run = async (world, name, args) => {
  const dispatch = createDispatch({ env: world.ctx.env, credentials: world.credentials,
    gates: [], fetch: world.gh.fetch, now: world.ctx.now, sleep: async () => {} });
  const result = await dispatch({ registry, name, args, connection: world.connection, db: world.db });
  let body;
  try { body = parse(result); } catch { body = result.content?.[0]?.text; }
  if (body?.full_payload_location === 'content[0].text') body = JSON.parse(result.content[0].text);
  return { result, body };
};
const contents = (path, text) => ({
  name: path.split('/').at(-1), path, type: 'file', encoding: 'base64',
  size: Buffer.byteLength(text), content: Buffer.from(text).toString('base64'),
  sha: 'a'.repeat(40)
});

describe('organization issue metadata discovery', () => {
  it('registers three new readable, discoverable, independently callable tools', () => {
    const names = ['github_org_list_issue_types', 'github_org_list_issue_fields', 'github_security_scan_files'];
    for (const name of names) {
      const item = registry.tools.find(x => x.name === name);
      expect(item?.readContract).toBe('defineRead-v1');
      expect(item?.annotations?.readOnlyHint).toBe(true);
    }
  });
  it('returns bounded type and select-field metadata from the correct org', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    w.gh.when('GET /orgs/{org}/issue-types').reply(200, [
      { id: 10, name: 'Bug', description: 'defect', color: 'red', is_enabled: true },
      { id: 11, name: 'Task', description: 'activity', color: 'blue', is_enabled: false }
    ]);
    w.gh.when('GET /orgs/{org}/issue-fields').reply(200, [
      { id: 20, name: 'Priority', data_type: 'single_select', visibility: 'all',
        options: [{ id: 25, name: 'High', color: 'red', priority: 1 }] }
    ]);
    const t = await run(w, 'github_org_list_issue_types', { owner: ORG, max: 1 });
    expect(t.body).toMatchObject({ org: ORG, count: 1, total: 2, complete: false,
      items: [{ id: 10, name: 'Bug', color: 'red' }] });
    const f = await run(w, 'github_org_list_issue_fields', { owner: ORG });
    expect(f.body).toMatchObject({ org: ORG, complete: true,
      items: [{ id: 20, name: 'Priority', data_type: 'single_select',
        options: [{ id: 25, name: 'High', color: 'red' }] }] });
    expect(w.gh.invalid).toEqual([]);
    expect(w.gh.calls.filter(c => c.method !== 'GET')).toHaveLength(0);
  });
  it('honors connected-organization and provider permission boundaries', async () => {
    const foreign = await makeWorld({ profile: 'read_only' });
    const noScope = await run(foreign, 'github_org_list_issue_types', { owner: 'outside-org' });
    expect(noScope.result.isError).toBe(true);
    expect(foreign.gh.calls).toHaveLength(0);
    const denied = await makeWorld({ profile: 'read_only' });
    denied.gh.when('GET /orgs/{org}/issue-fields').reply(403, { message: 'Resource not accessible by integration' });
    expect((await run(denied, 'github_org_list_issue_fields', { owner: ORG })).result.isError).toBe(true);
    const empty = await makeWorld({ profile: 'read_only' });
    empty.gh.when('GET /orgs/{org}/issue-fields').reply(200, []);
    expect((await run(empty, 'github_org_list_issue_fields', { owner: ORG })).body).toMatchObject({
      count: 0, complete: true, items: []
    });
  });
});

describe('bounded file secret pattern review', () => {
  it('recognizes synthetic GitHub, Slack, key and AWS signatures with no matched text returned', () => {
    const fake = 'ghp_' + 'A'.repeat(35);
    const source = [
      'const token = "' + fake + '";',
      '-----BEGIN ' + 'PRIVATE KEY-----',
      'AWS_SECRET_ACCESS_KEY=' + 'a'.repeat(40),
      'xoxb-' + 'A'.repeat(24),
      'ordinary code, no secret'
    ].join('\n');
    const found = detectCredentialPatterns(source, 'src/file.js');
    expect(found.findings.map(x => x.line)).toEqual([1, 2, 3, 4]);
    expect(JSON.stringify(found)).not.toContain(fake);
    expect(JSON.stringify(found)).not.toContain('xoxb-');
    const stateless = 'ghs_FAKE' + 'a-_'.repeat(15) + '.' + 'b-_'.repeat(100) + '.' + 'c-_'.repeat(60);
    const statelessResult = detectCredentialPatterns('token=' + stateless, 'stateless.js');
    expect(statelessResult.findings).toMatchObject([{ path: 'stateless.js', line: 1, rule: 'github_oauth_or_app_token' }]);
    expect(JSON.stringify(statelessResult)).not.toContain(stateless);
    expect(detectCredentialPatterns('console.log("safe");', 'ok.js').findings).toEqual([]);
    expect(detectCredentialPatterns(source, 'src/file.js', 2).capped).toBe(true);
  });
  it('accepts normal nested paths but rejects traversal, URLs and control characters', () => {
    for (const bad of ['/a', '../a', 'a/../b', 'a//b', 'a\\b', 'a?token=foo', 'https://example.com/a', 'a\u0000b'])
      expect(validScanPath(bad)).toBe(false);
    expect(validScanPath('.github/workflows/ci.yml')).toBe(true);
    expect(SCAN_LIMITS.maxFiles).toBe(12);
  });
  it('scans selected files at a specified ref without disclosing raw contents', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    const fake = 'ghp_' + 'A'.repeat(35);
    w.gh.when('GET /repos/{owner}/{repo}/contents/{path}')
      .reply(200, contents('src/app.js', 'line 1\nkey=' + fake + '\nline 3'));
    const result = await run(w, 'github_security_scan_files', {
      owner: ORG, repo: 'example-repo', ref: 'main', paths: ['src/app.js']
    });
    expect(result.result.isError).not.toBe(true);
    expect(result.body).toMatchObject({ scanned_files: 1, finding_count: 1, complete: true,
      findings: [{ path: 'src/app.js', line: 2, rule: 'github_personal_access_token' }] });
    expect(JSON.stringify(result.body)).not.toContain(fake);
    expect(JSON.stringify(result.body)).not.toContain('key=');
    expect(result.body.note).toMatch(/not GitHub|not.*Secret Protection|not.*remote MCP/i);
    expect(w.gh.invalid).toEqual([]);
    expect(w.gh.calls.filter(c => c.method !== 'GET')).toHaveLength(0);
  });
  it('skips unreadable and binary files without treating their absence as clean', async () => {
    const binary = await makeWorld({ profile: 'read_only' });
    binary.gh.when('GET /repos/{owner}/{repo}/contents/{path}')
      .reply(200, contents('binary.bin', String.fromCharCode(0) + 'not-text'));
    const out = await run(binary, 'github_security_scan_files',
      { owner: ORG, repo: 'example-repo', paths: ['binary.bin'] });
    expect(out.body).toMatchObject({ complete: false, scanned_files: 0,
      skipped: [{ path: 'binary.bin', reason: 'binary_or_invalid_text' }] });
    const missing = await makeWorld({ profile: 'read_only' });
    missing.gh.when('GET /repos/{owner}/{repo}/contents/{path}')
      .reply(404, { message: 'Not Found' });
    const notFound = await run(missing, 'github_security_scan_files',
      { owner: ORG, repo: 'example-repo', paths: ['missing.txt'] });
    expect(notFound.body).toMatchObject({ complete: false, scanned_files: 0,
      skipped: [{ path: 'missing.txt', reason: 'missing_or_not_accessible' }] });
    expect(notFound.body.repository_clean).toBeNull();
  });
  it('reports incomplete scans, rejects unsafe paths, binary or oversized content and cross-account access', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    w.gh.when('GET /repos/{owner}/{repo}/contents/{path}').reply(200, () =>
      contents('file.txt', 'q'.repeat(SCAN_LIMITS.maxFileBytes + 1)));
    const tooLarge = await run(w, 'github_security_scan_files',
      { owner: ORG, repo: 'example-repo', paths: ['file.txt'] });
    expect(tooLarge.body).toMatchObject({ scanned_files: 0, complete: false,
      skipped: [{ path: 'file.txt', reason: 'size_limit' }] });
    expect((await run(w, 'github_security_scan_files', { owner: ORG, repo: 'example-repo',
      paths: ['../not-allowed.txt'] })).result.isError).toBe(true);
    expect((await run(w, 'github_security_scan_files', { owner: 'foreign-account', repo: 'example-repo',
      paths: ['src/file.txt'] })).result.isError).toBe(true);
    expect(w.gh.calls.filter(c => c.method !== 'GET')).toHaveLength(0);
  });
});
