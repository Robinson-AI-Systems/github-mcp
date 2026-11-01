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

it('FLEET-7 counts new pool allocations per pool and image variant since a time, disposed included, device runs excluded',async()=>{
 const put=(key,allocation)=>db.setSetting('pg_index.'+key,{kind:'playground-index',revision:1,allocation:{revision:1,binding:key.padEnd(64,'0'),...allocation}});
 await put('a1',{pool:'default',phase:'disposed',createdAt:2000,runtimeImage:{variant:'full'}});
 await put('a2',{phase:'attached',createdAt:3000,runtimeImage:{variant:'slim'}});
 await put('a3',{pool:'east',phase:'requested',createdAt:2500});
 await put('a4',{pool:'default',phase:'disposed',createdAt:999,runtimeImage:{variant:'full'}});
 await put('a5',{placement:'device',phase:'attached',createdAt:5000});
 await put('a6',{pool:'default',phase:'attached',createdAt:'not-a-number'});
 await db.setSetting('pg_unrelated',{kind:'playground-index',allocation:{createdAt:5000}});
 expect(await db.playgroundDemandSince(1000)).toEqual([{pool:'default',variant:'full',count:1},{pool:'default',variant:'slim',count:1},{pool:'east',variant:'unknown',count:1}]);
 expect(await db.playgroundDemandSince(10000)).toEqual([]);
 await expect(db.playgroundDemandSince(-1)).rejects.toThrow(/demand window/);
});
