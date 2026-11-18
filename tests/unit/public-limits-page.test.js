import { describe, expect, it } from 'vitest';
import { publicLimits } from '../../src/tenancy/public-http.js';
import { TENANT_RUNTIME_LIMITS } from '../../src/tenancy/runtime-limits.js';

const res = () => { const r = { headers: {}, setHeader(k, v) { r.headers[k] = v; }, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; }, end(b) { r.body = b; return r; }, send(b) { r.body = b; return r; } }; return r; };

describe('/limits page', () => {
  it('states the enforced numbers in plain words and is off while the public sign-in is off', async () => {
    const on = res();
    await publicLimits({ method: 'GET' }, on, { env: { GITHUB_PUBLIC_CONNECT: 'enabled' } });
    expect(on.code).toBe(200);
    const html = String(on.body);
    // LIMITS-MATCH-GITHUB-1: no limit of ours, so the page says GitHub's own limits apply.
    expect(TENANT_RUNTIME_LIMITS.mcpClientPerMinute).toBeNull();
    expect(html).toContain('adds no usage limit of its own');
    expect(html).toContain('about 5,000 GitHub API calls an hour');
    const calls=html.match(/Assistant calls[\s\S]*?<\/div>/)?.[0];
    expect(calls).toContain('No limit of ours; GitHub&#39;s own limits apply'.replace('&#39;', "'"));
    expect(html).toContain('Saved results');
    expect(html).toContain('each up to 16 MB');
    expect(html).toContain('No fixed request or workspace count; resource-based admission and four-hour inactivity cleanup');
    const jobs=html.match(/Background jobs[\s\S]*?<\/div>/)?.[0];
    expect(jobs).toContain('No limit of ours');
    expect(html).not.toMatch(/null|undefined|NaN/);
    expect(html).not.toMatch(/ghp_|github_pat_|secret/i);
    const off = res();
    await publicLimits({ method: 'GET' }, off, { env: {} });
    expect(off.code).not.toBe(200);
  });
  it('only answers GET', async () => {
    const r = res();
    await publicLimits({ method: 'POST' }, r, { env: { GITHUB_PUBLIC_CONNECT: 'enabled' } });
    expect(r.code).toBe(405);
  });
});
