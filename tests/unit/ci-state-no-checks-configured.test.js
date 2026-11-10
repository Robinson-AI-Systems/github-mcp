import { describe, it, expect } from 'vitest';
import { ciState } from '../../src/github/ci-state.js';

// Owner feedback 2026-11-09: a repository with no checks at all (the library repo) could never be merged with
// "merge when green" because "no checks yet" waited forever. Only a proven zero-workflow repository is treated as
// having nothing to wait for; every uncertain case stays fail-closed.
const err = (status, message) => Object.assign(new Error(message), { status, response: { data: { message } } });
function octokit({ runs = [], statuses = [], workflows = 0, workflowsError = null }) {
  return {
    async request(route) {
      if (route.includes('/rules/branches/')) return { data: [] };
      if (route.includes('/protection/required_status_checks')) throw err(404, 'Not Found');
      if (route.includes('/check-runs')) return { data: { check_runs: runs, total_count: runs.length } };
      if (route.includes('/commits/{ref}/status')) return { data: { statuses } };
      if (route === 'GET /repos/{owner}/{repo}/actions/workflows') { if (workflowsError) throw workflowsError; return { data: { total_count: workflows, workflows: [] } }; }
      throw new Error('unexpected ' + route);
    }
  };
}
const call = (o) => ciState(o, { owner: 'o', repo: 'r', baseBranch: 'main', headSha: 'a'.repeat(40) });

describe('ciState: repository with no checks configured', () => {
  it('is green with its own basis and a plain note when nothing is required and there are no workflows', async () => {
    const r = await call(octokit({ workflows: 0 }));
    expect(r).toMatchObject({ green: true, known: true, basis: 'no-checks-configured', problems: [] });
    expect(r.notes.join(' ')).toMatch(/no GitHub Actions workflows/);
  });
  it('keeps waiting (not green) when workflows exist but nothing has reported yet', async () => {
    const r = await call(octokit({ workflows: 2 }));
    expect(r.green).toBe(false);
    expect(r.problems[0]).toMatch(/no checks have reported/);
  });
  it('is unknown-safe: an unreadable workflow list never becomes green', async () => {
    const r = await call(octokit({ workflowsError: err(403, 'Resource not accessible') }));
    expect(r.green).toBe(false);
    expect(r.basis).toBe('all-checks');
  });
  it('does not apply when a commit status exists', async () => {
    const r = await call(octokit({ statuses: [{ context: 'x', state: 'pending' }], workflows: 0 }));
    expect(r.green).toBe(false);
  });
  it('does not apply when a check run exists', async () => {
    const r = await call(octokit({ runs: [{ id: 1, name: 'ci', status: 'in_progress', started_at: '2026-11-09T00:00:00Z' }], workflows: 0 }));
    expect(r.green).toBe(false);
  });
});

describe('ciState: every check run with its duration', () => {
  it('lists all runs (not only required ones) with seconds, so a roll-up pass can be checked', async () => {
    const r = await call(octokit({ runs: [
      { id: 1, name: 'unit', status: 'completed', conclusion: 'success', started_at: '2026-11-09T00:00:00Z', completed_at: '2026-11-09T00:00:41Z', app: { slug: 'github-actions' } },
      { id: 2, name: 'test', status: 'completed', conclusion: 'success', started_at: '2026-11-09T00:00:50Z', completed_at: '2026-11-09T00:00:53Z', app: { slug: 'github-actions' } }] }));
    expect(r.all_runs).toEqual([
      { name: 'unit', status: 'completed', conclusion: 'success', seconds: 41, app: 'github-actions' },
      { name: 'test', status: 'completed', conclusion: 'success', seconds: 3, app: 'github-actions' }]);
  });
});
