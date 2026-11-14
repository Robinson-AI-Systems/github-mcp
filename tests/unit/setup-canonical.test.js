import { describe, expect, it } from 'vitest';
import { canonicalSetupUrl } from '../../src/github/setup-canonical.js';

const ORIGIN = 'https://github-dev.robinsonaisystems.com';

describe('canonicalSetupUrl', () => {
  it('serves the page when the browser used the configured host directly', () => {
    expect(canonicalSetupUrl({ headers: { host: 'github-dev.robinsonaisystems.com' } }, ORIGIN)).toBeNull();
  });

  it('serves the page behind a proxy that forwards the public host (no redirect loop)', () => {
    const req = { headers: { host: '10.160.3.2:8787', 'x-forwarded-host': 'github-dev.robinsonaisystems.com' } };
    expect(canonicalSetupUrl(req, ORIGIN)).toBeNull();
  });

  it('uses the first forwarded host when a chain is present', () => {
    const req = { headers: { host: '127.0.0.1:9000', 'x-forwarded-host': 'GitHub-Dev.RobinsonAISystems.com, edge.internal' } };
    expect(canonicalSetupUrl(req, ORIGIN)).toBeNull();
  });

  it('still redirects a browser that reached the server on another public name', () => {
    const req = { headers: { host: '10.160.3.2:8787', 'x-forwarded-host': 'd-abc-github.rack.robinsonaisystems.com' }, query: {} };
    expect(canonicalSetupUrl(req, ORIGIN)).toBe(`${ORIGIN}/api/github/setup`);
  });

  it('redirects to the configured origin only, never the forwarded one', () => {
    const req = { headers: { host: 'x', 'x-forwarded-host': 'evil.example.test' }, query: { installation_id: '42' } };
    expect(canonicalSetupUrl(req, ORIGIN)).toBe(`${ORIGIN}/api/github/setup?installation_id=42`);
  });

  it('without a forwarded header behaves as before', () => {
    const req = { headers: { host: 'other.example.test' }, query: {} };
    expect(canonicalSetupUrl(req, ORIGIN)).toBe(`${ORIGIN}/api/github/setup`);
  });
});
