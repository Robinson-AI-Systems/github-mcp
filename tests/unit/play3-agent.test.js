// PLAY-3 step 2 — agent service-form behaviour: startup reconciliation
// (§6: never silently resurrect uncertain work) and the supervised gate on
// self-update (§5.1: only the supervised service form applies updates).
import {describe, it, expect, afterEach} from 'vitest';
import {mkdtemp, rm, writeFile, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {HostAgent} from '../../tools/playground-device/agent.mjs';

const cleanups = []; afterEach(async () => { for (const c of cleanups.splice(0)) await c(); });
const BINDING = 'b'.repeat(64), PROJECT = 'ras-pg-' + 'a'.repeat(32);

// Fake Docker: `live` projects answer compose ps with a container id.
function fakeExec(live) {
  return async (cmd, a) => {
    const s = a.join(' ');
    if (/compose -p \S+ -f \S+ ps -q/.test(s)) return live.has(a[2]) ? 'c1' : '';
    if (/compose -p \S+ -f \S+ down/.test(s)) { live.delete(a[2]); return ''; }
    if (/^(container|volume|network) ls/.test(s)) return '';
    if (s.startsWith('volume rm')) return '';
    throw new Error('unexpected docker call: ' + s);
  };
}
async function agentWithAllocations(live) {
  const d = await mkdtemp(join(tmpdir(), 'play3-agent-')); cleanups.push(() => rm(d, {recursive: true, force: true}));
  const file = join(d, 'allocations', PROJECT, 'compose.json');
  await mkdir(join(d, 'allocations', PROJECT), {recursive: true});
  await writeFile(file, '{}');
  const state = {server: 'https://mcp.example.test', deviceId: 'd'.repeat(32), generation: 1, controlKey: 'ed25519:AAAA', seq: 0,
    allocations: {[BINDING]: {project: PROJECT, port: 41234, file}}};
  await writeFile(join(d, 'agent.json'), JSON.stringify(state));
  const logs = [];
  const agent = new HostAgent({dir: d, exec: fakeExec(live), fetchImpl: async () => { throw new Error('no network in this test'); }, log: m => logs.push(m), exit: () => { throw new Error('agent tried to exit'); }});
  await agent.load();
  return {agent, logs};
}

describe('PLAY-3 startup reconciliation', () => {
  it('retires a recorded allocation whose containers are gone, with absence proven first', async () => {
    const {agent, logs} = await agentWithAllocations(new Set());
    expect(await agent.reconcile()).toEqual({retired: 1});
    expect(agent.state.allocations[BINDING]).toBeUndefined();
    expect(logs.some(l => l.includes('Reconciled allocation'))).toBe(true);
  });
  it('keeps a recorded allocation whose containers are live', async () => {
    const {agent} = await agentWithAllocations(new Set([PROJECT]));
    expect(await agent.reconcile()).toEqual({retired: 0});
    expect(agent.state.allocations[BINDING]).toBeDefined();
  });
});

describe('PLAY-3 supervised update gate', () => {
  it('a foreground (unsupervised) agent never applies an update itself', async () => {
    const {agent} = await agentWithAllocations(new Set());
    agent.supervised = false;
    expect(await agent.maybeUpdate({body: '{}', signature: 'ed25519:x'})).toMatchObject({applied: false, reason: 'not_supervised'});
  });
  it('a supervised agent refuses an unsigned advertisement and does not exit', async () => {
    const {agent, logs} = await agentWithAllocations(new Set());
    agent.supervised = true;
    const r = await agent.maybeUpdate({body: '{"purpose":"robinson-playground-agent-release/v1"}', signature: 'ed25519:' + 'A'.repeat(86)});
    expect(r.applied).toBe(false);
    expect(logs.some(l => l.includes('Agent update refused'))).toBe(true);
  });
});
