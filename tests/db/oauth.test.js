import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, CONNECTION_FIELDS } from '../../src/db.js';
import { evaluateLogin, hashToken, MAX_FAILED_LOGINS } from '../../src/core/oauth.js';
import { openIsolatedSchema, closeIsolatedSchema, neonShapedQuery, rawQuery } from '../../test/helpers/pg-neon-adapter.js';
import { runOAuthContract } from '../../test/contract/oauth-contract.js';

let db;
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL must point to disposable localhost Postgres (npm run test:db)');
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(process.env.TEST_DATABASE_URL).hostname)) throw new Error('Refusing non-local Postgres in tests');
  await openIsolatedSchema(process.env.TEST_DATABASE_URL);
  db = createDb(neonShapedQuery());
  await db.initSchema();
});
afterAll(async () => { await closeIsolatedSchema(); });
beforeEach(async () => { await rawQuery('TRUNCATE oauth_clients, oauth_codes, oauth_tokens, login_attempts, gh_accounts'); });

describe('FORK-CI-1 durable approval request claims in real PostgreSQL', () => {
  it('allows one concurrent claim and replays a confirmed duplicate without a second provider operation', async () => {
    const requestKey = 'rmcp_fork_ci_postgres_claim_20261026';
    const change = { account: 'example-org', repo: 'hello', mode: 'preview', connection: 'owner-client',
      tool: 'github_actions_approve_fork_run', target: 'example-org/hello run 9',
      summary: 'Approve reviewed fork PR #23 run #9', requestKey };
    const claims = await Promise.all(Array.from({ length: 8 }, () => db.claimChange(change)));
    const winners = claims.filter((x) => x.claimed);
    expect(winners).toHaveLength(1);
    expect(claims.filter((x) => !x.claimed)).toHaveLength(7);
    await db.finishChange(winners[0].id, { summary: change.summary, confirmed: true, after: { run_id: 9 } });
    expect(await db.claimChange(change)).toMatchObject({ claimed: false, existing: { confirmed: true } });
    const rows = await rawQuery('SELECT count(*)::int AS n FROM change_log WHERE request_key = $1', [requestKey]);
    expect(rows[0].n).toBe(1);
  });
});

runOAuthContract('isolated PostgreSQL', async () => ({
  ...db,
  async seedAccounts(list) {
    let id = 0;
    for (const a of list) {
      await rawQuery('INSERT INTO gh_accounts (login, account_id, account_type, label, production_enabled, is_default) VALUES ($1, $2, $3, $4, $5, $6)',
        [a.login, ++id, 'Organization', a.label, a.production_enabled, a.is_default]);
    }
  }
}));

describe('connector login store on throwaway Postgres only', () => {
  const scope = { defaultAccount: 'example-org', accounts: ['example-org'], mode: 'preview', profile: 'everyday', listing: 'catalog' };

  it('never stores a client secret, code, access token or refresh token in plain text', async () => {
    await db.createOAuthClient({ clientId: 'client-1', clientSecret: 'fixture-secret-not-real', redirectUris: ['https://example.test/cb'] });
    await db.createAuthCode({ code: 'code-plain-fixture', clientId: 'client-1', redirectUri: 'https://example.test/cb', codeChallenge: 'Z'.repeat(43), ...scope });
    await db.createAccessToken({ accessToken: 'access-plain-fixture', refreshToken: 'refresh-plain-fixture', clientId: 'client-1', ...scope });
    const dump = JSON.stringify([
      await rawQuery('SELECT * FROM oauth_clients'), await rawQuery('SELECT * FROM oauth_codes'), await rawQuery('SELECT * FROM oauth_tokens')
    ]);
    for (const plain of ['fixture-secret-not-real', 'code-plain-fixture', 'access-plain-fixture', 'refresh-plain-fixture']) expect(dump).not.toContain(plain);
    expect((await rawQuery('SELECT code FROM oauth_codes'))[0].code).toBe(hashToken('code-plain-fixture'));
    const [token] = await rawQuery('SELECT token_hash, refresh_hash FROM oauth_tokens');
    expect(token).toEqual({ token_hash: hashToken('access-plain-fixture'), refresh_hash: hashToken('refresh-plain-fixture') });
  });

  it('fails if oauth_codes or oauth_tokens gain a column that is neither a connection setting nor a listed non-setting (so a new setting cannot be dropped on refresh)', async () => {
    const NON_SETTINGS = {
      oauth_codes: ['code', 'client_id', 'data', 'expires_at'],
      oauth_tokens: ['token_hash', 'client_id', 'refresh_hash', 'kind', 'expires_at', 'last_used_at', 'revoked_at', 'created_at', 'prev_refresh_hash', 'rotated_at']
    };
    for (const [table, allowed] of Object.entries(NON_SETTINGS)) {
      const columns = (await rawQuery('SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1', [table])).map((r) => r.column_name);
      expect(columns.filter((c) => !CONNECTION_FIELDS.includes(c) && !allowed.includes(c))).toEqual([]);
      for (const field of CONNECTION_FIELDS) expect(columns).toContain(field);
    }
  });

  it('stores the account list as a real text array and the settings exactly as given', async () => {
    await db.createAccessToken({ accessToken: 'a', refreshToken: 'r', clientId: 'c', defaultAccount: 'b', accounts: ['a', 'b', 'c'], mode: 'production', profile: 'full', listing: 'compact' });
    const [row] = await rawQuery('SELECT accounts, pg_typeof(accounts)::text AS type, default_account, mode, profile, listing FROM oauth_tokens');
    expect(row).toEqual({ accounts: ['a', 'b', 'c'], type: 'text[]', default_account: 'b', mode: 'production', profile: 'full', listing: 'compact' });
  });

  it('counts a lockout in Postgres: five wrong passphrases lock the address, other addresses stay open', async () => {
    for (let n = 0; n < MAX_FAILED_LOGINS; n++) {
      expect((await evaluateLogin({ ip: '192.0.2.50', supplied: 'wrong', expected: 'correct', store: db })).status).toBe('wrong');
    }
    expect((await evaluateLogin({ ip: '192.0.2.50', supplied: 'correct', expected: 'correct', store: db })).status).toBe('locked');
    expect((await evaluateLogin({ ip: '192.0.2.51', supplied: 'correct', expected: 'correct', store: db })).status).toBe('ok');
    expect(Number((await rawQuery(`SELECT count(*) FROM login_attempts WHERE ip = '192.0.2.50' AND success = FALSE`))[0].count)).toBe(MAX_FAILED_LOGINS + 1);
    expect((await rawQuery(`SELECT success FROM login_attempts WHERE ip = '192.0.2.51'`))[0].success).toBe(true);
  });
});

describe('owner connection compatibility flags on PostgreSQL',()=>{
  it('upgrades a full personal non-scratch connection despite a legacy production-off preference, retaining exact client and credential checks',async()=>{
    await db.upsertAccount({login:'example-user',accountId:97431,accountType:'User',label:'Owner',credentialKind:'app',appId:97432});
    await db.setInstallation('example-user',{installationId:97433,repositorySelection:'all',permissions:{contents:'write'},status:'active'});
    await db.createOAuthClient({clientId:'owner-mode-client',clientSecret:'fixture-owner-mode-secret',redirectUris:['https://example.test/cb']});
    const token={clientId:'owner-mode-client',accessToken:'fixture-owner-mode-access',refreshToken:'fixture-owner-mode-refresh',
      defaultAccount:'example-user',accounts:['example-user'],mode:'preview',profile:'full',listing:'compact'};
    await db.createAccessToken(token);
    expect((await db.getAccount('example-user')).production_enabled).toBe(false);
    await db.setInstallationStatus('example-user','suspended');
    expect(await db.upgradeConnectionProductionMode(token.clientId,'example-user')).toBe(0);
    await db.setInstallationStatus('example-user','active');
    expect(await db.upgradeConnectionProductionMode('wrong-client','example-user')).toBe(0);
    expect(await db.upgradeConnectionProductionMode(token.clientId,'example-user')).toBe(1);
    expect(await db.getAccessToken(token.accessToken)).toMatchObject({profile:'full',mode:'production',accounts:['example-user']});
    await db.setConnectionsReadOnly(true);
    expect(await db.getAccessToken(token.accessToken)).toMatchObject({profile:'read_only',mode:'preview'});
    await db.setConnectionsReadOnly(false);
    expect(await db.getAccessToken(token.accessToken)).toMatchObject({profile:'full',mode:'production'});
  });
});
