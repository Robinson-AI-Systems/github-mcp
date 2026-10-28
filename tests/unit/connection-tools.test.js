import { describe, expect, it } from 'vitest';
import { handlers, tools } from '../../src/tools/server.js';
import { createGates } from '../../src/tools/gates.js';
import { makeWorld, parse } from '../../test/helpers/write-contract.js';

const SECRET = [/gh[pousr]_[A-Za-z0-9]{8,}/, /github_pat_[A-Za-z0-9_]{8,}/, /access-/, /refresh-/];
const SCOPE = (accounts, extra = {}) => ({ defaultAccount: accounts[0], accounts, mode: 'preview', profile: 'full', listing: 'compact', ...extra });
async function login(db, clientId, name, accounts, extra = {}) {
  await db.createOAuthClient({ clientId, clientSecret: `fixture-secret-${clientId}`, redirectUris: ['https://example.test/cb'], clientName: name });
  await db.createAccessToken({ accessToken: `access-${clientId}`, refreshToken: `refresh-${clientId}`, clientId, ...SCOPE(accounts, extra) });
}
async function world(accounts = ['example-org', 'example-user'], extra = {}) {
  const w = await makeWorld({ profile: 'full', accounts, gates: createGates(), ...extra });
  await login(w.db, 'client-1', 'Claude', accounts);
  return w;
}
const call = (name, w, args) => Promise.resolve(handlers[name](args, w.ctx)).then((r) => (r?.content ? parse(r) : r));

describe('github_list_connections: service passes', () => {
  it('lists a pass with its scope and request limit, never a token, and switches it off with the same tool as a login', async () => {
    const w = await world(['example-org']);
    w.db.seedRtcPass({ clientId: 'rtc-' + 'a'.repeat(24), account: 'example-org', rateLimitPerMinute: 5 });
    const out = await call('github_list_connections', w, {});
    const pass = out.connections.find((c) => c.connection_id === 'rtc-' + 'a'.repeat(24));
    expect(pass).toMatchObject({ kind: 'service pass', is_this_connection: false, can_revoke_here: true,
      pass_scope: { areas: ['server', 'meta'], writes_allowed: false, production_allowed: false, requests_per_minute: 5 } });
    expect(out.connections.find((c) => c.connection_id === 'client-1').kind).toBe('login');
    expect(JSON.stringify(out)).not.toMatch(/rtc_pass_/);
    const revoke = (extra) => call('github_revoke_connection', w, { connection: 'rtc-' + 'a'.repeat(24), ...extra });
    expect(await revoke({ dryRun: true })).toMatchObject({ status: 'preview' });
    expect(await revoke({ confirm: true })).toMatchObject({ status: 'applied', confirmed: true });
    expect((await call('github_list_connections', w, {})).connections.some((c) => c.kind === 'service pass')).toBe(false);
  });
  it('a pass for an account this connection cannot use stays hidden', async () => {
    const w = await world(['example-org']);
    w.db.seedRtcPass({ clientId: 'rtc-' + 'b'.repeat(24), account: 'unrelated-org' });
    expect((await call('github_list_connections', w, {})).connections.some((c) => c.kind === 'service pass')).toBe(false);
  });
});

describe('github_list_connections', () => {
  it('shows the logins that use only your accounts, marks this one, and shows no token', async () => {
    const w = await world();
    await login(w.db, 'client-2', 'Codex', ['example-user'], { mode: 'production' });
    await login(w.db, 'client-3', 'Elsewhere', ['example-org', 'unrelated-org']);
    await login(w.db, 'client-4', 'Strangers', ['unrelated-org']);
    const out = await call('github_list_connections', w, {});
    expect(out.count).toBe(3);
    const byId = Object.fromEntries(out.connections.map((c) => [c.connection_id, c]));
    expect(byId['client-1']).toMatchObject({ name: 'Claude', is_this_connection: true, mode: 'PREVIEW', can_revoke_here: true, last_used: 'never' });
    expect(byId['client-2']).toMatchObject({ mode: 'PRODUCTION', is_this_connection: false, can_revoke_here: true });
    expect(byId['client-3'].can_revoke_here).toBe(false);
    expect(byId['client-4']).toBeUndefined();
    for (const re of SECRET) expect(JSON.stringify(out)).not.toMatch(re);
  });
  it('shows more with detail=full and only the named fields with fields', async () => {
    const w = await world();
    expect((await call('github_list_connections', w, { detail: 'full' })).connections[0]).toHaveProperty('connected_since');
    const narrow = await call('github_list_connections', w, { fields: ['mode'] });
    expect(Object.keys(narrow.connections[0]).sort()).toEqual(['connection_id', 'mode']);
    await expect(call('github_list_connections', w, { fields: ['nope'] })).rejects.toThrow(/Unknown field/);
  });
});

describe('github_set_default_account', () => {
  it('previews, then changes the default for this login only, and verifies by reading it back', async () => {
    const w = await world();
    await login(w.db, 'client-2', 'Codex', ['example-org', 'example-user']);
    const preview = await call('github_set_default_account', w, { account: 'example-user', dryRun: true });
    expect(preview.preview).toContain('Make example-user the default');
    expect((await w.db.getAccessToken('access-client-1')).default_account).toBe('example-org');
    const done = await call('github_set_default_account', w, { account: 'example-user', confirm: true });
    expect(done.status).toBe('applied');
    expect((await w.db.getAccessToken('access-client-1')).default_account).toBe('example-user');
    expect((await w.db.getAccessToken('access-client-2')).default_account).toBe('example-org');
    const change = (await w.db.listChanges())[0];
    expect(change).toMatchObject({ tool: 'github_set_default_account', account: 'example-user' });
  });
  it('is refused for an account outside the connection and below the full profile', async () => {
    const w = await world();
    expect((await call('github_set_default_account', w, { account: 'unrelated-org', confirm: true })).status).toBe('refused');
    const low = await makeWorld({ profile: 'everyday', accounts: ['example-org'], gates: createGates() });
    expect((await call('github_set_default_account', low, { account: 'example-org', confirm: true })).status).toBe('refused');
  });
  it('does not pretend when the account is unknown to the server', async () => {
    const w = await world();
    w.ctx.connection = Object.freeze({ ...w.connection, accounts: Object.freeze(['example-org', 'ghost']) });
    const res = await call('github_set_default_account', w, { account: 'ghost', confirm: true });
    expect(['refused', 'rejected']).toContain(res.status);
    expect((await w.db.getAccessToken('access-client-1')).default_account).toBe('example-org');
  });
});

describe('github_revoke_connection', () => {
  it('always asks, warns when it is this very connection, then switches only that login off', async () => {
    const w = await world();
    await login(w.db, 'client-2', 'Codex', ['example-user']);
    const first = await call('github_revoke_connection', w, { connection: 'client-2', dryRun: true });
    expect(first.status).toBe('preview');
    expect(await w.db.getAccessToken('access-client-2')).not.toBeNull();
    const own = await call('github_revoke_connection', w, { connection: 'client-1', dryRun: true });
    expect(own.preview).toContain('THIS is the connection');
    const done = await call('github_revoke_connection', w, { connection: 'client-2', confirm: true });
    expect(done.status).toBe('applied');
    expect(await w.db.getAccessToken('access-client-2')).toBeNull();
    expect(await w.db.getAccessToken('access-client-1')).not.toBeNull();
  });
  it('cannot switch off a login that reaches accounts this connection cannot, or one that does not exist', async () => {
    const w = await world();
    await login(w.db, 'client-3', 'Elsewhere', ['example-org', 'unrelated-org']);
    for (const connection of ['client-3', 'nobody']) {
      const res = await call('github_revoke_connection', w, { connection, confirm: true });
      expect(['rejected', 'refused', 'uncertain']).toContain(res.status);
      expect(res.status).not.toBe('applied');
    }
    expect(await w.db.getAccessToken('access-client-3')).not.toBeNull();
  });
  it('is refused below the full profile', async () => {
    const w = await makeWorld({ profile: 'everyday', accounts: ['example-org'], gates: createGates() });
    expect((await call('github_revoke_connection', w, { connection: 'x', confirm: true })).status).toBe('refused');
  });
});

describe('github_recent_changes', () => {
  const base = { mode: 'production', connection: 'client-1', tool: 'github_x_write', summary: 'Did a thing', dryRun: false };
  it('lists newest first for the connection\'s own accounts only, hides previews, and shows cost and marks', async () => {
    const w = await world();
    await w.db.recordChange({ ...base, account: 'example-org', repo: 'example-org/a', summary: 'one', spendCents: 1900, confirmed: true });
    await w.db.recordChange({ ...base, account: 'unrelated-org', repo: 'unrelated-org/b', summary: 'not yours' });
    await w.db.recordChange({ ...base, account: 'example-org', repo: 'example-org/a', summary: 'two', accessWidening: true, notifies: ['outsider'] });
    await w.db.recordChange({ ...base, account: 'example-org', repo: 'example-org/a', summary: 'only a preview', dryRun: true });
    const out = await call('github_recent_changes', w, {});
    expect(out.changes.map((c) => c.summary)).toEqual(['two', 'one']);
    expect(out.changes[0]).toMatchObject({ accessWidening: true, notifies: ['outsider'], mode: 'PRODUCTION' });
    expect(out.changes[1]).toMatchObject({ cost: '$19.00', confirmed: true });
    const withPreviews = await call('github_recent_changes', w, { includePreviews: true });
    expect(withPreviews.changes.map((c) => c.summary)).toEqual(['only a preview', 'two', 'one']);
    expect(withPreviews.changes[0].preview).toBe(true);
  });
  it('filters, limits, and rejects an account outside the connection or a bad date', async () => {
    const w = await world();
    await w.db.recordChange({ ...base, account: 'example-org', repo: 'example-org/a', summary: 'a1' });
    await w.db.recordChange({ ...base, account: 'example-user', repo: 'example-user/b', tool: 'github_y_write', summary: 'b1' });
    expect((await call('github_recent_changes', w, { repo: 'example-user/b' })).changes.map((c) => c.summary)).toEqual(['b1']);
    expect((await call('github_recent_changes', w, { tool: 'github_x_write' })).changes.map((c) => c.summary)).toEqual(['a1']);
    expect((await call('github_recent_changes', w, { limit: 1 })).count).toBe(1);
    expect((await call('github_recent_changes', w, { since: '2999-01-01' })).count).toBe(0);
    await expect(call('github_recent_changes', w, { account: 'unrelated-org' })).rejects.toThrow(/not one of the GitHub accounts/);
    await expect(call('github_recent_changes', w, { since: 'last tuesday-ish' })).rejects.toThrow(/since must be a date/);
  });
});

describe('the tool descriptions', () => {
  it('keep the listing short and the new tools are registered', () => {
    for (const t of tools) expect(t.description.length, t.name).toBeLessThanOrEqual(160);
    for (const name of ['github_list_connections', 'github_recent_changes', 'github_set_default_account', 'github_revoke_connection']) expect(tools.map((t) => t.name)).toContain(name);
  });
});
