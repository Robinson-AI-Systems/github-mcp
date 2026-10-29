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
    expect(html).toContain(`${TENANT_RUNTIME_LIMITS.mcpClientPerMinute} a minute per app`);
    expect(html).toContain(`${TENANT_RUNTIME_LIMITS.mcpTenantPerMinute} a minute in total`);
    expect(html).toContain('Saved results');
    expect(html).toContain('Job creation has no daily quota.');
    const jobs=html.match(/Background jobs[\s\S]*?<\/div>/)?.[0];
    expect(jobs).toContain(`${TENANT_RUNTIME_LIMITS.jobsTenantPending} active at once; no daily job-creation limit`);
    expect(jobs).not.toMatch(/null|undefined|\d+ a day/);
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
