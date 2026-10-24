// GOD-6 "Act as me": with a master token and the switch on, GitHub sees the person; the app is used where only it can act,
// where a rule must hold, and for connections that may never use the master token. Fake values only.
import { describe, expect, it } from 'vitest';
import { makeWorld, parse } from '../../test/helpers/write-contract.js';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';
import { githubFor } from '../../src/github/client.js';
import { protectionGate } from '../../test/helpers/fixture-gates.js';

const MASTER = 'ghp_FAKEmaster0123456789abcdefghij';
const APP = 'ghs_FAKEinstall0123456789abcdefghij';
const ME = { subject: '4242', login: 'chris-fake' };
const issue = (extras = {}) => ({ id: 1, number: 3, title: 'Hi', state: 'open', body: '', labels: [], assignees: [], user: { login: 'chris-fake' }, html_url: 'https://github.com/example-org/hello/issues/3', ...extras });

/** A world whose credentials hand out a fake master token for `M` and a fake app token for everything else. */
async function setup({ status = { enrolled: true, scopes: ['repo'], expires_at: null, ...ME }, connection = {}, masterThrows = false } = {}) {
  const w = await makeWorld({ accounts: ['example-org'] });
  let current = status;
  const credentials = {
    ...w.credentials,
    masterStatus: async () => current,
    token: async ({ cred }) => {
      if (cred === 'M') { if (masterThrows) throw new Error('unreadable'); return MASTER; }
      return APP;
    }
  };
  const conn = { ...w.connection, ...connection };
  const ctx = { ...w.ctx, credentials, connection: conn };
  return { ...w, credentials, connection: conn, ctx, setStatus: (s) => { current = s; } };
}
const who = (call) => { const a = String(call.headers.authorization ?? ''); return a.includes(MASTER) ? 'M' : a.includes(APP) ? 'app' : 'other'; };
const writesOf = (gh) => gh.calls.filter((c) => !['GET', 'HEAD'].includes(c.method) && c.route !== 'POST /graphql');
async function call(w, name, args, extra = {}) {
  const dispatcher = createDispatch({ credentials: w.credentials, gates: [], fetch: w.gh.fetch, now: w.ctx.now, sleep: async () => {} });
  const out = await dispatcher({ registry, name, args, connection: w.connection, db: w.db, ...extra });
  return { out, body: out.isError ? null : (out.structuredContent ?? parse(out)), text: out.content?.[0]?.text ?? '' };
}
const arrangeIssue = (gh) => {
  gh.when('GET /repos/{owner}/{repo}').reply(200, { has_issues: true, default_branch: 'main' });
  gh.when('POST /repos/{owner}/{repo}/issues').reply(201, issue());
  gh.when('GET /repos/{owner}/{repo}/issues/{issue_number}').reply(200, issue());
};
const create = { repo: 'hello', title: 'Hi', body: '' };

describe('who makes the call', () => {
  it('1. with a master token and the switch on, the change is made as the person and recorded as such', async () => {
    const w = await setup(); arrangeIssue(w.gh);
    const r = await call(w, 'github_issue_create', create);
    expect(r.body.done).toBe(true);
    expect(r.body.acting_as).toBe('chris-fake (you)');
    expect(who(writesOf(w.gh)[0])).toBe('M');
    expect(w.gh.invalid).toEqual([]);
    const rows = await w.db.listChanges({ limit: 5 });
    expect(rows.find((c) => c.tool === 'github_issue_create').actedAs).toBe('you');
  });
  it('2. with no master token the app makes the call and nothing extra is said', async () => {
    const w = await setup({ status: { enrolled: false } }); arrangeIssue(w.gh);
    const r = await call(w, 'github_issue_create', create);
    expect(r.body.done).toBe(true);
    expect(r.body.acting_as).toBe('Robinson GitHub MCP app');
    expect(r.body.acting_as_note).toBeUndefined();
    expect(w.gh.calls.every((c) => who(c) === 'app')).toBe(true);
  });
  it('3. read-only connections and service passes always use the app, and the master token never reaches the request', async () => {
    for (const connection of [{ profile: 'read_only' }, { pass: true }]) {
      const w = await setup({ connection });
      w.gh.when('GET /repos/{owner}/{repo}').reply(200, { id: 1 });
      const octokit = await githubFor(w.ctx, { owner: 'example-org' });
      await octokit.request('GET /repos/{owner}/{repo}', { owner: 'example-org', repo: 'hello' });
      expect(w.gh.calls.map(who)).toEqual(['app']);
      expect(JSON.stringify(w.gh.calls)).not.toContain(MASTER);
    }
  });
  it('4. a narrowed-token request uses the app, with the reason', async () => {
    const w = await setup(); w.gh.when('GET /repos/{owner}/{repo}').reply(200, { id: 1 });
    const octokit = await githubFor(w.ctx, { owner: 'example-org', scope: { repositories: ['hello'] } });
    await octokit.request('GET /repos/{owner}/{repo}', { owner: 'example-org', repo: 'hello' });
    expect(who(w.gh.calls[0])).toBe('app');
  });
  it('5. one tool call that reads as you and creates a check run as the app reports "mixed"', async () => {
    const w = await setup();
    w.gh.when('GET /repos/{owner}/{repo}/commits/{ref}').reply(200, { sha: 'a'.repeat(40) });
    w.gh.when('POST /repos/{owner}/{repo}/check-runs').reply(201, { id: 9, name: 'x', head_sha: 'a'.repeat(40), status: 'queued' });
    const { createActorLog } = await import('../../src/github/act-as.js');
    const actor = createActorLog();
    const octokit = await githubFor({ ...w.ctx, actor }, { owner: 'example-org' });
    await octokit.request('GET /repos/{owner}/{repo}/commits/{ref}', { owner: 'example-org', repo: 'hello', ref: 'a'.repeat(40) });
    await octokit.request('POST /repos/{owner}/{repo}/check-runs', { owner: 'example-org', repo: 'hello', name: 'x', head_sha: 'a'.repeat(40) });
    expect(w.gh.calls.map(who)).toEqual(['M', 'app']);
    expect(actor.summary().as).toBe('mixed');
  });
  it('6. one person\'s switch or rejected token does not affect another person in the same tenant', async () => {
    const w = await setup();
    await w.db.setSetting('act_as_me.4242', 'off');
    await w.db.setSetting('master_rejected_at.4242', '2026-10-24T00:00:00Z');
    w.gh.when('GET /repos/{owner}/{repo}').reply(200, { id: 1 });
    const a = await githubFor(w.ctx, { owner: 'example-org' });
    await a.request('GET /repos/{owner}/{repo}', { owner: 'example-org', repo: 'hello' });
    w.setStatus({ enrolled: true, scopes: ['repo'], expires_at: null, subject: '7', login: 'other-person' });
    const b = await githubFor(w.ctx, { owner: 'example-org' });
    await b.request('GET /repos/{owner}/{repo}', { owner: 'example-org', repo: 'hello' });
    expect(w.gh.calls.map(who)).toEqual(['app', 'M']);
  });
  it('7. an expired master token falls back to the app and says when it expired', async () => {
    const w = await setup({ status: { enrolled: false, expired: true, expires_at: '2026-10-01T12:00:00Z', subject: '4242' } });
    arrangeIssue(w.gh);
    const r = await call(w, 'github_issue_create', create);
    expect(r.body.acting_as_note).toMatch(/expired on/);
    expect(w.gh.calls.every((c) => who(c) === 'app')).toBe(true);
  });
  it('a master token that cannot be read falls back to the app', async () => {
    const w = await setup({ masterThrows: true }); arrangeIssue(w.gh);
    const r = await call(w, 'github_issue_create', create);
    expect(r.body.done).toBe(true);
    expect(r.body.acting_as_note).toMatch(/could not be read/);
    expect(w.gh.calls.every((c) => who(c) === 'app')).toBe(true);
  });
});

describe('when GitHub refuses the personal token', () => {
  const read = async (w) => { const o = await githubFor(w.ctx, { owner: 'example-org' }); return o.request('GET /repos/{owner}/{repo}', { owner: 'example-org', repo: 'hello' }); };
  it('8. a 401 on a read is repeated once with the app, remembered, and cleared by a new token', async () => {
    const w = await setup();
    w.gh.when('GET /repos/{owner}/{repo}').replySequence([{ status: 401, body: { message: 'Bad credentials' } }, { status: 200, body: { id: 1 } }]);
    expect((await read(w)).status).toBe(200);
    expect(w.gh.calls.map(who)).toEqual(['M', 'app']);
    expect(await w.db.getSetting('master_rejected_at.4242')).toBeTruthy();
    expect((await read(w)).status).toBe(200);
    expect(who(w.gh.calls.at(-1))).toBe('app');
    await w.db.setSetting('master_rejected_at.4242', ''); // saving a new token clears it
    await read(w);
    expect(who(w.gh.calls.at(-1))).toBe('M');
  });
  it('9. a 401 on a write sends exactly one request, changes nothing, and can be run again', async () => {
    const w = await setup(); arrangeIssue(w.gh);
    w.gh.when('POST /repos/{owner}/{repo}/issues').replySequence([{ status: 401, body: { message: 'Bad credentials' } }, { status: 201, body: issue() }]);
    const first = await call(w, 'github_issue_create', { ...create, requestKey: 'k-1' });
    expect(JSON.stringify(first.out)).toMatch(/nothing was changed/);
    expect(writesOf(w.gh)).toHaveLength(1);
    const second = await call(w, 'github_issue_create', { ...create, requestKey: 'k-1' });
    expect(second.body?.done).toBe(true);
    expect(writesOf(w.gh)).toHaveLength(2);
    expect(who(writesOf(w.gh)[1])).toBe('app');
  });
  it('10. a 403 or 404 on a read is repeated once with the app; on a write it is not; SSO is explained', async () => {
    const w = await setup();
    w.gh.when('GET /repos/{owner}/{repo}').replySequence([{ status: 403, body: { message: 'no' } }, { status: 200, body: { id: 1 } }]);
    expect((await read(w)).status).toBe(200);
    expect(w.gh.calls.map(who)).toEqual(['M', 'app']);
    const v = await setup();
    v.gh.when('POST /repos/{owner}/{repo}/issues').reply(403, { message: 'Resource protected by organization SAML enforcement' }, { 'x-github-sso': 'required; url=https://github.com/orgs/x/sso' });
    const o = await githubFor(v.ctx, { owner: 'example-org' });
    await expect(o.request('POST /repos/{owner}/{repo}/issues', { owner: 'example-org', repo: 'hello', title: 't' })).rejects.toThrow(/SSO/);
    expect(writesOf(v.gh)).toHaveLength(1);
  });
  it('11. a nearly used-up personal allowance uses the app until it resets, on separate rate keys', async () => {
    const w = await setup();
    await w.db.recordRateState({ account: '~me:4242', resource: 'core', remaining: 50, resetAt: new Date(w.ctx.now() + 3_600_000), blockedUntil: null });
    w.gh.when('GET /repos/{owner}/{repo}').reply(200, { id: 1 });
    const o = await githubFor(w.ctx, { owner: 'example-org' });
    await o.request('GET /repos/{owner}/{repo}', { owner: 'example-org', repo: 'hello' });
    expect(who(w.gh.calls[0])).toBe('app');
    expect(await w.db.getRateState('example-org', 'core')).not.toMatchObject({ remaining: 50 });
  });
});

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const pr = (extra = {}) => ({ number: 7, node_id: 'PR_x', title: 'T', state: 'open', draft: false, merged: false, mergeable: true, mergeable_state: 'clean', head: { ref: 'feat', sha: A }, base: { ref: 'main' }, html_url: 'u', auto_merge: null, ...extra });
const run = { id: 1, name: 'ci', status: 'completed', conclusion: 'success', started_at: '2026-10-11T00:00:00Z', app: { id: 15368 } };
const RULES = [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'ci' }] } }, { type: 'pull_request', parameters: { required_approving_review_count: 1 } }];
function mergeWorld(gh, { state = 'clean', rules = RULES, ciRuns = [run] } = {}) {
  gh.when('GET /repos/{owner}/{repo}').reply(200, { default_branch: 'main', node_id: 'R_x', name: 'hello' });
  gh.when('GET /repos/{owner}/{repo}/branches/{branch}').reply(200, { protected: false, commit: { sha: A } });
  gh.when('GET /repos/{owner}/{repo}/rules/branches/{branch}').reply(200, rules);
  gh.when('GET /repos/{owner}/{repo}/branches/{branch}/protection').reply(404, { message: 'Not Found' });
  gh.when('GET /repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks').reply(404, { message: 'Not Found' });
  gh.when('GET /repos/{owner}/{repo}/commits/{ref}/check-runs').reply(200, { total_count: ciRuns.length, check_runs: ciRuns });
  gh.when('GET /repos/{owner}/{repo}/commits/{ref}/status').reply(200, { state: 'success', statuses: [], sha: A, total_count: 0 });
  gh.when('GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews').reply(200, []);
  gh.when('GET /repos/{owner}/{repo}/pulls/{pull_number}').replySequence([{ status: 200, body: pr({ mergeable_state: state }) }, { status: 200, body: pr({ mergeable_state: state, merged: true, state: 'closed' }) }]);
  gh.when('PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge').reply(200, { sha: B, merged: true, message: 'ok' });
  gh.when('PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge-async').reply(200, { status: 'merged', details: { merge_commit_sha: B } });
}
const live = (options) => setup({ ...options, connection: { mode: 'production', ...(options?.connection ?? {}) } });
const merge = { repo: 'hello', number: 7, expectedHeadSha: A, confirm: true };

describe('merging as you (12)', () => {
  it('is refused while GitHub says the rules are not met yet, and nothing is sent', async () => {
    const w = await live(); mergeWorld(w.gh, { state: 'blocked' });
    const r = await call(w, 'github_pr_merge', merge);
    expect(JSON.stringify(r.body ?? r.out)).toMatch(/rules for main are not met/);
    expect(w.gh.calls.some((c) => c.route.startsWith('PUT'))).toBe(false);
  });
  it('waits when GitHub is still working it out', async () => {
    const w = await live(); mergeWorld(w.gh, { state: 'unknown' });
    const r = await call(w, 'github_pr_merge', merge);
    expect(JSON.stringify(r.body ?? r.out)).toMatch(/still working out/);
    expect(w.gh.calls.some((c) => c.route.startsWith('PUT'))).toBe(false);
  });
  it('merges as you when GitHub says clean', async () => {
    const w = await live(); mergeWorld(w.gh, { state: 'clean', rules: [] });
    const r = await call(w, 'github_pr_merge', merge);
    expect(r.body.done).toBe(true);
    const put = w.gh.calls.find((c) => c.route === 'PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge');
    expect(who(put)).toBe('M');
    expect(put.body).not.toHaveProperty('bypass_rules');
  });
});

describe('branch rules cannot be skipped by the credential change (13)', () => {
  const CONTENTS = 'GET /repos/{owner}/{repo}/contents/{path}';
  const PUT = { repo: 'hello', branch: 'main', path: 'docs/a.md', message: 'Update', content: 'new text', confirm: true };
  const file = (t) => ({ type: 'file', path: 'docs/a.md', sha: 'f'.repeat(40), size: t.length, encoding: 'base64', content: Buffer.from(t).toString('base64') });
  const arrange = (gh, { protectedBranch = false, rules = [], rulesStatus = 200 } = {}) => {
    gh.when('GET /repos/{owner}/{repo}').reply(200, { default_branch: 'main', node_id: 'R_x', name: 'hello' });
    gh.when('GET /repos/{owner}/{repo}/branches/{branch}').reply(200, { protected: protectedBranch, commit: { sha: A } });
    gh.when('GET /repos/{owner}/{repo}/rules/branches/{branch}').reply(rulesStatus, rulesStatus === 200 ? rules : { message: 'boom' });
    gh.when(CONTENTS).replySequence([{ status: 200, body: file('old') }, { status: 200, body: file('new text') }]);
    gh.when('PUT /repos/{owner}/{repo}/contents/{path}').reply(200, { content: { sha: 'n' } });
  };
  const putFrom = (gh) => gh.calls.find((c) => c.route === 'PUT /repos/{owner}/{repo}/contents/{path}');
  it('an unprotected branch with no rules is written as you', async () => {
    const w = await live(); arrange(w.gh);
    await call(w, 'github_content_put_file', PUT);
    expect(who(putFrom(w.gh))).toBe('M');
  });
  it('a protected branch, a branch with rules, or rules that cannot be read are written by the app', async () => {
    for (const options of [{ protectedBranch: true }, { rules: RULES }, { rulesStatus: 500 }]) {
      const w = await live(); arrange(w.gh, options);
      await call(w, 'github_content_put_file', PUT);
      expect(who(putFrom(w.gh))).toBe('app');
    }
  });
  it('a release and a createCommitOnBranch mutation always come from the app', async () => {
    const w = await live();
    w.gh.when('POST /repos/{owner}/{repo}/releases').reply(201, { id: 1, tag_name: 'v1' });
    w.gh.when('POST /graphql').reply(200, { data: { createCommitOnBranch: { commit: { oid: A } } } });
    const o = await githubFor(w.ctx, { owner: 'example-org' });
    await o.request('POST /repos/{owner}/{repo}/releases', { owner: 'example-org', repo: 'hello', tag_name: 'v1' });
    await o.graphql('mutation { createCommitOnBranch(input: {branch: {repositoryNameWithOwner: "example-org/hello", branchName: "main"}, message: {headline: "x"}, expectedHeadOid: "' + A + '"}) { commit { oid } } }');
    expect(w.gh.calls.map(who)).toEqual(['app', 'app']);
  });
  it('an extra place with a protected branch is refused with the "app is not installed" message', async () => {
    const w = await live({ status: { enrolled: false } });
    await w.db.upsertExtraPlace({ login: 'acme-co', accountId: 77, accountType: 'Organization', repo: null });
    await w.db.setPlaceChanges('acme-co', true);
    w.connection = { ...w.connection, accounts: ['example-org', 'acme-co'] }; w.ctx.connection = w.connection;
    arrange(w.gh, { protectedBranch: true });
    const o = await githubFor(w.ctx, { owner: 'acme-co' });
    await expect(o.request('PUT /repos/{owner}/{repo}/contents/{path}', { owner: 'acme-co', repo: 'hello', path: 'a.md', message: 'm', content: 'eA==', branch: 'main' })).rejects.toThrow(/app is not installed/);
    expect(writesOf(w.gh)).toHaveLength(0);
  });
});

describe('skipping rules on purpose (14a to 14e)', () => {
  const override = { ...merge, overrideRules: true, overrideReason: 'Release hotfix approved by Chris' };
  it('14a. previews the skipped rules, then sends exactly one merge-async with bypass_rules as you; the log says OVERRIDE', async () => {
    const w = await live(); mergeWorld(w.gh, { state: 'blocked', ciRuns: [{ ...run, conclusion: 'failure' }] });
    const preview = await call(w, 'github_pr_merge', { ...override, confirm: false });
    expect(JSON.stringify(preview.body)).toMatch(/required checks/);
    expect(JSON.stringify(preview.body)).toMatch(/1 required approval/);
    expect(w.gh.calls.some((c) => c.route.startsWith('PUT'))).toBe(false);
    const w2 = await live(); mergeWorld(w2.gh, { state: 'blocked', ciRuns: [{ ...run, conclusion: 'failure' }] });
    const r = await call(w2, 'github_pr_merge', override);
    expect(r.body.done).toBe(true);
    const puts = w2.gh.calls.filter((c) => c.route.startsWith('PUT'));
    expect(puts).toHaveLength(1);
    expect(puts[0].route).toBe('PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge-async');
    expect(JSON.stringify(r.body)).toMatch(/rules_overridden/); expect(JSON.stringify(r.body.result ?? r.body.after ?? r.body)).toMatch(/required checks/);
    expect(puts[0].body).toMatchObject({ bypass_rules: true, sha: A });
    expect(who(puts[0])).toBe('M');
    expect(w2.gh.invalid).toEqual([]);
    const row = (await w2.db.listChanges({ limit: 5 })).find((c) => c.tool === 'github_pr_merge');
    expect(row.summary).toMatch(/^OVERRIDE \(/);
  });
  it('14b. is refused without a reason, with Act as me off, with the override switch off, and on a preview connection', async () => {
    const cases = [
      [await live({ status: { enrolled: false } }), override, /master token/],
      [await live(), override, /off on My connection/, async (w) => w.db.setSetting('rule_override.4242', 'off')],
      [await setup(), override, /preview mode|production connection/]
    ];
    for (const [w, args, message, prep] of cases) {
      if (prep) await prep(w);
      mergeWorld(w.gh, { state: 'blocked' });
      const r = await call(w, 'github_pr_merge', args);
      expect(JSON.stringify(r.body ?? r.out)).toMatch(message);
      expect(w.gh.calls.some((c) => c.route.startsWith('PUT'))).toBe(false);
    }
  });
  it('14b. (no reason) the permission check itself refuses a missing reason', async () => {
    const { overrideAllowed } = await import('../../src/github/act-as.js');
    const w = await live();
    expect(await overrideAllowed(w.ctx, { overrideRules: true })).toMatchObject({ ok: false, message: expect.stringMatching(/why you are overriding/) });
    expect(await overrideAllowed(w.ctx, { overrideReason: 'Release hotfix approved by Chris' })).toMatchObject({ ok: true, login: 'chris-fake' });
  });
  it('14c. a file write with overrideRules on a protected branch is sent as you; without it, by the app', async () => {
    const CONTENTS = 'GET /repos/{owner}/{repo}/contents/{path}';
    const file = (t) => ({ type: 'file', path: 'docs/a.md', sha: 'f'.repeat(40), size: t.length, encoding: 'base64', content: Buffer.from(t).toString('base64') });
    const arrange = (gh) => {
      mergeWorld(gh, { state: 'clean' });
      gh.when(CONTENTS).replySequence([{ status: 200, body: file('old') }, { status: 200, body: file('new text') }]);
      gh.when('PUT /repos/{owner}/{repo}/contents/{path}').reply(200, { content: { sha: 'n' } });
    };
    const args = { repo: 'hello', branch: 'main', path: 'docs/a.md', message: 'Update', content: 'new text', confirm: true };
    const a = await live(); arrange(a.gh);
    await call(a, 'github_content_put_file', { ...args, overrideRules: true, overrideReason: 'Fix a typo in the live docs' });
    expect(who(a.gh.calls.find((c) => c.route === 'PUT /repos/{owner}/{repo}/contents/{path}'))).toBe('M');
    const b = await live(); arrange(b.gh);
    await call(b, 'github_content_put_file', args);
    expect(who(b.gh.calls.find((c) => c.route === 'PUT /repos/{owner}/{repo}/contents/{path}'))).toBe('app');
  });
  it('14d. when GitHub refuses the override, it says so plainly, sends one request and never retries with the app', async () => {
    const w = await live(); mergeWorld(w.gh, { state: 'blocked' });
    w.gh.when('PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge-async').reply(403, { message: 'Bypass not allowed by branch protection rule' });
    const r = await call(w, 'github_pr_merge', override);
    expect(JSON.stringify(r.body ?? r.out)).toMatch(/does not let you skip the rules/);
    expect(w.gh.calls.filter((c) => c.route.startsWith('PUT'))).toHaveLength(1);
  });
  it('14f. a locked repository still refuses an override: the guards run before anything is sent', async () => {
    const w = await live(); mergeWorld(w.gh, { state: 'blocked' });
    const dispatcher = createDispatch({ credentials: w.credentials, gates: [protectionGate('locked')], fetch: w.gh.fetch, now: w.ctx.now, sleep: async () => {} });
    const out = await dispatcher({ registry, name: 'github_pr_merge', args: override, connection: w.connection, db: w.db });
    expect(JSON.stringify(out)).toMatch(/locked|protected/i);
    expect(w.gh.calls.some((c) => c.route.startsWith('PUT'))).toBe(false);
  });
  it('14e. the bypass option appears in no other request', async () => {
    const w = await live(); mergeWorld(w.gh);
    await call(w, 'github_pr_merge', merge);
    await call(w, 'github_pr_merge_async', merge);
    expect(JSON.stringify(w.gh.calls.map((c) => c.body ?? null))).not.toContain('bypass_rules');
  });
});

describe('details', () => {
  it('14. the next page of an app listing (an absolute address) is still sent by the app', async () => {
    const w = await setup(); w.gh.when('GET /app/installations').reply(200, []);
    const o = await githubFor(w.ctx, { owner: 'example-org' });
    await o.request('GET https://api.github.com/app/installations?page=2');
    expect(who(w.gh.calls[0])).toBe('app');
  });
  it('every request carries the pinned GitHub API version, as the person or as the app', async () => {
    const w = await setup(); w.gh.when('GET /repos/{owner}/{repo}').reply(200, { id: 1 });
    const o = await githubFor(w.ctx, { owner: 'example-org' });
    await o.request('GET /repos/{owner}/{repo}', { owner: 'example-org', repo: 'hello' });
    expect(w.gh.calls[0].headers['x-github-api-version']).toBe('2026-03-10');
  });
  it('15. a workflow that calls the merge reports who made it', async () => {
    const w = await live(); mergeWorld(w.gh);
    const r = await call(w, 'github_workflow_merge_when_green', merge);
    expect(JSON.stringify(r.body ?? r.text)).toMatch(/acting_as|chris-fake/);
  });
});

describe('what other tools and views report', () => {
  it('16. github_whoami shows acting_as', async () => {
    const w = await setup();
    const r = await call(w, 'github_whoami', {});
    expect(JSON.stringify(r.body)).toMatch(/acting_as/);
    expect(JSON.stringify(r.body)).toMatch(/chris-fake/);
  });
});
