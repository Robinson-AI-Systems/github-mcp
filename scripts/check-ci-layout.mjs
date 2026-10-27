// Deliberately bounded reader for this repo's block-style job map/inline needs.
// Unknown syntax refuses validation; this is not a general YAML parser.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const policy = {"gate": "ci", "parallel": ["check", "unit", "db", "shapes", "rtc", "browser"], "matrices": {"unit": 2, "browser": 3}, "maxTimeouts": {"check": 10, "unit": 10, "db": 10, "shapes": 10, "rtc": 10, "browser": 3, "ci": 5}, "timedJobs": ["unit", "db", "shapes", "rtc", "browser"]};

export function checkLayout(source, expected = policy) {
  const body = source.split(/^jobs:\s*$/m)[1];
  if (!body) throw Error('CI needs an explicit jobs map.');
  const matches = [...body.matchAll(/^  ([a-zA-Z0-9_-]+):\s*$/gm)];
  const jobs = new Map(matches.map((m,i) => [m[1], body.slice(m.index, matches[i+1]?.index)]));
  const dependencies = block => {
    const match = /^    needs:\s*([^\n]*)$/m.exec(block);
    if (!match) return [];
    const text = match[1].trim();
    if (!/^(\[[\w,'" -]+\]|[\w-]+)$/.test(text)) throw Error('Unsupported needs syntax; review the CI topology guard.');
    return text.replace(/[\[\]'" ]/g,'').split(',').filter(Boolean);
  };
  if (jobs.size !== matches.length) throw Error('Duplicate CI job.');
  for (const id of expected.parallel) {
    if (!jobs.has(id)) throw Error('Missing independent verification family: ' + id);
    if (dependencies(jobs.get(id)).some(dep => !(expected.allowedPrerequisites ?? []).includes(dep)))
      throw Error('Independent verification serialized behind another job: ' + id);
  }
  for (const [id, block] of jobs) {
    const limit = Number(/^    timeout-minutes:\s*(\d+)\s*$/m.exec(block)?.[1]);
    if (!limit || limit > (expected.maxTimeouts[id] ?? 10)) throw Error('Missing/increased CI timeout: ' + id);
    if (/continue-on-error:\s*true|^    if:\s*(?:false|'false'|"false")\s*$/m.test(block)) throw Error('Verification may not silently ignore/disable failure: ' + id);
    for (const dep of dependencies(block)) if (!jobs.has(dep)) throw Error('Unknown dependency: ' + dep);
  }
  for (const match of source.matchAll(/ci-phase\.mjs --budget-seconds (\d+)/g))
    if (Number(match[1]) > 30) throw Error('CI feedback target increased beyond 30 seconds; profile/split instead.');
  for (const id of expected.timedJobs ?? [])
    if (!/ci-phase\.mjs --budget-seconds \d+ -- /.test(jobs.get(id) ?? '')) throw Error('Missing measured CI phase budget: ' + id);
  if (!jobs.get('check')?.includes('name: ci-timing-check'))
    throw Error('Missing mandatory check timing artifact.');
    const browser = jobs.get('browser') ?? '';
  if (!/shard:\s*\[sign-in, home-page, fair-use\]/.test(browser))
    throw Error('Required browser shards missing; reconcile the exact file manifest.');
  if (!browser.includes('scripts/browser-shards.mjs') ||
      !jobs.get('check')?.includes('scripts/browser-shards.mjs --check'))
    throw Error('Missing mandatory browser spec coverage check.');
  for (const [id, block] of jobs) {
    if (id === expected.gate) continue;
    if (!block.includes('actions/upload-artifact@v6') || !block.includes('ci-timing-'))
      throw Error('Missing durable CI timing artifact: ' + id);
  }
  const gate = jobs.get(expected.gate);
  if (!gate || !/^    if:\s*always\(\)\s*$/m.test(gate)) throw Error('Required aggregate must run even after failure.');
  const required = [...jobs.keys()].filter(id => id !== expected.gate);
  const needs = dependencies(gate);
  if (needs.length !== required.length || required.some(id => !needs.includes(id))) throw Error('Required aggregate must include EVERY verification job.');
  for (const id of required) if (!gate.includes('needs.' + id + '.result')) throw Error('Aggregate must inspect result: ' + id);
  for (const [id,count] of Object.entries(expected.matrices ?? {})) {
    const block = jobs.get(id);
    if (!/fail-fast:\s*false/.test(block)) throw Error('Collect all shard failures: ' + id);
    const values = /shard:\s*\[([^\]]+)\]/.exec(block)?.[1].split(',').filter(v=>v.trim());
    const max = /max-parallel:\s*(\d+)/.exec(block)?.[1];
    if (!values || values.length < count || (max && Number(max) < values.length)) throw Error('Required shards may not collapse or serialize: ' + id);
  }
  return { gate: expected.gate, independentFamilies: expected.parallel, jobs: jobs.size,
    note: 'Topology/timeout guard only; real exact-head CI must pass. Review job/step timings and rebalance growing cohorts, never weaken coverage.' };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(checkLayout(readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url),'utf8')))); }
  catch(error) { console.error(error.message); process.exitCode=1; }
}
