import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { openIsolatedSchema, closeIsolatedSchema, rawQuery, neonShapedQuery } from '../../test/helpers/pg-neon-adapter.js';
import { SCHEMA_TABLES, createDb } from '../../src/db.js';

// Column names that look secret-like but hold no secret: lookup keys, hashes, and expiry timestamps.
const NON_SECRET_COLUMNS = new Set([
  'scope_key', 'installation_key', 'request_key', 'url_key', 'token_hash', 'refresh_hash',
  // GIT-REMOTE-1: the public id of a git remote key row (the key itself is only ever stored as key_hash).
  'key_id',
  'user_token_expires_at', 'user_refresh_expires_at',
  // Non-sensitive refresh coordination metadata, never OAuth token material.
  'user_refresh_claim', 'user_refresh_claim_expires_at'
]);
const SECRET_LOOKING = /token|secret|key|pem|refresh|verifier/;

let db;
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL must point to disposable localhost Postgres (npm run test:db)');
  const url = new URL(process.env.TEST_DATABASE_URL);
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)) throw new Error('Refusing non-local Postgres in tests');
  await openIsolatedSchema(process.env.TEST_DATABASE_URL);
  db = createDb(neonShapedQuery());
  await db.initSchema();
});
afterAll(async () => { await closeIsolatedSchema(); });

const columns = () => rawQuery(
  `SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns
   WHERE table_schema = current_schema() ORDER BY table_name, ordinal_position`);
const indexes = () => rawQuery(`SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = current_schema() ORDER BY tablename, indexname`);

describe('foundation schema on throwaway Postgres', () => {
  it('creates exactly the 13 foundation tables', async () => {
    const tables = (await rawQuery(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' ORDER BY table_name`
    )).map((row) => row.table_name);
    expect(tables).toEqual([...SCHEMA_TABLES].sort());
    expect(await db.listTables()).toEqual([...SCHEMA_TABLES].sort());
  });

  it('is idempotent: a second initSchema changes no column or index and keeps existing rows', async () => {
    await rawQuery(`INSERT INTO gh_write_slots (installation_key) VALUES ('keep-me')`);
    const before = { columns: await columns(), indexes: await indexes() };
    await db.initSchema();
    expect({ columns: await columns(), indexes: await indexes() }).toEqual(before);
    expect(await rawQuery(`SELECT installation_key FROM gh_write_slots`)).toEqual([{ installation_key: 'keep-me' }]);
  });

  it('creates the change_log request-key index over (request_key, at)', async () => {
    const [index] = (await indexes()).filter((row) => row.indexname === 'change_log_request_key');
    expect(index).toBeDefined();
    expect(index.tablename).toBe('change_log');
    expect(index.indexdef).toMatch(/\(request_key, at\)/);
  });

  it('gives gh_accounts safe defaults (app credential, no installation, production off, zero spend)', async () => {
    await rawQuery(`INSERT INTO gh_accounts (login, account_id, account_type, label) VALUES ('example-org', 1, 'Organization', 'Example')`);
    const [row] = await rawQuery(`SELECT * FROM gh_accounts WHERE login = 'example-org'`);
    expect(row).toMatchObject({
      credential_kind: 'app', installation_status: 'none', production_enabled: false, spend_limit_cents: 0,
      is_default: false, is_scratch: false, user_token_enc: null, fine_grained_enc: null, classic_enc: null
    });
    expect(row.added_at).toBeInstanceOf(Date);
  });

  it('defaults connections to preview mode, everyday profile, catalog listing, connector kind', async () => {
    await rawQuery(`INSERT INTO oauth_codes (code, client_id, data, expires_at) VALUES ('c1', 'cl', '{}', now())`);
    await rawQuery(`INSERT INTO oauth_tokens (token_hash) VALUES ('hash1')`);
    const [code] = await rawQuery(`SELECT mode, profile, listing FROM oauth_codes WHERE code = 'c1'`);
    const [token] = await rawQuery(`SELECT mode, profile, listing, kind, revoked_at FROM oauth_tokens WHERE token_hash = 'hash1'`);
    expect(code).toEqual({ mode: 'preview', profile: 'everyday', listing: 'catalog' });
    expect(token).toEqual({ mode: 'preview', profile: 'everyday', listing: 'catalog', kind: 'connector', revoked_at: null });
  });

  it('gives change_log and the rate and write-slot tables their defaults', async () => {
    await rawQuery(`INSERT INTO change_log (tool, summary) VALUES ('github_example', 'example change')`);
    const [log] = await rawQuery(`SELECT dry_run, production, access_widening, confirmed, undone_by FROM change_log`);
    expect(log).toEqual({ dry_run: false, production: false, access_widening: false, confirmed: null, undone_by: null });
    await rawQuery(`INSERT INTO login_attempts (ip, success) VALUES ('203.0.113.9', false)`);
    expect((await rawQuery(`SELECT id::int AS id FROM login_attempts`))[0].id).toBeGreaterThan(0);
    await rawQuery(`INSERT INTO gh_rate_state (account, resource) VALUES ('example-org', 'core')`);
    await expect(rawQuery(`INSERT INTO gh_rate_state (account, resource) VALUES ('example-org', 'core')`)).rejects.toThrow(/duplicate key/);
  });

  it('enforces the keys that make the schema safe (unique account id, one installation token per scope)', async () => {
    await expect(rawQuery(`INSERT INTO gh_accounts (login, account_id, account_type, label) VALUES ('other', 1, 'User', 'Dup id')`)).rejects.toThrow(/duplicate key/);
    await rawQuery(`INSERT INTO gh_installation_tokens (installation_id, scope_key, token_enc, expires_at) VALUES (7, 'full', 'FAKE-ciphertext', now())`);
    await expect(rawQuery(`INSERT INTO gh_installation_tokens (installation_id, scope_key, token_enc, expires_at) VALUES (7, 'full', 'FAKE-ciphertext', now())`)).rejects.toThrow(/duplicate key/);
  });

  it('has no plaintext secret column: every secret-looking column is ciphertext (_enc), a hash (_hash) or on the explicit allow-list', async () => {
    const offenders = (await columns())
      .filter(({ column_name: name }) => SECRET_LOOKING.test(name))
      .filter(({ column_name: name }) => !(name.endsWith('_enc') || name.endsWith('_hash') || NON_SECRET_COLUMNS.has(name)))
      .map(({ table_name: table, column_name: name }) => `${table}.${name}`);
    expect(offenders).toEqual([]);
    const secretColumns = (await columns()).filter(({ column_name: name }) => name.endsWith('_enc') || name.endsWith('_hash'));
    expect(secretColumns.length).toBeGreaterThanOrEqual(11);
    for (const { data_type: type } of secretColumns) expect(type).toBe('text');
  });
});
