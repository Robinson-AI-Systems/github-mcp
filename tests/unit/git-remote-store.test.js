// GIT-REMOTE-1: the fake database holds the same key-store contract as PostgreSQL (tests/db/git-remote.test.js).
import { createFakeDb } from '../../test/helpers/fake-db.js';
import { runGitRemoteStoreContract } from '../../test/contract/git-remote-store-contract.js';

runGitRemoteStoreContract('fake', async () => { const db = createFakeDb(); await db.initSchema(); return db; });
