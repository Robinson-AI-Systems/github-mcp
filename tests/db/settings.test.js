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
