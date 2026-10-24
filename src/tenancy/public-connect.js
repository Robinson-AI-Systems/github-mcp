// Public sign-in ("connect") and the person's own "My connection" page. Redesigned 2026-10-23 after a day of phone-only
// failures: the old flow chained up to ten hops (our form, GitHub, install, GitHub again, an accounts page, a God-mode page,
// a token page, a hand-back page) and needed three browser cookies to survive every hop. In-app browsers lost them.
//
// The connect flow now is:  app -> our authorize (straight on to GitHub) -> GitHub -> our callback -> ONE "Approve" page
// (a 200 page, so the redirect chain ends on our site) -> tap Approve -> small hand-back page -> app.
// Only when no account of theirs has the App does an "Install the App" page come first (one tap to GitHub and back).
// Everything else (more accounts, the master token, read-only, time zone, disconnecting apps, deleting data) lives on the
// "My connection" page, reached by its own GitHub sign-in at any time.
//
// Safety shape (fails closed, says nothing about why):
// * Off unless GITHUB_PUBLIC_CONNECT=enabled on the production deployment with the private-tenant machinery configured.
// * NO browser cookie is needed anywhere. Each step's state is a one-use random value kept (hashed) in the database. What
//   stops someone tricking a person into finishing a sign-in they did not start is the Approve page itself: it shows who is
//   signed in and the exact site that will receive access, and nothing reaches any app until the person taps Approve there.
//   The Approve handle is minted after GitHub sign-in and exists only inside that person's page.
// * The person is whoever GitHub's numeric id says they are. Only accounts they own (their personal account, or an
//   organization where GitHub says they are an admin) and that have the App installed are ever connected.
// * Hard caps on public clients, open steps and self-serve tenants (kill switch = unset the flag).
// * Authorization codes carry the routing marker `pc.<tenant>.<identity>.<random>`: only a selector. The tenant's own
//   single-use code row, the client secret hash, PKCE and live membership revisions still decide everything.
import { validZone, ZONE_SETTING } from '../core/time-zone.js';
import { createHash, randomBytes } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { createTenantDirectory, initializeProvisionedTenant, openAuthorizedTenantDb } from './directory.js';
import { admitTenantOAuth, recordTenantMetric } from './runtime-limits.js';
import { verifyGithubBearerIdentity, listUserAppInstallations, verifyAccountAuthority } from './github-identity.js';
import { storePilotUserGrant, createTenantScopedCredentials } from './user-authorization.js';
import { pilotAppClient } from './pilot-app-client.js';
import { MASTER_HANDLE } from './master-credential.js';
import { masterUnlocks } from '../github/master-areas.js';
import { createDb } from '../db.js';
import { bareOctokit } from '../github/client.js';
import { hashToken, randomToken, validRedirectUri } from '../core/oauth.js';
import { publicOrigin } from '../core/http.js';
import { isPublicClientId, publicAuthCode, parsePublicCode } from './public-code.js';

const gitAuthorize = 'https://github.com/login/oauth/authorize';
const gitToken = 'https://github.com/login/oauth/access_token';
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const PLACE = /^[A-Za-z0-9-]{1,39}(\/[A-Za-z0-9._-]{1,100})?$/;
const STATE = /^pc\.[A-Za-z0-9_-]{32,256}$/;
const CODE = /^[A-Za-z0-9_-]{8,256}$/;
const TENANT_KEY = 'public-connect';
const APPROVE_SECONDS = 900, MANAGE_SECONDS = 1800;
const sha = (text) => createHash('sha256').update(text).digest('hex');
const random = (n) => randomBytes(n).toString('base64url');

/** A refusal whose message is safe to show a person. `code` picks the page; nothing else about why is revealed. */
export class PublicConnectError extends Error {
  constructor(code, message) { super(message); this.name = 'PublicConnectError'; this.code = code; }
}
export const FORGET_CLIENT = 'pcl_forget_my_data_built_in_page_0000000';
export const MANAGE_CLIENT = 'pcl_my_connection_built_in_page_00000000';
export const MANAGE_PATH = '/connection';
// Claude asks for the permission names this server advertises in its discovery document; sign-in gives no extra power for them.
const ADVERTISED_SCOPES = ['github.notifications.read'];
// `why` is an internal label for the server log only (never shown to the person, never a secret).
const refused = (why = '') => Object.assign(new PublicConnectError('refused', 'GitHub could not verify this sign-in. Start again from your app.'), { why });
const busy = () => new PublicConnectError('capacity', 'Too many people are connecting right now. Please try again in a few minutes.');

export { isPublicClientId, publicAuthCode, parsePublicCode };
export const publicConnectEnabled = (env = process.env) => env.GITHUB_PUBLIC_CONNECT === 'enabled';

const whole = (text, fallback, max) => {
  const n = Number(text ?? fallback);
  return Number.isSafeInteger(n) && n >= 1 && n <= max ? n : fallback;
};

export function createPublicConnect({ env = process.env, fetchImpl = fetch, rootSqlFactory = neon, tenantSqlFactory = neon } = {}) {
  const appId = Number(env.GITHUB_PILOT_APP_ID);
  const limits = Object.freeze({
    maxClients: whole(env.GITHUB_PUBLIC_MAX_CLIENTS, 500, 100000),
    // HARD-1: the shared cap is high (no one person can fill it); each registered app gets its own small cap, so one app opening many
    // sign-in links can only block itself. The built-in pages (My connection, Delete my data) share one larger cap each.
    maxOpenFlows: whole(env.GITHUB_PUBLIC_MAX_OPEN_FLOWS, 5000, 100000),
    maxOpenPerClient: whole(env.GITHUB_PUBLIC_MAX_OPEN_FLOWS_PER_CLIENT, 20, 10000),
    maxOpenPerBuiltIn: 200,
    maxTenants: whole(env.GITHUB_PUBLIC_MAX_TENANTS, 25, 1000000)
  });
  const active = () => {
    if (!publicConnectEnabled(env) || env.GITHUB_PRIVATE_TENANT_PILOT !== 'enabled' ||
        env.VERCEL_ENV !== 'production' || !env.DATABASE_URL ||
        !Number.isSafeInteger(appId) || appId <= 0) throw refused('r1');
    return publicOrigin(env);
  };
  const rootSql = () => rootSqlFactory(env.DATABASE_URL);
  const directory = () => createTenantDirectory(rootSql());
  let schemaReady = null;
  const ensureSchema = () => {
    schemaReady ??= directory().initSchema();
    schemaReady.catch(() => { schemaReady = null; });
    return schemaReady;
  };
  const callback = () => active() + '/api/github/user-callback';
  const manageUrl = () => active() + MANAGE_PATH;

  async function loadClient(clientId, redirectUri) {
    const client = await directory().getPublicClient(clientId);
    if (!client || !client.redirectUris.includes(redirectUri)) throw refused('r2');
    return client;
  }
  function checkAuthorizeRequest(p) {
    const origin = active();
    if (!isPublicClientId(p.client_id) || [FORGET_CLIENT, MANAGE_CLIENT].includes(p.client_id) || p.response_type !== 'code' ||
        p.code_challenge_method !== 'S256' || !CHALLENGE.test(String(p.code_challenge ?? '')) || p.resource !== origin + '/api/mcp' ||
        typeof p.redirect_uri !== 'string' || !validRedirectUri(p.redirect_uri) ||
        (p.state !== undefined && (typeof p.state !== 'string' || p.state.length > 256)) ||
        (p.scope !== undefined && !(typeof p.scope === 'string' && p.scope.split(/\s+/).filter(Boolean).every((x) => ADVERTISED_SCOPES.includes(x))))) throw refused('r3');
  }
  /** The two built-in pages (delete my data, My connection) hang their GitHub sign-in on a client row that can never get tokens. */
  async function builtInClient(clientId, name) {
    const dir = directory(), redirectUri = clientId === MANAGE_CLIENT ? manageUrl() : active() + '/api/oauth/authorize';
    await dir.ensureBuiltInClient(clientId, redirectUri, hashToken(randomToken(32)), name);
    return await loadClient(clientId, redirectUri);
  }

  /** RFC 7591 registration for the public flow. Capped; the secret is shown once and only its hash is kept. */
  async function registerClient(body) {
    active(); await ensureSchema();
    const uris = body?.redirect_uris;
    if (!Array.isArray(uris) || uris.length < 1 || uris.length > 8 || new Set(uris).size !== uris.length ||
        !uris.every((u) => typeof u === 'string' && validRedirectUri(u)) ||
        (body.token_endpoint_auth_method && body.token_endpoint_auth_method !== 'client_secret_post'))
      throw new PublicConnectError('invalid_client_metadata', 'One to eight valid, distinct redirect URIs are required.');
    const clientId = 'pcl_' + random(24), secret = randomToken(32);
    const name = typeof body.client_name === 'string' ? body.client_name.slice(0, 100) : null;
    const stored = await directory().createPublicClient({ clientId, secretHash: hashToken(secret), redirectUris: uris,
      clientName: name, maxClients: limits.maxClients });
    if (!stored) throw new PublicConnectError('capacity', 'New connections are paused for now. Please try again later.');
    return Object.freeze({ client_id: clientId, client_secret: secret, client_secret_expires_at: 0, redirect_uris: [...uris],
      token_endpoint_auth_method: 'client_secret_post', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] });
  }

  const perClient = (clientId) => ([FORGET_CLIENT, MANAGE_CLIENT].includes(clientId) ? limits.maxOpenPerBuiltIn : limits.maxOpenPerClient);
  /** Stores one step and, for a sign-in step, returns GitHub's sign-in address. */
  async function openStep({ client, flow, stage = 'signin', afterInstall = false }) {
    const state = 'pc.' + random(32), verifier = random(48);
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const stored = await directory().createPublicFlow({ stateHash: sha(state), stage, clientId: client.clientId,
      redirectUri: flow.redirectUri, clientState: flow.clientState ?? null, codeChallenge: flow.codeChallenge,
      tier: 'standard', allowChanges: true, purpose: flow.purpose ?? null,
      providerVerifier: stage === 'signin' ? verifier : null, maxOpen: limits.maxOpenFlows, maxOpenPerClient: perClient(client.clientId), afterInstall });
    if (!stored) throw busy();
    if (stage !== 'signin') return { state };
    const appClient = await pilotAppClient({ env, db: createDb(rootSql()) });
    const q = new URLSearchParams({ client_id: appClient.clientId, redirect_uri: callback(), state,
      code_challenge: challenge, code_challenge_method: 'S256' });
    return { url: gitAuthorize + '?' + q.toString(), state };
  }
  /** A follow-on page's one-use handle (Approve, My connection, delete). */
  async function openHandle(fields, ttlSeconds) {
    const handle = 'pc.' + random(32);
    if (!await directory().createPublicFlow({ tier: 'standard', codeChallenge: random(32), ...fields, stateHash: sha(handle), stage: 'god',
      ttlSeconds, maxOpen: limits.maxOpenFlows, maxOpenPerClient: perClient(fields.clientId) })) throw busy();
    return handle;
  }
  async function installUrl({ client, flow }) {
    const app = await createDb(rootSql()).getApp(appId);
    if (!app?.slug || !/^[a-z0-9-]{1,100}$/.test(app.slug)) throw refused('r17');
    const next = await openStep({ client, flow, stage: 'install' });
    return (target) => `https://github.com/apps/${app.slug}/installations/new?state=${next.state}` + (target ? `&suggested_target_id=${target}` : '');
  }

  /** The app opened our sign-in address. Checked, then straight on to GitHub: no page, no cookie. */
  async function begin(p) {
    active(); await ensureSchema(); checkAuthorizeRequest(p);
    const client = await loadClient(p.client_id, p.redirect_uri);
    await directory().purgeExpiredPublicFlows(client.clientId);
    return await openStep({ client, flow: { redirectUri: p.redirect_uri, clientState: p.state, codeChallenge: p.code_challenge } });
  }

  /** GitHub sent the person back after installing the App: sign in once more (GitHub does it silently). */
  async function resumeInstall({ state }) {
    active();
    if (!STATE.test(String(state ?? ''))) throw refused('r6');
    const flow = await directory().consumePublicFlow(sha(state), 'install');
    if (!flow) throw refused('r7');
    const client = await loadClient(flow.clientId, flow.redirectUri);
    return await openStep({ client, flow, afterInstall: true });
  }

  /** One isolated tenant per verified GitHub person; every account that person connects lives inside it. */
  async function ensureTenant({ principal, installations }) {
    const dir = directory(), root = createDb(rootSql());
    // LAUNCH-1: while invite-only is on, a NEW person needs an invite; people who already have a store are never locked out.
    if (env.GITHUB_PUBLIC_INVITE_ONLY === 'enabled' && !await dir.findPublicTenantBySubject(principal.subject) && !await dir.isPublicInvited(principal.login))
      throw new PublicConnectError('invite_only', 'Robinson GitHub MCP is invite-only right now. Ask Chris for an invite.');
    const identityId = await dir.enrollVerifiedGithubSubject(principal.subject);
    const existing = await dir.findPilotTenant(identityId, TENANT_KEY);
    if (!existing && await dir.countPilotTenants() >= limits.maxTenants)
      throw new PublicConnectError('capacity', 'We are at our current capacity for new accounts. Please try again later.');
    const tenantId = await dir.provisionPilotForOwnerAccount(identityId, TENANT_KEY);
    const { db } = await initializeProvisionedTenant({ tenantId, connectionString: env.DATABASE_URL, sqlFactory: tenantSqlFactory });
    const app = await root.getApp(appId);
    if (!app || !app.client_secret_enc || !app.private_key_enc || !app.webhook_secret_enc) throw refused('r8');
    // The tenant keeps its own copy of the App's sealed keys (older code paths still read it) and it is refreshed on every sign-in.
    // HARD-1: the shared (root) copy is authoritative - the MCP route reads it first, so a replaced key reaches everyone at once.
    await db.saveApp({ id: app.id, slug: app.slug, ownerLogin: app.owner_login, ownerType: app.owner_type, clientId: app.client_id,
      clientSecretEnc: app.client_secret_enc, privateKeyEnc: app.private_key_enc, webhookSecretEnc: app.webhook_secret_enc,
      permissions: app.permissions });
    if (!await dir.authorized(tenantId, identityId) && !await dir.activate(tenantId, 'gh_t_' + tenantId.replaceAll('-', ''))) throw refused('r9');
    if (!await dir.resolveAllowlistedPilotSubject(tenantId, principal.subject) &&
        !await dir.allowlistPilotIdentity(tenantId, identityId, identityId)) throw refused('r10');
    const logins = [];
    for (const installation of installations) {
      const login = installation.login.toLowerCase();
      await db.upsertAccount({ login, accountId: installation.accountId, accountType: installation.type, label: login,
        credentialKind: 'app', appId });
      if (!await db.setInstallation(login, { installationId: installation.installationId,
        repositorySelection: installation.repositorySelection, permissions: installation.permissions, status: 'active' })) throw refused('r11');
      // Verified owner of this account (own account, or organization admin). Changes are on by default for accounts the
      // person owns (owner decision 2026-10-23); each change is still previewed and confirmed, and Read-only is one tap.
      if (env.VERCEL_ENV === 'production') await db.setProductionEnabled(login, true);
      logins.push(login);
    }
    // PUB-5 A: keep the shared lookup of "who holds which App installation" current (numbers only), from what this
    // person's own store now holds, so accounts added earlier are kept. Extra places (master token) have no installation.
    await dir.indexPublicInstallations(tenantId, (await db.listAccounts())
      .filter((a) => a.credential_kind === 'app' && a.installation_id).map((a) => a.installation_id));
    return { dir, tenantId, identityId, logins };
  }

  /** Accounts this person administers (personal account first) where the App is not installed. Anything unexpected → none. */
  async function findOffers({ token, principal, installs }) {
    try {
      const have = new Set(installs.map((i) => i.login.toLowerCase()));
      const out = [];
      const subject = Number(principal.subject);
      if (!have.has(principal.login.toLowerCase()) && Number.isSafeInteger(subject) && subject > 0 && LOGIN.test(principal.login))
        out.push({ login: principal.login, id: subject, type: 'User' });
      const res = await fetchImpl('https://api.github.com/user/memberships/orgs?state=active&per_page=100', { signal: AbortSignal.timeout(8000),
        headers: { accept: 'application/vnd.github+json', authorization: 'Bearer ' + token, 'x-github-api-version': '2026-03-10' } });
      if (res.ok) {
        for (const m of (await res.json()) ?? []) {
          const org = m?.organization;
          if (m?.state === 'active' && m?.role === 'admin' && org && Number.isSafeInteger(org.id) && org.id > 0 &&
              LOGIN.test(String(org.login)) && !have.has(String(org.login).toLowerCase())) out.push({ login: org.login, id: org.id, type: 'Organization' });
          if (out.length >= 8) break;
        }
      }
      return out;
    } catch { return []; }
  }

  /** Swaps GitHub's code for the person's GitHub token and works out which of their accounts can be connected. */
  async function signedIn(flow, code) {
    const appClient = await pilotAppClient({ env, db: createDb(rootSql()) });
    const exchange = await fetchImpl(gitToken, { method: 'POST', signal: AbortSignal.timeout(10000),
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: appClient.clientId, client_secret: appClient.clientSecret, code,
        redirect_uri: callback(), code_verifier: flow.providerVerifier }) });
    if (!exchange.ok) throw refused('r14');
    const data = await exchange.json();
    if (!data?.access_token || data.error) throw refused('r15');
    const principal = await verifyGithubBearerIdentity(data.access_token, { fetchImpl });
    return { data, principal };
  }
  async function connectable(data, principal) {
    const installs = await listUserAppInstallations(data.access_token, { appId, fetchImpl });
    if (installs === null) throw refused('r16');
    // Installation tokens act with the App's own rights, so only accounts this person owns are connected; others are skipped.
    const chosen = [];
    for (const installation of installs.slice(0, 10))
      if (await verifyAccountAuthority(data.access_token, { installation, subject: principal.subject, fetchImpl })) chosen.push(installation);
    chosen.sort((x, y) => Number(y.login.toLowerCase() === principal.login.toLowerCase()) - Number(x.login.toLowerCase() === principal.login.toLowerCase()));
    return { installs, chosen };
  }
  /** Creates/updates the person's tenant and stores their own sealed GitHub grant for every connected account. */
  async function connect({ data, principal, chosen }) {
    const made = await ensureTenant({ principal, installations: chosen });
    const { db, sql } = await openAuthorizedTenantDb({ directory: made.dir, tenantId: made.tenantId,
      verifiedIdentityId: made.identityId, connectionString: env.DATABASE_URL, sqlFactory: tenantSqlFactory });
    const latest = await made.dir.authorizedPilotIdentity(made.tenantId, made.identityId);
    if (!latest) throw refused('r18');
    const expiresIn = Number(data.expires_in ?? 28800);
    const refreshExpiresIn = data.refresh_token_expires_in == null ? null : Number(data.refresh_token_expires_in);
    if (!Number.isSafeInteger(expiresIn) || expiresIn < 60 || expiresIn > 31536000 ||
        (refreshExpiresIn !== null && (!Number.isSafeInteger(refreshExpiresIn) || refreshExpiresIn < 60 || refreshExpiresIn > 31536000)) ||
        (data.refresh_token !== undefined && (typeof data.refresh_token !== 'string' || data.refresh_token.length < 8 || data.refresh_token.length > 4096))) throw refused('r19');
    const rows = [];
    for (const login of made.logins) {
      const account = await db.getAccount(login);
      if (!account || account.installation_status !== 'active') throw refused('r20');
      if (!await storePilotUserGrant({ directory: made.dir, tenantId: made.tenantId, identityId: made.identityId,
        account: login, userLogin: principal.login, accessToken: data.access_token, expiresIn,
        verifiedContext: { subject: principal.subject, tenant: latest, account },
        refreshToken: data.refresh_token ?? null, refreshExpiresIn, env })) throw refused('r21');
      rows.push(account);
    }
    return { ...made, db, sql, rows };
  }

  /** The browser came back from GitHub. Returns what the next page shows:
   *  {approve} the Approve page, {install} the "install the App" page, {manage} My connection, {forget} delete-my-data. */
  async function finish({ state, code }) {
    const started = Date.now(); let metricSql = null, outcome = 'error';
    try {
      active();
      if (!STATE.test(String(state ?? '')) || !CODE.test(String(code ?? ''))) throw refused('r12');
      const flow = await directory().consumePublicFlow(sha(state), 'signin');
      if (!flow) throw refused('r13');
      const client = await loadClient(flow.clientId, flow.redirectUri);
      const { data, principal } = await signedIn(flow, code);
      if (flow.purpose === 'forget') { outcome = 'ok'; return await forgetLookup(principal); }
      if (flow.purpose === 'manage') { outcome = 'ok'; return await manageAfterSignIn({ data, principal }); }
      const { installs, chosen } = await connectable(data, principal);
      if (chosen.length === 0) {
        outcome = 'ok';
        return { install: { signedInAs: principal.login, again: flow.afterInstall === true,
          url: (await installUrl({ client, flow: { redirectUri: flow.redirectUri, clientState: flow.clientState, codeChallenge: flow.codeChallenge } }))() } };
      }
      const offers = await findOffers({ token: data.access_token, principal, installs });
      const made = await connect({ data, principal, chosen });
      metricSql = made.sql;
      await admitTenantOAuth(made.sql, flow.clientId);
      await made.db.mirrorOAuthClient({ clientId: client.clientId, secretHash: client.secretHash, redirectUris: client.redirectUris,
        clientName: client.clientName, authorizedAccount: null });
      const handle = await openHandle({ clientId: flow.clientId, redirectUri: flow.redirectUri, clientState: flow.clientState,
        codeChallenge: flow.codeChallenge, accountLogin: made.logins.join(','), allowChanges: true, purpose: 'approve',
        tenantId: made.tenantId, identityId: made.identityId, offers: offers.length ? offers : null }, APPROVE_SECONDS);
      outcome = 'ok';
      return { approve: { handle, signedInAs: principal.login, appName: client.clientName, appHost: new URL(flow.redirectUri).host,
        accounts: made.rows.map((r) => ({ login: r.login, organization: r.account_type === 'Organization' })),
        others: offers.map((o) => o.login), manageUrl: manageUrl() } };
    } finally {
      if (metricSql) await recordTenantMetric(metricSql, { event: 'provider', outcome, durationMs: Math.max(0, Date.now() - started) }).catch(() => {});
    }
  }

  /** Opens the tenant behind a stored step, re-checking that the person is still an active member. */
  async function scopeOf(flow) {
    const dir = directory();
    const { db, sql, tenant } = await openAuthorizedTenantDb({ directory: dir, tenantId: flow.tenantId, verifiedIdentityId: flow.identityId,
      connectionString: env.DATABASE_URL, sqlFactory: tenantSqlFactory });
    const live = await dir.authorizedPilotIdentity(flow.tenantId, flow.identityId);
    if (!live || live.membershipRevision !== tenant.membershipRevision) throw refused('r24');
    return { dir, db, sql, tenant: live };
  }
  async function mintCode({ db, tenantId, identityId, logins, flow, mode, profile = 'full' }) {
    const code = publicAuthCode(tenantId, identityId);
    await db.createAuthCode({ code, clientId: flow.clientId, redirectUri: flow.redirectUri, codeChallenge: flow.codeChallenge,
      codeChallengeMethod: 'S256', defaultAccount: logins[0], accounts: logins, mode, profile, listing: 'compact' });
    const url = new URL(flow.redirectUri);
    url.searchParams.set('code', code);
    if (flow.clientState !== null && flow.clientState !== undefined) url.searchParams.set('state', flow.clientState);
    url.searchParams.set('iss', active());
    return url.toString();
  }

  /** The Approve page was answered. `approve` hands the app its code; `cancel` tells the app the person said no. */
  async function approve({ handle, choice, readOnly = false }) {
    active();
    if (!STATE.test(String(handle ?? '')) || !['approve', 'cancel'].includes(choice)) throw refused('r25');
    const flow = await directory().consumePublicFlow(sha(handle), 'god');
    if (!flow || flow.purpose !== 'approve' || !flow.tenantId || !flow.identityId || !flow.accountLogin) throw refused('r26');
    if (choice === 'cancel') {
      const url = new URL(flow.redirectUri);
      url.searchParams.set('error', 'access_denied');
      if (flow.clientState !== null && flow.clientState !== undefined) url.searchParams.set('state', flow.clientState);
      url.searchParams.set('iss', active());
      return { redirect: url.toString() };
    }
    const logins = flow.accountLogin.split(',');
    const { db } = await scopeOf(flow);
    const rows = [];
    for (const login of logins) {
      const row = await db.getAccount(login);
      if (!row || row.installation_status !== 'active') throw refused('r27');
      rows.push(row);
    }
    // Changes only when not read-only AND every connected account really has them on; otherwise safe preview.
    // Read-only means the read_only profile (every change tool refused), not only preview mode.
    const mode = readOnly !== true && env.VERCEL_ENV === 'production' && rows.every((r) => r.production_enabled === true) ? 'production' : 'preview';
    // GOD-5: the person's extra places (master token) come along with a new connection; their own gate keeps changes off until allowed.
    const places = readOnly === true ? [] : (await db.listAccounts()).filter((a) => a.credential_kind === 'master').map((a) => a.login);
    logins.push(...places.filter((p) => !logins.some((l) => l.toLowerCase() === p.toLowerCase())));
    logins.splice(10);
    return { redirect: await mintCode({ db, tenantId: flow.tenantId, identityId: flow.identityId, logins,
      flow: { clientId: flow.clientId, redirectUri: flow.redirectUri, codeChallenge: flow.codeChallenge, clientState: flow.clientState },
      mode, profile: readOnly === true ? 'read_only' : 'full' }) };
  }

  // ---------------------------------------------------------------- My connection
  /** Start: a GitHub sign-in that proves who is managing. */
  async function startManage() {
    active(); await ensureSchema();
    const client = await builtInClient(MANAGE_CLIENT, 'My connection');
    return await openStep({ client, flow: { redirectUri: client.redirectUris[0], clientState: null, codeChallenge: random(32), purpose: 'manage' } });
  }
  /** After GitHub: refresh what is connected (new installations join, the stored grant is renewed) and open the page. */
  async function manageAfterSignIn({ data, principal }) {
    const tenantId = await directory().findPublicTenantBySubject(principal.subject);
    if (!tenantId) return { manage: { none: true, signedInAs: principal.login } };
    const { installs, chosen } = await connectable(data, principal);
    const offers = await findOffers({ token: data.access_token, principal, installs });
    let made;
    if (chosen.length) made = await connect({ data, principal, chosen });
    else {
      const identityId = await directory().enrollVerifiedGithubSubject(principal.subject);
      made = { tenantId, identityId, logins: [] };
    }
    if (made.tenantId !== tenantId) throw refused('r32');
    const { db } = await scopeOf(made);
    // Accounts added since an app connected join that app's connection now, without reconnecting.
    if (made.logins.length) await db.addAccountsToConnections(made.logins);
    await db.mirrorOAuthClient({ clientId: MANAGE_CLIENT, secretHash: hashToken(randomToken(32)), redirectUris: [manageUrl()],
      clientName: 'My connection', authorizedAccount: null });
    return { manage: await manageView({ tenantId, identityId: made.identityId, signedInAs: principal.login, offers, db }) };
  }
  async function manageView({ tenantId, identityId, signedInAs, offers, db, notice = null }) {
    const handle = await openHandle({ clientId: MANAGE_CLIENT, redirectUri: manageUrl(), purpose: 'manage', tenantId, identityId,
      accountLogin: signedInAs.toLowerCase(), offers: offers?.length ? offers : null }, MANAGE_SECONDS);
    const all = await db.listAccounts();
    const accounts = all.filter((a) => a.credential_kind !== 'master').map((a) => ({ login: a.login, organization: a.account_type === 'Organization',
      changes: a.production_enabled === true, active: a.installation_status === 'active' }));
    const places = all.filter((a) => a.credential_kind === 'master').map((a) => ({ login: a.login, organization: a.account_type === 'Organization',
      changes: a.allow_changes === true, repos: a.allowed_repos ?? null }));
    // Refresh-aware: an app whose one-hour access lapsed but can still renew it is listed (and can be disconnected).
    const seen = new Set();
    const connections = (await db.listUpgradeableConnections()).filter((c) => c.client_id !== MANAGE_CLIENT && !seen.has(c.client_id) && seen.add(c.client_id))
      .map((c) => ({ clientId: c.client_id, name: c.client_name ?? 'An app', readOnly: c.profile === 'read_only', canChange: c.profile !== 'read_only' && c.mode === 'production',
        accounts: c.accounts }));
    const master = await directory().getPilotOptionalCredential({ tenantId, identityId, accountLogin: MASTER_HANDLE, kind: 'M' }).catch(() => null);
    // GOD-6: "Act as me" and "Allow overriding branch rules" are per person (their GitHub id), never per tenant.
    let actAs = null;
    if (master) {
      const subject = await directory().getPilotVerifiedSubject(tenantId, identityId).catch(() => null);
      if (/^[1-9][0-9]{0,18}$/.test(String(subject))) {
        const read = (key) => db.getSetting(`${key}.${subject}`).catch(() => null);
        const expired = master.expires_at && new Date(master.expires_at).getTime() <= Date.now();
        actAs = { login: (await read('master_login')) || null, on: (await read('act_as_me')) !== 'off', ruleOverride: (await read('rule_override')) !== 'off',
          rejected: !!(await read('master_rejected_at')), expired: !!expired };
      }
    }
    return { handle, signedInAs, accounts, places, connections, offers: offers ?? [], timeZone: (await db.getSetting(ZONE_SETTING)) ?? 'UTC',
      master: master ? { added: true, expiresAt: master.expires_at ?? null, unlocks: masterUnlocks(master.scopes ?? []), actAs } : { added: false, unlocks: [] }, notice };
  }
  /** One action on My connection. Every action uses up the page's handle and returns a fresh page (or somewhere to go). */
  async function manageAction({ handle, action, value }) {
    active();
    if (!STATE.test(String(handle ?? '')) ||
        !['refresh', 'read_only', 'allow_changes', 'time_zone', 'disconnect', 'add', 'master', 'add_place', 'place_changes', 'remove_place', 'act_as_me', 'rule_override'].includes(action)) throw refused('r33');
    const flow = await directory().consumePublicFlow(sha(handle), 'god');
    if (!flow || flow.purpose !== 'manage' || !flow.tenantId || !flow.identityId || !flow.accountLogin) throw refused('r34');
    const { db, dir, tenant } = await scopeOf(flow);
    const view = (notice) => manageView({ tenantId: flow.tenantId, identityId: flow.identityId, signedInAs: flow.accountLogin, offers: flow.offers, db, notice });
    if (action === 'read_only') {
      const n = await db.setConnectionsReadOnly(true);
      return { manage: await view(n ? 'Done. Your apps can now look, but not change anything.' : 'No app is connected yet.') };
    }
    if (action === 'allow_changes') {
      const n = await db.setConnectionsReadOnly(false);
      return { manage: await view(n ? 'Done. Your apps can make changes again (each one is still shown to you first).' : 'No app is connected yet.') };
    }
    if (action === 'time_zone') {
      const zone = validZone(String(value ?? ''));
      if (!zone) throw refused('r35');
      await db.setSetting(ZONE_SETTING, zone);
      return { manage: await view('Saved. Times are shown in ' + zone + '.') };
    }
    if (action === 'disconnect') {
      const target = (await db.listUpgradeableConnections()).find((c) => c.client_id === value && c.client_id !== MANAGE_CLIENT);
      if (!target) throw refused('r36');
      await db.revokeConnection(target.client_id);
      return { manage: await view('Disconnected ' + (target.client_name ?? 'that app') + '. To use it again, connect from the app.') };
    }
    if (action === 'add') {
      const offer = (flow.offers ?? []).find((o) => o.login === value);
      if (!offer) throw refused('r37');
      const client = await builtInClient(MANAGE_CLIENT, 'My connection');
      const url = (await installUrl({ client, flow: { redirectUri: manageUrl(), clientState: null, codeChallenge: random(32), purpose: 'manage' } }))(offer.id);
      return { go: url };
    }
    if (action === 'master') {
      // Same one-use master-token page the github_master_token_link tool opens; the token is pasted there, never here.
      const link = random(32);
      if (!await dir.createPublicFlow({ stateHash: sha(link), stage: 'god', clientId: MANAGE_CLIENT, redirectUri: manageUrl(),
        codeChallenge: random(32), tier: 'standard', purpose: 'master', tenantId: flow.tenantId, identityId: flow.identityId,
        ttlSeconds: 600, maxOpen: limits.maxOpenFlows, maxOpenPerClient: limits.maxOpenPerBuiltIn })) throw busy();
      return { go: active() + '/api/tenant/optional?master_link=' + link };
    }
    if (action === 'act_as_me' || action === 'rule_override') {
      if (!['on', 'off'].includes(String(value))) throw refused('r41');
      const subject = await dir.getPilotVerifiedSubject(flow.tenantId, flow.identityId);
      if (!/^[1-9][0-9]{0,18}$/.test(String(subject))) throw refused('r42');
      await db.setSetting(`${action}.${subject}`, value);
      return { manage: await view(action === 'act_as_me'
        ? (value === 'on' ? 'Done. GitHub will record you as the one who makes each change.' : 'Done. GitHub will show the Robinson GitHub MCP app for each change.')
        : (value === 'on' ? 'Done. Your assistant may ask to skip a branch\'s rules for one change, and you confirm each one.' : 'Done. Branch rules can no longer be skipped for you.')) };
    }
    if (action === 'add_place') return { manage: await view(await addPlace({ db, dir, tenant, value })) };
    if (action === 'place_changes') {
      const [login, state] = String(value ?? '').split(':');
      if (!LOGIN.test(login ?? '') || !['on', 'off'].includes(state)) throw refused('r38');
      if (!await db.setPlaceChanges(login, state === 'on')) return { manage: await view('That place is not in your list.') };
      if (state === 'on') await db.addAccountsToConnections([login]);
      return { manage: await view(state === 'on' ? `Changes are now allowed for ${login}. Each one is still shown to you first.` : `${login} is read-only again.`) };
    }
    if (action === 'remove_place') {
      const [login, repo = null] = String(value ?? '').split('/');
      if (!PLACE.test(String(value ?? ''))) throw refused('r39');
      const done = await db.removeExtraPlace(login, repo);
      if (done.whole) await db.removeAccountFromConnections(login);
      return { manage: await view(done.removed ? `Removed ${value}.` : 'That place is not in your list.') };
    }
    return { manage: await view(null) };
  }

  // GOD-5: "extra places". The master token is read here only to ask GitHub whether the person can really see the place; it
  // is never stored again, logged or shown. The reply to the person is a plain sentence either way.
  async function addPlace({ db, dir, tenant, value }) {
    const text = String(value ?? '').trim();
    if (!PLACE.test(text)) return 'Type an organization (like acme-co) or a repository (like acme-co/website).';
    const [owner, repoWanted = null] = text.split('/');
    let token;
    try {
      token = await createTenantScopedCredentials({ base: { token: async () => { throw refused('r40'); } }, directory: dir, tenant, db, env, fetchImpl })
        .token({ cred: 'M', account: owner });
    } catch { return 'Add your master token first (below). Extra places use it.'; }
    // Only through the shared client (pinned API version, user agent). A refusal or missing item reads as "not visible".
    const octokit = bareOctokit({ token, fetch: fetchImpl });
    const get = async (route, params = {}) => { try { return (await octokit.request(route, params)).data; } catch { return null; } };
    const me = await get('GET /user'), who = await get('GET /users/{username}', { username: owner });
    if (!me?.login || !who?.login || !Number.isSafeInteger(who.id)) return `GitHub does not show ${owner} to your master token, so it was not added.`;
    let repo = null;
    if (repoWanted) {
      const r = await get('GET /repos/{owner}/{repo}', { owner: who.login, repo: repoWanted });
      if (!r || r.permissions?.pull !== true || String(r.owner?.login).toLowerCase() !== who.login.toLowerCase()) return `Your master token cannot read ${text}, so it was not added.`;
      repo = r.name;
    } else if (who.type === 'Organization') {
      const m = await get('GET /user/memberships/orgs/{org}', { org: who.login });
      if (m?.state !== 'active') return `You are not an active member of ${who.login}. Add a specific repository (${who.login}/name) instead, or ask an owner to add you.`;
    } else if (who.login.toLowerCase() !== me.login.toLowerCase()) return `Add a specific repository of ${who.login} (${who.login}/name), not the whole account.`;
    const existing = await db.getAccount(who.login);
    if (existing && existing.credential_kind !== 'master') return `${who.login} is already connected with the GitHub App, which is the better way. Nothing was changed.`;
    const row = await db.upsertExtraPlace({ login: who.login, accountId: who.id, accountType: who.type, repo });
    if (!row) return `${who.login} could not be added.`;
    await db.addAccountsToConnections([who.login]);
    return `Added ${repo ? who.login + '/' + repo : who.login} as an extra place. It starts read-only: your apps can look, and every change is refused until you allow changes for it here.`;
  }

  // ---------------------------------------------------------------- delete my data
  /** Start: sign in with GitHub (no accounts are listed, no identity is created). */
  async function startForget() {
    active(); await ensureSchema();
    const client = await builtInClient(FORGET_CLIENT, 'Delete my data');
    return await openStep({ client, flow: { redirectUri: client.redirectUris[0], clientState: null, codeChallenge: random(32), purpose: 'forget' } });
  }
  /** The person came back from GitHub. Only a person already stored can be found; nobody is enrolled by asking to leave. */
  async function forgetLookup(principal) {
    const tenantId = await directory().findPublicTenantBySubject(principal.subject);
    if (!tenantId) return { forget: { none: true } };
    const handle = await openHandle({ clientId: FORGET_CLIENT, redirectUri: active() + '/api/oauth/authorize', purpose: 'forget', tenantId }, 600);
    return { forget: { handle, signedInAs: principal.login } };
  }
  /** Confirm: one use per handle. Returns true when data was deleted. */
  async function forgetConfirm({ handle }) {
    active();
    if (!STATE.test(String(handle ?? ''))) throw refused('r22');
    const flow = await directory().consumePublicFlow(sha(handle), 'god');
    if (!flow || flow.purpose !== 'forget' || !flow.tenantId) throw refused('r23');
    return await directory().forgetPublicTenant(flow.tenantId);
  }

  return Object.freeze({ registerClient, begin, resumeInstall, finish, approve, startManage, manageAction, startForget, forgetConfirm, limits });
}
