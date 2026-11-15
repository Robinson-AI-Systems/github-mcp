// PLAY-IMAGES-1 (Chris, 2026-11-15): finished Playground runtimes leave no images behind.
import {describe, it, expect, afterEach} from 'vitest';
import {mkdtemp, rm, writeFile, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {HostAgent} from '../../tools/playground-device/agent.mjs';

const cleanups = []; afterEach(async () => { for (const c of cleanups.splice(0)) await c(); });
const LIVE = 'ras-pg-' + 'a'.repeat(32), DONE = 'ras-pg-' + 'b'.repeat(32), BINDING = 'c'.repeat(64);

// Fake Docker with images: {id, tags, project, inUse}.
function docker(images, liveProjects) {
  const removed = [];
  const exec = async (cmd, a) => {
    const s = a.join(' ');
    if (s.startsWith('image ls -q --filter label=com.docker.compose.project')) return images.map(i => i.id).join('\n');
    if (s.startsWith('image inspect')) return JSON.stringify(a.slice(2).map(id => images.find(i => i.id === id))
      .map(i => ({Id: i.id, RepoTags: i.tags, Config: {Labels: {'com.docker.compose.project': i.project}}})));
    if (s.startsWith('image rm')) {
      const img = images.find(i => i.tags.includes(a[2]) || i.id === a[2]);
      if (!img || img.inUse) throw new Error('conflict: image is being used');
      removed.push(a[2]); images.splice(images.indexOf(img), 1); return '';
    }
    if (/compose -p \S+ -f \S+ ps -q/.test(s)) return liveProjects.has(a[2]) ? 'c1' : '';
    if (/compose -p \S+ -f \S+ down/.test(s)) { liveProjects.delete(a[2]); return ''; }
    if (/^(container|volume|network) ls/.test(s)) return '';
    throw new Error('unexpected docker call: ' + s);
  };
  return {exec, removed};
}
async function agent(exec, allocations = {}) {
  const d = await mkdtemp(join(tmpdir(), 'play-images-')); cleanups.push(() => rm(d, {recursive: true, force: true}));
  for (const a of Object.values(allocations)) { await mkdir(join(d, 'allocations', a.project), {recursive: true}); a.file = join(d, 'allocations', a.project, 'compose.json'); await writeFile(a.file, '{}'); }
  await writeFile(join(d, 'agent.json'), JSON.stringify({server: 'https://mcp.example.test', deviceId: 'd'.repeat(32), generation: 1, controlKey: 'ed25519:AAAA', seq: 0, allocations}));
  const logs = [];
  const ag = new HostAgent({dir: d, exec, fetchImpl: async () => { throw new Error('no network'); }, log: m => logs.push(m), exit: () => { throw new Error('exit'); }});
  await ag.load();
  return {ag, logs};
}

describe('PLAY-IMAGES-1 Playground image cleanup', () => {
  it('the sweep removes images of finished runtimes and keeps the live runtime\'s and anything in use', async () => {
    const images = [
      {id: 'sha256:1', tags: ['ras-playground:live'], project: LIVE},
      {id: 'sha256:2', tags: ['ras-playground:done'], project: DONE},
      {id: 'sha256:3', tags: ['ras-playground:busy'], project: 'ras-pg-' + 'e'.repeat(32), inUse: true},
      {id: 'sha256:4', tags: ['other:1'], project: 'some-other-compose'}];
    const {exec, removed} = docker(images, new Set([LIVE]));
    const {ag, logs} = await agent(exec, {[BINDING]: {project: LIVE, port: 41000}});
    expect(await ag.sweepImages()).toEqual({removed: 1});
    expect(removed).toEqual(['ras-playground:done']);
    expect(images.map(i => i.id)).toEqual(['sha256:1', 'sha256:3', 'sha256:4']);
    expect(logs.some(l => l.includes('Removed 1 image'))).toBe(true);
  });
  it('a runtime that goes down takes its own images with it', async () => {
    const images = [{id: 'sha256:1', tags: ['ras-playground:x'], project: LIVE}, {id: 'sha256:2', tags: ['ras-playground:y'], project: DONE}];
    const {exec, removed} = docker(images, new Set());
    const {ag} = await agent(exec, {[BINDING]: {project: LIVE, port: 41000}});
    const ev = await ag.down({binding: BINDING, project: LIVE});
    expect(ev).toEqual({containersAbsent: true, volumesAbsent: true, networksAbsent: true});
    expect(removed).toEqual(['ras-playground:x']);
  });
  it('startup reconciliation also sweeps, and a Docker error never fails it', async () => {
    const images = [{id: 'sha256:2', tags: ['ras-playground:old'], project: DONE}];
    const {exec, removed} = docker(images, new Set());
    const {ag} = await agent(exec);
    expect(await ag.reconcile()).toEqual({retired: 0});
    expect(removed).toEqual(['ras-playground:old']);
    const {ag: ag2} = await agent(async () => { throw new Error('daemon busy'); });
    expect(await ag2.sweepImages()).toEqual({removed: 0});
  });
});
