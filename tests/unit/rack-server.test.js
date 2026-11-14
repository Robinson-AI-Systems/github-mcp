import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FILE_ROUTES, BRACKET_ROUTES, REWRITES, pinReleaseCommit } from '../../rack-server.mjs';

// S-2 contract pins: the rack entrypoint must reproduce the Vercel
// route contract — every api/ function file bound, every vercel.json
// rewrite present, bracket doors bound as query parameters.
const vercel = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));

function apiFiles(dir = 'api', prefix = '/api') {
  const out = [];
  for (const name of readdirSync(new URL('../../' + dir, import.meta.url), { withFileTypes: true })) {
    if (name.isDirectory()) out.push(...apiFiles(`${dir}/${name.name}`, `${prefix}/${name.name}`));
    else if (name.name.endsWith('.js')) out.push(`${prefix}/${name.name.slice(0, -3)}`);
  }
  return out;
}

describe('rack entrypoint route contract (S-2)', () => {
  it('binds every api/ function file', () => {
    const missing = [];
    for (const routePath of apiFiles()) {
      if (FILE_ROUTES.has(routePath)) continue;
      if (BRACKET_ROUTES.some((b) => b.pattern.test(routePath.replace(/\[.+?\]/, 'x')))) continue;
      // an index.js also answers at its directory path; the file path itself must exist too
      missing.push(routePath);
    }
    expect(missing).toEqual([]);
    expect(FILE_ROUTES.size).toBeGreaterThanOrEqual(30);
  });
  it('reproduces every vercel.json rewrite', () => {
    for (const rewrite of vercel.rewrites) {
      expect(REWRITES.has(rewrite.source), `rewrite ${rewrite.source}`).toBe(true);
      const entry = REWRITES.get(rewrite.source);
      expect(FILE_ROUTES.has(entry.route), `destination ${rewrite.destination}`).toBe(true);
    }
    expect(REWRITES.size).toBe(vercel.rewrites.length);
  });
  it('serves the scoped protected-resource document and the Muse client document', () => {
    expect(REWRITES.get('/.well-known/oauth-protected-resource/api/mcp'))
      .toEqual({ route: '/api/well-known/oauth-protected-resource', query: {} });
    expect(REWRITES.get('/.well-known/muse-client.json'))
      .toEqual({ route: '/api/well-known/muse-client', query: {} });
    expect(FILE_ROUTES.has('/api/well-known/muse-client')).toBe(true);
  });
  it('pins the release commit only from a valid 40-hex source', () => {
    const env = {};
    expect(pinReleaseCommit(env)).toBe(null);
    env.RACK_RELEASE_COMMIT = 'not-a-sha';
    expect(pinReleaseCommit(env)).toBe(null);
    env.RACK_RELEASE_COMMIT = 'f21fad344d704bd1ea85b10da6da58de515d09e3';
    expect(pinReleaseCommit(env)).toBe('f21fad344d704bd1ea85b10da6da58de515d09e3');
    expect(env.VERCEL_GIT_COMMIT_SHA).toBe('f21fad344d704bd1ea85b10da6da58de515d09e3');
  });
});
