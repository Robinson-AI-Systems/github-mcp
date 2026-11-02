import { describe, expect, it } from 'vitest';
import { acceptedPermissions, describeGithubError, describeGraphqlErrors, explainGithubError, ruleViolations } from '../../src/tools/errors.js';
import { GithubClientError } from '../../src/github/errors.js';
import { withTimeZone } from '../../src/core/time-zone.js';

const err = (status, data = {}, headers = {}) => Object.assign(new Error(data.message ?? 'x'), { status, response: { data, headers: { 'x-github-request-id': 'AB12:34', ...headers } } });
const d = (status, data, headers, opts) => describeGithubError(err(status, data, headers), opts);

describe('every explanation has what, why, next and a technical line with the request id', () => {
  it('for each rule', () => {
    const cases = [
      err(401, { message: 'Bad credentials' }),
      err(403, { message: 'Resource not accessible by integration' }, { 'x-accepted-github-permissions': 'pull_requests=write; contents=write' }),
      err(403, { message: 'You have exceeded a secondary rate limit.' }, { 'retry-after': '60' }),
      err(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1791700000' }),
      err(404, { message: 'Not Found' }), err(409, { message: 'Git Repository is empty.' }), err(422, { message: 'Validation Failed', errors: [{ resource: 'Issue', field: 'title', code: 'missing_field' }] }),
      err(451, { message: 'blocked' }), err(502, { message: 'Bad gateway' })
    ];
    for (const e of cases) {
      const x = describeGithubError(e);
      expect(x.what.length).toBeGreaterThan(10);
      expect(x.cause.length).toBeGreaterThan(10);
      expect(x.todo.length).toBeGreaterThan(5);
      expect(x.technical).toContain('request id AB12:34');
    }
  });
});

describe('specific rules', () => {
  it('401 sends the owner to the setup page', () => expect(d(401, { message: 'Bad credentials' }).todo).toContain('setup page'));
  it('403 with genuine accepted permissions provides conditional grant comparison', () => {
    const x = d(403, { message: 'Resource not accessible by integration' }, { 'x-accepted-github-permissions': 'pull_requests=write; issues=read' });
    expect(x.kind).toBe('forbidden');
    expect(x.what).toContain('pull requests (write), issues (read)');
    expect(x.todo).toContain('only if it is missing');
    expect(x.cause).toContain('not a proven missing grant');
    expect(acceptedPermissions('a_b=read, c=admin')).toEqual([{ permission: 'a_b', level: 'read' }, { permission: 'c', level: 'admin' }]);
    expect(acceptedPermissions('')).toEqual([]);
    expect(acceptedPermissions('Bad Value!!')).toEqual([]);
  });
  it('403 without a real grant header preserves integration refusal without inventing missing consent', () => {
    expect(d(403, { message: 'Resource not accessible by integration' }).kind).toBe('forbidden');
  });
  it('separates primary from secondary rate limits and shows the reset in the person\'s time zone, UTC when none is saved', () => {
    const primary0 = d(403, { message: 'API rate limit exceeded for installation' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Date.UTC(2026, 9, 10, 20, 0, 0) / 1000) });
    expect(primary0.todo).toContain('Oct 10, 2026, 8:00 PM UTC');
    withTimeZone('America/Denver', () => {
    const primary = d(403, { message: 'API rate limit exceeded for installation' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Date.UTC(2026, 9, 10, 20, 0, 0) / 1000) });
    expect(primary.kind).toBe('primary_rate_limit');
    expect(primary.todo).toContain('Oct 10, 2026, 2:00 PM MDT');
    const secondary = d(403, { message: 'You have exceeded a secondary rate limit' }, { 'retry-after': '90' });
    expect(secondary.kind).toBe('secondary_rate_limit');
    expect(secondary.todo).toContain('90 seconds');
    expect(d(429, { message: 'slow down' }).kind).toBe('primary_rate_limit');
    });
  });
  it('shows a winter reset in standard time (daylight-saving change)', () => {
    const x = d(429, {}, { 'x-ratelimit-reset': String(Date.UTC(2026, 10, 2, 20, 0, 0) / 1000) });
    expect(withTimeZone('America/Denver', () => d(429, {}, { 'x-ratelimit-reset': String(Date.UTC(2026, 10, 2, 20, 0, 0) / 1000) }).todo)).toContain('Nov 2, 2026, 1:00 PM MST');
    expect(x.todo).toContain('Nov 2, 2026, 8:00 PM UTC');
  });
  it('404 says "not found or no access" and names the account used', () => {
    const x = d(404, { message: 'Not Found' }, {}, { account: 'example-org' });
    expect(x.what).toContain('example-org');
    expect(x.cause).toContain('cannot see it');
  });
  it('409 variants: empty repository, conflict, sha mismatch', () => {
    expect(d(409, { message: 'Git Repository is empty.' }).kind).toBe('empty_repository');
    expect(d(409, { message: 'Merge conflict' }).kind).toBe('conflict');
    const sha = d(409, { message: 'is at abc but expected def: sha does not match' });
    expect(sha.kind).toBe('sha_mismatch');
    expect(sha.retryable).toBe(true);
  });
  it('422 lists each error field and code', () => {
    const x = d(422, { message: 'Validation Failed', errors: [{ resource: 'Issue', field: 'title', code: 'missing_field' }, 'Label name is invalid'] });
    expect(x.what).toContain('Issue title missing_field');
    expect(x.what).toContain('Label name is invalid');
  });
  it('422 repository rule violations list each rule and ruleset name', () => {
    const data = { message: 'Repository rule violations found\n\n- Changes must be made through a pull request.\n- Required status check "ci" is expected.\n' };
    expect(ruleViolations(data)).toEqual(['Changes must be made through a pull request.', 'Required status check "ci" is expected.']);
    const x = d(422, data);
    expect(x.kind).toBe('rule_violation');
    expect(x.what).toContain('Changes must be made through a pull request.');
    expect(x.todo).toContain('never bypasses');
    const withMeta = ruleViolations({ message: 'Repository rule violations found', metadata: { rule_violations: [{ message: 'Needs review', ruleset_name: 'main-protection' }] } });
    expect(withMeta).toEqual(['Needs review (ruleset "main-protection")']);
  });
  it('required status check names the check and its state', () => {
    expect(d(405, { message: 'Required status check "ci" is expected.' }).kind).toBe('unknown');
    const expected = d(422, { message: 'Required status check "ci" is expected.' });
    expect(expected.what).toBe('The required check "ci" has not reported yet on this commit.');
    expect(d(422, { message: 'Required status check "lint" is failing.' }).what).toContain('is failing');
    expect(d(422, { message: 'Required status check "lint" is failing.' }).retryable).toBe(false);
  });
  it('"Base/Head branch was modified" says to re-read and retry', () => {
    const base = d(422, { message: 'Base branch was modified. Review and try the merge again.' });
    expect(base.kind).toBe('branch_moved');
    expect(base.what).toContain('base branch');
    expect(d(409, { message: 'Head branch was modified. Review and try the merge again.' }).what).toContain('head branch');
  });
  it('451 says unavailable for legal reasons', () => expect(d(451, { message: 'x' }).kind).toBe('unavailable_legal'));
  it('5xx and network failures say the change may not have been made', () => {
    expect(d(503, {}).todo).toContain('Check the current state');
    expect(describeGithubError(new Error('socket hang up')).kind).toBe('network');
  });
  it('unknown errors fall back to the plain status line', () => {
    const x = d(418, { message: 'I am a teapot' });
    expect(x.kind).toBe('unknown');
    expect(x.what).toBe('GitHub refused the change (HTTP 418).');
  });
  it('the server\'s own client errors keep their message', () => {
    const x = describeGithubError(new GithubClientError('rate_limited', 'Waiting is too long.', { reset_display: 'Oct 10, 2026, 3:00 PM MDT' }));
    expect(x.what).toBe('Waiting is too long.');
    expect(x.todo).toContain('Oct 10, 2026, 3:00 PM MDT');
    expect(x.retryable).toBe(true);
  });
  it('never repeats a credential found in an error message', () => {
    const text = explainGithubError(err(422, { message: 'bad token ghp_FAKE0123456789abcdef' }));
    expect(text.length).toBeLessThan(900);
  });
});

describe('GraphQL errors', () => {
  it('reports each error by path and type, and says when only part succeeded', () => {
    const r = describeGraphqlErrors([{ type: 'NOT_FOUND', path: ['repository', 'pullRequest'], message: 'x' }, { type: 'RATE_LIMITED', path: ['viewer'] }], { repository: { name: 'a' } });
    expect(r.partial).toBe(true);
    expect(r.problems[0]).toBe('repository.pullRequest was not found (or this credential cannot see it)');
    expect(r.summary.startsWith('Partly succeeded.')).toBe(true);
    expect(describeGraphqlErrors([{ message: 'weird' }], { a: null }).partial).toBe(false);
    expect(describeGraphqlErrors(undefined).problems).toEqual([]);
  });
});

describe('actual permissionless-header refusal regression',()=>{
  it.each([
    'allows_permissionless_access=true','allows_permissionless_access=write','organization_packages=write',
    'contents=true','issues=unknown','contents','issues=read=write','allows_permissionless_access=true; contents=write'
  ])('never synthesizes a grant from %s',header=>{
    expect(acceptedPermissions(header)).toEqual([]);
    const out=d(403,{message:'Resource not accessible by integration'},{'x-accepted-github-permissions':header});
    expect(out.kind).toBe('forbidden');
    expect(out.cause).toContain('does not establish');
    expect(out.todo).toContain('supported credential type');
    expect(out.what+' '+out.todo).not.toMatch(/needs the|add .*permission|allows permissionless access|organization packages/);
    expect(out.technical).toContain('HTTP 403');expect(out.technical).toContain('request id AB12:34');
  });
  it('keeps genuine explicit grants while ignoring an invalid neighboring entry',()=>{
    expect(acceptedPermissions('contents=write, metadata=read; members=admin, other=true')).toEqual([
      {permission:'contents',level:'write'},{permission:'metadata',level:'read'},{permission:'members',level:'admin'}]);
    expect(d(403,{message:'Resource not accessible by integration'},{'x-accepted-github-permissions':'contents=write'})).toMatchObject({kind:'forbidden',todo:expect.stringContaining('contents (write)')});
  });
  it('preserves rate-limit precedence over metadata flags',()=>{
    const out=d(403,{message:'You have exceeded a secondary rate limit.'},{'x-accepted-github-permissions':'allows_permissionless_access=true','retry-after':'60'});
    expect(out).toMatchObject({kind:'secondary_rate_limit',retryable:true});expect(out.todo).toContain('60 seconds');
  });
});

import { GithubClientError } from '../../src/github/errors.js';
import { it as itHint, expect as expectHint } from 'vitest';
itHint('an account outside the connection points collaborators to adding a place or asking the owner to install', () => {
  const x = describeGithubError(new GithubClientError('outside_scope', '"someone-else" is not one of the GitHub accounts this connection may use (me).'));
  expectHint(x.todo).toMatch(/Add a place/);
  expectHint(x.todo).toMatch(/\/connection\)/);
  expectHint(x.todo).toMatch(/ask its owner to install the GitHub App/);
});
