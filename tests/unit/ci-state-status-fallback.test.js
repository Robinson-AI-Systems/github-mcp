import { describe, it, expect } from 'vitest';
import { ciState } from '../../src/github/ci-state.js';

// G4/G11 (Takeover Batch 2): a required check that is reported as a commit STATUS (not a check
// run) must be read from the combined status even when the branch rule names the app that must
// report it. Live proof 2026-11-04: appliance-desk PR #842, head d86dfe49 — the ruleset requires
// "review-gate" from app 15368; GitHub's combined status at that head carries review-gate
// (state failure, posted by that app), while github_pr_get reported it "missing" because the
// status fallback only ran when no app id was named. GitHub's own merge box counts the status.
const err = (status, message) => Object.assign(new Error(message), { status, response: { data: { message } } });

function octokit({ required = [], runs = [], statuses = [], statusesError = null }) {
  return {
    async request(route) {
      if (route.includes('/rules/branches/')) {
        return { data: required.length ? [{ type: 'required_status_checks', ruleset_id: 1, ruleset_name: 'r',
          parameters: { strict_required_status_checks_policy: false, required_status_checks: required } }] : [] };
      }
      if (route.includes('/protection/required_status_checks')) throw err(404, 'Not Found');
      if (route.includes('/check-runs')) return { data: { check_runs: runs, total_count: runs.length } };
      if (route.includes('/status')) { if (statusesError) throw statusesError; return { data: { statuses } }; }
      throw new Error('unexpected ' + route);
    }
  };
}
const call = (o) => ciState(o, { owner: 'o', repo: 'r', baseBranch: 'main', headSha: 'a'.repeat(40) });
const ciRun = { id: 1, name: 'ci', status: 'completed', conclusion: 'success', started_at: '2026-11-04T00:00:00Z', app: { id: 15368 } };
const gateRun = (appId, conclusion = 'success') => ({ id: 2, name: 'review-gate', status: 'completed', conclusion, started_at: '2026-11-04T00:01:00Z', app: { id: appId } });
const gateStatus = (state) => ({ context: 'review-gate', state, updated_at: '2026-11-04T00:02:00Z' });
const REQUIRED = [{ context: 'ci', integration_id: 15368 }, { context: 'review-gate', integration_id: 15368 }];

describe('ciState: status-posted required checks with a named app', () => {
  it('reads a pending required check from the combined status instead of calling it missing', async () => {
    const r = await call(octokit({ required: REQUIRED, runs: [ciRun], statuses: [gateStatus('pending')] }));
    const gate = r.checks.find((c) => c.context === 'review-gate');
    expect(gate.state).toBe('pending');
    expect(gate.source).toBe('status');
    expect(r.green).toBe(false);
    expect(r.problems).toContain('review-gate: pending');
    expect(r.problems).not.toContain('review-gate: missing');
  });
  it('is green when the status-posted required check succeeded', async () => {
    const r = await call(octokit({ required: REQUIRED, runs: [ciRun], statuses: [gateStatus('success')] }));
    expect(r.checks.find((c) => c.context === 'review-gate')).toMatchObject({ state: 'success', source: 'status' });
    expect(r.green).toBe(true);
  });
  it('reports the real failure state of a status-posted required check (the live #842 shape)', async () => {
    const r = await call(octokit({ required: REQUIRED, runs: [ciRun], statuses: [gateStatus('failure')] }));
    expect(r.checks.find((c) => c.context === 'review-gate').state).toBe('failure');
    expect(r.green).toBe(false);
    expect(r.problems).toContain('review-gate: failure');
  });
  it('a matching check run still wins over a same-context status', async () => {
    const r = await call(octokit({ required: REQUIRED, runs: [ciRun, gateRun(15368, 'failure')], statuses: [gateStatus('success')] }));
    expect(r.checks.find((c) => c.context === 'review-gate')).toMatchObject({ state: 'failure', source: 'check run' });
  });
  it('stays missing (fail-closed) when another app\'s run exists but no status and no matching run', async () => {
    const r = await call(octokit({ required: REQUIRED, runs: [ciRun, gateRun(999)], statuses: [] }));
    const gate = r.checks.find((c) => c.context === 'review-gate');
    expect(gate.state).toBe('missing');
    expect(gate.reason).toBe('same-name check exists under another app');
    expect(r.green).toBe(false);
  });
  it('stays unknown, never green, when the statuses themselves could not be read', async () => {
    const r = await call(octokit({ required: REQUIRED, runs: [ciRun], statusesError: err(500, 'boom') }));
    expect(r.green).toBeNull();
    expect(r.errors.join(' ')).toContain('commit statuses could not be read');
  });
});
