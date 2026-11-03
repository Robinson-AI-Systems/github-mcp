import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCimdClientCache, cimdAdmitsPublicClient, isBlockedCimdHost, isCimdClientId, resolveCimdClient } from '../../src/tenancy/cimd-client.js';

// Fixtures mirror the LIVE documents fetched 2026-11-02 (shapes only; no live network here).
const CLAUDE_ID = 'https://claude.ai/oauth/mcp-oauth-client-metadata';
const CLAUDE_DOC = {
  client_id: CLAUDE_ID, client_name: 'Claude', client_uri: 'https://claude.ai',
  redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
  grant_types: ['authorization_code', 'refresh_token', 'urn:ietf:params:oauth:grant-type:jwt-bearer'],
  response_types: ['code'], token_endpoint_auth_method: 'none',
};
const CHATGPT_ID = 'https://chatgpt.com/oauth/client.json';
const CHATGPT_DOC = {
  client_id: CHATGPT_ID, client_uri: 'https://chatgpt.com/',
  redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
  token_endpoint_auth_method: 'private_key_jwt',
  token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'],
  grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
  client_name: 'ChatGPT', token_endpoint_auth_signing_alg: 'RS256',
};
const docFetch = (docs) => vi.fn(async (url) => {
  const doc = docs[url];
  return doc ? { ok: true, status: 200, text: async () => JSON.stringify(doc) }
             : { ok: false, status: 404, text: async () => 'not found' };
});
beforeEach(() => clearCimdClientCache());

describe('CIMD client_id shape + host guards', () => {
  it('accepts public https document addresses and refuses everything else', () => {
    expect(isCimdClientId(CLAUDE_ID)).toBe(true);
    expect(isCimdClientId(CHATGPT_ID)).toBe(true);
    for (const bad of ['pcl_meta_muse_public_client_20261026_v1xyz', 'http://claude.ai/oauth/x',
      'https://localhost/oauth/x', 'https://127.0.0.1/oauth/x', 'https://[::1]/oauth/x',
      'https://192.168.1.10/oauth/x', 'https://10.0.0.5/oauth/x', 'https://172.16.0.9/oauth/x',
      'https://169.254.1.1/oauth/x', 'https://user:pass@claude.ai/oauth/x', 'not a url', '', null, 42])
      expect(isCimdClientId(bad), String(bad)).toBe(false);
    expect(isBlockedCimdHost('example.com')).toBe(false);
    expect(isBlockedCimdHost('172.32.0.1')).toBe(false);
  });
});

describe('CIMD auth-method intersection (the PenPal ChatGPT trap)', () => {
  it('admits a document whose only method is "none" (Claude shape)', () => {
    expect(cimdAdmitsPublicClient(CLAUDE_DOC)).toBe(true);
  });
  it('admits ChatGPT: singular private_key_jwt but plural includes "none"', () => {
    expect(cimdAdmitsPublicClient(CHATGPT_DOC)).toBe(true);
  });
  it('refuses when the intersection is empty', () => {
    expect(cimdAdmitsPublicClient({ token_endpoint_auth_method: 'private_key_jwt' })).toBe(false);
    expect(cimdAdmitsPublicClient({ token_endpoint_auth_methods_supported: ['private_key_jwt'] })).toBe(false);
    expect(cimdAdmitsPublicClient({ token_endpoint_auth_method: 'client_secret_post',
      token_endpoint_auth_methods_supported: ['client_secret_basic'] })).toBe(false);
  });
});

describe('resolveCimdClient with a mocked fetch', () => {
  it('resolves Claude and ChatGPT from their real document shapes', async () => {
    const fetchImpl = docFetch({ [CLAUDE_ID]: CLAUDE_DOC, [CHATGPT_ID]: CHATGPT_DOC });
    const claude = await resolveCimdClient(CLAUDE_ID, { fetchImpl });
    expect(claude).toMatchObject({ client_id: CLAUDE_ID, token_endpoint_auth_method: 'none', client_secret_hash: null });
    expect(claude.redirect_uris).toEqual(['https://claude.ai/api/mcp/auth_callback']);
    // Consent names the HOST, never the self-asserted client_name.
    expect(claude.client_name).toBe('claude.ai');
    const chatgpt = await resolveCimdClient(CHATGPT_ID, { fetchImpl });
    expect(chatgpt).toMatchObject({ client_id: CHATGPT_ID, token_endpoint_auth_method: 'none' });
    expect(chatgpt.redirect_uris).toEqual(['https://chatgpt.com/connector_platform_oauth_redirect']);
    expect(chatgpt.client_name).toBe('chatgpt.com');
  });
  it('refuses a document that names a different client_id than its address', async () => {
    const fetchImpl = docFetch({ [CLAUDE_ID]: { ...CLAUDE_DOC, client_id: 'https://evil.example.test/card' } });
    expect(await resolveCimdClient(CLAUDE_ID, { fetchImpl })).toBeNull();
  });
  it('refuses a document with no usable redirect list', async () => {
    const fetchImpl = docFetch({ [CLAUDE_ID]: { ...CLAUDE_DOC, redirect_uris: ['http://evil.example.test/cb'] } });
    expect(await resolveCimdClient(CLAUDE_ID, { fetchImpl })).toBeNull();
    clearCimdClientCache();
    const empty = docFetch({ [CLAUDE_ID]: { ...CLAUDE_DOC, redirect_uris: [] } });
    expect(await resolveCimdClient(CLAUDE_ID, { fetchImpl: empty })).toBeNull();
  });
  it('never fetches a blocked-host or non-https client_id', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('must not be called'); });
    expect(await resolveCimdClient('https://192.168.0.8/card.json', { fetchImpl })).toBeNull();
    expect(await resolveCimdClient('http://claude.ai/oauth/x', { fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('refuses on fetch failure, non-200 and oversized documents', async () => {
    expect(await resolveCimdClient(CLAUDE_ID, { fetchImpl: async () => { throw new Error('down'); } })).toBeNull();
    expect(await resolveCimdClient(CLAUDE_ID, { fetchImpl: docFetch({}) })).toBeNull();
    const big = docFetch({ [CLAUDE_ID]: CLAUDE_DOC });
    expect(await resolveCimdClient(CLAUDE_ID, { fetchImpl: big, maxBytes: 16 })).toBeNull();
  });
  it('refuses a ChatGPT-shaped document when "none" leaves the plural list', async () => {
    const doc = { ...CHATGPT_DOC, token_endpoint_auth_methods_supported: ['private_key_jwt'] };
    expect(await resolveCimdClient(CHATGPT_ID, { fetchImpl: docFetch({ [CHATGPT_ID]: doc }) })).toBeNull();
  });
});
