// Own-store transport (RACK-STAGING S-1): the one place that decides how
// every store client in this server is built. Two drivers implement the
// exact handle contract all callers already use — the Neon driver's
// tagged-template interface:
//
//   - callable as a tagged template: sql`... ${value} ...` resolves to
//     an array of row objects, and the value it returns BEFORE being
//     awaited is a query object carrying { text, values } (the Neon
//     driver behaves the same way; src/tenancy/directory.js feeds such
//     objects to sql.transaction([...]));
//   - sql.query(text, values) runs a parameterized statement and
//     resolves to an array of row objects;
//   - sql.transaction([query, ...]) runs the queries in ONE database
//     transaction and resolves to one row-array per query, in order;
//   - sql.end() releases the underlying pool (idempotent).
//
//   neon — the @neondatabase/serverless HTTP driver. This is the
//     behavior production has always had; the branch returns the
//     driver's own handle untouched.
//   pg — a pooled node-postgres client for a plain Postgres store (the
//     Development Rack). The Neon HTTP driver cannot serve a plain
//     Postgres, so the rack instance selects this path. Per-tenant
//     scoping is preserved exactly: when the connection string carries
//     the tenant `options=-c search_path=<schema>` parameter (see
//     tenantConnectionString in src/tenancy/directory.js), every query
//     runs inside a transaction that first runs the same
//     transaction-local set_config('search_path', <schema>, true) the
//     Neon path runs — never a pooled SET, never public in the path —
//     so assertTenantSearchPath's proof holds unchanged.
//
// Selection (selectStoreTransport):
//   1. An explicit STORE_TRANSPORT of "neon" or "pg" wins; any other
//      value is a configuration error and throws. The rack enrollment
//      sets STORE_TRANSPORT=pg.
//   2. Otherwise a *.neon.tech host keeps the Neon driver, and the
//      rack's own Postgres hostnames (rack-postgres, postgres) select
//      pg. Every other host keeps the Neon driver — deliberately:
//      this repo's test suites pin the Neon HTTP serializer against
//      fixture hosts (tests/unit + tests/db tenant-http-namespace),
//      and production behavior without the switch must not change.
import { neon } from '@neondatabase/serverless';
import pg from 'pg';

export const STORE_TRANSPORTS = Object.freeze(['neon', 'pg']);
const PG_HOSTNAMES = new Set(['rack-postgres', 'postgres']);

export function isNeonStoreUrl(url) {
  try {
    return new URL(url).hostname.toLowerCase().endsWith('.neon.tech');
  } catch {
    return false;
  }
}

export function selectStoreTransport(env = process.env, url = env.DATABASE_URL) {
  const declared = String(env.STORE_TRANSPORT ?? '').trim().toLowerCase();
  if (declared) {
    if (!STORE_TRANSPORTS.includes(declared)) {
      throw new Error('STORE_TRANSPORT must be "neon" or "pg" when set.');
    }
    return declared;
  }
  if (isNeonStoreUrl(url)) return 'neon';
  try {
    if (PG_HOSTNAMES.has(new URL(url).hostname.toLowerCase())) return 'pg';
  } catch { /* an unparseable URL keeps the historical driver */ }
  return 'neon';
}

const pools = new Map();

function searchPathFromUrl(url) {
  try {
    const options = new URL(url).searchParams.get('options') ?? '';
    const match = /(?:^|\s)-c\s+search_path=([A-Za-z0-9_]+)/.exec(options);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function poolFor(url) {
  let entry = pools.get(url);
  if (!entry) {
    // The tenant options parameter is applied per transaction by this
    // module (set_config), never as a startup parameter, so it is
    // stripped before the string reaches node-postgres.
    let connectionString = url;
    try {
      const parsed = new URL(url);
      if (parsed.searchParams.has('options')) {
        parsed.searchParams.delete('options');
        connectionString = parsed.toString();
      }
    } catch { /* keep the caller's string untouched */ }
    entry = {
      pool: new pg.Pool({ connectionString, max: 5, idleTimeoutMillis: 30_000 }),
      ended: false,
    };
    pools.set(url, entry);
  }
  return entry;
}

// One lazy query object: building it runs nothing; awaiting it runs it
// once (memoized), exactly like the Neon driver's query objects, and
// sql.transaction([...]) can consume the same object for its
// { text, values }.
function lazyQuery(executor, text, values) {
  let running = null;
  const run = () => (running ??= executor(text, values));
  return {
    text,
    values,
    then: (ok, bad) => run().then(ok, bad),
    catch: (bad) => run().catch(bad),
    finally: (f) => run().finally(f),
  };
}

export function pgStoreSql(url) {
  const entry = poolFor(url);
  const { pool } = entry;
  const searchPath = searchPathFromUrl(url);

  const runOn = async (client, text, values) => (await client.query(text, values)).rows;
  const runScoped = async (text, values) => {
    if (!searchPath) return runOn(pool, text, values);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('search_path', $1, true)", [searchPath]);
      const rows = await runOn(client, text, values);
      await client.query('COMMIT');
      return rows;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  };

  const sql = (strings, ...values) => {
    let text = strings[0];
    for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1]}`;
    return lazyQuery(runScoped, text, values);
  };
  sql.query = async (text, values = []) => runScoped(text, values);
  sql.transaction = async (queries) => {
    if (!Array.isArray(queries)) throw new TypeError('transaction needs an array of queries.');
    for (const q of queries) {
      if (!q || typeof q.text !== 'string' || !Array.isArray(q.values)) {
        throw new TypeError('transaction entries must be query objects from this handle.');
      }
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (searchPath) {
        await client.query("SELECT set_config('search_path', $1, true)", [searchPath]);
      }
      const out = [];
      for (const q of queries) out.push(await runOn(client, q.text, q.values));
      await client.query('COMMIT');
      return out;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  };
  sql.end = async () => {
    if (entry.ended) return;
    entry.ended = true;
    pools.delete(url);
    await pool.end();
  };
  return sql;
}

// The store factory every construction site uses in place of the Neon
// driver's own neon(): the same call shape (a URL in, a tagged-template
// handle out), with the transport selected as documented above. A
// missing URL keeps the historical failure: the Neon driver throws its
// own configuration error, exactly as before this module existed.
export function storeFactory(url, env = process.env) {
  if (typeof url !== 'string' || !url) return neon(url);
  return selectStoreTransport(env, url) === 'neon' ? neon(url) : pgStoreSql(url);
}

export function storeSql(env = process.env) {
  return storeFactory(env.DATABASE_URL, env);
}
