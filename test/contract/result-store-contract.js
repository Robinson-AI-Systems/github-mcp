// Contract for the kept-result store (C-1): a big result lives behind a handle for 24 hours and only the connection that made it
// can read it. Run against the in-memory fake and real PostgreSQL.
import { describe, expect, it } from 'vitest';

const H1 = `res_${'a'.repeat(22)}`;
const H2 = `res_${'b'.repeat(22)}`;
const H3 = `res_${'c'.repeat(22)}`;

export function runResultStoreContract(name, make) {
  describe(`kept results: ${name}`, () => {
    it('keeps a body and its summary and reads them back for the same connection', async () => {
      const db = await make();
      const body = { items: [{ id: 1, text: 'héllo' }, { id: 2 }], total: 2 };
      await db.putResult({ handle: H1, connection: 'client-1', summary: '2 items', body });
      const got = await db.getResult(H1, 'client-1');
      expect(got).toMatchObject({ handle: H1, summary: '2 items', body });
      expect(new Date(got.expires_at).getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
    });

    it('retains a 25 KB minified UTF-8 file exactly for its owning connection', async () => {
      const db = await make();
      const content = 'x'.repeat(24990) + 'é😀';
      const body = { type: 'file', path: 'src/minified.js', content, sha: 'fixture-sha' };
      await db.putResult({ handle: H2, connection: 'client-1', body });
      expect((await db.getResult(H2, 'client-1')).body).toEqual(body);
      expect(Buffer.from((await db.getResult(H2, 'client-1')).body.content)).toEqual(Buffer.from(content));
      expect(await db.getResult(H2, 'client-2')).toBeNull();
    });

    it('does not show a result to another connection, an unknown handle, or a malformed one', async () => {
      const db = await make();
      await db.putResult({ handle: H1, connection: 'client-1', body: { a: 1 } });
      expect(await db.getResult(H1, 'client-2')).toBeNull();
      expect(await db.getResult(H2, 'client-1')).toBeNull();
      expect(await db.getResult('res_short', 'client-1')).toBeNull();
      expect(await db.getResult(undefined, 'client-1')).toBeNull();
      expect(await db.getResult(H1, '')).toBeNull();
    });

    it('does not offer an expired result and clears expired rows when the next one is kept', async () => {
      const db = await make();
      await db.putResult({ handle: H1, connection: 'client-1', body: { old: true }, ttlSeconds: -5 });
      expect(await db.getResult(H1, 'client-1')).toBeNull();
      await db.putResult({ handle: H2, connection: 'client-1', body: { fresh: true } });
      await db.putResult({ handle: H1, connection: 'client-1', body: { again: true } });
      expect((await db.getResult(H1, 'client-1')).body).toEqual({ again: true });
      expect((await db.getResult(H2, 'client-1')).body).toEqual({ fresh: true });
    });

    it('refuses a bad handle, a missing connection and a handle already used', async () => {
      const db = await make();
      await expect(db.putResult({ handle: 'x', connection: 'c', body: {} })).rejects.toThrow(TypeError);
      await expect(db.putResult({ handle: H3, connection: '', body: {} })).rejects.toThrow(TypeError);
      await db.putResult({ handle: H3, connection: 'c', body: {} });
      await expect(db.putResult({ handle: H3, connection: 'other', body: { stolen: true } })).rejects.toThrow();
      expect((await db.getResult(H3, 'c')).body).toEqual({});
    });
  });
}
