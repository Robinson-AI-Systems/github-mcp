#!/usr/bin/env node
// fleet-route — bench-by-construction shim for this repo's suite/build
// entry points (Chris's direction, 2026-11-05: bench execution is the
// default BY CONSTRUCTION, not a per-job choice).
//
// package.json routes the heavy entry points (check, test, test:db, ...)
// through this file and keeps their original commands in the
// "fleetRoute" map. What happens then depends on where the command runs:
//
//   - On Vivienne's VM (the normal agent case): the command is handed to
//     fleet-run (~/workspace/scripts/fleet-run), which snapshots the
//     exact working tree — uncommitted changes included — and runs it on
//     the first free bench surface (Chris's PC slot 1 -> PC slot 2 ->
//     Workshop -> potato -> Dokploy last, container-shaped jobs only ->
//     Vivienne's VM DEAD LAST: named in the order but never an automatic
//     surface). Output streams back; the exit code is the bench run's;
//     the run leaves a ~/workspace/fleet-jobs/ ledger entry. If no bench
//     can take the job, fleet-run reports NO SLOT and this shim exits
//     non-zero — there is NO fall-through to a local run. A heavy run on
//     the VM is an explicit, reported exception only
//     (FLEET_RUN_LOCAL=1, which prints a loud unledgered-run warning).
//   - On a bench (FLEET_ON_BENCH), in GitHub Actions (GITHUB_ACTIONS),
//     or in a platform build (VERCEL): the original command runs
//     directly, unchanged — CI behaviour is identical to before.
//
// DECLARED NON-REROUTABLES (run locally wherever invoked, with a notice
// — never silently): watch modes (a command or argument asking for
// --watch), and interactive debugging flags (--inspect, --ui, --debug).
// They are long-lived/interactive and cannot ship to a batch bench job.
//
// Appliance-desk runner mode ("fleetRouteMode": "runner" in
// package.json): that repo's DB/browser harness is bound to VM testbox
// plumbing no bench reproduces, and its history is too large to bundle
// per run — so its whole-suite entry points route to the bench RUNNERS
// (run-checks-pc.sh / run-checks.sh) against the exact PUSHED head
// instead. The boundary is exact and enforced here: a dirty tree or an
// unpushed head refuses with instructions; file-scoped invocations
// (arguments present) stay on the repo's own local launcher, announced
// loudly as the declared exception they are.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = process.argv[2];
const args = process.argv.slice(3);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const originals = pkg.fleetRoute || {};
const original = originals[script];

function note(msg) {
  process.stderr.write(`fleet-route: ${msg}\n`);
}

if (!script || !(script in originals)) {
  note(`no fleetRoute entry for "${script || ''}" in package.json — nothing routed.`);
  process.exit(2);
}

function quoteArg(a) {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`;
}

function runLocal(command, extraArgs, why) {
  if (why) note(why);
  const cmd = [command, ...extraArgs.map(quoteArg)].join(' ');
  const res = spawnSync(cmd, { shell: true, stdio: 'inherit', cwd: root });
  if (res.error) {
    note(`local run failed to start: ${res.error.message}`);
    process.exit(1);
  }
  process.exit(res.status === null ? 1 : res.status);
}

const onBench = Boolean(process.env.FLEET_ON_BENCH);
const inCI = Boolean(process.env.GITHUB_ACTIONS);
const inPlatformBuild = Boolean(process.env.VERCEL);
const watchLike =
  /(^|\s)--watch\b/.test(original) ||
  /\bwatch\b/.test(script) ||
  args.some((a) => ['--watch', '--ui', '--debug', '--inspect'].includes(a) || a.startsWith('--inspect='));

if (pkg.fleetRouteMode === 'runner') {
  // ---------------- appliance-desk runner mode ----------------
  // fleetRoute value = the bench runner's phase list; the real command
  // (for CI, benches, and the declared file-scoped boundary) lives in
  // fleetRouteLocal.
  const localCmd = (pkg.fleetRouteLocal || {})[script];
  if (!localCmd) {
    note(`no fleetRouteLocal entry for "${script}" — runner mode is misconfigured.`);
    process.exit(2);
  }
  if (onBench || inCI || inPlatformBuild) {
    runLocal(localCmd, args, '');
  }
  if (watchLike) {
    runLocal(localCmd, args, 'watch/interactive invocation — declared non-reroutable; running locally (unledgered).');
  }
  if (process.env.FLEET_RUN_LOCAL) {
    runLocal(localCmd, args, 'FLEET_RUN_LOCAL — EXPLICIT EXCEPTION: the repo launcher runs on this machine, unledgered, by deliberate choice.');
  }
  if (args.length > 0) {
    runLocal(
      localCmd,
      args,
      'DECLARED BOUNDARY: file-scoped appliance-desk runs stay on the repo\'s own testbox launcher — ' +
        'the bench runners execute whole phases against pushed heads and cannot see a file-scoped, ' +
        'possibly-uncommitted invocation. Running locally via the repo launcher (unledgered exception). ' +
        'Whole-suite entry points (no arguments) route to the benches.'
    );
  }
  const git = (a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' });
  const dirty = git(['status', '--porcelain']).stdout.trim();
  if (dirty) {
    note('REFUSED: the working tree has uncommitted changes. The bench runners verify a pushed head');
    note('and cannot see this state. Commit and push, then re-run — or set FLEET_RUN_LOCAL=1 to run');
    note('the repo launcher here as a deliberate, unledgered exception.');
    process.exit(65);
  }
  const branch = git(['branch', '--show-current']).stdout.trim();
  git(['fetch', '--quiet', 'origin', branch]);
  const head = git(['rev-parse', 'HEAD']).stdout.trim();
  const remote = git(['rev-parse', `origin/${branch}`]).stdout.trim();
  if (!branch || head !== remote) {
    note(`REFUSED: HEAD (${head.slice(0, 8)}) is not the pushed head of "${branch}" (${remote.slice(0, 8)}).`);
    note('Push first, then re-run — or set FLEET_RUN_LOCAL=1 for a deliberate, unledgered local exception.');
    process.exit(65);
  }
  const phases = original; // in runner mode the fleetRoute value is the runner phase list
  const fleetRun = findFleetRun();
  if (!fleetRun) refuseNoFleetRun();
  const fleetArgs = ['--runner', 'appliance-desk', '--sha', head];
  if (phases) fleetArgs.push('--phases', phases);
  const res = spawnSync(fleetRun, fleetArgs, { stdio: 'inherit', cwd: root });
  process.exit(res.status === null ? 1 : res.status);
}

// ---------------- bundle mode (the MCP fleet repos) ----------------
if (onBench || inCI || inPlatformBuild) {
  runLocal(original, args, '');
}
if (watchLike) {
  runLocal(original, args, 'watch/interactive invocation — declared non-reroutable; running locally (unledgered).');
}
if (process.env.FLEET_RUN_LOCAL) {
  runLocal(original, args, 'FLEET_RUN_LOCAL — EXPLICIT EXCEPTION: running on the VM, unledgered, by deliberate choice (not an automatic route).');
}

function findFleetRun() {
  const candidates = [
    process.env.FLEET_RUN,
    path.join(os.homedir(), 'workspace', 'scripts', 'fleet-run'),
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  const onPath = spawnSync('command', ['-v', 'fleet-run'], { shell: true, encoding: 'utf8' });
  return onPath.status === 0 ? 'fleet-run' : null;
}

function refuseNoFleetRun() {
  note('fleet-run not found (~/workspace/scripts/fleet-run) — the reroute cannot be built.');
  note('NO fall-through: the suite was NOT run on the VM. Restore fleet-run, or set');
  note('FLEET_RUN_LOCAL=1 to run it here as a deliberate, unledgered exception.');
  process.exit(78);
}

const fleetRun = findFleetRun();
if (!fleetRun) refuseNoFleetRun();
const res = spawnSync(fleetRun, ['--npm', script, '--', ...args], { stdio: 'inherit', cwd: root });
if (res.error) {
  note(`fleet-run failed to start: ${res.error.message}`);
  process.exit(1);
}
process.exit(res.status === null ? 1 : res.status);
