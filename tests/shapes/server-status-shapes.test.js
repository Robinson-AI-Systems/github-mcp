// SRV-STATUS-1 request shapes: the release-history and deployment-time reads go through the shared client to the fake
// GitHub, which validates each request against the vendored OpenAPI description.
import { describe, expect, it } from 'vitest';
import { bareOctokit } from '../../src/github/client.js';
import { deploymentTime, liveHistory } from '../../src/tools/server-status.js';
import { makeWorld } from '../../test/helpers/write-contract.js';

const SHA = 'a'.repeat(40);
describe('github_server_status shapes against the pinned schema', () => {
  it('live history, deployments for one commit and their statuses are schema-valid', async () => {
    const w = await makeWorld({ mode: 'preview', profile: 'read_only' });
    w.gh.when('GET /repos/{owner}/{repo}/commits').reply(200, [{ sha: SHA, parents: [{ sha: 'b'.repeat(40) }, { sha: 'c'.repeat(40) }], commit: { message: 'Merge pull request #7 from x/y\n\nTitle', committer: { date: '2026-11-03T02:00:00Z' } } }]);
    w.gh.when('GET /repos/{owner}/{repo}/deployments').reply(200, [{ id: 9, sha: SHA, created_at: '2026-11-03T02:01:00Z' }]);
    w.gh.when('GET /repos/{owner}/{repo}/deployments/{deployment_id}/statuses').reply(200, [{ state: 'success', created_at: '2026-11-03T02:02:00Z' }]);
    const gh = bareOctokit({ fetch: w.gh.fetch });
    expect((await liveHistory(gh)).merges).toEqual([{ pr: 7, title: 'Title', merged_at: '2026-11-03T02:00:00Z', commit: SHA.slice(0, 12) }]);
    expect(await deploymentTime(gh, SHA, 'Production')).toEqual({ at: '2026-11-03T02:02:00Z', source: 'github_deployment_status' });
    expect(w.gh.unmatched).toEqual([]);
    expect(w.gh.invalid).toEqual([]);
  });
});
