import {stableScannerJson} from '../../src/github/scanner-policy.js';
import { beforeAll, afterAll, beforeEach, it, expect } from 'vitest';
import { createDb } from '../../src/db.js';
import { openIsolatedSchema, closeIsolatedSchema, neonShapedQuery, rawQuery } from '../../test/helpers/pg-neon-adapter.js';
import { runProtectedContract, runSettingsContract, runSpendContract } from '../../test/contract/settings-contract.js';

let db;
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL must point to disposable localhost Postgres (npm run test:db)');
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(process.env.TEST_DATABASE_URL).hostname)) throw new Error('Refusing non-local Postgres in tests');
  await openIsolatedSchema(process.env.TEST_DATABASE_URL);
  db = createDb(neonShapedQuery());
  await db.initSchema();
});
afterAll(async () => { await closeIsolatedSchema(); });
beforeEach(async () => { await rawQuery('TRUNCATE change_log, protected_resources, server_settings, setup_states, gh_accounts CASCADE'); });

runSettingsContract('isolated PostgreSQL', async () => db);
runProtectedContract('isolated PostgreSQL', async () => db);
runSpendContract('isolated PostgreSQL', async () => db);

it('compares persisted nested scanner settings independently of PostgreSQL JSONB key order',async()=>{
 const settings={additionalRules:[{id:'custom_fixture',label:'Synthetic marker',type:'prefix',prefix:'fixture_',alphabet:'alnum',minLength:12,maxLength:80}],disabledRules:[],suppressions:[{rule:'database-connection-password',path:'docs/fixture.md',blobSha:'a'.repeat(40),fingerprint:'b'.repeat(64),fileReadException:true,reason:'Reviewed synthetic fixture only'}]};
 await db.compareAndSetSetting('scanner_jsonb_fixture',0,{revision:1,settings});
 const stored=await db.getSetting('scanner_jsonb_fixture');expect(stableScannerJson(stored.settings)).toBe(stableScannerJson(settings));
 const changed=structuredClone(stored.settings);changed.suppressions[0].fileReadException=false;expect(stableScannerJson(changed)).not.toBe(stableScannerJson(settings));
});

it('SWEEP-CLEANUP-1 lists closed allocation rows older than a time and deletes a setting only at its revision',async()=>{
 const put=(key,allocation)=>db.setSetting('pg_index.'+key,{kind:'playground-index',revision:1,allocation:{revision:1,binding:key.padEnd(64,'0'),...allocation}});
 await put('a1',{phase:'disposed',disposedAt:1000});
 await put('a2',{phase:'disposed',disposedAt:9000});
 await put('a3',{phase:'attached'});
 await put('a4',{phase:'disposed'});
 expect((await db.listClosedPlaygroundIndexes({before:5000})).map(r=>r.setting)).toEqual(['pg_index.a1']);
 // No disposedAt: the row's last update (just now) decides.
 expect((await db.listClosedPlaygroundIndexes({before:Date.now()+3600000})).map(r=>r.setting)).toEqual(['pg_index.a1','pg_index.a2','pg_index.a4']);
 expect((await db.listClosedPlaygroundIndexes({before:Date.now()+3600000,after:'pg_index.a1',limit:1})).map(r=>r.setting)).toEqual(['pg_index.a2']);
 expect(await db.deleteSettingAt('pg_index.a1',2)).toBe(false);
 expect(await db.deleteSettingAt('pg_index.a1',1)).toBe(true);
 expect(await db.getSetting('pg_index.a1')).toBeNull();
 await expect(db.listClosedPlaygroundIndexes({before:-1})).rejects.toThrow(/closed allocation/);
});
