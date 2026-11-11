#!/usr/bin/env node
// PLAY-3 §5.1 — build a signed-release agent bundle (operator tool, run by
// hand when publishing an agent release; never an agent tool and never run
// by the control plane). Writes agent-release-<version>.tar.gz containing
// the payload files at its root plus a version.json for the target version,
// and prints the sha256 the operator then configures as
// PLAYGROUND_AGENT_BUNDLE_SHA256 alongside PLAYGROUND_AGENT_LATEST_VERSION
// and PLAYGROUND_AGENT_BUNDLE_URL. Signing happens on the control plane at
// check-in time (signAgentReleaseBody); this script signs nothing and holds
// no key.
//
//   node make-bundle.mjs --version fleet-agent/2 --out ./dist
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFile, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseVersion} from './update.mjs';

const PAYLOAD = ['agent.mjs', 'pair.mjs', 'update.mjs', 'run.mjs'];
const sha256 = v => createHash('sha256').update(v).digest('hex');
function args(argv) { const o = {}; for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[++i]; return o; }

export async function buildBundle({version, outDir, here = dirname(fileURLToPath(import.meta.url))}) {
  if (!parseVersion(version ?? '')) throw new Error('Use a version like fleet-agent/2.');
  await mkdir(outDir, {recursive: true});
  const stage = join(outDir, '.stage-' + version.replace('/', '-'));
  await rm(stage, {recursive: true, force: true});
  await mkdir(stage, {recursive: true});
  for (const f of PAYLOAD) await copyFile(join(here, f), join(stage, f));
  await writeFile(join(stage, 'version.json'), JSON.stringify({version}) + '\n');
  const file = join(outDir, 'agent-release-' + version.replace('/', '-') + '.tar.gz');
  await new Promise((resolve, reject) => execFile('tar', ['-czf', file, '-C', stage, '.'], e => e ? reject(e) : resolve()));
  await rm(stage, {recursive: true, force: true});
  const bytes = await readFile(file);
  return {file, sha256: sha256(bytes), bytes: bytes.length, version};
}

async function main() {
  const o = args(process.argv.slice(2));
  const r = await buildBundle({version: o.version, outDir: o.out ?? './dist'});
  process.stdout.write(JSON.stringify(r, null, 1) + '\n');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { process.stderr.write('Bundle error: ' + e.message + '\n'); process.exitCode = 1; });
