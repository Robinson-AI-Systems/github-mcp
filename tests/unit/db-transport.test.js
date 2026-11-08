import { describe, expect, it } from 'vitest';
import {
  isNeonStoreUrl, selectStoreTransport, storeFactory, pgStoreSql
} from '../../src/db-transport.js';

// The pg half is exercised against real Postgres by the db suite and
// the rack staging battery (boot + self-migration on a scratch store);
// these unit tests pin the selection contract and the lazy query
// object's shape, which the Neon transaction call sites depend on.
describe('store transport selection (S-1)', () => {
  it('explicit STORE_TRANSPORT wins over the URL host', () => {
    expect(selectStoreTransport({ STORE_TRANSPORT: 'pg' }, 'postgresql://u:p@ep-x.neon.tech/db')).toBe('pg');
    expect(selectStoreTransport({ STORE_TRANSPORT: 'neon' }, 'postgresql://u:p@rack-postgres/db')).toBe('neon');
    expect(selectStoreTransport({ STORE_TRANSPORT: ' PG ' }, 'postgresql://u:p@rack-postgres/db')).toBe('pg');
  });
  it('refuses an unknown STORE_TRANSPORT value', () => {
    expect(() => selectStoreTransport({ STORE_TRANSPORT: 'sqlite' }, 'postgresql://u:p@rack-postgres/db'))
      .toThrow(/STORE_TRANSPORT must be "neon" or "pg"/);
  });
  it('keeps the Neon driver for Neon hosts and every unlisted host', () => {
    expect(selectStoreTransport({}, 'postgresql://u:p@ep-x-pooler.neon.tech/db')).toBe('neon');
    expect(selectStoreTransport({}, 'postgresql://fixture:fictional@example.com/fixture')).toBe('neon');
    expect(selectStoreTransport({}, 'postgresql://u:p@localhost:5432/db')).toBe('neon');
    expect(isNeonStoreUrl('postgresql://u:p@ep-x.neon.tech/db')).toBe(true);
    expect(isNeonStoreUrl('postgresql://u:p@example.com/db')).toBe(false);
  });
  it('selects pg for the rack Postgres hostnames', () => {
    expect(selectStoreTransport({}, 'postgresql://u:p@rack-postgres:5432/github_production')).toBe('pg');
    expect(selectStoreTransport({}, 'postgresql://u:p@postgres/github_production')).toBe('pg');
  });
  it('storeFactory returns the Neon handle untouched on the neon path', () => {
    const sql = storeFactory('postgresql://u:p@ep-x.neon.tech/db', {});
    expect(typeof sql).toBe('function');
    expect(typeof sql.transaction).toBe('function');
  });
});

describe('pg handle contract (no database: shape only)', () => {
  it('builds lazy query objects carrying text and values', () => {
    const sql = pgStoreSql('postgresql://u:p@rack-postgres:5432/shape_only');
    const q = sql`SELECT ${'a'} AS one, ${42} AS two`;
    expect(q.text).toBe('SELECT $1 AS one, $2 AS two');
    expect(q.values).toEqual(['a', 42]);
    expect(typeof q.then).toBe('function');
    expect(typeof sql.query).toBe('function');
    expect(typeof sql.transaction).toBe('function');
    expect(typeof sql.end).toBe('function');
  });
  it('transaction refuses entries that are not query objects', async () => {
    const sql = pgStoreSql('postgresql://u:p@rack-postgres:5432/shape_only');
    await expect(sql.transaction(['SELECT 1'])).rejects.toThrow(/array of queries|query objects/);
  });
});
