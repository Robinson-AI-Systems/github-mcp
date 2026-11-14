// AGENT-FB-1113: three shortcomings an agent hit on 2026-11-13 (owner asked for them fixed).
// 1. Adding one scanner exception meant resending the whole list, and leaving the old ones out failed as
//    "GitHub could not be reached" with the real reason cut off.
// 2. The job log reader had no search, so finding a failure meant paging 4,000 characters at a time.
// 3. merge_when_green answered a red check with "not proven green" and advice to add CI.
import { describe, expect, it } from 'vitest';
import { scannerSettings } from '../../src/github/scanner-policy.js';
import { assertTuneCoverage } from '../../src/tools/scanner-verification.js';
import { describeGithubError } from '../../src/tools/errors.js';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';
import { makeWorld, parse } from '../../test/helpers/write-contract.js';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const sha = (c) => c.repeat(40);
const fp = (c) => c.repeat(64);
const ex = (path, blob, vf) => ({ rule: 'database-connection-password', path, blobSha: blob, reason: 'Synthetic fixture value', pushException: true, valueFingerprint: vf });
const base = { additionalRules: [], disabledRules: [], suppressions: [ex('a.js', sha('1'), fp('1')), ex('b.js', sha('2'), fp('2'))] };

function call(w, name, args) {
  return createDispatch({ env: w.ctx.env, credentials: w.credentials, fetch: w.gh.fetch, gates: [], now: w.ctx.now, sleep: w.ctx.sleep })({ registry, name, args, connection: w.connection, db: w.db });
}

describe('scanner exceptions: add and remove without resending the list', () => {
  it('addSuppressions keeps the current exceptions', () => {
    const out = scannerSettings({ addSuppressions: [ex('c.js', sha('3'), fp('3'))] }, base);
    expect(out.suppressions.map((s) => s.path)).toEqual(['a.js', 'b.js', 'c.js']);
    expect(out).not.toHaveProperty('addSuppressions');
  });
  it('removeSuppressions removes exactly the matching one', () => {
    const out = scannerSettings({ removeSuppressions: [{ rule: 'database-connection-password', path: 'a.js', blobSha: sha('1') }] }, base);
    expect(out.suppressions.map((s) => s.path)).toEqual(['b.js']);
  });
  it('refuses mixing, unknown removals and duplicates with a clear reason', () => {
    expect(() => scannerSettings({ suppressions: [], addSuppressions: [] }, base)).toThrow(/either suppressions/);
    expect(() => scannerSettings({ removeSuppressions: [{ rule: 'database-connection-password', path: 'zz.js', blobSha: sha('9') }] }, base)).toThrow(/No current exception matches/);
    expect(() => scannerSettings({ addSuppressions: [ex('a.js', sha('1'), fp('1'))] }, base)).toThrow(/already exists/);
  });
  it('replacing the list so that old exceptions drop says so, by name', () => {
    const after = scannerSettings({ suppressions: [ex('c.js', sha('3'), fp('3'))] }, base);
    const checks = [{ rule: 'database-connection-password', path: 'c.js', blobSha: sha('3'), door: 'push', fingerprint: fp('3'), before_detected: true, after_detected: false }];
    expect(() => assertTuneCoverage(base, after, checks)).toThrow(/would REMOVE 2 existing exception\(s\).*addSuppressions/);
  });
  it('a missing verification names the exception and what it needs', () => {
    const after = scannerSettings({ addSuppressions: [ex('c.js', sha('3'), fp('3'))] }, base);
    expect(() => assertTuneCoverage(base, after, [])).toThrow(/c\.js has no matching verification.*push door/);
  });
});

describe('errors: our own refusals are not network problems', () => {
  it('a validation TypeError reads as an invalid request, in full, not retryable', () => {
    const long = 'Every changed exception needs its exact pinned-file verification; ' + 'x'.repeat(300) + ' value fingerprint.';
    const d = describeGithubError(new TypeError(long));
    expect(d.kind).toBe('invalid_request');
    expect(d.what).toMatch(/value fingerprint\.$/);
    expect(d.retryable).toBe(false);
  });
  it('a real fetch failure still reads as network', () => {
    const e = new TypeError('fetch failed');
    e.cause = { code: 'ECONNRESET' };
    expect(describeGithubError(e).kind).toBe('network');
  });
});

describe('job log search', () => {
  it('finds the failing section with context and a continuation offset', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    const lines = [];
    for (let i = 0; i < 2000; i++) lines.push(`2026-11-14T02:39:21.0000000Z PASS check ${i}`);
    lines.splice(1200, 0, '2026-11-14T02:39:21.1Z Traceback (most recent call last):', '2026-11-14T02:39:21.2Z sqlite3.InterfaceError: bad parameter or other API misuse', '2026-11-14T02:39:21.3Z ##[error]tests/test_fleet_update.py failed');
    const text = lines.join('\n');
    w.gh.when('GET /repos/{owner}/{repo}/actions/jobs/{job_id}').reply(200, { id: 5, name: 'tests', status: 'completed', conclusion: 'failure', steps: [] });
    w.gh.when('GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs').reply(200, text);
    const r = await call(w, 'github_actions_get_job_log', { repo: 'hello', jobId: 5, search: 'InterfaceError', contextLines: 2 });
    const out = r.structuredContent?.full_payload_location === 'content[0].text' ? JSON.parse(r.content[0].text) : (r.structuredContent ?? parse(r));
    expect(out.total_matches).toBe(1);
    expect(out.matches[0].line).toBe(1202);
    expect(out.matches[0].lines.join('\n')).toMatch(/1202> sqlite3\.InterfaceError/);
    expect(out.matches[0].lines.join('\n')).toMatch(/Traceback/);
    expect(text.slice(out.matches[0].textOffset)).toMatch(/^2026-11-14T02:39:21\.0000000Z PASS check 1199/);
    const cont = await call(w, 'github_actions_get_job_log', { repo: 'hello', jobId: 5, fullText: true, textOffset: out.matches[0].textOffset, expectedLogHash: out.log_hash });
    expect(cont.isError).toBeFalsy();
    const bad = await call(w, 'github_actions_get_job_log', { repo: 'hello', jobId: 5, search: 'x1', fullText: true });
    expect(bad.isError).toBe(true);
  });
});

describe('merge_when_green: a red check is named, with where to see why', () => {
  it('names the failing check and the tool that says why (the owner-ruled fallback pointer stays)', async () => {
    const w = await makeWorld({ advanceClockOnSleep: true, profile: 'full' });
    w.gh.when('GET /repos/{owner}/{repo}').reply(200, { default_branch: 'main', name: 'hello' });
    w.gh.when('GET /repos/{owner}/{repo}/pulls/{pull_number}').reply(200, { number: 6, state: 'open', draft: false, merged: false, mergeable: true, head: { ref: 'work', sha: A }, base: { ref: 'main', sha: B } });
    w.gh.when('POST /graphql').reply(200, { data: { repository: { pullRequest: { reviewDecision: null, reviewThreads: { totalCount: 0, pageInfo: { hasNextPage: false }, nodes: [] } } } } });
    w.gh.when('GET /repos/{owner}/{repo}/rules/branches/{branch}').reply(200, []);
    w.gh.when('GET /repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks').reply(404, { message: 'Not Found' });
    w.gh.when('GET /repos/{owner}/{repo}/commits/{ref}/check-runs').reply(200, { total_count: 1, check_runs: [{ id: 1, name: 'tests', status: 'completed', conclusion: 'failure', started_at: '2026-11-02T10:00:00Z', completed_at: '2026-11-02T10:05:00Z' }] });
    w.gh.when('GET /repos/{owner}/{repo}/commits/{ref}/status').reply(200, { state: 'failure', statuses: [] });
    const out = parse(await call(w, 'github_workflow_merge_when_green', { repo: 'hello', number: 6, expectedHeadSha: A, waitForChecks: true, confirm: true }));
    expect(out.status).toBe('not_ready');
    expect(out.done).toBe(false);
    expect(out.failed_checks).toEqual(['tests']);
    expect(out.why_tool.tool).toBe('github_actions_get_run_logs_summary');
    expect(out.next).toMatch(/^Failed at this head: tests/);
    expect(out.warnings[0].suggestion).toMatch(/Fix the failing check \(tests\)/);
    expect(w.gh.calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
  });
});
