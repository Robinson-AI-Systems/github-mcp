import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WRITE_ONLY_PERMISSIONS, createCredentials } from '../../src/github/credentials.js';
import { githubFor } from '../../src/github/client.js';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';
import { isToolVisible, profileCounts, toolsForProfile } from '../../src/core/registry.js';
import { createFakeDb } from '../../test/helpers/fake-db.js';
import { makeFakeGitHub } from '../../test/helpers/fake-github.js';
import handler from '../../api/index.js';

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const ENV = { TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64url') };
const CONVERSION = { id: 424242, slug: 'example-org-mcp', client_id: 'Iv1.fixtureclientid', client_secret: 'fixture-client-secret-value', pem: PEM, webhook_secret: 'fixture-webhook-secret-value', permissions: {} };

async function world(permissions = { contents: 'write', issues: 'write', workflows: 'write', metadata: 'read' }) {
  const db = createFakeDb();
  await db.initSchema();
  const gh = makeFakeGitHub();
  const credentials = createCredentials({ db, env: ENV, fetch: gh.fetch });
  await credentials.storeApp(CONVERSION, { ownerLogin: 'example-org', ownerType: 'Organization' });
  await db.upsertAccount({ login: 'example-org', accountId: 1, accountType: 'Organization', label: 'x', credentialKind: 'app', appId: 424242 });
  await db.setInstallation('example-org', { installationId: 777, repositorySelection: 'all', permissions, status: 'active' });
  const bodies = [];
  gh.when('POST /app/installations/{installation_id}/access_tokens').reply(201, (req) => {
    bodies.push(req.body);
    return { token: `ghs_FAKEinstall${bodies.length}`, expires_at: new Date(Date.now() + 3600e3).toISOString(), permissions: {}, repository_selection: 'all' };
  });
  const ctxFor = (profile) => ({ connection: Object.freeze({ client_id: 'c', default_account: 'example-org', accounts: Object.freeze(['example-org']), mode: 'preview', profile, listing: 'catalog' }), db, credentials, fetch: gh.fetch });
  return { db, gh, credentials, bodies, ctxFor };
}

describe('profiles decide which tools exist for a connection', () => {
  const tool = (extra) => ({ name: 't', ...extra });
  it('read tools are visible to every profile; write tools only to the profiles they list', () => {
    expect(isToolVisible(tool({}), 'read_only')).toBe(true);
    const write = tool({ writes: true, profiles: ['everyday', 'full'] });
    expect(isToolVisible(write, 'read_only')).toBe(false);
    expect(isToolVisible(write, 'everyday')).toBe(true);
    expect(isToolVisible(tool({ writes: true, profiles: ['full'] }), 'everyday')).toBe(false);
    expect(isToolVisible(tool({ writes: true }), 'full')).toBe(false);
  });
  it('the real registry lists no write tool for read_only, fewer for everyday than full', () => {
    expect(toolsForProfile(registry, 'read_only').some((t) => t.writes)).toBe(false);
    const counts = profileCounts(registry);
    expect(counts.read_only).toBeLessThanOrEqual(counts.everyday);
    expect(counts.everyday).toBeLessThan(counts.full);
    // Every tool except the operator-only ones (PUB-8), which only the operator's own connection sees.
    expect(counts.full).toBe(registry.tools.filter((t) => t.operatorOnly !== true).length);
    expect(toolsForProfile(registry, 'full', { client_id: 'c', default_account: 'o', accounts: ['o'], mode: 'preview', profile: 'full', listing: 'catalog', operator: true })).toHaveLength(registry.tools.length);
    expect(toolsForProfile(registry, 'everyday').map((t) => t.name)).not.toContain('github_enable_production');
    expect(toolsForProfile(registry, 'full').map((t) => t.name)).toContain('github_enable_production');
  });
  it('a hidden write tool is "unknown" when called by name, and nothing is sent', async () => {
    const w = await world();
    const dispatch = createDispatch({ credentials: w.credentials, gates: [], fetch: w.gh.fetch });
    const connection = w.ctxFor('read_only').connection;
    const res = await dispatch({ registry, name: 'github_disable_production', args: { account: 'example-org', confirm: true }, connection, db: w.db });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Unknown or unavailable tool');
    expect(w.gh.calls).toEqual([]);
  });
  it('the home page prints the counts per profile', () => {
    let body;
    handler({}, { setHeader() {}, status: () => ({ json: (b) => { body = b; } }) });
    expect(body.tools_by_profile).toEqual(profileCounts(registry));
  });
});

describe('downscoped installation tokens', () => {
  it('a read_only connection gets every granted permission at read, and workflows (write-only) is left out', async () => {
    const w = await world();
    await githubFor(w.ctxFor('read_only'), { owner: 'example-org' });
    expect(w.bodies).toHaveLength(1);
    expect(w.bodies[0].permissions).toEqual({ contents: 'read', issues: 'read', metadata: 'read' });
    expect(JSON.stringify(w.bodies[0])).not.toContain('write');
  });
  it('everyday and full connections are not downscaled, and their tokens are cached separately from read_only ones', async () => {
    const w = await world();
    await githubFor(w.ctxFor('everyday'), { owner: 'example-org' });
    expect(w.bodies[0]?.permissions).toBeUndefined();
    await githubFor(w.ctxFor('full'), { owner: 'example-org' });
    expect(w.bodies).toHaveLength(1);
    await githubFor(w.ctxFor('read_only'), { owner: 'example-org' });
    expect(w.bodies).toHaveLength(2);
    await githubFor(w.ctxFor('read_only'), { owner: 'example-org' });
    expect(w.bodies).toHaveLength(2);
  });
  it('a caller\'s own narrower permission list is respected, never widened', async () => {
    const w = await world();
    await githubFor(w.ctxFor('read_only'), { owner: 'example-org', scope: { permissions: { issues: 'write', pull_requests: 'write' } } });
    expect(w.bodies[0].permissions).toEqual({ issues: 'read' });
  });
  it('repository-limited scope passes through to the token request', async () => {
    const w = await world();
    await githubFor(w.ctxFor('read_only'), { owner: 'example-org', scope: { repositories: ['app'] } });
    expect(w.bodies[0]).toMatchObject({ repositories: ['app'], permissions: { contents: 'read' } });
  });
  it('refuses to guess when the installation\'s permissions are unknown (an empty list would mean "all")', async () => {
    const w = await world({});
    await expect(githubFor(w.ctxFor('read_only'), { owner: 'example-org' })).rejects.toThrow(/permissions are not known/);
    expect(w.bodies).toEqual([]);
  });
  it('the write-only permission list matches the vendored GitHub description', () => {
    const doc = JSON.parse(readFileSync(new URL('../../vendor/github-openapi/api.github.com.2026-03-10.json', import.meta.url), 'utf8'));
    const writeOnly = Object.entries(doc.components.schemas['app-permissions'].properties).filter(([, v]) => !v.enum.includes('read')).map(([k]) => k).sort();
    expect([...WRITE_ONLY_PERMISSIONS].sort()).toEqual(writeOnly);
  });
});
