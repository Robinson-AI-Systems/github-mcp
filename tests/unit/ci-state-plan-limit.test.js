import { describe, it, expect } from 'vitest';
import { ciState } from '../../src/github/ci-state.js';

const PLAN = 'Upgrade to GitHub Pro or make this repository public to enable this feature.';
const err = (status, message) => Object.assign(new Error(message), { status, response: { data: { message } } });

function octokit({ rules, classic, runs = [] }) {
  return {
    async request(route) {
      if (route.includes('/rules/branches/')) { if (rules instanceof Error) throw rules; return { data: rules ?? [] }; }
      if (route.includes('/protection/required_status_checks')) { if (classic instanceof Error) throw classic; return { data: classic }; }
      if (route === 'GET /repos/{owner}/{repo}/actions/runs') return { data: { total_count: 0, workflow_runs: [] } };
      if (route.includes('/check-runs')) return { data: { check_runs: runs } };
      if (route.includes('/status')) return { data: { statuses: [] } };
      throw new Error('unexpected ' + route);
    }
  };
}
const run = (name, conclusion = 'success') => ({ id: 1, name, status: conclusion ? 'completed' : 'in_progress', conclusion, started_at: '2026-10-23T00:00:00Z' });
const call = (o) => ciState(o, { owner: 'o', repo: 'r', baseBranch: 'main', headSha: 'a'.repeat(40) });

describe('ciState on a plan that cannot hold rules or protection', () => {
  it('treats the exact plan-limit answer as "none configured", is green when every reported check passes, and discloses it', async () => {
    const r = await call(octokit({ rules: err(403, PLAN), classic: err(403, PLAN), runs: [run('ci')] }));
    expect(r.green).toBe(true);
    expect(r.basis).toBe('all-checks');
    expect(r.errors).toEqual([]);
    expect(r.notes).toHaveLength(2);
  });
  it('is still not green while a check is pending or failing, or nothing has reported', async () => {
    expect((await call(octokit({ rules: err(403, PLAN), classic: err(403, PLAN), runs: [run('ci', null)] }))).green).toBe(false);
    expect((await call(octokit({ rules: err(403, PLAN), classic: err(403, PLAN), runs: [run('ci', 'failure')] }))).green).toBe(false);
    expect((await call(octokit({ rules: err(403, PLAN), classic: err(403, PLAN), runs: [] }))).green).toBe(false);
  });
  it('keeps any other 403 or failure as unknown, never green', async () => {
    const other = err(403, 'Resource not accessible by integration');
    const r = await call(octokit({ rules: other, classic: err(403, PLAN), runs: [run('ci')] }));
    expect(r.green).toBeNull();
    expect(r.errors[0]).toContain('HTTP 403');
    const r2 = await call(octokit({ rules: err(500, 'boom'), classic: err(404, 'Not Found'), runs: [run('ci')] }));
    expect(r2.green).toBeNull();
  });
  it('does not accept a look-alike message from a different status', async () => {
    const r = await call(octokit({ rules: err(404, PLAN), classic: err(404, 'Not Found'), runs: [run('ci')] }));
    expect(r.green).toBeNull();
  });
});
