// Contract for the async job store (Y-8): a slow GitHub operation is tracked per connection for up to 24 hours,
// finished once, and polled at most once per gap. Run against the in-memory fake and real PostgreSQL.
import { describe, expect, it } from 'vitest';

const J1 = `job_${'a'.repeat(16)}`;
const J2 = `job_${'b'.repeat(16)}`;
const make1 = (over = {}) => ({ id: J1, connection: 'client-1', owner: 'example-org', repo: 'app', kind: 'sbom', providerRef: 'uuid-1', ...over });

export function runJobStoreContract(name, make) {
  describe(`async jobs: ${name}`, () => {
    it('renews native idle metadata only for its active owner and immutable original duration',async()=>{
      const db=await make();
      const row=await db.createJob(make1({kind:'native-git-workspace',providerRef:JSON.stringify({worker:'git_'+'a'.repeat(32),authority:'b'.repeat(32)}),ttlMinutes:1}));
      expect(await db.renewNativeGitJob(J1,'foreign',{idleTimeoutMs:60000})).toBeNull();
      const expiry=new Date(row.expires_at).getTime()+1000;
      const renewed=await db.renewNativeGitJob(J1,'client-1',{idleTimeoutMs:60000,expiresAt:expiry});
      expect(new Date(renewed.expires_at).getTime()).toBe(expiry);expect(JSON.parse(renewed.provider_ref).idleTimeoutMs).toBe(60000);
      expect(await db.renewNativeGitJob(J1,'client-1',{idleTimeoutMs:120000})).toBeNull();
      expect(await db.renewNativeGitJob(J1,'client-1',{idleTimeoutMs:60000,expiresAt:expiry+600000})).toBeNull();
      await db.finishJob(J1,'client-1',{state:'ready'});
      expect(await db.renewNativeGitJob(J1,'client-1',{idleTimeoutMs:60000})).toBeNull();
      await db.createJob(make1({id:J2,kind:'native-git-workspace',providerRef:'{}',ttlMinutes:-1}));
      expect(await db.renewNativeGitJob(J2,'client-1',{idleTimeoutMs:60000})).toBeNull();
      await expect(db.renewNativeGitJob(J1,'client-1',{idleTimeoutMs:1})).rejects.toThrow(TypeError);
    });
    it('does not apply native idle renewal to another kind of job',async()=>{
      const db=await make();await db.createJob(make1());
      expect(await db.renewNativeGitJob(J1,'client-1',{idleTimeoutMs:60000})).toBeNull();
    });
    it('starts pending and reads back only for the connection that started it', async () => {
      const db = await make();
      const row = await db.createJob(make1());
      expect(row).toMatchObject({ id: J1, state: 'pending', kind: 'sbom', owner: 'example-org', repo: 'app', provider_ref: 'uuid-1', result_handle: null });
      expect(await db.getJob(J1, 'client-1')).toMatchObject({ id: J1, state: 'pending' });
      expect(await db.getJob(J1, 'client-2')).toBeNull();
      expect(await db.getJob(J2, 'client-1')).toBeNull();
      expect(await db.getJob('job_short', 'client-1')).toBeNull();
      expect(await db.getJob(J1, '')).toBeNull();
    });
    it('lists only active native workspaces in the exact connection without private worker metadata', async () => {
      const db = await make();
      await db.createJob(make1({ kind: 'native-git-workspace', providerRef: 'private worker identity' }));
      await db.createJob(make1({ id: J2, kind: 'native-git-workspace', connection: 'client-2' }));
      expect(await db.listNativeGitWorkspaces('client-1')).toMatchObject([{ id: J1, owner: 'example-org', repo: 'app' }]);
      expect(await db.listNativeGitWorkspaces('client-3')).toEqual([]);
      expect((await db.listNativeGitWorkspaces('client-1'))[0]).not.toHaveProperty('provider_ref');
      await db.finishJob(J1, 'client-1', { state: 'ready' });
      expect(await db.listNativeGitWorkspaces('client-1')).toEqual([]);
    });
    it('pages native workspace metadata without duplicates, includes lookahead and excludes expired or non-native jobs', async () => {
      const db = await make();
      await db.createJob(make1({ kind: 'native-git-workspace' }));
      await db.createJob(make1({ id: J2, kind: 'native-git-workspace' }));
      expect((await db.listNativeGitWorkspaces('client-1', { limit: 1 })).map(r => r.id)).toEqual([J1, J2]);
      expect((await db.listNativeGitWorkspaces('client-1', { after: J1, limit: 1 })).map(r => r.id)).toEqual([J2]);
      expect(await db.listNativeGitWorkspaces('client-1', { after: J2, limit: 1 })).toEqual([]);
      await expect(db.listNativeGitWorkspaces('client-1', { after: '../bad' })).rejects.toThrow();
    });
    it('refuses a bad id, a missing connection and an id already used', async () => {
      const db = await make();
      await expect(db.createJob(make1({ id: 'nope' }))).rejects.toThrow(TypeError);
      await expect(db.createJob(make1({ connection: '' }))).rejects.toThrow(TypeError);
      await db.createJob(make1());
      await expect(db.createJob(make1())).rejects.toThrow();
    });
    it('finishes a pending job once; another connection cannot finish it', async () => {
      const db = await make();
      await db.createJob(make1());
      expect(await db.finishJob(J1, 'client-2', { state: 'ready' })).toBeNull();
      const done = await db.finishJob(J1, 'client-1', { state: 'ready', resultHandle: `res_${'c'.repeat(22)}`, detail: 'x'.repeat(300) });
      expect(done).toMatchObject({ state: 'ready', result_handle: `res_${'c'.repeat(22)}` });
      expect(done.detail).toHaveLength(200);
      expect(await db.finishJob(J1, 'client-1', { state: 'failed' })).toBeNull();
      expect((await db.getJob(J1, 'client-1')).state).toBe('ready');
      await expect(db.finishJob(J1, 'client-1', { state: 'pending' })).rejects.toThrow(TypeError);
    });
    it('does not offer an expired job and clears expired rows when the next one starts', async () => {
      const db = await make();
      await db.createJob(make1({ ttlMinutes: -5 }));
      expect(await db.getJob(J1, 'client-1')).toBeNull();
      expect(await db.finishJob(J1, 'client-1', { state: 'ready' })).toBeNull();
      await db.createJob(make1({ id: J2 }));
      await db.createJob(make1());
      expect(await db.getJob(J1, 'client-1')).toMatchObject({ state: 'pending' });
    });
    it('lets GitHub be asked at most once per gap and never for a finished job', async () => {
      const db = await make();
      await db.createJob(make1());
      expect(await db.claimJobPoll(J1, 'client-1', 10)).toBe(true);
      expect(await db.claimJobPoll(J1, 'client-1', 10)).toBe(false);
      expect(await db.claimJobPoll(J1, 'client-2', 0)).toBe(false);
      expect(await db.claimJobPoll(J1, 'client-1', 0)).toBe(true);
      await db.finishJob(J1, 'client-1', { state: 'failed' });
      expect(await db.claimJobPoll(J1, 'client-1', 0)).toBe(false);
    });
  });
}
