import { describe, expect, it } from 'vitest';
import { bareOctokit } from '../../src/github/client.js';
import { FINE_PROBES, readFinePermissions } from '../../src/github/fine-grained.js';
import { makeFakeGitHub } from '../../test/helpers/fake-github.js';

// PUB-9: every request a fine-grained token enrollment sends (who it is, which repositories, the harmless permission reads)
// goes through the shared client and validates against the vendored REST description.
describe('fine-grained token enrollment request shapes', () => {
  it('identity, repository list and every permission probe are valid pinned requests', async () => {
    const gh = makeFakeGitHub();
    gh.when('GET /user').reply(200, { id: 31001, login: 'alice-dev' });
    gh.when('GET /user/repos').reply(200, []);
    for (const p of FINE_PROBES) gh.when(p.route).reply(p.permission === 'issues' ? 403 : 200,
      p.permission === 'issues' ? { message: 'Resource not accessible by personal access token' } : []);
    const octokit = bareOctokit({ token: 'github_pat_FAKEshape0001', fetch: gh.fetch });
    await octokit.request('GET /user');
    await octokit.request('GET /user/repos', { per_page: 100, page: 1, sort: 'full_name' });
    const user = await readFinePermissions((route, params) => octokit.request(route, params), { owner: 'alice-dev', repo: 'web', ref: 'main', scope: 'user' });
    const org = await readFinePermissions((route, params) => octokit.request(route, params), { owner: 'acme-co', repo: 'web', ref: 'main', scope: 'org' });
    expect(gh.invalid).toEqual([]);
    expect(gh.unmatched).toEqual([]);
    expect(user).toContain('issues:none');
    expect(user).toContain('emails:read');
    expect(org).toContain('organization_hooks:read');
    expect(gh.calls.every((c) => c.method === 'GET')).toBe(true);
    expect(gh.calls.every((c) => c.headers['x-github-api-version'])).toBe(true);
  });
});
