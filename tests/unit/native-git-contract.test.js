import { afterEach, it, expect } from 'vitest';
import { runWriteContract, makeWorld, parse, doorsFor } from '../../test/helpers/write-contract.js';
import { prepareNativeWorld } from '../../test/helpers/native-git-world.js';
import * as native from '../../src/tools/native-git.js';
const cleanups = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });
const definition = name => ({ tool: native.tools.find(t => t.name === name), handler: native.handlers[name] });
const arrange = (gh, outcome) => { gh.nativeOutcome = outcome; gh.when('GET /repos/{owner}/{repo}').reply(200, { full_name: 'example-org/hello', default_branch: 'main' }); };
for (const [name, args, existing] of [
 ['github_git_workspace_open', { owner: 'example-org', repo: 'hello' }, false],
 ['github_git_workspace_run', { workspace_id: 'job_0123456789abcdef', operation: 'branch_create', expectedGeneration: 0, options: { name: 'topic' } }, true],
 ['github_git_workspace_close', { workspace_id: 'job_0123456789abcdef' }, true]
]) runWriteContract({ label: name, definition: definition(name), args, arrange, needsConfirm: true, profile: 'full', expectedWrites: 0,
 prepare: async w => { cleanups.push(await prepareNativeWorld(w, { existing })); } });

it('each public write door sends a single worker mutation on replay', async () => {
 for (const door of doorsFor(definition('github_git_workspace_run'))) {
  const w = await makeWorld({ profile: 'full', mode: 'production', gates: [] }); arrange(w.gh, 'ok'); cleanups.push(await prepareNativeWorld(w, { existing: true }));
  const args = { workspace_id: 'job_0123456789abcdef', operation: 'branch_create', expectedGeneration: 0, options: { name: 'only-once' }, requestKey: 'worker-send-once' };
  expect(parse(await door.call(w, args)).status).toBe('applied'); expect(parse(await door.call(w, args)).status).toBe('replayed');
  expect(w.nativeRequests.filter(x => x === 'run')).toHaveLength(1);
 }
});
