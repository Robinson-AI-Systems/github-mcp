// RAS MCP Standard D-006 MC-8: plain `muse` is the Client ID anyone can type.
// It is swapped for this server's fixed public Muse client as the request
// arrives, so every later door sees the client it always has.
import { describe, expect, it } from 'vitest';
import { applyMuseNickname, MUSE_CLIENT_NICKNAME } from '../../src/oauth/routes.js';
import { MUSE_PUBLIC_CLIENT_ID } from '../../src/tenancy/muse-client.js';
import { isPublicClientId } from '../../src/tenancy/public-code.js';
import { renderHome } from '../../src/brand/home-page.js';

describe('the muse nickname', () => {
  it('maps to the fixed public client, which the public doors already accept', () => {
    expect(MUSE_CLIENT_NICKNAME).toBe('muse');
    expect(isPublicClientId(MUSE_PUBLIC_CLIENT_ID)).toBe(true);
  });
  it('is swapped in a GET query, a parsed body, a form body and a JSON body', () => {
    const get = { method: 'GET', query: { client_id: 'muse', state: 's' } };
    applyMuseNickname(get);
    expect(get.query).toEqual({ client_id: MUSE_PUBLIC_CLIENT_ID, state: 's' });
    const parsed = { method: 'POST', body: { client_id: 'muse', grant_type: 'refresh_token' } };
    applyMuseNickname(parsed);
    expect(parsed.body.client_id).toBe(MUSE_PUBLIC_CLIENT_ID);
    const form = { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=authorization_code&client_id=muse&code=c' };
    applyMuseNickname(form);
    expect(new URLSearchParams(form.body).get('client_id')).toBe(MUSE_PUBLIC_CLIENT_ID);
    expect(new URLSearchParams(form.body).get('code')).toBe('c');
    const json = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_id: 'muse' }) };
    applyMuseNickname(json);
    expect(JSON.parse(json.body).client_id).toBe(MUSE_PUBLIC_CLIENT_ID);
  });
  it('leaves every other client id, and lookalikes, untouched', () => {
    for (const id of ['Muse', 'muse ', 'muse2', 'pcl_other', 'https://example.test/c.json']) {
      const req = { method: 'GET', query: { client_id: id } };
      applyMuseNickname(req);
      expect(req.query.client_id).toBe(id);
    }
    const form = { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'client_id=other' };
    applyMuseNickname(form);
    expect(form.body).toBe('client_id=other');
  });
  it('the home page tells Muse users to type muse', () => {
    const html = renderHome('https://github.example.test');
    expect(html).toContain('<code class="addr" id="muse-client-id">muse</code>');
    expect(html).toContain('use muse and leave Client Secret blank');
  });
});
