// GOD-6: requests only the Robinson GitHub MCP app can make (check runs, /app, /installation). The list is built from the
// vendored GitHub description, so it cannot drift; these tests pin that and the matching rules.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildAppOnlyRoutes, render } from '../../scripts/build-app-only-routes.mjs';
import { APP_ONLY, APP_ONLY_GRAPHQL } from '../../src/github/app-only-routes.js';
import { isAppOnly } from '../../src/github/app-only.js';

describe('the app-only list', () => {
  it('is exactly what the build script produces from the vendored description (committed file is in sync)', () => {
    expect(buildAppOnlyRoutes()).toEqual([...APP_ONLY]);
    expect(render(buildAppOnlyRoutes())).toBe(readFileSync(new URL('../../src/github/app-only-routes.js', import.meta.url), 'utf8'));
    expect([...APP_ONLY_GRAPHQL]).toContain('createCheckRun');
  });
});

describe('isAppOnly', () => {
  it('is true for check runs, the app itself, installation requests and absolute next-page URLs', () => {
    expect(isAppOnly('POST', '/repos/a/b/check-runs')).toBe(true);
    expect(isAppOnly('PATCH', '/repos/a/b/check-runs/5')).toBe(true);
    expect(isAppOnly('GET', '/app')).toBe(true);
    expect(isAppOnly('GET', '/installation/repositories')).toBe(true);
    expect(isAppOnly('GET', 'https://api.github.com/app/installations?page=2')).toBe(true);
  });
  it('is true for the check mutations in a GraphQL document, false for ordinary ones', () => {
    expect(isAppOnly('POST', '/graphql', 'mutation { createCheckRun(input: {}) { checkRun { id } } }')).toBe(true);
    expect(isAppOnly('POST', '/graphql', 'mutation { createIssue(input: {}) { issue { id } } }')).toBe(false);
  });
  it('is false for ordinary repository requests', () => {
    expect(isAppOnly('GET', '/repos/a/b')).toBe(false);
    expect(isAppOnly('POST', '/repos/a/b/issues')).toBe(false);
    expect(isAppOnly('GET', '/repos/a/b/check-runs/5')).toBe(false);
  });
  it('treats an unreadable address as app-only (the safe side)', () => {
    expect(isAppOnly('GET', 'http://[bad')).toBe(true);
  });
});
