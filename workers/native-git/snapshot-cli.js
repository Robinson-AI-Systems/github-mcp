// Run only in the operator's private terminal. Keys are read from environment, never argv/stdout.
import { readFile, writeFile, rename, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { exportWorkspace, importWorkspace } from './snapshot.js';
const [action, location, file] = process.argv.slice(2);
const root = process.env.NATIVE_GIT_STORAGE_ROOT;
if (!root) throw new TypeError('Set NATIVE_GIT_STORAGE_ROOT to the exact persistent volume.');
if (action === 'export') {
 const bytes = await exportWorkspace({ root, id: location, key: process.env.NATIVE_GIT_SNAPSHOT_KEY });
 await writeFile(resolve(file), bytes, { flag: 'wx', mode: 0o600 });
 process.stdout.write(JSON.stringify({ exported: location, encrypted_bytes: bytes.length }) + '\n');
} else if (action === 'import') {
 const result = await importWorkspace({ root, bytes: await readFile(resolve(location)), key: process.env.NATIVE_GIT_SNAPSHOT_KEY });
 process.stdout.write(JSON.stringify(result) + '\n');
} else if (action === 'recover-lease') {
 if (process.env.NATIVE_GIT_WORKER_STOPPED !== 'yes' || !/^git_[a-f0-9]{32}$/.test(location ?? '')) throw new TypeError('Stop the worker service first; explicitly set NATIVE_GIT_WORKER_STOPPED=yes and use the exact workspace ID.');
 const dir = join(resolve(root), location);
 if ((await lstat(dir)).isSymbolicLink()) throw new TypeError('Invalid workspace root.');
 await rename(join(dir, 'mutation.lock'), join(dir, 'recovered-lock-' + Date.now()));
 process.stdout.write(JSON.stringify({ recovered_lease: location, next: 'Restart the service, inspect local and remote refs, then issue a new intent only after reconciliation. Prior uncertain receipts remain unchanged.' }) + '\n');
} else throw new TypeError('Use export WORKSPACE_ID ENCRYPTED_FILE, import ENCRYPTED_FILE, or recover-lease WORKSPACE_ID.');
