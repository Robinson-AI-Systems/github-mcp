// FLEET-2 upsize hint: the runtime records `out_of_memory` only for a kernel OOM kill (SIGKILL the
// supervisor did not send while the cgroup oom_kill counter rose), and the tool layer names the
// next size up. The real-image smoke test (workers/coding-workspace/smoke.test.js) runs the same
// receipt path as root with an injected counter.
import {afterEach, describe, expect, it} from 'vitest';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {killedByOom, readOomKills} from '../../workers/coding-workspace/runtime.js';
import {upsizeHint, withUpsizeHint} from '../../src/playground/sizing.js';
import {makeWorld, parse} from '../../test/helpers/write-contract.js';
import {preparePlaygroundWorld} from '../../test/helpers/playground-world.js';
import * as playground from '../../src/tools/playground.js';

describe('kernel out-of-memory detection', () => {
  it('is an OOM kill only for SIGKILL (or a shell 137) the supervisor did not send while the counter rose', () => {
    expect(killedByOom({signal: 'SIGKILL', code: null, supervisorReason: null, before: 0, after: 1})).toBe(true);
    expect(killedByOom({signal: null, code: 137, supervisorReason: null, before: 3, after: 4})).toBe(true);
    for (const supervisorReason of ['timeout', 'cancelled', 'log_limit_exceeded', 'runtime_stopped']) expect(killedByOom({signal: 'SIGKILL', code: null, supervisorReason, before: 0, after: 1})).toBe(false);
    expect(killedByOom({signal: 'SIGKILL', code: null, supervisorReason: null, before: 2, after: 2})).toBe(false);
    expect(killedByOom({signal: 'SIGTERM', code: null, supervisorReason: null, before: 0, after: 1})).toBe(false);
    expect(killedByOom({signal: null, code: 1, supervisorReason: null, before: 0, after: 1})).toBe(false);
    expect(killedByOom({signal: 'SIGKILL', code: null, supervisorReason: null, before: null, after: 1})).toBe(false);
  });
  it('reads the cgroup v2 oom_kill counter and returns null when it cannot', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'oom-'));
    try {
      await writeFile(join(dir, 'memory.events'), 'low 0\nhigh 0\nmax 12\noom 2\noom_kill 2\noom_group_kill 0\n');
      expect(await readOomKills(join(dir, 'memory.events'))).toBe(2);
      await writeFile(join(dir, 'other'), 'low 0\n');
      expect(await readOomKills(join(dir, 'other'))).toBeNull();
      expect(await readOomKills(join(dir, 'missing'))).toBeNull();
    } finally { await rm(dir, {recursive: true, force: true}); }
  });
});

describe('upsize hint', () => {
  it('names the next size: small -> medium -> large -> split the job', () => {
    expect(upsizeHint({reason: 'out_of_memory'}, 'small')).toMatchObject({next_size: 'medium'});
    expect(upsizeHint({reason: 'out_of_memory'}, 'medium')).toMatchObject({next_size: 'large'});
    expect(upsizeHint({reason: 'out_of_memory'}, 'large')).toMatchObject({next_size: null, hint: expect.stringMatching(/Split the job/)});
    expect(upsizeHint({reason: 'out_of_memory'}, null)).toMatchObject({next_size: 'large', hint: expect.stringMatching(/medium or large/)});
    expect(upsizeHint({reason: 'timeout'}, 'small')).toBeNull();
    expect(withUpsizeHint({state: 'completed', reason: null}, 'small')).toEqual({state: 'completed', reason: null});
  });
});

const cleanups = []; afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });
const base = {owner: 'example-org', repo: 'hello', workspace_id: 'job_0123456789abcdef'};
it('github_playground_read status and github_playground_execute carry the hint for an out-of-memory kill', async () => {
  const w = await makeWorld({profile: 'full', mode: 'production', gates: []});
  w.gh.nativeOutcome = 'ok'; w.gh.when('GET /repos/{owner}/{repo}').reply(200, {full_name: 'example-org/hello'});
  cleanups.push(await preparePlaygroundWorld(w));
  const runtime = w.playground.runtime, status = runtime.status.bind(runtime);
  runtime.status = async id => ({...await status(id), state: 'failed', exitCode: null, signal: 'SIGKILL', reason: 'out_of_memory'});
  const executed = parse(await playground.handlers.github_playground_execute({...base, argv: ['npm', 'test'], requestKey: 'oom'}, w.ctx));
  expect(executed.result.execution).toMatchObject({reason: 'out_of_memory', upsize: {next_size: 'large'}});
  const read = await playground.handlers.github_playground_read({...base, operation: 'status', requestKey: 'oom'}, w.ctx), shown = read.structuredContent ?? read;
  expect(shown).toMatchObject({reason: 'out_of_memory', upsize: {next_size: 'large', hint: expect.stringMatching(/medium or large/)}});
  runtime.status = status;
  const plain = await playground.handlers.github_playground_read({...base, operation: 'status', requestKey: 'oom'}, w.ctx);
  expect((plain.structuredContent ?? plain).upsize).toBeUndefined();
});
