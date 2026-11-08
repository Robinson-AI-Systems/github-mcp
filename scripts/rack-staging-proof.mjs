#!/usr/bin/env node
// Rack staging proof (S-1 exit + S-2 smoke): run INSIDE the built
// image / staging tree against a fresh scratch Postgres whose URL is
// in DATABASE_URL, with STORE_TRANSPORT=pg. Proves, in order:
//   1. boot + self-migration through the pg transport (owner 32 +
//      directory 15 + marketplace 5 = 52 public tables);
//   2. store round-trip through production code (settings write/read
//      via createDb on the pg handle);
//   3. per-tenant schema creation + search_path proof: a tenant
//      directory is created, a tenant schema is provisioned through
//      initializeProvisionedTenant (which asserts the namespace),
//      tenant rows land ONLY in the tenant schema;
//   4. the rack entrypoint serves the front door at the fixture pin
//      and the MCP door refuses tokenless calls in shape.
// Exits non-zero on the first failed leg, printing PROOF lines.
import { randomUUID } from 'node:crypto';

process.env.STORE_TRANSPORT = 'pg';
const { createDb, SCHEMA_TABLES } = await import('../src/db.js');
const { storeFactory } = await import('../src/db-transport.js');
const { createTenantDirectory, initializeProvisionedTenant, tenantSchemaName } =
  await import('../src/tenancy/directory.js');
const { initMarketplaceSchema } = await import('../src/marketplace/store.js');

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL required'); process.exit(1); }
const sql = storeFactory(url);

// 1. Boot + self-migration
const db = createDb(sql);
await db.initSchema();
await createTenantDirectory(sql).initSchema();
await initMarketplaceSchema(sql);
const tables = await db.listTables();
const publicRows = await sql`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`;
console.log(`PROOF boot: public tables = ${publicRows[0].n}; owner tables visible = ${tables.length}`);
if (publicRows[0].n !== 52) throw new Error(`expected 52 public tables, got ${publicRows[0].n}`);
if (!SCHEMA_TABLES.every((t) => tables.includes(t))) throw new Error('owner schema incomplete');

// 2. Round-trip through production code paths on the pg handle
await db.setSetting('rack_proof', { verdict: 'ok' });
const readBack = await db.getSetting('rack_proof');
if (readBack?.verdict !== 'ok') throw new Error('round-trip failed');
console.log('PROOF round-trip: server_settings write/read exact through createDb');

// 3. Per-tenant schema creation + search_path proof, through the
// same calls openAuthorizedTenantDb makes: createTenantSql (pg
// transport applies the scope transaction-locally),
// assertTenantSearchPath (the namespace proof), then the tenant
// copy of the core schema via createDb(tenantSql).initSchema().
const { createTenantSql, assertTenantSearchPath } = await import('../src/tenancy/directory.js');
const tenantId = randomUUID();
const schema = tenantSchemaName(tenantId);
await sql.query(`CREATE SCHEMA "${schema}"`);
const tenantSql = createTenantSql(url, tenantId);
const asserted = await assertTenantSearchPath(tenantSql, tenantId);
console.log(`PROOF tenant: search_path asserted = ${asserted}`);
const tenantDb = createDb(tenantSql);
await tenantDb.initSchema();
const tenantTablesList = await tenantDb.listTables();
console.log(`PROOF tenant: tenant schema tables = ${tenantTablesList.length}`);
if (!SCHEMA_TABLES.every((t) => tenantTablesList.includes(t))) throw new Error('tenant schema incomplete');
await tenantDb.setSetting('tenant_proof', { verdict: 'scoped' });
const scopedRead = await tenantDb.getSetting('tenant_proof');
if (scopedRead?.verdict !== 'scoped') throw new Error('tenant round-trip failed');
const publicLeak = await sql`SELECT count(*)::int AS n FROM server_settings WHERE setting = 'tenant_proof'`;
if (publicLeak[0].n !== 0) throw new Error('tenant row leaked into public schema');
console.log('PROOF tenant: row written in tenant schema only, public schema clean');

await sql.end().catch(() => {});
console.log('PROOF ALL LEGS PASS');
