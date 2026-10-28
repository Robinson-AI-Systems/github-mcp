// The owner's private setup page and the three GitHub redirects that finish its steps (A4, A5, A10, A11). The page is the
// only place a GitHub credential is entered or a one-time secret is shown. Every action needs the administrator passphrase
// (with the same lockout as the connector login), a same-origin form post and a double-submit CSRF token, and every
// credential step is refused unless this is the production deployment. The redirects from GitHub carry an unguessable
// `state` created only after the passphrase was accepted; a state works once and expires.
import { createHash, randomBytes } from 'node:crypto';
import { LOCKOUT_WINDOW_MINUTES, clientIp, evaluateLogin, randomToken, secretsMatch } from '../core/oauth.js';
import { only, paramsOf, publicOrigin, send } from '../core/http.js';
import { buildManifest, isValidLogin, manifestFormUrl } from './app-manifest.js';
import { bareOctokit, githubFor } from './client.js';
import { putSecret, secretRoutes } from './secret-seal.js';
import { readBack, missingPermissions } from './setup-readback.js';
import { canonicalSetupUrl } from './setup-canonical.js';
import { renderSetup, resultPage } from './setup-html.js';
import { summarizeConnectorReadiness } from './oauth-readiness.js';
import { PRODUCTION_NAMES_KEY, cleanNames, productionNames, productionReason } from '../tools/production-guard.js';
import { protectedList } from '../tools/protect-guard.js';
import { DEFAULT_ZONE, ZONE_SETTING, validZone } from '../core/time-zone.js';
import { OWN_PEOPLE_KEY, cleanLogins, extraOwnPeople } from '../tools/people-guard.js';
import { spendStatus } from '../tools/spend-guard.js';
import { dollars as money } from '../github/prices.js';
import { validateGrant } from '../rtc/pass-scope.js';
import { bootstrapPrivateOwnerPilot } from '../tenancy/owner-bootstrap.js';
import { invitePrivatePilotMember } from '../tenancy/private-invite.js';
import { purgeRevokedTenantArtifacts } from '../tenancy/incident-cleanup.js';
import { registerPrivatePilotClient } from '../tenancy/client-registration.js';
import { createTenantDirectory, openAuthorizedTenantDb } from '../tenancy/directory.js';
import { saveTenantRuntimePolicy } from '../tenancy/runtime-limits.js';
import { forgetPublicPerson } from '../tenancy/forget-person.js';
import { publicUsageSummary } from '../tenancy/usage-summary.js';
import { neon } from '@neondatabase/serverless';

const HTML = 'text/html; charset=utf-8';
const CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://github.com; base-uri 'none'; frame-ancestors 'none'";
const COOKIE = 'github_setup_csrf';
const OAUTH_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const NOT_PRODUCTION = 'Credentials can only be set up on the production deployment. Preview deployments share the database but never hold or add credentials.';
const csrfCookie = (req) => new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]{43})`).exec(String(req.headers?.cookie || ''))?.[1] || null;
const secretPlace = (s) => (s.level === 'org' ? `the ${s.owner} organization` : s.level === 'environment' ? `the ${s.environment} environment of ${s.owner}/${s.repo}` : `${s.owner}/${s.repo}`);
const plainStatus = (error) => (error?.status ? `GitHub answered ${error.status}` : 'GitHub could not be reached');

/** @param {{ db: object, credentials: object, oneTimeStore?: object, env?: object, fetch?: Function, now?: () => number }} deps */
export function createSetupHandlers({ db, credentials, oneTimeStore, env = process.env, fetch = globalThis.fetch }) {
  const isProduction = () => env.VERCEL_ENV === 'production';

  function frame(res, status, body, containsForm = false) {
    res.setHeader('Content-Security-Policy', CSP);
    // HTML navigation form POSTs can send Origin: null under no-referrer.
    // same-origin exposes no Referer to GitHub/external websites, but preserves
    // the true Origin for this page's same-origin form submissions.
    res.setHeader('Referrer-Policy', containsForm ? 'same-origin' : 'no-referrer');
    return send(res, status, body, HTML);
  }
  function newCsrf(res) {
    const csrf = randomToken(32);
    res.setHeader('Set-Cookie', `${COOKIE}=${csrf}; Max-Age=600; Path=/api/github; HttpOnly; Secure; SameSite=Strict`);
    return csrf;
  }
  function origin(res) {
    try { return publicOrigin(env); } catch { send(res, 503, { error: 'server_not_configured', description: 'Set PUBLIC_BASE_URL first' }); return null; }
  }

  // ---- GET /api/github/setup (the page, and the install redirect from GitHub) ----
  async function setupGet(req, res) {
    const canonicalOrigin = origin(res);
    if (!canonicalOrigin) return;
    if (isProduction()) {
      const canonicalUrl = canonicalSetupUrl(req, canonicalOrigin);
      if (canonicalUrl) {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Location', canonicalUrl);
        return res.status(302).end();
      }
    }
    const installationId = Number(req.query?.installation_id);
    if (Number.isSafeInteger(installationId) && installationId > 0) return await installReturn(res, installationId);
    const csrf = newCsrf(res);
    const wanted = String(req.query?.secret || '');
    const waiting = wanted ? await db.getSecretRequest(wanted) : null;
    const secretEntry = waiting ? { id: waiting.id, expires: new Date(waiting.expires_at).toUTCString(), summary: `Claude asked for ${waiting.scope.kind} secret ${waiting.scope.name} in ${secretPlace(waiting.scope)}.` } : null;
    return frame(res, 200, renderSetup({ csrf, show: String(req.query?.show || ''), secretEntry, ...(wanted && !waiting ? { result: 'That secret request is unknown, already used or expired. Ask Claude to start it again.' } : {}) }), true);
  }

  /** GitHub sends the owner back here after installing. Nothing in the URL is trusted: the installation is read from GitHub as the App. */
  async function installReturn(res, installationId) {
    try {
      const accounts = await db.listAccounts();
      for (const appId of [...new Set(accounts.map((a) => a.app_id).filter((id) => id != null))]) {
        const octokit = bareOctokit({ token: await credentials.appJwt(appId), fetch });
        const found = await octokit.request('GET /app/installations/{installation_id}', { installation_id: installationId }).then((r) => r.data, () => null);
        const owner = found && accounts.find((a) => a.app_id === appId && a.login.toLowerCase() === String(found.account?.login).toLowerCase());
        if (!owner) continue;
        await db.setInstallation(owner.login, { installationId: found.id, repositorySelection: found.repository_selection, permissions: found.permissions ?? {}, status: found.suspended_at ? 'suspended' : 'active' });
        await db.deleteInstallationTokens(found.id);
        return frame(res, 200, resultPage({ title: 'App installed', message: `The GitHub App is installed on ${owner.login}. Use "Show my accounts" on the setup page to check everything.` }));
      }
      return frame(res, 404, resultPage({ title: 'Unknown installation', message: 'That installation does not belong to any GitHub App set up on this server. Nothing was changed.' }));
    } catch {
      return frame(res, 502, resultPage({ title: 'Could not check the installation', message: 'GitHub could not be asked about this installation. Open the setup page and press "Show my accounts" to retry.' }));
    }
  }

  // ---- POST /api/github/setup ----
  async function setupPost(req, res) {
    const expectedOrigin = origin(res);
    if (!expectedOrigin) return;
    if (String(req.headers?.origin || '') !== expectedOrigin) return frame(res, 403, resultPage({
      title: 'Secure browser required',
      message: `Browser origin did not match the required HTTPS setup address. Open ${expectedOrigin}/api/github/setup in Chrome or another full browser, not an embedded browser, and submit again. No setting was changed.`
    }));
    let p;
    try { p = paramsOf(req); } catch { return send(res, 400, { error: 'invalid_request' }); }
    const cookie = csrfCookie(req);
    if (!cookie || !p.csrf || !secretsMatch(p.csrf, cookie)) return send(res, 403, { error: 'forbidden', description: 'Setup page expired; reload it' });
    if (!env.ADMIN_PASSPHRASE) return send(res, 503, { error: 'server_not_configured', description: 'Set ADMIN_PASSPHRASE first' });
    const login = await evaluateLogin({ ip: clientIp(req), supplied: p.passphrase, expected: env.ADMIN_PASSPHRASE, store: db });
    if (login.status === 'locked') {
      res.setHeader('Retry-After', String(LOCKOUT_WINDOW_MINUTES * 60));
      return frame(res, 429, renderSetup({ csrf: cookie, result: 'Too many attempts. Try again later.' }), true);
    }
    if (login.status !== 'ok') return frame(res, 401, renderSetup({ csrf: cookie, result: 'Incorrect administrator passphrase.' }), true);

    const page = (status, view) => frame(res, status, renderSetup({ csrf: cookie, ...view }), true);
    const action = String(p.action || '');
    if (action === 'status') {
      const accounts = [];
      for (const a of (await db.listAccounts()).slice(0, 10)) accounts.push(await readBack({ db, credentials, fetch }, a.login));
      const oauthReadiness=summarizeConnectorReadiness(
        await db.getConnectorOAuthReadiness(),{mcpUrl:`${expectedOrigin}/api/mcp`});
      return page(200, { accounts, oauthReadiness, connections: (await db.listUpgradeableConnections()).filter((c) => c.kind === 'connector').map((c) => ({
        id: c.client_id, name: c.client_name || 'Custom MCP login', mode: c.mode, profile: c.profile, accounts: c.accounts
      })), productionNames: await productionNames(db), protectedList: await protectedList(db), spendLimits: await spendView(), ownPeopleExtra: await extraOwnPeople(db), publicUsage: await publicUsage(), publicInvites: await publicInvites() });
    }
    if (action === 'reveal') {
      if (!isProduction()) return page(403, { blocked: NOT_PRODUCTION });
      try {
        const secret = oneTimeStore ? await oneTimeStore.consume(p.id) : null;
        return secret ? page(200, { revealed: secret.secret, result: `Secret type: ${secret.kind}${secret.account ? ` · account: ${secret.account}` : ''}.` })
          : page(410, { result: 'This one-time secret was used, expired, or does not exist.' });
      } catch { return page(400, { result: 'Unable to retrieve this secret.' }); }
    }
    if (action === 'enter-secret') return await enterSecret(p, page);
    if (action === 'set-production-names') return await setProductionNames(p, page);
    if (action === 'confirm-production') return await confirmProduction(p, page);
    if (action === 'upgrade-connection-production') return await upgradeConnectionProduction(p, page);
    if (action === 'bootstrap-private-pilot') return await setupPrivatePilot(p, page);
    if (action === 'register-private-pilot-client') return await registerPrivateOwnerClient(p, page);
    if (action === 'invite-private-pilot-user') return await invitePrivateOwnerUser(p, page);
    if (action === 'revoke-private-pilot') return await revokePrivateOwnerPilot(p, page);
    if (action === 'set-private-tenant-capacity') return await setPrivateTenantCapacity(p, page);
    if (action === 'set-spend-limit') return await setSpendLimit(p, page);
    if (action === 'set-scratch') return await setScratch(p, page);
    if (action === 'create-rtc-pass') {
      if(!isProduction())return page(403,{blocked:NOT_PRODUCTION});
      if(!oneTimeStore)return page(503,{keyHelp:'Set TOKEN_ENCRYPTION_KEY before issuing a pass.'});
      const account=String(p.login||''),days=Number(p.days||1),rate=Number(p.rate||120);
      if(!isValidLogin(account)||!Number.isInteger(days)||days<1||days>30)
        return page(400,{result:'Choose an approved scratch organization and an expiry of 1–30 days.'});
      if(!Number.isInteger(rate)||rate<1||rate>600)
        return page(400,{result:'Choose a request limit from 1 to 600 per minute (the default is 120).'});
      const pass='rtc_pass_'+randomBytes(32).toString('base64url');
      const passId=randomBytes(12).toString('hex');
      const created=await db.createRtcPass({pass,passId,account,expiresAt:new Date(Date.now()+days*86400000),rateLimitPerMinute:rate});
      if(!created)return page(403,{result:'Pass creation refused: account must be an active, all-repositories, production-disabled scratch Organization.'});
      try {
        const one=await oneTimeStore.issue({account,kind:'rtc-read-only-pass',secret:pass});
        await db.recordChange({account,mode:'setup',tool:'setup_create_rtc_pass',
          target:passId,summary:'Issued one-day to 30-day preview/read-only RTC test pass',
          confirmed:true,production:false}).catch(()=>{});
        return page(200,{result:`Read-only preview RTC pass ${passId} created (expires in ${days} day(s); ${rate} requests per minute). Open ${one.setupPath} in this browser, then reveal it once. Revoke it here after testing.`});
      }catch {
        await db.revokeRtcPass(passId);
        return page(503,{result:'Pass reveal could not be prepared. The newly issued pass was revoked.'});
      }
    }
    if (action === 'create-scoped-pass') {
      // R-1: a pass with its own limits. Only this passphrase-protected page can issue production or spending passes.
      if(!isProduction())return page(403,{blocked:NOT_PRODUCTION});
      if(!oneTimeStore)return page(503,{keyHelp:'Set TOKEN_ENCRYPTION_KEY before issuing a pass.'});
      const account=String(p.login||'');
      if(!isValidLogin(account))return page(400,{result:'Choose a connected account.'});
      const list=(value)=>{const t=String(value??'').split(/[,\s]+/).map((x)=>x.trim()).filter(Boolean);return t.length?t:null;};
      const dollarsText=String(p.spend??'0').trim();
      if(!/^\d{1,6}(\.\d{1,2})?$/.test(dollarsText))return page(400,{result:'Enter the spend allowance in dollars, such as 0 or 25.50.'});
      let grant;
      try {
        grant=validateGrant({profile:p.profile||'read_only',mode:p.mode||'preview',allowWrites:p.writes==='true',
          allowAccessChanges:p.access==='true',moneyLimitCents:Math.round(Number(dollarsText)*100),forHub:p.hub==='true',
          days:Number(p.days||1),ratePerMinute:Number(p.rate||120),areas:list(p.areas),repos:list(p.repos)},account);
      } catch(error) { return page(400,{result:error instanceof TypeError?error.message:'Those pass settings are not valid.'}); }
      const pass='rtc_pass_'+randomBytes(32).toString('base64url');
      const passId=randomBytes(12).toString('hex');
      const created=await db.createRtcPassGrant({pass,passId,account,expiresAt:new Date(Date.now()+grant.days*86400000),grant});
      if(!created)return page(403,{result:'Pass creation refused: the account must be connected and active, and production passes need production switched on for it.'});
      try {
        const one=await oneTimeStore.issue({account,kind:'rtc-scoped-pass',secret:pass});
        await db.recordChange({account,mode:'setup',tool:'setup_create_scoped_pass',target:passId,
          summary:`Issued ${grant.mode} ${grant.profile} pass (writes ${grant.allowWrites?'on':'off'}, access changes ${grant.allowAccessChanges?'on':'off'}, spend ${grant.moneyLimitCents} cents, ${grant.days} day(s)${grant.forHub?', for Robinson\'s Toolkit':''})`,
          confirmed:true,production:grant.mode==='production'}).catch(()=>{});
        return page(200,{result:`Pass ${passId} created: ${grant.mode}, ${grant.profile} profile, writes ${grant.allowWrites?'allowed':'not allowed'}, access changes ${grant.allowAccessChanges?'allowed':'not allowed'}, spend allowance $${(grant.moneyLimitCents/100).toFixed(2)}, ${grant.ratePerMinute} requests per minute, ${grant.days} day(s). Open ${one.setupPath} in this browser, then reveal it once. Revoke it here when finished.`});
      }catch {
        await db.revokeRtcPass(passId);
        return page(503,{result:'Pass reveal could not be prepared. The newly issued pass was revoked.'});
      }
    }
    if (action === 'revoke-rtc-pass') {
      if(!isProduction())return page(403,{blocked:NOT_PRODUCTION});
      const passId=String(p.passId||'');
      if(!/^[a-f0-9]{24}$/.test(passId))return page(400,{result:'Enter the 24-character pass identifier.'});
      const revoked=await db.revokeRtcPass(passId);
      if(revoked)await db.recordChange({mode:'setup',tool:'setup_revoke_rtc_pass',
        target:passId,summary:'Revoked an RTC test pass',confirmed:true,production:false}).catch(()=>{});
      return page(revoked?200:404,{result:revoked?'RTC pass revoked immediately.':'No active RTC pass with that identifier.'});
    }
    if (action === 'forget-person') return await forgetPerson(p, page);
    if (action === 'add-invites' || action === 'remove-invite') return await editInvites(action, p, page);
    if (action === 'set-time-zone') return await setTimeZone(p, page);
    if (action === 'set-own-people') return await setOwnPeople(p, page);
    if (action === 'save-protected' || action === 'remove-protected') return await editProtected(action, p, page);
    if (!['start-app', 'start-user-auth', 'add-fine-grained', 'add-classic', 'add-package', 'remove-package', 'remove-classic', 'remove-fine-grained'].includes(action)) return page(400, { result: 'Unknown action.' });
    if (!isProduction()) return page(403, { blocked: NOT_PRODUCTION });
    if (!isValidLogin(p.login)) return page(400, { result: 'Enter a valid GitHub account name.' });
    const account = p.login;
    if (action === 'remove-package') {
      const removed = await db.clearPackageToken(account);
      return page(removed ? 200 : 404, { result: removed
        ? 'Removed the stored package token. Revoke it on GitHub too if it is no longer needed.'
        : 'That account is not set up on the server.' });
    }

    if (action==='remove-classic' || action==='remove-fine-grained') {
      const removed=action==='remove-classic'
        ?await db.clearClassicToken(account)
        :await db.clearFineGrainedToken(account);
      return page(removed?200:404,{result:removed
        ? 'The stored credential and its recorded identity proof were cleared. Revoke the credential on GitHub separately if needed.'
        : 'No corresponding stored credential for that account.'});
    }
    if (!credentials.keyConfigured()) return page(503, { keyHelp: 'The server has no encryption key, so it will not store anything. Set TOKEN_ENCRYPTION_KEY (see docs/DEPLOY.md) and reload.' });

    if (action === 'start-app') {
      const accountType = p.accountType === 'User' ? 'User' : 'Organization';
      const state = randomToken(32);
      await db.createSetupState({ state, purpose: 'manifest', accountHint: account });
      return page(200, { manifestForm: { action: manifestFormUrl({ login: account, accountType, state }), manifest: JSON.stringify(buildManifest({ origin: expectedOrigin, login: account })) },
        result: `Ready to create the GitHub App for ${account}.` });
    }
    if (action === 'start-user-auth') {
      const row = await db.getAccount(account);
      const client = row?.app_id != null ? await credentials.clientCredentials(row.app_id) : null;
      if (!client) return page(404, { result: 'Create and install the GitHub App for that account first.' });
      const verifier = randomToken(48);
      const state = randomToken(32);
      await db.createSetupState({ state, purpose: 'user_auth', accountHint: row.login, codeVerifierEnc: credentials.sealVerifier(state, verifier) });
      const query = new URLSearchParams({ client_id: client.clientId, redirect_uri: `${expectedOrigin}/api/github/user-callback`, state,
        code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
      res.setHeader('Location', `https://github.com/login/oauth/authorize?${query}`);
      res.setHeader('Content-Security-Policy', CSP);
      return send(res, 303, '', HTML);
    }
    return await addToken(action, account, p, page);
  }

  /**
   * The owner types a secret that Claude asked for. The request is claimed first (so a double click cannot send twice), the value is
   * sealed for the place's public key and sent, and the request is put back if GitHub refuses so the owner can try again.
   * The value is never stored, logged, recorded in the change log or put in any message.
   */
  async function enterSecret(p, page) {
    if (!isProduction()) return page(403, { blocked: NOT_PRODUCTION });
    const value = typeof p.value === 'string' ? p.value : '';
    if (!value || value.length > 48000) return page(400, { result: 'Enter the secret value (up to 48,000 characters).', secretEntry: null });
    const request = await db.claimSecretRequest(String(p.id || ''));
    if (!request) return page(410, { result: 'This secret request is unknown, already used or expired. Ask Claude to start it again.' });
    const scope = request.scope;
    const fail = async (status, result) => { await db.releaseSecretRequest(request.id).catch(() => {}); return page(status, { result: `${result} Nothing was saved; the link still works until it expires.` }); };
    try {
      const row = await db.getAccount(request.account);
      if (!row) return await fail(404, 'That account is no longer set up on the server.');
      const ctx = { connection: { default_account: row.login, accounts: [row.login], mode: 'production', profile: 'full' }, db, credentials, fetch, now: Date.now, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };
      const production = await productionReason(ctx, { owner: scope.owner, ...(scope.repo ? { repo: scope.repo } : {}), ...(scope.environment ? { environment: scope.environment } : {}), scope: scope.level === 'org' ? 'org' : 'repo' });
      const octokit = await githubFor(ctx, { owner: row.login });
      await putSecret(octokit, scope, value, { visibility: scope.visibility, selectedRepositoryIds: scope.selectedRepositoryIds });
      const routes = secretRoutes(scope);
      const meta = await octokit.request(`GET ${routes.one}`, { ...routes.params, secret_name: scope.name }).then((r) => r.data, () => null);
      const line = `Secret ${scope.name} (${scope.kind}) set in ${secretPlace(scope)} from the setup page`;
      await db.recordChange({ account: row.login, mode: 'setup', tool: 'setup_enter_secret', target: `${secretPlace(scope)} ${scope.name}`, summary: meta ? line : `UNCONFIRMED: ${line}`, production: !!production, accessWidening: false, confirmed: !!meta }).catch(() => {});
      return page(200, { result: meta ? `Done. ${scope.name} is saved in ${secretPlace(scope)} (GitHub shows it updated ${meta.updated_at}). GitHub never shows the value again.` : `GitHub accepted ${scope.name} but could not confirm it afterwards. Check ${secretPlace(scope)} on GitHub.` });
    } catch (error) {
      return await fail(error?.status === 403 || error?.status === 404 ? 403 : 502, `GitHub did not accept the secret (${plainStatus(error)}).`);
    }
  }

  /** Names the owner adds to the built-in production names. They can only widen what counts as production, never shrink the built-in list. */
  async function setProductionNames(p, page) {
    if (!isProduction()) return page(403, { blocked: NOT_PRODUCTION });
    const environments = cleanNames(p.environments, 'environment');
    const branches = cleanNames(p.branches, 'branch');
    if (environments.error || branches.error) return page(400, { result: environments.error || branches.error });
    await db.setSetting(PRODUCTION_NAMES_KEY, { environments: environments.names, branches: branches.names });
    return page(200, { result: 'Saved. These names now count as production in addition to the built-in ones.', productionNames: await productionNames(db) });
  }

  const spendView = async () => {
    const rows = [];
    for (const a of (await db.listAccounts()).slice(0, 10)) {
      const st = await spendStatus({ db, now: () => Date.now() }, a.login);
      rows.push({ login: a.login, limit: money(st.limitCents), used: money(st.usedCents) });
    }
    return rows;
  };

  /** Owner-only, explicitly named disposable Organization; never accept caller-provided scratch status. */
  async function setScratch(p, page) {
    if (!isProduction()) return page(403, { blocked: NOT_PRODUCTION });
    if (!isValidLogin(p.login)) return page(400, { result: 'Enter a valid GitHub organization name.' });
    const row = await db.getAccount(p.login);
    if (!row) return page(404, { result: 'That account is not set up on this server.' });
    if (p.confirmLogin !== row.login) return page(400, { result: 'Re-type the exact organization name to confirm this disposable target.' });
    if (p.enabled !== 'true' && p.enabled !== 'false') return page(400, { result: 'Choose whether to enable or disable scratch mode.' });
    const enable = p.enabled === 'true';
    if (enable) {
      if (row.account_type !== 'Organization' || row.credential_kind !== 'app' ||
          !row.app_id || !row.installation_id || row.production_enabled)
        return page(409, { result: 'Scratch requires a separate organization, a configured GitHub App, an installation and production OFF.' });
      let live;
      try {
        const app = bareOctokit({ token: await credentials.appJwt(row.app_id), fetch });
        live = (await app.request('GET /app/installations/{installation_id}', { installation_id: row.installation_id })).data;
      } catch { return page(409, { result: 'The GitHub App installation could not be verified. No scratch setting changed.' }); }
      if (live?.id !== row.installation_id ||
          String(live.account?.login ?? '').toLowerCase() !== row.login.toLowerCase() ||
          live.account?.type !== 'Organization' || live.repository_selection !== 'all' ||
          live.suspended_at || missingPermissions(live.permissions).length)
        return page(409, { result: 'GitHub must confirm an active all-repositories App installation with all required permissions on this exact organization.' });
      await db.setInstallation(row.login, { installationId: live.id,
        repositorySelection: live.repository_selection, permissions: live.permissions, status: 'active' });
    }
    if (!await db.setScratchAccount(row.login, enable))
      return page(409, { result: 'The account no longer qualifies for scratch mode. No setting changed.' });
    await db.recordChange({ account: row.login, mode: 'setup', tool: 'setup_set_scratch',
      target: row.login, summary: `Scratch testing ${enable ? 'enabled' : 'disabled'} for ${row.login} by owner`,
      production: false, accessWidening: enable, confirmed: true }).catch(() => {});
    return page(200, { result: `Scratch testing is ${enable ? 'ON' : 'OFF'} for ${row.login}. ${enable
      ? 'Only preview-mode developer tools may create run-owned disposable resources. This does not enable production.' : 'Developer scratch writes are blocked for this organization.'}` });
  }

  /** The owner's only way to raise the monthly spend limit (Claude's tool can only lower it). */
  async function setSpendLimit(p, page) {
    if (!isProduction()) return page(403, { blocked: NOT_PRODUCTION });
    if (!isValidLogin(p.login)) return page(400, { result: 'Enter a valid GitHub account name.' });
    const row = await db.getAccount(p.login);
    if (!row) return page(404, { result: 'That account is not set up on the server.' });
    const text = String(p.dollars ?? '').trim().replace(/^\$/, '');
    if (!/^\d{1,7}(\.\d{1,2})?$/.test(text)) return page(400, { result: 'Enter dollars as a number such as 25 or 19.50.' });
    const cents = Math.round(Number(text) * 100);
    await db.setSpendLimitCents(row.login, cents);
    const raised = cents > (Number(row.spend_limit_cents) || 0);
    await db.recordChange({ account: row.login, mode: 'setup', tool: 'setup_set_spend_limit', target: row.login, summary: `Monthly spend limit for ${row.login} set to ${money(cents)} (was ${money(Number(row.spend_limit_cents) || 0)})`,
      production: true, accessWidening: false, confirmed: true }).catch(() => {});
    return page(200, { result: `The monthly spend limit for ${row.login} is now ${money(cents)}${raised ? '. Actions that cost money still ask you first.' : '.'}`, spendLimits: await spendView() });
  }

  /** Owner request: delete everything stored for one public person (found by their personal GitHub account name). */
  async function forgetPerson(p, page) {
    if (!isProduction()) return page(403, { blocked: NOT_PRODUCTION });
    const name = String(p.login ?? '').trim().toLowerCase();
    if (!isValidLogin(name) || String(p.confirmLogin ?? '').trim().toLowerCase() !== name || String(p.confirmDelete ?? '') !== 'yes')
      return page(400, { result: 'Type the person\'s GitHub account name twice and tick the confirmation. Nothing was deleted.' });
    if (!env.DATABASE_URL) return page(409, { result: 'No database is configured.' });
    try {
      const root = neon(env.DATABASE_URL);
      const removed = await forgetPublicPerson(createTenantDirectory(root), root, name, { connectionString: env.DATABASE_URL });
      await db.recordChange({ account: null, mode: 'setup', tool: 'setup_forget_public_person', target: 'public_person',
        summary: `Deleted ${removed} public sign-in data set${removed === 1 ? '' : 's'} on request`, production: true, accessWidening: false, confirmed: true }).catch(() => {});
      return page(removed ? 200 : 404, { result: removed
        ? `Deleted. ${removed} data set${removed === 1 ? '' : 's'} for ${name} (sign-in, tokens, stored settings) removed for good. They can connect again later as a new person.`
        : 'No public sign-in was found for that personal account name. Nothing was deleted.' });
    } catch { return page(500, { result: 'The deletion could not be completed. Nothing further was changed; try again.' }); }
  }

  /** Read-only public usage numbers for the owner; any problem just hides the section. */
  async function publicUsage() {
    if (env.GITHUB_PRIVATE_TENANT_PILOT !== 'enabled' || !env.DATABASE_URL) return null;
    try { return await publicUsageSummary(neon(env.DATABASE_URL), { connectionString: env.DATABASE_URL, env }); } catch { return null; }
  }

  /** LAUNCH-1: the invite list (who may become a NEW public person while invite-only is on). Hidden when the public sign-in is not set up. */
  async function publicInvites() {
    if (env.GITHUB_PRIVATE_TENANT_PILOT !== 'enabled' || !env.DATABASE_URL) return null;
    try { return { on: env.GITHUB_PUBLIC_INVITE_ONLY === 'enabled', logins: await createTenantDirectory(neon(env.DATABASE_URL)).listPublicInvites() }; } catch { return null; }
  }
  async function editInvites(action, p, page) {
    if (!isProduction()) return page(403, { blocked: NOT_PRODUCTION });
    if (env.GITHUB_PRIVATE_TENANT_PILOT !== 'enabled' || !env.DATABASE_URL) return page(409, { result: 'The public sign-in is not set up here.' });
    try {
      const dir = createTenantDirectory(neon(env.DATABASE_URL));
      let result;
      if (action === 'add-invites') {
        const names = String(p.logins ?? '').split(/[\s,]+/).filter(Boolean);
        if (!names.length || names.length > 100 || !names.every((n) => isValidLogin(n))) return page(400, { result: 'Enter one or more GitHub account names separated by commas. Nothing was saved.' });
        await dir.addPublicInvites(names);
        result = `Invited ${names.length} name${names.length === 1 ? '' : 's'}.`;
      } else {
        if (!isValidLogin(String(p.login ?? ''))) return page(400, { result: 'Enter a valid GitHub account name.' });
        result = await dir.removePublicInvite(p.login) ? `Removed ${p.login} from the invite list. Anyone who already signed in keeps their connection.` : 'That name was not on the invite list.';
      }
      await db.recordChange({ account: null, mode: 'setup', tool: 'setup_edit_public_invites', target: 'public_invites', summary: action === 'add-invites' ? 'Added names to the public invite list' : 'Removed a name from the public invite list', production: true, accessWidening: false, confirmed: true }).catch(() => {});
      return page(200, { result, publicInvites: await publicInvites() });
    } catch { return page(500, { result: 'The invite list could not be changed. Nothing further was changed; try again.' }); }
  }

  /** Display-only time zone for times shown to assistants. Blank means UTC. Not a security setting, so it works in any mode. */
  async function setTimeZone(p, page) {
    const text = String(p.zone ?? '').trim();
    const zone = text === '' ? DEFAULT_ZONE : validZone(text);
    if (!zone) return page(400, { result: 'That is not a time zone name. Use a name like America/Denver or UTC.' });
    await db.setSetting(ZONE_SETTING, zone);
    return page(200, { result: `Saved. Times will now show in ${zone}${zone === DEFAULT_ZONE ? ' (UTC)' : ''}.` });
  }

  /** Extra names that count as the owner's own people (they reduce confirmations, so only this page sets them). */
  async function setOwnPeople(p, page) {
    if (!isProduction()) return page(403, { blocked: NOT_PRODUCTION });
    const cleaned = cleanLogins(p.logins);
    if (cleaned.error) return page(400, { result: cleaned.error });
    await db.setSetting(OWN_PEOPLE_KEY, { logins: cleaned.logins });
    await db.recordChange({ account: null, mode: 'setup', tool: 'setup_set_own_people', target: 'own_people', summary: `Extra own people set to: ${cleaned.logins.join(', ') || 'none'}`, production: true, accessWidening: true, confirmed: true }).catch(() => {});
    return page(200, { result: 'Saved. These names now count as your own people in addition to the built-in ones.', ownPeopleExtra: cleaned.logins });
  }

  /** The owner's only way to change the protected list. Loosening protection is logged as an access change. */
  async function editProtected(action, p, page) {
    if (!isProduction()) return page(403, { blocked: NOT_PRODUCTION });
    const kind = String(p.kind || '');
    const before = await protectedList(db);
    const target = String(p.target ?? '').trim().toLowerCase();
    const current = before.find((e) => e.kind === kind && e.target === target);
    let summary; let loosened;
    if (action === 'remove-protected') {
      if (!current) return page(404, { result: 'That entry is not on the list.' });
      await db.removeProtectedResource(kind, target);
      summary = `Removed ${kind} ${target} from the protected list (was ${current.level})`; loosened = true;
    } else {
      let saved;
      try { saved = await db.saveProtectedResource({ kind, target, level: String(p.level || ''), reason: p.reason }); } catch (error) { return page(400, { result: error instanceof TypeError ? error.message : 'That entry was not accepted.' }); }
      summary = `Protected list: ${kind} ${saved.target} is now ${saved.level}${current ? ` (was ${current.level})` : ''}`; loosened = current?.level === 'locked' && saved.level === 'pr-only';
    }
    await db.recordChange({ account: null, mode: 'setup', tool: `setup_${action.replace('-', '_')}`, target, summary, production: true, accessWidening: loosened, confirmed: true }).catch(() => {});
    return page(200, { result: `${summary}.`, protectedList: await protectedList(db) });
  }

  /** Step 2 of turning production on: the owner has asked Claude first (a pending request exists), and now proves it with the passphrase. */
  async function confirmProduction(p, page) {
    if (!isProduction()) return page(403, { blocked: NOT_PRODUCTION });
    if (!isValidLogin(p.login)) return page(400, { result: 'Enter a valid GitHub account name.' });
    const row = await db.getAccount(p.login);
    if (!row) return page(404, { result: 'That account is not set up on the server.' });
    const pending = await db.consumeSetupStateByHint('enable_production', row.login);
    if (!pending) return page(409, { result: `There is no waiting request for ${row.login}, or it expired (they last 10 minutes). Ask Claude to turn production on for ${row.login} first, then come back here.` });
    await db.setProductionEnabled(row.login, true);
    await db.recordChange({ account: row.login, mode: 'setup', tool: 'setup_confirm_production', target: row.login, summary: `Production turned ON for ${row.login} from the setup page`,
      production: true, accessWidening: true, confirmed: true }).catch(() => {});
    return page(200, { result: `Production is now ON for ${row.login}. Full owner connections follow your instructions and GitHub permissions; explicitly restricted connections keep their chosen limits.` });
  }

  /** This action inherits passphrase lockout, CSRF and exact Origin guards
   * from setupPost. It cannot create a tenant on preview or a normal account. */
  async function setupPrivatePilot(p,page) {
    if (!isProduction()) return page(403,{blocked:NOT_PRODUCTION});
    const account=String(p.login||'').trim().toLowerCase();
    if (!isValidLogin(account) ||
        String(p.confirmLogin||'').trim().toLowerCase()!==account ||
        String(p.confirmPilot||'')!=='yes')
      return page(400,{result:'Confirm the exact disposable scratch organization and private pilot scope.'});
    try {
      const receipt=await bootstrapPrivateOwnerPilot({
        accountLogin:account,rootDb:db,ownerCredentials:credentials,
        env,fetchImpl:fetch
      });
      await db.recordChange({account,mode:'setup',tool:'setup_private_pilot',
        target:receipt.tenantId,
        summary:'Owner verified GitHub and prepared isolated PRIVATE scratch pilot',
        production:false,accessWidening:false,confirmed:true}).catch(()=>{});
      return page(200,{result:'Private tenant ready for '+receipt.account+
        ' (tenant '+receipt.tenantId+'). No public signup, production connection or new provider permission was enabled.'});
    }catch {
      return page(409,{result:'The private pilot could not be safely initialized. Verify your active scratch App, owner GitHub authorization and private pilot configuration. No public access was enabled.'});
    }
  }

  /** Owner-only, single-use delivery of a private MCP client's credentials.
   * No anonymous dynamic client registration or public tenant invitation. */
  async function registerPrivateOwnerClient(p,page) {
    if (!isProduction()) return page(403,{blocked:NOT_PRODUCTION});
    if (!oneTimeStore) return page(503,{keyHelp:'Set the encryption key first.'});
    const account=String(p.login||'').trim().toLowerCase();
    const redirect=String(p.redirectUri||'').trim();
    if (!isValidLogin(account) ||
        String(p.confirmLogin||'').trim().toLowerCase()!==account ||
        String(p.confirmPilot||'')!=='yes' ||
        redirect.length>2048 || !redirect.startsWith('https://'))
      return page(400,{result:'Confirm your exact scratch account, secure redirect URI and private scope.'});
    try {
      const pilot=await bootstrapPrivateOwnerPilot({
        accountLogin:account,rootDb:db,ownerCredentials:credentials,env,fetchImpl:fetch
      });
      const bearer=await credentials.token({account,cred:'U'});
      const enrolled=await registerPrivatePilotClient({
        oauthBearer:bearer,trustedTenantId:pilot.tenantId,
        accountLogin:account,redirectUris:[redirect],
        clientName:'Owner-approved private GitHub MCP client',env,fetchImpl:fetch
      });
      const one=await oneTimeStore.issue({
        account,kind:'private-pilot-mcp-client',
        secret:JSON.stringify({client_id:enrolled.client_id,
          client_secret:enrolled.client_secret,
          redirect_uris:enrolled.redirect_uris})
      });
      await db.recordChange({account,mode:'setup',tool:'setup_private_pilot_client',
        target:pilot.tenantId,
        summary:'Owner issued one scoped, secret-protected private MCP client for a verified GitHub tenant',
        confirmed:true,production:false,accessWidening:false}).catch(()=>{});
      return page(200,{result:'Private MCP client created for '+account+
        '. Open '+one.setupPath+' in this browser to reveal the one-time client configuration. '+
        'Do not paste the client secret into ChatGPT chat.'});
    }catch {
      return page(409,{result:'Private client registration refused. Verify the account, '+
        'App grant, exact supported redirect URI and private pilot configuration. '+
        'No public access was enabled.'});
    }
  }

  /** Controlled testing invitation only, not the final customer enrollment.
   * setupPost already enforces owner passphrase, lockout, origin, and CSRF. */
  async function invitePrivateOwnerUser(p,page) {
    if (!isProduction()) return page(403,{blocked:NOT_PRODUCTION});
    if (!oneTimeStore) return page(503,{keyHelp:'Set the encryption key first.'});
    const account=String(p.login||'').trim().toLowerCase();
    const user=String(p.targetLogin||'').trim();
    const redirect=String(p.redirectUri||'').trim();
    if (!isValidLogin(account) ||
        String(p.confirmLogin||'').trim().toLowerCase()!==account ||
        !isValidLogin(user) || String(p.confirmPilot||'')!=='yes' ||
        redirect.length>2048 || !redirect.startsWith('https://'))
      return page(400,{result:'Confirm the exact scratch organization, GitHub user and private callback.'});
    try {
      const invite=await invitePrivatePilotMember({
        accountLogin:account,targetLogin:user,redirectUri:redirect,
        rootDb:db,ownerCredentials:credentials,env,fetchImpl:fetch
      });
      const one=await oneTimeStore.issue({
        account,kind:'private-pilot-member-mcp-client',
        secret:JSON.stringify({client_id:invite.client_id,
          client_secret:invite.client_secret,
          redirect_uris:invite.redirect_uris})
      });
      await db.recordChange({account,mode:'setup',tool:'setup_invite_private_pilot',
        target:invite.tenantId,
        summary:'Owner authorized a verified GitHub member for a PRIVATE test tenant',
        confirmed:true,production:false,accessWidening:false}).catch(()=>{});
      return page(200,{result:'Private pilot client prepared for GitHub user '+
        invite.githubLogin+'. Open '+one.setupPath+
        ' in this protected browser to reveal the one-time client configuration. '+
        'Their GitHub sign-in and installation consent are still required. '+
        'No public enrollment or invitation email was enabled.'});
    }catch {
      return page(409,{result:'Private member could not be verified or safely allowed. '+
        'Recheck the authorized scratch organization, GitHub user, App and pilot configuration.'});
    }
  }

  /** Existing passphrase, origin, CSRF and lockout checks protect this owner
   * setting. Budgets are separate from GitHub permissions and developer spend. */
  async function setPrivateTenantCapacity(p,page) {
    if (!isProduction()) return page(403,{blocked:NOT_PRODUCTION});
    const account=String(p.login||'').trim().toLowerCase();
    const clientRate=Number(p.clientRate),tenantRate=Number(p.tenantRate);
    if (!isValidLogin(account) ||
        String(p.confirmLogin||'').trim().toLowerCase()!==account ||
        String(p.confirmPilot||'')!=='yes' ||
        !Number.isSafeInteger(clientRate) || clientRate<1 || clientRate>600 ||
        !Number.isSafeInteger(tenantRate) || tenantRate<clientRate || tenantRate>6000)
      return page(400,{result:'Confirm the exact private tenant and valid client/tenant rates.'});
    if (env.GITHUB_PRIVATE_TENANT_PILOT!=='enabled' || !env.DATABASE_URL)
      return page(409,{result:'Private tenant configuration is disabled.'});
    try {
      const row=await db.getAccount(account);
      if (row?.account_type!=='Organization' || !row.is_scratch ||
          row.installation_status!=='active') throw new Error('Not a protected scratch account.');
      const directory=createTenantDirectory(neon(env.DATABASE_URL));
      const tenants=await directory.listPilotsForAccount(account);
      if (tenants.length!==1) throw new Error('Ambiguous private tenant.');
      const owner=await directory.authorizedPilotIdentity(
        tenants[0].tenantId,tenants[0].ownerIdentityId);
      if (!owner || owner.role!=='owner') throw new Error('Owner consent missing.');
      const context=await openAuthorizedTenantDb({
        directory,tenantId:owner.tenantId,verifiedIdentityId:owner.identityId,
        connectionString:env.DATABASE_URL
      });
      await saveTenantRuntimePolicy(context.sql,{
        mcpClientPerMinute:clientRate,mcpTenantPerMinute:tenantRate
      });
      await db.recordChange({account,mode:'setup',tool:'setup_private_tenant_capacity',
        target:owner.tenantId,
        summary:'Owner changed private tenant fair-use request budgets',
        confirmed:true,production:false,accessWidening:false}).catch(()=>{});
      return page(200,{result:'Private request limits saved for '+account+': '+
        clientRate+' per client and '+tenantRate+' per tenant per minute. '+
        'GitHub authority and spending permissions unchanged.'});
    } catch {
      return page(409,{result:'Private tenant policy was not verified or saved. Nothing else changed.'});
    }
  }

  /** Emergency owner revocation also works when private OAuth is disabled or
   * GitHub's user token is no longer refreshable. */
  async function revokePrivateOwnerPilot(p,page) {
    if (!isProduction()) return page(403,{blocked:NOT_PRODUCTION});
    const account=String(p.login||'').trim().toLowerCase();
    if (!isValidLogin(account) ||
        String(p.confirmLogin||'').trim().toLowerCase()!==account ||
        String(p.confirmPilot||'')!=='revoke')
      return page(400,{result:'Confirm the exact account and that all its private pilot sessions must stop.'});
    try {
      const row=await db.getAccount(account);
      if (!row || row.account_type!=='Organization' || !env.DATABASE_URL)
        return page(404,{result:'This account has no private pilot to revoke.'});
      const dir=createTenantDirectory(neon(env.DATABASE_URL));
      const tenants=await dir.listPilotsForAccount(account);
      const stopped=await dir.revokePrivatePilotsForAccount(account);
      // Authorization is disabled FIRST. If cleanup fails, further private
      // calls already fail closed and the owner may safely retry the action.
      let cleaned={tokens:0,codes:0,clients:0,jobs:0,results:0};
      for(const tenant of tenants){
        const item=await purgeRevokedTenantArtifacts({
          directory:dir,tenantId:tenant.tenantId,
          ownerIdentityId:tenant.ownerIdentityId,
          connectionString:env.DATABASE_URL
        });
        for(const key of Object.keys(cleaned))cleaned[key]+=item[key];
      }
      const secrets=await dir.purgePrivatePilotRootSecrets(account);
      if(!secrets)throw new Error('Private credential cleanup was not verified.');
      await db.recordChange({account,mode:'setup',tool:'setup_revoke_private_pilot',
        target:account,
        summary:'Owner revoked private pilot sessions and cleared retained client data',
        confirmed:true,production:false,accessWidening:false}).catch(()=>{});
      return page(200,{result:'Revoked '+stopped+
        ' active private pilot grant(s) for '+account+
        '; removed '+cleaned.clients+' MCP clients, '+cleaned.tokens+
        ' bearer grants, '+cleaned.codes+' pending codes, '+cleaned.jobs+
        ' tracked jobs, '+cleaned.results+' retained results and '+
        secrets.userGrants+' encrypted user grants. Other accounts were untouched.'});
    }catch {
      return page(503,{result:'The private pilot revocation could not be verified. Disable the pilot deployment flag as a fallback and retry from the protected setup page.'});
    }
  }

  /** Passphrase/CSRF-protected owner upgrade with exact connected client and account. */
  async function upgradeConnectionProduction(p, page) {
    if (!isProduction()) return page(403, { blocked: NOT_PRODUCTION });
    const id = String(p.connection || ''), account = String(p.login || '');
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(id) || !isValidLogin(account))
      return page(400, { result: 'Enter the exact connection ID and connected GitHub account shown in the authenticated status view.' });
    const old = (await db.listUpgradeableConnections()).filter((c) => c.client_id === id && c.kind === 'connector');
    if (!old.length || old.some((c) => c.mode !== 'preview' || c.profile !== 'full' ||
      c.accounts.length !== 1 || c.accounts[0] !== account || c.default_account !== account))
      return page(403, { result: 'Only a FULL/PREVIEW custom connection for exactly this one account can be upgraded. Nothing changed.' });
    const row = await db.getAccount(account);
    if (!row) return page(403, { result: 'The connected account is no longer enrolled. Nothing changed.' });
    const count = await db.upgradeConnectionProductionMode(id, account);
    if (count !== old.length) return page(409, { result: 'The connection changed concurrently. Reload its status before trying again.' });
    const after = (await db.listUpgradeableConnections()).filter((c) => c.client_id === id && c.kind === 'connector');
    const verified = after.length === count && after.every((c) => c.mode === 'production' && c.profile === 'full' && c.accounts.length === 1 && c.accounts[0] === account);
    await db.recordChange({ account, mode: 'setup', connection: id, tool: 'setup_upgrade_connection_production', target: id,
      summary: (verified ? '' : 'UNCONFIRMED: ') + 'Owner upgraded a single-account full-profile custom connector to PRODUCTION; credentials unchanged',
      production: true, accessWidening: true, confirmed: verified }).catch(() => {});
    return page(verified ? 200 : 503, { result: verified
      ? `Connection ${id} is now PRODUCTION for ${account}. Ask ChatGPT for github_whoami to verify. Later writes retain GitHub permission checks, journaling and independent readback.`
      : 'Upgrade readback was inconclusive. Check the connection before attempting again.' });
  }

  /** The token boxes. A token is checked with GitHub before anything is stored, and only its last four characters are ever shown. */
  async function addToken(action, account, p, page) {
    const token = typeof p.token === 'string' ? p.token.trim() : '';
    if (token.length < 20 || /\s/.test(token)) return page(400, { result: 'That does not look like a GitHub token.' });
    let probe;
    try { probe = await bareOctokit({ token, fetch }).request('GET /rate_limit'); } catch (error) {
      return page(400, { result: `GitHub did not accept that token (${plainStatus(error)}). Nothing was saved.` });
    }
    const scopes = probe.headers['x-oauth-scopes'];
    if (action === 'add-package') {
      const list = String(scopes ?? '').split(',').map(s => s.trim()).filter(Boolean);
      // GitHub lists only the boxes that were ticked; read:packages is included automatically under write:packages (seen live 2026-10-23).
      if (list.includes('write:packages') && !list.includes('read:packages')) list.push('read:packages');
      const allowed = ['read:packages', 'write:packages', 'delete:packages', 'repo'];
      if (scopes === undefined)
        return page(400, { result: 'GitHub did not report any permissions for this token, which means it is not a "classic" token (it is probably a fine-grained one). On GitHub open Settings, Developer settings, Personal access tokens, Tokens (classic) and create a classic token with read:packages ticked. Nothing was saved.' });
      if (!list.includes('read:packages'))
        return page(400, { result: `This token does not have the read:packages permission. GitHub reports: ${list.length ? list.join(', ') : 'no permissions'}. Create a classic token with read:packages ticked (write:packages and delete:packages are optional). Nothing was saved.` });
      const extra = list.filter(s => !allowed.includes(s));
      if (extra.length)
        return page(400, { result: `This token has extra permissions that are not allowed here: ${extra.join(', ')}. Create a new classic token with only read:packages (optionally write:packages and delete:packages) ticked. The repo permission is only for a rare case you can ignore. Nothing was saved.` });
      const row = await db.getAccount(account);
      if (!row) return page(404, { result: 'Set that account up first. Nothing was saved.' });
      let actor;
      try { actor = (await bareOctokit({ token, fetch }).request('GET /user')).data; }
      catch (error) { return page(400, { result: `GitHub could not verify the package token owner (${plainStatus(error)}). Nothing was saved.` }); }
      const expected = row.account_type === 'User' ? row.login : row.user_login;
      if (!Number.isSafeInteger(actor?.id) || actor.id <= 0 || row.account_type === 'User' && actor.id !== row.account_id || !expected || typeof actor.login !== 'string' || actor.login.toLowerCase() !== expected.toLowerCase())
        return page(400, { result: 'The package token must belong to this personal account or the person already signed in for this organization. Use Authorize as me first. Nothing was saved.' });
      const expiry = Date.parse(probe.headers['github-authentication-token-expiration'] || '');
      if (Number.isFinite(expiry) && expiry <= Date.now())
        return page(400, { result: 'The package token has expired. Nothing was saved.' });
      let listReadback=false;
      if(row.account_type==='Organization') {
        try {
          const items=(await bareOctokit({token,fetch}).request(
            'GET /orgs/{org}/packages',{org:row.login,package_type:'container',per_page:1})).data;
          listReadback=Array.isArray(items);
        }catch{/* Provider could deny this endpoint; keep identity-only. */}
      }
      const saved = await credentials.storePackage(row.login, token, { scopes: list, actor: actor.login,
        listReadback,
        actorId: actor.id, accountId: row.account_id,
        expiresAt: Number.isFinite(expiry) ? new Date(expiry) : null });
      return page(saved ? 200 : 409, { result: saved
        ? `Saved the encrypted package token for ${row.login}. Package-level access and organization SSO/token policy still apply.`
        : 'The account changed during setup. Nothing was saved.' });
    }
    if (action === 'add-fine-grained') {
      if (scopes !== undefined) return page(400, { result: 'That is a classic token. Classic tokens are not accepted here; create a fine-grained token instead. Nothing was saved.' });
      let owner;
      try { owner = (await bareOctokit({ token, fetch }).request('GET /users/{username}', { username: account })).data; } catch (error) {
        return page(400, { result: `GitHub could not find the account "${account}" (${plainStatus(error)}). Nothing was saved.` });
      }
      const existing = await db.getAccount(owner.login);
      if (existing && existing.credential_kind !== 'fine_grained') return page(409, { result: `${owner.login} already uses a GitHub App. Remove it before switching to a fine-grained token. Nothing was saved.` });
      await db.upsertAccount({ login: owner.login, accountId: owner.id, accountType: owner.type, label: p.label ? String(p.label).slice(0, 100) : owner.login, credentialKind: 'fine_grained' });
      const expires = Date.parse(probe.headers['github-authentication-token-expiration'] || '');
      // Only the same numeric personal-account actor earns identity metadata.
      // Existing organization-associated fine-grained tokens keep their old
      // behavior but do not inherit private-tenant or proof authority.
      let numericActor=null;
      try{
        const who=(await bareOctokit({token,fetch}).request('GET /user')).data;
        if(owner.type==='User' && who?.id===owner.id && who?.type==='User')
          numericActor=who.id;
      }catch{/* No identity proof: legacy credential stays unverified. */}
      await credentials.storeFineGrained(owner.login, token, {
        expiresAt: Number.isFinite(expires)?new Date(expires):null,
        actorId:numericActor,accountId:numericActor?owner.id:null
      });
      return page(200, { result: `Saved the encrypted fine-grained token for ${owner.login} (ends in ${token.slice(-4)}).` });
    }
    const list = String(scopes ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (scopes === undefined || list.length !== 1 || list[0] !== 'notifications') {
      return page(400, { result: `This server only accepts a classic token with exactly the "notifications" scope (this one has: ${scopes === undefined ? 'not a classic token' : list.join(', ') || 'no scopes'}). Nothing was saved.` });
    }
    const row = await db.getAccount(account);
    if (!row) return page(404, { result: 'Set that account up first (create its GitHub App or add a fine-grained token).' });
    let numericActor=null;
    try{
      const who=(await bareOctokit({token,fetch}).request('GET /user')).data;
      if(who?.type==='User' && Number.isSafeInteger(who.id) && who.id>0 &&
          (row.account_type==='User'?who.id===row.account_id:
            row.user_login?.toLowerCase()===who.login?.toLowerCase()))
        numericActor=who.id;
    }catch{/* Scope-compatible tokens may not prove ownership; keep unverified. */}
    let listReadback=false;
    if(numericActor){
      try{
        const items=(await bareOctokit({token,fetch}).request(
          'GET /notifications',{per_page:1})).data;
        listReadback=Array.isArray(items);
      }catch{/* Token identity does not prove notification access. */}
    }
    await credentials.storeClassic(row.login,token,list,{
      actorId:numericActor,accountId:numericActor?row.account_id:null,
      listReadback
    });
    return page(200, { result: `Saved the encrypted notifications token for ${row.login} (ends in ${token.slice(-4)}).` });
  }

  // ---- GET /api/github/manifest-callback?code&state ----
  async function manifestCallback(req, res) {
    if (!only(res, req, ['GET'])) return;
    const state = await db.consumeSetupState(String(req.query?.state || ''), 'manifest');
    const code = String(req.query?.code || '');
    if (!state || !/^[A-Za-z0-9_-]{8,128}$/.test(code)) {
      return frame(res, 400, resultPage({ title: 'Setup link expired', message: 'This GitHub App setup link is unknown, already used or too old. Start again from the setup page.' }));
    }
    try {
      if (!isProduction() || !credentials.keyConfigured()) throw new Error('not allowed');
      const created = (await bareOctokit({ fetch }).request('POST /app-manifests/{code}/conversions', { code })).data;
      const owner = created.owner;
      if (!owner?.login || !owner?.id) throw new Error('no owner');
      await credentials.storeApp(created, { ownerLogin: owner.login, ownerType: owner.type });
      await db.upsertAccount({ login: owner.login, accountId: owner.id, accountType: owner.type, label: state.account_hint || owner.login, credentialKind: 'app', appId: created.id });
      return frame(res, 200, resultPage({ title: 'GitHub App created', message: `The GitHub App for ${owner.login} was created and its keys are stored encrypted. Next: install it on ${owner.login}.`, installSlug: created.slug }));
    } catch {
      return frame(res, 502, resultPage({ title: 'Could not finish creating the App', message: 'GitHub did not complete the App setup, or the server could not store it. Nothing secret was shown. If the App now exists on GitHub, delete it there and start again.' }));
    }
  }

  // ---- GET /api/github/user-callback?code&state ----
  async function userCallback(req, res) {
    if (!only(res, req, ['GET'])) return;
    const state = await db.consumeSetupState(String(req.query?.state || ''), 'user_auth');
    const code = String(req.query?.code || '');
    if (!state || !code || code.length > 256) {
      return frame(res, 400, resultPage({ title: 'Sign-in link expired', message: 'This authorization link is unknown, already used or too old. Start again from the setup page.' }));
    }
    try {
      if (!isProduction() || !credentials.keyConfigured()) throw new Error('not allowed');
      const row = await db.getAccount(state.account_hint);
      const client = await credentials.clientCredentials(row.app_id);
      const stateValue = String(req.query.state);
      const response = await fetch(OAUTH_TOKEN_URL, {
        method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: client.clientId, client_secret: client.clientSecret, code, redirect_uri: `${publicOrigin(env)}/api/github/user-callback`,
          code_verifier: credentials.openVerifier(stateValue, state.code_verifier_enc) })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.error || !data.access_token) throw new Error('exchange refused');
      const me = (await bareOctokit({ token: data.access_token, fetch }).request('GET /user')).data;
      await credentials.storeUserAuthorization(row.login, { userLogin: me.login, accessToken: data.access_token, expiresIn: data.expires_in, refreshToken: data.refresh_token, refreshExpiresIn: data.refresh_token_expires_in });
      return frame(res, 200, resultPage({ title: 'Signed in', message: `You are authorized as ${me.login} for ${row.login}'s personal-settings tools.` }));
    } catch {
      return frame(res, 502, resultPage({ title: 'Could not finish signing in', message: 'GitHub did not complete the authorization. Nothing was saved. Start again from the setup page.' }));
    }
  }

  return {
    setup: async (req, res) => {
      if (!only(res, req, ['GET', 'POST'])) return;
      return req.method === 'GET' ? await setupGet(req, res) : await setupPost(req, res);
    },
    manifestCallback,
    userCallback
  };
}

