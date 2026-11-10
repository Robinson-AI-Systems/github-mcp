// GIT-REMOTE-1: the git remote key store, held to one contract by the fake and real PostgreSQL.
// Hashes only; a code is exchanged once and only while live; revocation and expiry end a key;
// each broker nonce is accepted once; uses are logged and counted.
import { describe, it, expect } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';

const h = v => createHash('sha256').update(v).digest('hex');
const id = () => randomBytes(16).toString('hex');
export function runGitRemoteStoreContract(label, getDb, { now = () => Date.now() } = {}) {
 describe(`git remote key store (${label})`, () => {
  const make = async (db, extra = {}) => {
   const key = { id: id(), connection: 'client-1', owner: 'example-org', repo: 'hello', access: 'write', codeHash: h('code-' + randomBytes(4).toString('hex')), codeExpiresAt: new Date(now() + 600000), expiresAt: new Date(now() + 8 * 3600000), ...extra };
   const row = await db.createGitRemoteKey(key);
   return { key, row };
  };
  it('stores no secret, exchanges a live code exactly once, and keeps only the key hash', async () => {
   const db = await getDb();
   const { key, row } = await make(db);
   expect(row).toMatchObject({ id: key.id, owner: 'example-org', repo: 'hello', access: 'write', exchanged_at: null, revoked_at: null, uses: 0 });
   expect(JSON.stringify(row)).not.toContain(key.codeHash);
   expect(await db.exchangeGitRemoteCode({ id: key.id, codeHash: h('wrong'), keyHash: h('k') })).toBeNull();
   const done = await db.exchangeGitRemoteCode({ id: key.id, codeHash: key.codeHash, keyHash: h('k1') });
   expect(done).toMatchObject({ id: key.id, owner: 'example-org', repo: 'hello', access: 'write' });
   expect(await db.exchangeGitRemoteCode({ id: key.id, codeHash: key.codeHash, keyHash: h('k2') })).toBeNull();
   const stored = await db.getGitRemoteKey(key.id);
   expect(stored.key_hash).toBe(h('k1'));
   expect(stored).not.toHaveProperty('code_hash');
  });
  it('refuses an expired code, and lists only live keys (not revoked, not expired)', async () => {
   const db = await getDb();
   const late = await make(db, { codeExpiresAt: new Date(now() - 1000) });
   expect(await db.exchangeGitRemoteCode({ id: late.key.id, codeHash: late.key.codeHash, keyHash: h('x') })).toBeNull();
   const old = await make(db, { expiresAt: new Date(now() - 1000) });
   const live = await make(db, { connection: 'client-2' });
   const ids = (await db.listGitRemoteKeys({ limit: 200 })).map(r => r.id);
   expect(ids).toContain(live.key.id); expect(ids).not.toContain(old.key.id);
   expect((await db.listGitRemoteKeys({ connection: 'client-2' })).map(r => r.id)).toEqual([live.key.id]);
   expect(JSON.stringify(await db.listGitRemoteKeys({ limit: 200 }))).not.toMatch(/key_hash|code_hash/);
  });
  it('revokes once (optionally only for its own connection); a revoked code cannot be exchanged', async () => {
   const db = await getDb();
   const { key } = await make(db);
   expect(await db.revokeGitRemoteKey(key.id, { connection: 'someone-else' })).toBeNull();
   expect(await db.revokeGitRemoteKey(key.id)).toMatchObject({ id: key.id });
   expect(await db.revokeGitRemoteKey(key.id)).toBeNull();
   expect(await db.exchangeGitRemoteCode({ id: key.id, codeHash: key.codeHash, keyHash: h('k') })).toBeNull();
   expect((await db.getGitRemoteKey(key.id)).revoked_at).not.toBeNull();
   expect((await db.listGitRemoteKeys({ limit: 200 })).map(r => r.id)).not.toContain(key.id);
  });
  it('logs every use, counts allowed ones, and accepts each nonce once', async () => {
   const db = await getDb();
   const { key } = await make(db);
   const nonce = randomBytes(16).toString('hex') + '.push';
   expect(await db.recordGitRemoteUse({ keyId: key.id, service: 'fetch.refs', outcome: 'allowed' })).toBe(true);
   expect(await db.recordGitRemoteUse({ keyId: key.id, service: 'broker.push', outcome: 'started', nonce })).toBe(true);
   expect(await db.recordGitRemoteUse({ keyId: key.id, service: 'broker.push', outcome: 'started', nonce })).toBe(false);
   expect(await db.recordGitRemoteUse({ keyId: key.id, service: 'push.refs', outcome: 'refused:read_only_key', detail: 'x'.repeat(500) })).toBe(true);
   await expect(db.recordGitRemoteUse({ keyId: key.id, service: 'Bad Service', outcome: 'allowed' })).rejects.toThrow();
   const uses = await db.listGitRemoteUses(key.id);
   expect(uses.map(u => [u.service, u.outcome])).toEqual([['push.refs', 'refused:read_only_key'], ['broker.push', 'started'], ['fetch.refs', 'allowed']]);
   expect(uses[0].detail.length).toBe(200);
   const row = await db.getGitRemoteKey(key.id);
   expect(row.uses).toBe(1); expect(row.last_used_at).not.toBeNull();
  });
  it('quietly renews a used key: later, never earlier, capped from creation, not when revoked or expired, at most every 30 minutes', async () => {
   const db = await getDb();
   const { key } = await make(db, { expiresAt: new Date(now() + 3600000) });
   const renewed = await db.renewGitRemoteKey(key.id, { windowHours: 8, capDays: 7 });
   expect(new Date(renewed).getTime()).toBeGreaterThan(now() + 7 * 3600000);
   expect(new Date(renewed).getTime()).toBeLessThanOrEqual(now() + 8 * 3600000 + 5000);
   expect(await db.renewGitRemoteKey(key.id, { windowHours: 8, capDays: 7 })).toBeNull(); // just renewed: nothing to do
   const capped = await make(db, { expiresAt: new Date(now() + 3600000) });
   const got = await db.renewGitRemoteKey(capped.key.id, { windowHours: 24, capDays: 1 });
   expect(new Date(got).getTime()).toBeLessThanOrEqual(now() + 86400000 + 5000); // never past creation + cap
   const gone = await make(db);
   await db.revokeGitRemoteKey(gone.key.id);
   expect(await db.renewGitRemoteKey(gone.key.id, { windowHours: 8, capDays: 7 })).toBeNull();
   const old = await make(db, { expiresAt: new Date(now() - 1000) });
   expect(await db.renewGitRemoteKey(old.key.id, { windowHours: 8, capDays: 7 })).toBeNull();
   expect(await db.renewGitRemoteKey('../etc', { windowHours: 8, capDays: 7 })).toBeNull();
   expect(await db.renewGitRemoteKey(key.id, { windowHours: 99, capDays: 7 })).toBeNull();
  });
  it('refuses malformed input', async () => {
   const db = await getDb();
   await expect(db.createGitRemoteKey({ id: 'nope', connection: 'c', owner: 'o', repo: 'r', access: 'write', codeHash: h('x'), codeExpiresAt: new Date(), expiresAt: new Date() })).rejects.toThrow();
   await expect(db.createGitRemoteKey({ id: id(), connection: 'c', owner: 'o', repo: 'r', access: 'admin', codeHash: h('x'), codeExpiresAt: new Date(), expiresAt: new Date() })).rejects.toThrow();
   expect(await db.getGitRemoteKey('../etc')).toBeNull();
  });
 });
}
