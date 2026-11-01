import { describe, expect, it } from 'vitest';
import { renderTrustBody, supportEmail, legalApproved, serviceStatus, TRUST_PAGES, LINKED_TRUST_PAGES, DRAFT_LABEL } from '../../src/tenancy/trust-pages.js';
import { publicTrust } from '../../src/tenancy/public-http.js';
import { brandFooter } from '../../src/brand/brand.js';

const res = () => { const r = { headers: {}, setHeader(k, v) { r.headers[k] = v; }, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; }, end(b) { r.body = b; return r; }, send(b) { r.body = b; return r; } }; return r; };
const on = { GITHUB_PUBLIC_CONNECT: 'enabled' };

describe('trust pages', () => {
  it('has the five pages and each carries the "not reviewed by a lawyer; not in effect" draft banner until approved', () => {
    expect([...TRUST_PAGES].sort()).toEqual(['privacy', 'security', 'status', 'support', 'terms']);
    expect(DRAFT_LABEL).toBe('DRAFT \u2014 not yet reviewed by a lawyer; not in effect.');
    for (const name of TRUST_PAGES) {
      const draft = renderTrustBody(name, {});
      expect(draft.html).toContain('DRAFT');
      expect(draft.html).toContain('not yet reviewed by a lawyer; not in effect.');
      // A draft never claims to be in effect or approved.
      expect(draft.html).not.toContain('Effective:');
      expect(draft.html).not.toContain('Approved by the owner');
      const approval = name === 'status' ? { STATUS_PAGE_APPROVED: 'yes' } : { LEGAL_APPROVED: 'yes' };
      const final = renderTrustBody(name, approval);
      expect(final.html).not.toContain('DRAFT');
      expect(final.html).not.toContain('Status:');
    }
    // The owner's 2026-10-25 approval of the four pages does not approve the new status page.
    expect(renderTrustBody('status', { LEGAL_APPROVED: 'yes' }).html).toContain('DRAFT');
    expect(renderTrustBody('privacy', { LEGAL_APPROVED: 'yes' }).html).toContain('Effective:');
    expect(legalApproved({ LEGAL_APPROVED: 'Yes' })).toBe(false);
  });
  it('status page says how the service is set up right now, from switch names only', () => {
    expect(serviceStatus({})).toEqual({ sign_in: 'off', new_people: 'closed', version: null });
    expect(serviceStatus({ GITHUB_PUBLIC_CONNECT: 'enabled' }).new_people).toBe('open');
    expect(serviceStatus({ GITHUB_PUBLIC_CONNECT: 'enabled', GITHUB_PUBLIC_INVITE_ONLY: 'enabled' }).new_people).toBe('invite-only');
    expect(serviceStatus({ GITHUB_PUBLIC_CONNECT: 'enabled', GITHUB_PUBLIC_NEW_SIGNUPS: 'paused', GITHUB_PUBLIC_INVITE_ONLY: 'enabled' }).new_people).toBe('paused by the owner');
    expect(serviceStatus({ VERCEL_GIT_COMMIT_SHA: 'b'.repeat(40) }).version).toBe('b'.repeat(12));
    expect(serviceStatus({ VERCEL_GIT_COMMIT_SHA: '<script>' }).version).toBeNull();
    const html = renderTrustBody('status', { GITHUB_PUBLIC_CONNECT: 'enabled', GITHUB_PUBLIC_INVITE_ONLY: 'enabled' }).html;
    expect(html).toContain('Right now');
    expect(html).toContain('invite-only');
    expect(html).not.toContain('<script');
  });
  it('shows "coming soon" until a valid support email is set, then a mailto link', () => {
    expect(renderTrustBody('support', {}).html).toContain('support email coming soon');
    expect(renderTrustBody('support', { PUBLIC_SUPPORT_EMAIL: 'not an email' }).html).toContain('coming soon');
    expect(supportEmail({ PUBLIC_SUPPORT_EMAIL: 'help@example.test' })).toBe('help@example.test');
    expect(renderTrustBody('security', { PUBLIC_SUPPORT_EMAIL: 'help@example.test' }).html).toContain('href="mailto:help@example.test"');
  });
  it('never turns draft text into markup', () => {
    const html = renderTrustBody('privacy', { PUBLIC_SUPPORT_EMAIL: 'a"><script>@example.test' }).html;
    expect(html).not.toContain('<script');
    expect(html).toContain('<h2>');
    expect(html).toContain('<li>');
  });
  it('answers GET only, only for the five names, and is off while the public sign-in is off', async () => {
    const ok = res(); await publicTrust({ method: 'GET', query: { page: 'terms' } }, ok, { env: on });
    expect(ok.code).toBe(200); expect(String(ok.body)).toContain('Terms of use');
    const bad = res(); await publicTrust({ method: 'GET', query: { page: 'nope' } }, bad, { env: on });
    expect(bad.code).toBe(404);
    const post = res(); await publicTrust({ method: 'POST', query: { page: 'terms' } }, post, { env: on });
    expect(post.code).toBe(405);
    const off = res(); await publicTrust({ method: 'GET', query: { page: 'terms' } }, off, { env: {} });
    expect(off.code).not.toBe(200);
  });
  it('links the four approved pages from the footer, and not the draft status page (PUB-7: not linked until Chris approves)', () => {
    for (const name of LINKED_TRUST_PAGES) expect(brandFooter()).toContain(`href="/${name}"`);
    expect(brandFooter()).not.toContain('href="/status"');
  });
});
