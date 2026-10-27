// The 30-second target is a warning, never a reason to fail a passing test.
// Actual failure, signal, interrupted process and independent hard watchdog still fail.
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CI_SOFT_TARGET_MAX_SECONDS = 30;
export const CI_HARD_WATCHDOG_MS = 210000;

export function runPhase(args, { execute = spawnSync, clock = () => performance.now(),
  output = console.log, label = process.env.CI_PHASE_LABEL || process.env.GITHUB_JOB || 'phase' } = {}) {
  if (args[0] !== '--budget-seconds' || !/^\d+$/.test(args[1] ?? '') ||
      args[2] !== '--' || args.length < 4)
    throw Error('Usage: ci-phase --budget-seconds SECONDS -- command [args]');
  const budget = Number(args[1]);
  if (budget < 1 || budget > CI_SOFT_TARGET_MAX_SECONDS)
    throw Error('CI feedback target must be 1–30 seconds; split growing cohorts instead.');
  const safeLabel = /^[a-zA-Z0-9_-]{1,64}$/.test(label) ? label : 'phase';
  const start = clock();
  const result = execute(args[3], args.slice(4), { stdio: 'inherit', timeout: CI_HARD_WATCHDOG_MS });
  const seconds = (clock() - start) / 1000;
  const passed = !result.error && !result.signal && result.status === 0;
  const summary = {
    label: safeLabel, seconds: Number(seconds.toFixed(2)),
    budgetSeconds: budget, overrunSeconds: Number(Math.max(0, seconds - budget).toFixed(2)),
    commandPassed: passed, withinBudget: seconds <= budget,
    timedOut: result.error?.code === 'ETIMEDOUT',
    status: passed ? 'passed' : 'failed'
  };
  output('[CI phase] ' + JSON.stringify(summary));
  if (!passed) output('Verification failed, timed out or was interrupted; examine its original error.');
  else if (!summary.withinBudget)
    output('::warning title=CI phase over 30-second target::' + safeLabel +
      ' passed in ' + summary.seconds + 's; target ' + budget +
      's (over by ' + summary.overrunSeconds + 's). Recorded without restarting.');
  return { ...summary, exitCode: passed ? 0 : 1 };
}

export function writePhaseEvidence(summary, {
  timingFile = process.env.CI_TIMING_FILE, summaryFile = process.env.GITHUB_STEP_SUMMARY,
  append = appendFileSync, mkdir = mkdirSync
} = {}) {
  const record = { ...summary };
  delete record.exitCode;
  const outcome = summary.commandPassed ? (summary.withinBudget ? 'on target' : 'slow pass') : 'FAILED';
  if (timingFile) {
    mkdir(dirname(timingFile), { recursive: true });
    append(timingFile, JSON.stringify(record) + '\n');
  }
  if (summaryFile) append(summaryFile, '| ' + summary.label + ' | ' +
    summary.seconds + ' s | ' + summary.budgetSeconds + ' s | ' + outcome + ' |\n');
  return record;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = runPhase(process.argv.slice(2));
    writePhaseEvidence(result);
    process.exitCode = result.exitCode;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
