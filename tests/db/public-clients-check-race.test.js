// CHECK-RACE-1: several requests may start the public directory schema at once (each sign-in registration builds its own
// public-connect). The PUB-10 client_id check widening must not fail any of them, and the check must end up widened.
import crypto from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTenantDirectory } from '../../src/tenancy/directory.js';

const clients = [];
let ns, url;
const session = async () => {
  const c = new pg.Client({ connectionString: url }); await c.connect(); clients.push(c);
  await c.query('SET search_path TO "' + ns + '"');
  return async (template, ...values) => {
    let query = template[0];
    for (let i = 0; i < values.length; i++) query += '$' + (i + 1) + template[i + 1];
    return (await c.query(query, values)).rows;
  };
};
beforeAll(async () => {
  url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('Disposable TEST_DATABASE_URL is required.');
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url).hostname)) throw new Error('Refusing non-local PostgreSQL.');
  ns = 'github_check_race_' + crypto.randomBytes(6).toString('hex');
  const admin = await session(); await clients[0].query('CREATE SCHEMA "' + ns + '"'); await clients[0].query('SET search_path TO "' + ns + '"');
  await createTenantDirectory(admin).initSchema();
  // A store deployed before PUB-10 still has the narrow check.
  await clients[0].query('ALTER TABLE gh_public_clients DROP CONSTRAINT gh_public_clients_client_id_check');
  await clients[0].query("ALTER TABLE gh_public_clients ADD CONSTRAINT gh_public_clients_client_id_check CHECK (client_id ~ '^pcl_[A-Za-z0-9_-]{32,64}$')");
});
afterAll(async () => {
  await clients[0]?.query('DROP SCHEMA IF EXISTS "' + ns + '" CASCADE').catch(() => {});
  for (const c of clients.reverse()) await c.end().catch(() => {});
});

it('concurrent schema starts all succeed and leave the widened client_id check', async () => {
  for (let round = 0; round < 3; round++) {
    const sessions = await Promise.all(Array.from({ length: 6 }, session));
    const results = await Promise.allSettled(sessions.map((sql) => createTenantDirectory(sql).initSchema()));
    expect(results.filter((r) => r.status === 'rejected').map((r) => r.reason?.message)).toEqual([]);
  }
  const rows = (await clients[0].query("SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'gh_public_clients'::regclass AND conname = 'gh_public_clients_client_id_check'")).rows;
  expect(rows).toHaveLength(1);
  expect(rows[0].def).toContain('https://');
});
