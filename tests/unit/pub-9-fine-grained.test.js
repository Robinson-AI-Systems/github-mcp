// PUB-9: fine-grained token tenants. The permission set comes from GitHub (harmless reads at enrollment) and from GitHub's
// own published list of what each operation needs; a request the token cannot do is refused before it reaches GitHub, and
// nothing about fine-grained tokens is offered until one is added.
import { describe, expect, it } from 'vitest';
import { FINE_AREAS, FINE_PROBES, fineDecision, fineUnlocks, finePermissionSummary, operationOf, probeOutcome, probeRequests,
  readFinePermissions, refusedBy, validPermissionSet } from '../../src/github/fine-grained.js';
import { listedFor } from '../../src/github/credential-derivation.js';
import { credentialFor, githubFor } from '../../src/github/client.js';
import { createCredentials } from '../../src/github/credentials.js';
import { registry } from '../../src/tools/index.js';
import { handlers as serverHandlers } from '../../src/tools/server.js';
import { containsCredential } from '../../src/github/content-protection.js';
import { createFakeDb } from '../../test/helpers/fake-db.js';
import { makeFakeGitHub } from '../../test/helpers/fake-github.js';

const SCOPES = ['contents:read', 'issues:none', 'metadata:read', 'pull_requests:read'];
const url = (path) => 'https://api.github.com' + path;

describe('what the token is asked at enrollment', () => {
  it('every probe is a GET GitHub lists for fine-grained tokens with exactly that read permission', () => {
    for (const p of FINE_PROBES) {
      expect(p.route.startsWith('GET '), p.route).toBe(true);
      expect(listedFor(p.route).f, p.route).toEqual([p.permission + ':read']);
    }
  });
  it('sends per_page exactly where the pinned description has it', async () => {
    const { restOperation, restParameters } = await import('../../src/github/openapi-index.js');
    for (const p of probeRequests({ owner: 'acme', repo: 'web', ref: 'main', scope: 'user' }).concat(probeRequests({ owner: 'acme', repo: null, scope: 'org' }))) {
      const query = restParameters(restOperation(p.route)).filter((x) => x.in === 'query').map((x) => x.name);
      expect('per_page' in p.params, p.route).toBe(query.includes('per_page'));
    }
  });
  it('asks repository probes of the sample repository and account probes only for the right owner type', () => {
    const user = probeRequests({ owner: 'alice', repo: 'web', ref: 'main', scope: 'user' });
    expect(user.some((p) => p.route === 'GET /user/emails')).toBe(true);
    expect(user.some((p) => p.route.startsWith('GET /orgs/'))).toBe(false);
    expect(user.find((p) => p.permission === 'statuses').params).toMatchObject({ owner: 'alice', repo: 'web', ref: 'main' });
    const org = probeRequests({ owner: 'acme', repo: 'web', ref: null, scope: 'org' });
    expect(org.some((p) => p.route === 'GET /orgs/{org}/hooks')).toBe(true);
    expect(org.some((p) => p.route.startsWith('GET /user/'))).toBe(false);
    expect(org.some((p) => p.permission === 'statuses')).toBe(false); // no branch known: that probe is skipped, not guessed
  });
  it('records read on success, none only on GitHub\'s exact "not accessible" refusal, and nothing when unclear', () => {
    expect(probeOutcome(200)).toBe('read');
    expect(probeOutcome(403, 'Resource not accessible by personal access token')).toBe('none');
    expect(probeOutcome(403, 'Advanced Security must be enabled')).toBeNull();
    expect(probeOutcome(404, 'Not Found')).toBeNull();
    expect(probeOutcome(500)).toBeNull();
  });
  it('turns the answers into a sorted permission set that always has repository details', async () => {
    const answers = { 'GET /repos/{owner}/{repo}/issues': 200, 'GET /repos/{owner}/{repo}/pulls': 403, 'GET /repos/{owner}/{repo}/pages': 404 };
    const request = async (route) => {
      const status = answers[route] ?? 403;
      if (status === 200) return { status };
      throw Object.assign(new Error('x'), { status, response: { data: { message: status === 403 ? 'Resource not accessible by personal access token' : 'Not Found' } } });
    };
    const set = await readFinePermissions(request, { owner: 'acme', repo: 'web', ref: 'main', scope: 'org' });
    expect(set).toContain('metadata:read');
    expect(set).toContain('issues:read');
    expect(set).toContain('pull_requests:none');
    expect(set.some((s) => s.startsWith('pages:'))).toBe(false);
    expect([...set].sort()).toEqual(set);
    expect(validPermissionSet(set)).toBe(true);
    expect(validPermissionSet(['contents:read'])).toBe(false);
    expect(validPermissionSet(['metadata:read', 'contents:write'])).toBe(false);
  });
});

describe('which operation a request is', () => {
  it('matches the most literal vendored route', () => {
    expect(operationOf('GET', url('/repos/acme/web/issues?per_page=1'))).toBe('GET /repos/{owner}/{repo}/issues');
    expect(operationOf('GET', url('/repos/acme/web/issues/comments'))).toBe('GET /repos/{owner}/{repo}/issues/comments');
    expect(operationOf('GET', url('/repos/acme/web/issues/7'))).toBe('GET /repos/{owner}/{repo}/issues/{issue_number}');
    expect(operationOf('PUT', url('/repos/acme/web/contents/docs/a%20b.md'))).toBe('PUT /repos/{owner}/{repo}/contents/{path}');
    expect(operationOf('GET', url('/nowhere/at/all'))).toBeNull();
  });
});

describe('the gate before GitHub', () => {
  it('allows what the token has or what is still unknown, and refuses what it lacks with plain guidance', () => {
    expect(fineDecision({ method: 'GET', url: url('/repos/acme/web/commits'), scopes: SCOPES }).allow).toBe(true);
    expect(fineDecision({ method: 'GET', url: url('/repos/acme/web/actions/runs'), scopes: SCOPES }).allow).toBe(true); // not checked: GitHub decides
    const no = fineDecision({ method: 'GET', url: url('/repos/acme/web/issues'), scopes: SCOPES });
    expect(no.allow).toBe(false);
    expect(no.reason).toMatch(/does not have issues \(read\).*Fine-grained tokens.*Re-check on My connection/);
    expect(fineDecision({ method: 'POST', url: url('/repos/acme/web/issues'), scopes: SCOPES }).allow).toBe(false);
    // a change GitHub refused once is refused here next time
    expect(fineDecision({ method: 'POST', url: url('/repos/acme/web/pulls'), scopes: SCOPES }).allow).toBe(true);
    expect(fineDecision({ method: 'POST', url: url('/repos/acme/web/pulls'), scopes: SCOPES, refused: ['pull_requests:write'] }).allow).toBe(false);
    // GitHub's list says "any of": one possible permission left is enough
    expect(fineDecision({ method: 'POST', url: url('/repos/acme/web/issues/3/comments'), scopes: SCOPES }).allow).toBe(true);
  });
  it('refuses what GitHub does not let fine-grained tokens do at all, and leaves GraphQL to GitHub', () => {
    const n = fineDecision({ method: 'GET', url: url('/notifications'), scopes: SCOPES });
    expect(n.allow).toBe(false);
    expect(n.reason).toMatch(/does not let fine-grained tokens do this/);
    expect(fineDecision({ method: 'GET', url: url('/unknown/thing'), scopes: SCOPES }).allow).toBe(false);
    expect(fineDecision({ method: 'POST', url: url('/graphql'), scopes: SCOPES }).allow).toBe(true);
    expect(fineDecision({ method: 'GET', url: url('/user'), scopes: SCOPES }).allow).toBe(true);
  });
  it('learns a missing permission only from GitHub\'s own refusal of a fine-grained request', () => {
    expect(refusedBy({ method: 'POST', url: url('/repos/acme/web/pulls'), status: 403, message: 'Resource not accessible by personal access token' })).toEqual(['pull_requests:write']);
    expect(refusedBy({ method: 'POST', url: url('/repos/acme/web/pulls'), status: 403, message: 'Must have admin rights' })).toEqual([]);
    expect(refusedBy({ method: 'POST', url: url('/repos/acme/web/pulls'), status: 422, message: 'Validation Failed' })).toEqual([]);
  });
});

describe('what it unlocks', () => {
  it('derives areas from the recorded permissions; every tool family named is a real tool', () => {
    const names = registry.tools.map((t) => t.name);
    for (const a of FINE_AREAS) for (const t of a.tools) {
      const ok = t.endsWith('*') ? names.some((n) => n.startsWith(t.slice(0, -1))) : names.includes(t);
      expect(ok, t).toBe(true);
    }
    const u = fineUnlocks(SCOPES, ['pull_requests:write']);
    expect(u.find((x) => x.area.startsWith('Code'))).toMatchObject({ reads: 'yes', changes: 'GitHub decides on first use' });
    expect(u.find((x) => x.area.startsWith('Issues'))).toMatchObject({ reads: 'no', changes: 'no' });
    expect(u.find((x) => x.area.startsWith('Pull'))).toMatchObject({ reads: 'yes', changes: 'no' });
    expect(u.find((x) => x.area.startsWith('Actions runs'))).toMatchObject({ reads: 'not checked' });
    expect(finePermissionSummary(SCOPES)).toMatchObject({ can_read: ['contents', 'metadata', 'pull_requests'], not_granted: ['issues'] });
  });
});

// ---- the client: which credential, and refusals before GitHub ----
const PLACE = 'acme-co';
async function setup(connection = {}, { refuse = null } = {}) {
  const gh = makeFakeGitHub();
  const db = createFakeDb({ clock: () => 1_800_000_000_000 });
  await db.initSchema();
  await db.upsertAccount({ login: 'example-org', accountId: 1, accountType: 'Organization', label: 'example-org', credentialKind: 'app', appId: 5 });
  await db.upsertFinePlace({ login: PLACE, accountId: 77, accountType: 'Organization', repos: ['web'] });
  const asked = [], checked = [], noted = [];
  const ctx = {
    db, fetch: gh.fetch, now: () => 1_800_000_000_000, retryAfterBaseValue: 1, sleep: async () => {},
    connection: { client_id: 'pcl_x', default_account: 'example-org', accounts: ['example-org', PLACE], mode: 'preview', profile: 'full', listing: 'compact', ...connection },
    credentials: {
      token: async (r) => { asked.push(r); return r.cred === 'F' ? 'github_pat_FAKEfinegrained0001' : 'ghs_FAKEinstall'; },
      authorizeOptionalRequest: async (r) => { checked.push(r); if (refuse) throw refuse; return true; },
      noteFineOutcome: async (r) => { noted.push(r); }
    }
  };
  return { gh, db, ctx, asked, checked, noted };
}

describe('credential selection stays App first', () => {
  it('uses the fine-grained token only for its own place; App accounts keep the App', async () => {
    const { ctx, asked } = await setup();
    expect((await credentialFor(ctx, { owner: PLACE, cred: 'I' })).token).toBe('github_pat_FAKEfinegrained0001');
    expect(asked.at(-1)).toMatchObject({ account: PLACE, cred: 'F' });
    expect((await credentialFor(ctx, { owner: 'example-org', cred: 'I' })).token).toBe('ghs_FAKEinstall');
    await expect(credentialFor(ctx, { owner: 'example-org', cred: 'F' })).rejects.toMatchObject({ code: 'no_credentials' });
  });
  it('is refused for read-only connections, service passes and narrowed scopes', async () => {
    const ro = await setup({ profile: 'read_only' });
    await expect(credentialFor(ro.ctx, { owner: PLACE })).rejects.toThrow(/fine-grained token is not available to read-only/);
    const pass = await setup({ pass: true });
    await expect(credentialFor(pass.ctx, { owner: PLACE })).rejects.toThrow(/service pass/);
    const narrow = await setup();
    await expect(credentialFor(narrow.ctx, { owner: PLACE, scope: { repositories: ['web'] } })).rejects.toMatchObject({ code: 'outside_scope' });
  });
  it('the owner\'s own vault never answers for a fine-grained place', async () => {
    const db = createFakeDb(); await db.initSchema();
    await db.upsertFinePlace({ login: PLACE, accountId: 77, accountType: 'Organization', repos: null });
    const creds = createCredentials({ db, env: { TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64url') } });
    await expect(creds.token({ account: PLACE, cred: 'F' })).rejects.toThrow(/signed-in connection/);
  });
});

describe('requests on a fine-grained place', () => {
  it('a refused request never reaches GitHub and says what to do', async () => {
    const refusal = Object.assign(new Error('Your fine-grained token does not have issues (read). Edit it on GitHub, then Re-check.'), { code: 'outside_scope' });
    const { ctx, gh, checked } = await setup({}, { refuse: refusal });
    gh.when('GET /repos/{owner}/{repo}/issues').reply(200, []);
    const octokit = await githubFor(ctx, { owner: PLACE });
    await expect(octokit.request('GET /repos/{owner}/{repo}/issues', { owner: PLACE, repo: 'web' })).rejects.toThrow(/does not have issues/);
    expect(gh.calls).toHaveLength(0);
    expect(checked[0]).toMatchObject({ account: PLACE, kind: 'F', method: 'GET' });
  });
  it('an allowed request is sent with the token, validated against the pinned schema, and a GitHub refusal is remembered', async () => {
    const { ctx, gh, noted, db } = await setup();
    await db.setPlaceChanges(PLACE, true); // GOD-5: a place is read-only until the person allows changes
    gh.when('GET /repos/{owner}/{repo}/commits').reply(200, []);
    gh.when('POST /repos/{owner}/{repo}/pulls').reply(403, { message: 'Resource not accessible by personal access token' });
    const octokit = await githubFor(ctx, { owner: PLACE });
    expect((await octokit.request('GET /repos/{owner}/{repo}/commits', { owner: PLACE, repo: 'web', per_page: 1 })).status).toBe(200);
    expect(gh.calls[0].headers.authorization).toBe('token github_pat_FAKEfinegrained0001');
    await expect(octokit.request('POST /repos/{owner}/{repo}/pulls', { owner: PLACE, repo: 'web', title: 't', head: 'a', base: 'main' })).rejects.toMatchObject({ status: 403 });
    expect(gh.invalid).toEqual([]);
    expect(noted.at(-1)).toMatchObject({ account: PLACE, method: 'POST', status: 403, message: 'Resource not accessible by personal access token' });
  });
  it('a request outside the repositories the token was given is refused before GitHub', async () => {
    const { ctx, gh } = await setup();
    const octokit = await githubFor(ctx, { owner: PLACE });
    await expect(octokit.request('GET /repos/{owner}/{repo}/commits', { owner: PLACE, repo: 'secret' })).rejects.toThrow(/not one of the places you added/);
    expect(gh.calls).toHaveLength(0);
  });
});

describe('the gate in github_whoami', () => {
  const whoami = serverHandlers.github_whoami;
  const ctxWith = async (fine) => {
    const db = createFakeDb(); await db.initSchema();
    await db.upsertAccount({ login: 'example-org', accountId: 1, accountType: 'Organization', label: 'example-org', credentialKind: 'app', appId: 5 });
    return { db, connection: { client_id: 'pcl_x', default_account: 'example-org', accounts: ['example-org'], mode: 'preview', profile: 'full', listing: 'compact' },
      credentials: { token: async () => 'x', masterStatus: async () => ({ enrolled: false }), ...(fine ? { fineStatus: async () => fine } : {}) } };
  };
  it('says nothing about fine-grained tokens when none was added', async () => {
    for (const fine of [null, []]) {
      const out = await whoami({}, await ctxWith(fine));
      expect(JSON.stringify(out)).not.toMatch(/fine/i);
      expect(out.credential_types).not.toHaveProperty('F');
    }
  });
  it('reports each token, its permissions and what it unlocks once one is added, never the token', async () => {
    const fine = [{ owner: PLACE, status: 'active', expires_at: '2031-01-01T00:00:00.000Z', repositories: ['web'], allow_changes: false,
      permissions: finePermissionSummary(SCOPES), unlocks: fineUnlocks(SCOPES) }];
    const out = await whoami({}, await ctxWith(fine));
    expect(out.credential_types.F).toMatch(/fine-grained/);
    expect(out.fine_grained_tokens[0]).toMatchObject({ owner: PLACE, status: 'active', permissions: { not_granted: ['issues'] } });
    expect(out.fine_grained_tokens[0].unlocks.find((u) => u.area.startsWith('Issues')).reads).toBe('no');
    expect(containsCredential(JSON.stringify(out))).toBe(false);
  });
  it('tool listings carry no fine-grained credential choice at all (nothing is offered before enrollment)', () => {
    for (const tool of registry.tools) {
      const text = JSON.stringify(tool.inputSchema ?? {});
      expect(text.includes('"F"'), tool.name).toBe(false);
      expect(String(tool.description).includes('your fine-grained token'), tool.name).toBe(false);
    }
  });
  it('a fine-grained token value is caught by the result guard', () => {
    expect(containsCredential('github_pat_FAKE' + 'a'.repeat(70))).toBe(true);
  });
});
