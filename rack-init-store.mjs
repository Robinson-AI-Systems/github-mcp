#!/usr/bin/env node
// Rack store init (the registry migration command): boots the
// server's own self-migration against the store named by
// DATABASE_URL, through the pg transport (STORE_TRANSPORT=pg is set
// by this command's environment on the rack). This server's schema
// has no migration files — it creates itself, additively, from three
// homes (dossier §2.2):
//
//   - src/db.js initSchema() — the 32 owner-store tables;
//   - src/tenancy/directory.js initSchema() — the 15 tenancy
//     directory tables in the public schema;
//   - src/marketplace/store.js initMarketplaceSchema() — the 5
//     marketplace tables.
//
// Every statement is CREATE ... IF NOT EXISTS, so running this
// command against an initialized store is a no-op proof, not a
// change. Per-tenant schemas (gh_t_<uuid>) are NOT created here:
// they are created per tenant on first open by the server itself
// (openAuthorizedTenantDb), exactly as in production.
import { createDb } from './src/db.js';
import { storeFactory } from './src/db-transport.js';
import { createTenantDirectory } from './src/tenancy/directory.js';
import { initMarketplaceSchema } from './src/marketplace/store.js';

process.env.STORE_TRANSPORT = process.env.STORE_TRANSPORT || 'pg';

const url = process.env.DATABASE_URL;
if (!url?.startsWith('postgres')) {
  console.error('DATABASE_URL is not configured');
  process.exit(1);
}

const sql = storeFactory(url);
try {
  const db = createDb(sql);
  await db.initSchema();
  const tables = await db.listTables();
  await createTenantDirectory(sql).initSchema();
  await initMarketplaceSchema(sql);
  console.log(`rack store init complete: owner tables visible = ${tables.length}`);
} finally {
  await sql.end?.().catch(() => {});
}
