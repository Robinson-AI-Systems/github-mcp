// GIT-REMOTE-1: git remote session keys on throwaway PostgreSQL (additive schema, same contract as the fake).
import { beforeAll, afterAll, it, expect } from 'vitest';
import { createDb } from '../../src/db.js';
import { openIsolatedSchema, closeIsolatedSchema, neonShapedQuery, rawQuery } from '../../test/helpers/pg-neon-adapter.js';
import { runGitRemoteStoreContract } from '../../test/contract/git-remote-store-contract.js';

let db;
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL must point to disposable localhost Postgres (npm run test:db)');
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(process.env.TEST_DATABASE_URL).hostname)) throw new Error('Refusing non-local Postgres in tests');
  await openIsolatedSchema(process.env.TEST_DATABASE_URL);
  db = createDb(neonShapedQuery());
  await db.initSchema();
  await db.initSchema(); // additive: a second run changes nothing
});
afterAll(async () => { await closeIsolatedSchema(); });

runGitRemoteStoreContract('isolated PostgreSQL', async () => db);

it('creates both tables and the lookup indexes', async () => {
  const tables = await db.listTables();
  expect(tables).toEqual(expect.arrayContaining(['git_remote_keys', 'git_remote_uses']));
  const indexes = (await rawQuery("SELECT indexname FROM pg_indexes WHERE tablename IN ('git_remote_keys','git_remote_uses')")).map(r => r.indexname);
  expect(indexes).toEqual(expect.arrayContaining(['git_remote_keys_connection', 'git_remote_uses_key']));
});
