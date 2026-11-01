// Contract for the GitHub App / account / credential store (A-5a). Run against the in-memory fake and real PostgreSQL.
// `make()` returns a fresh database. Only fake values appear here; "ciphertext" is any opaque string to the store.
import { describe, expect, it } from 'vitest';

const APP = { id: 424242, slug: 'example-org-mcp', ownerLogin: 'example-org', ownerType: 'Organization', clientId: 'Iv1.fixtureclientid',
  clientSecretEnc: 'v1.cs', privateKeyEnc: 'v1.pk', webhookSecretEnc: 'v1.wh', permissions: { contents: 'write', metadata: 'read' } };
const ORG = { login: 'example-org', accountId: 1001, accountType: 'Organization', label: 'Example Org', appId: 424242 };
const USER = { login: 'example-user', accountId: 1002, accountType: 'User', label: 'Example User' };
const future = (ms) => new Date(Date.now() + ms);

export function runCredentialsContract(name, make) {
  describe(`GitHub credential store: ${name}`, () => {
    it('saves an App with only ciphertext columns, replaces it on a second save, and returns null for an unknown id', async () => {
      const db = await make();
      expect(await db.getApp(APP.id)).toBeNull();
      await db.saveApp(APP);
      expect(await db.getApp(APP.id)).toEqual({ id: 424242, slug: 'example-org-mcp', owner_login: 'example-org', owner_type: 'Organization', client_id: 'Iv1.fixtureclientid',
        client_secret_enc: 'v1.cs', private_key_enc: 'v1.pk', webhook_secret_enc: 'v1.wh', permissions: { contents: 'write', metadata: 'read' } });
      await db.saveApp({ ...APP, privateKeyEnc: 'v1.pk2', permissions: { contents: 'read' } });
      expect(await db.getApp(APP.id)).toMatchObject({ private_key_enc: 'v1.pk2', permissions: { contents: 'read' } });
    });

    it('KEY-ROTATION: replaces one App secret only from the expected value, keeps the old one for its window, undoes and finishes', async () => {
      const db = await make();
      await db.saveApp(APP);
      const soon = future(24 * 3600e3);
      expect(await db.replaceAppSecret({ id: APP.id, kind: 'webhook_secret', expectedEnc: 'v1.stale', newEnc: 'v1.wh2', acceptedUntil: soon })).toBe(false);
      expect(await db.replaceAppSecret({ id: APP.id, kind: 'not_a_kind', expectedEnc: 'v1.wh', newEnc: 'v1.wh2', acceptedUntil: soon })).toBe(false);
      expect(await db.replaceAppSecret({ id: 1, kind: 'webhook_secret', expectedEnc: 'v1.wh', newEnc: 'v1.wh2', acceptedUntil: soon })).toBe(false);
      expect(await db.replaceAppSecret({ id: APP.id, kind: 'webhook_secret', expectedEnc: 'v1.wh', newEnc: 'v1.wh2', acceptedUntil: soon })).toBe(true);
      // Only that one column changed; the other two secrets are untouched.
      expect(await db.getApp(APP.id)).toMatchObject({ webhook_secret_enc: 'v1.wh2', private_key_enc: 'v1.pk', client_secret_enc: 'v1.cs' });
      expect((await db.getAppPreviousSecrets(APP.id)).map((p) => [p.kind, p.secret_enc])).toEqual([['webhook_secret', 'v1.wh']]);
      // A second replacement keeps exactly one previous value (the one just replaced).
      expect(await db.replaceAppSecret({ id: APP.id, kind: 'webhook_secret', expectedEnc: 'v1.wh2', newEnc: 'v1.wh3', acceptedUntil: soon })).toBe(true);
      expect((await db.getAppPreviousSecrets(APP.id)).map((p) => p.secret_enc)).toEqual(['v1.wh2']);
      // Undo only from the expected current value; it puts the previous value back and forgets the undone one.
      expect(await db.restorePreviousAppSecret({ id: APP.id, kind: 'webhook_secret', expectedEnc: 'v1.other' })).toBe(false);
      expect(await db.restorePreviousAppSecret({ id: APP.id, kind: 'webhook_secret', expectedEnc: 'v1.wh3' })).toBe(true);
      expect((await db.getApp(APP.id)).webhook_secret_enc).toBe('v1.wh2');
      expect(await db.getAppPreviousSecrets(APP.id)).toEqual([]);
      expect(await db.restorePreviousAppSecret({ id: APP.id, kind: 'webhook_secret', expectedEnc: 'v1.wh2' })).toBe(false);
      // Finish now removes the previous value at once.
      expect(await db.replaceAppSecret({ id: APP.id, kind: 'private_key', expectedEnc: 'v1.pk', newEnc: 'v1.pk2', acceptedUntil: soon })).toBe(true);
      expect(await db.endAppSecretOverlap({ id: APP.id, kind: 'private_key' })).toBe(true);
      expect(await db.endAppSecretOverlap({ id: APP.id, kind: 'private_key' })).toBe(false);
      expect(await db.getAppPreviousSecrets(APP.id)).toEqual([]);
      // A window that already ended is never returned and cannot be undone.
      expect(await db.replaceAppSecret({ id: APP.id, kind: 'client_secret', expectedEnc: 'v1.cs', newEnc: 'v1.cs2', acceptedUntil: new Date(Date.now() - 1000) })).toBe(true);
      expect(await db.getAppPreviousSecrets(APP.id)).toEqual([]);
      expect(await db.restorePreviousAppSecret({ id: APP.id, kind: 'client_secret', expectedEnc: 'v1.cs2' })).toBe(false);
      expect((await db.getApp(APP.id)).client_secret_enc).toBe('v1.cs2');
    });

    it('adds accounts: the first is the default, lookup ignores case, a duplicate GitHub id is refused', async () => {
      const db = await make();
      await db.upsertAccount(ORG);
      await db.upsertAccount(USER);
      expect((await db.getAccount('EXAMPLE-ORG')).is_default).toBe(true);
      expect((await db.getAccount('example-user')).is_default).toBe(false);
      expect(await db.getAccount('nobody')).toBeNull();
      expect((await db.listAccounts()).map((a) => a.login)).toEqual(['example-org', 'example-user']);
      await expect(db.upsertAccount({ ...USER, login: 'other-login', accountId: 1002 })).rejects.toThrow();
      expect(await db.getAccount('example-org')).toMatchObject({ account_id: 1001, app_id: 424242, installation_status: 'none', production_enabled: false, spend_limit_cents: 0, credential_kind: 'app' });
    });

    it('updating an account keeps production_enabled, the default flag, the installation and every credential', async () => {
      const db = await make();
      await db.upsertAccount(ORG);
      await db.setInstallation('example-org', { installationId: 777, repositorySelection: 'all', permissions: { contents: 'write' }, status: 'active' });
      await db.setUserAuthorization('example-org', { userLogin: 'example-user', tokenEnc: 'v1.ut', tokenExpiresAt: future(3600e3), refreshEnc: 'v1.rt', refreshExpiresAt: future(86400e3) });
      await db.upsertAccount({ ...ORG, label: 'Renamed' });
      expect(await db.getAccount('example-org')).toMatchObject({ label: 'Renamed', is_default: true, production_enabled: false, installation_id: 777, user_token_enc: 'v1.ut', app_id: 424242 });
      await db.upsertAccount({ login: 'example-org', accountId: 1001, accountType: 'Organization', label: 'Again' }); // no appId given: keep the stored one
      expect((await db.getAccount('example-org')).app_id).toBe(424242);
    });

    it('records an installation, a status change, a plan and refuses an unknown account', async () => {
      const db = await make();
      await db.upsertAccount(ORG);
      expect(await db.setInstallation('example-org', { installationId: 777, repositorySelection: 'selected', permissions: { issues: 'write' }, status: 'active' })).toBe(true);
      expect(await db.getAccount('example-org')).toMatchObject({ installation_id: 777, repository_selection: 'selected', installation_permissions: { issues: 'write' }, installation_status: 'active' });
      expect(await db.setInstallationStatus('example-org', 'suspended')).toBe(true);
      await db.setAccountPlan('example-org', 'team');
      expect(await db.getAccount('example-org')).toMatchObject({ installation_status: 'suspended', plan_name: 'team' });
      expect(await db.setInstallation('nobody', { installationId: 1, repositorySelection: 'all', permissions: {}, status: 'active' })).toBe(false);
      expect(await db.setInstallationStatus('nobody', 'active')).toBe(false);
    });

    it('atomically reserves one U refresh, rejects stale completion and preserves owner reauthorization', async () => {
      const db = await make();
      await db.upsertAccount(ORG);
      const original = { userLogin: 'example-user', tokenEnc: 'v1.old-token',
        tokenExpiresAt: future(60e3), refreshEnc: 'v1.old-refresh', refreshExpiresAt: future(86400e3) };
      await db.setUserAuthorization('example-org', original);
      const at = new Date(Date.now()), lease = new Date(at.getTime() + 60e3);
      expect(await db.claimUserRefresh('example-org', { expectedTokenEnc: original.tokenEnc, claimId: 'worker-a', at, expiresAt: lease })).toBe(true);
      expect(await db.claimUserRefresh('EXAMPLE-ORG', { expectedTokenEnc: original.tokenEnc, claimId: 'worker-b', at, expiresAt: lease })).toBe(false);
      const changed = { ...original, tokenEnc: 'v1.new-owner-token', refreshEnc: 'v1.new-owner-refresh' };
      await db.setUserAuthorization('example-org', changed);
      expect(await db.finishUserRefresh('example-org', { expectedTokenEnc: original.tokenEnc, claimId: 'worker-a',
        ...original })).toBe(false);
      expect(await db.clearUserAuthorizationIfClaim('example-org', original.tokenEnc, 'worker-a')).toBe(false);
      expect(await db.releaseUserRefreshClaim('example-org', 'worker-a')).toBe(false);
      expect(await db.clearUserAuthorizationIfCurrent('example-org', original.tokenEnc)).toBe(false);
      expect(await db.getAccount('example-org')).toMatchObject({ user_token_enc: changed.tokenEnc,
        user_refresh_enc: changed.refreshEnc, user_refresh_claim: null });
    });

    it('refreshes only under a current claim and clears only the invalid claimed authorization', async () => {
      const db = await make();
      await db.upsertAccount(ORG);
      const before = { userLogin: 'example-user', tokenEnc: 'v1.initial',
        tokenExpiresAt: future(60e3), refreshEnc: 'v1.initial-refresh', refreshExpiresAt: future(86400e3) };
      await db.setUserAuthorization('example-org', before);
      const at = new Date(Date.now()), expiresAt = new Date(at.getTime() + 60e3);
      expect(await db.claimUserRefresh('example-org', { expectedTokenEnc: before.tokenEnc, claimId: 'worker-a', at, expiresAt })).toBe(true);
      expect(await db.finishUserRefresh('example-org', { expectedTokenEnc: before.tokenEnc, claimId: 'worker-b',
        ...before, tokenEnc: 'v1.wrong' })).toBe(false);
      const good = { ...before, tokenEnc: 'v1.renewed', refreshEnc: 'v1.renewed-refresh' };
      expect(await db.finishUserRefresh('example-org', { expectedTokenEnc: before.tokenEnc,
        claimId: 'worker-a', ...good })).toBe(true);
      expect(await db.clearUserAuthorizationIfClaim('example-org', before.tokenEnc, 'worker-a')).toBe(false);
      expect(await db.getAccount('example-org')).toMatchObject({ user_token_enc: good.tokenEnc,
        user_refresh_enc: good.refreshEnc, user_refresh_claim: null });
      expect(await db.claimUserRefresh('example-org', { expectedTokenEnc: good.tokenEnc, claimId: 'worker-c', at, expiresAt })).toBe(true);
      expect(await db.clearUserAuthorizationIfClaim('example-org', good.tokenEnc, 'worker-c')).toBe(true);
      expect(await db.getAccount('example-org')).toMatchObject({ user_token_enc: null, user_refresh_enc: null, user_refresh_claim: null });
    });

    it('stores user, fine-grained and classic credentials as ciphertext and clears the user authorization', async () => {
      const db = await make();
      await db.upsertAccount(ORG);
      expect(await db.setFineGrainedToken('example-org', { enc: 'v1.fg', last4: 'ABCD', expiresAt: future(86400e3) })).toBe(true);
      expect(await db.setClassicToken('example-org', { enc: 'v1.cl', scopes: ['notifications'], last4: 'WXYZ' })).toBe(true);
      await db.setUserAuthorization('example-org', { userLogin: 'example-user', tokenEnc: 'v1.ut', tokenExpiresAt: future(3600e3), refreshEnc: 'v1.rt', refreshExpiresAt: future(86400e3) });
      expect(await db.getAccount('example-org')).toMatchObject({ fine_grained_enc: 'v1.fg', fine_grained_last4: 'ABCD', classic_enc: 'v1.cl', classic_scopes: ['notifications'], classic_last4: 'WXYZ', user_login: 'example-user' });
      await db.clearUserAuthorization('example-org');
      expect(await db.getAccount('example-org')).toMatchObject({ user_login: null, user_token_enc: null, user_refresh_enc: null, fine_grained_enc: 'v1.fg' });
      expect(await db.setFineGrainedToken('nobody', { enc: 'x', last4: 'x' })).toBe(false);
    });

    it('stores, replaces and clears dedicated package credentials without touching notifications or policy', async () => {
      const db = await make();
      await db.upsertAccount(ORG);
      await db.setClassicToken(ORG.login, { enc: 'v1.notifications', scopes: ['notifications'], last4: 'ABCD' });
      const expiry = future(3600e3);
      expect(await db.setPackageToken('EXAMPLE-ORG', { enc: 'v1.package-secret', scopes: ['read:packages'], actor: 'example-user', expiresAt: expiry })).toBe(true);
      await db.initSchema(); // Existing installations upgrade safely and repeated schema startup preserves credentials.
      const row = await db.getAccount(ORG.login);
      expect(row).toMatchObject({ package_enc: 'v1.package-secret', package_actor: 'example-user', production_enabled: false, classic_enc: 'v1.notifications' });
      expect(new Date(row.package_expires_at).getTime()).toBe(expiry.getTime());
      const listed = await db.listAccounts();
      expect(listed[0]).toMatchObject({ has_package: true, package_scopes: ['read:packages'], package_actor: 'example-user' });
      expect(JSON.stringify(listed)).not.toContain('v1.package-secret');
      expect(listed[0]).not.toHaveProperty('package_enc');
      await db.setPackageToken(ORG.login, { enc: 'v1.replacement', scopes: ['read:packages', 'delete:packages'], actor: 'example-user' });
      expect((await db.getAccount(ORG.login)).package_expires_at).toBeNull();
      expect(await db.clearPackageToken(ORG.login)).toBe(true);
      expect(await db.getAccount(ORG.login)).toMatchObject({ package_enc: null, package_scopes: null, package_actor: null, package_expires_at: null, classic_enc: 'v1.notifications' });
      expect(await db.setPackageToken('absent', { enc: 'v1.x', scopes: [], actor: 'nobody' })).toBe(false);
      expect(await db.clearPackageToken('absent')).toBe(false);
    });

    it('lists accounts without any ciphertext, only whether each credential exists', async () => {
      const db = await make();
      await db.upsertAccount(ORG);
      await db.setFineGrainedToken('example-org', { enc: 'v1.SECRETISH', last4: 'ABCD' });
      await db.setClassicToken('example-org', { enc: 'v1.SECRETISH2', scopes: ['notifications'], last4: 'WXYZ' });
      await db.setUserAuthorization('example-org', { userLogin: 'example-user', tokenEnc: 'v1.SECRETISH3', tokenExpiresAt: future(3600e3), refreshEnc: 'v1.SECRETISH4', refreshExpiresAt: future(86400e3) });
      const [row] = await db.listAccounts();
      expect(JSON.stringify(row)).not.toContain('SECRETISH');
      expect(Object.keys(row).filter((k) => k.endsWith('_enc'))).toEqual([]);
      expect(row).toMatchObject({ has_user_token: true, has_fine_grained: true, has_classic: true, fine_grained_last4: 'ABCD', classic_last4: 'WXYZ', classic_scopes: ['notifications'] });
    });

    it('caches an installation token per scope until five minutes before expiry', async () => {
      const db = await make();
      await db.putInstallationToken(777, 'all', 'v1.t1', future(3600e3));
      await db.putInstallationToken(777, 'repos:hello', 'v1.t2', future(3600e3));
      await db.putInstallationToken(777, 'short', 'v1.t3', future(4 * 60e3));
      expect((await db.getInstallationToken(777, 'all')).token_enc).toBe('v1.t1');
      expect((await db.getInstallationToken(777, 'repos:hello')).token_enc).toBe('v1.t2');
      expect(await db.getInstallationToken(777, 'short')).toBeNull();
      expect(await db.getInstallationToken(778, 'all')).toBeNull();
      await db.putInstallationToken(777, 'all', 'v1.t1b', future(7200e3));
      expect((await db.getInstallationToken(777, 'all')).token_enc).toBe('v1.t1b');
      await db.deleteInstallationTokens(777);
      expect(await db.getInstallationToken(777, 'all')).toBeNull();
    });

    it('setup states are single use, purpose-bound, expiring and need an unguessable value', async () => {
      const db = await make();
      const state = 'S'.repeat(43);
      await db.createSetupState({ state, purpose: 'manifest', accountHint: 'example-org' });
      expect(await db.consumeSetupState(state, 'user_auth')).toBeNull(); // wrong purpose does not consume it
      expect(await db.consumeSetupState(state, 'manifest')).toEqual({ account_hint: 'example-org', code_verifier_enc: null });
      expect(await db.consumeSetupState(state, 'manifest')).toBeNull();
      await db.createSetupState({ state: 'V'.repeat(43), purpose: 'user_auth', codeVerifierEnc: 'v1.verifier' });
      expect(await db.consumeSetupState('V'.repeat(43), 'user_auth')).toEqual({ account_hint: null, code_verifier_enc: 'v1.verifier' });
      await db.createSetupState({ state: 'E'.repeat(43), purpose: 'manifest', ttlSeconds: -1 });
      expect(await db.consumeSetupState('E'.repeat(43), 'manifest')).toBeNull();
      await expect(db.createSetupState({ state: 'short', purpose: 'manifest' })).rejects.toThrow(TypeError);
      await expect(db.createSetupState({ state: 'X'.repeat(43), purpose: 'other' })).rejects.toThrow(TypeError);
      expect(await db.consumeSetupState('', 'manifest')).toBeNull();
    });

    it('a one-time secret can be consumed exactly once, and not after it expires', async () => {
      const db = await make();
      await db.addOneTimeSecret({ id: 'A'.repeat(32), account: 'example-org', kind: 'webhook_secret', ciphertext: 'v1.x', expiresAt: future(600e3) });
      const results = await Promise.all([db.consumeOneTimeSecret('A'.repeat(32)), db.consumeOneTimeSecret('A'.repeat(32))]);
      expect(results.filter(Boolean)).toEqual([{ account: 'example-org', kind: 'webhook_secret', ciphertext: 'v1.x' }]);
      expect(await db.consumeOneTimeSecret('A'.repeat(32))).toBeNull();
      await db.addOneTimeSecret({ id: 'B'.repeat(32), kind: 'pass', ciphertext: 'v1.y', expiresAt: new Date(Date.now() - 1000) });
      expect(await db.consumeOneTimeSecret('B'.repeat(32))).toBeNull();
      await expect(db.addOneTimeSecret({ id: 'A'.repeat(32), kind: 'k', ciphertext: 'c', expiresAt: future(1000) })).resolves.toBeUndefined();
      await expect(db.addOneTimeSecret({ id: 'A'.repeat(32), kind: 'k', ciphertext: 'c', expiresAt: future(1000) })).rejects.toThrow();
    });
  });
}
