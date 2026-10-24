// The only file in the server that imports @octokit/*. Every GitHub call goes through an Octokit built here, so the
// pinned API version, request keys, write spacing, rate discipline and ETag caching cannot be skipped (A7–A9).
import crypto from 'node:crypto';
import { Octokit } from '@octokit/core';
import { paginateRest } from '@octokit/plugin-paginate-rest';
import { retry } from '@octokit/plugin-retry';
import { throttling } from '@octokit/plugin-throttling';
import { GithubClientError, formatDenver } from './errors.js';
import { assertNotBlocked, rateLimited, recordRate, resourceFor, takeWriteSlot } from './rate.js';
import { actAsFor, forgetActAs, mustUseAppForBranch } from './act-as.js';
import { isAppOnly } from './app-only.js';

/** The GitHub REST API version sent on every request. Moving it is its own card (BATCH-A A7). */
export const GITHUB_API_VERSION = '2026-03-10';
/** How long one request may spend waiting on GitHub's `retry-after` / reset times before it gives up (A9). */
export const DEFAULT_BUDGET_MS = 20_000;
export const CREDENTIAL_KINDS = Object.freeze(['I', 'U', 'K', 'P', 'M']);
const USER_AGENT = 'robinson-github-mcp';
const KEY_EXCLUDED_ARGS = Object.freeze(['dryRun', 'confirm', 'fields', 'detail', 'requestKey']);
const BUCKET_MS = 10 * 60 * 1000;

const CompositeOctokit = Octokit.plugin(paginateRest, retry, throttling);
// Our own spacing (database write slots, shared across instances) replaces the plugin's in-process queues.
const noQueue = Object.freeze({ key: () => ({ schedule: (_options, fn, ...args) => fn(...args) }) });

const isMutation = (options) => /^\s*(?:#[^\n]*\n\s*)*mutation\b/.test(String(options.query ?? options.body?.query ?? ''));
const isGraphqlUrl = (url) => new URL(url, 'https://api.github.com').pathname.startsWith('/graphql');
const isWrite = (method, options) => (isGraphqlUrl(options.url) ? isMutation(options) : !['GET', 'HEAD'].includes(method));

/** Canonical JSON: object keys sorted, undefined dropped, so equal arguments always serialize identically. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map((v) => canonical(v === undefined ? null : v)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).filter((k) => value[k] !== undefined).sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * A plain Octokit for the few calls that happen before a connection exists: minting installation tokens with the App's
 * JWT, reading the App, checking a token the owner pasted. Same API version header and user agent; no database hooks, no
 * throttling, no retries (the setup page shows the plain error and the owner tries again).
 * @param {{ token?: string, fetch?: Function }} options `token` may be left out for the two unauthenticated calls (manifest conversion)
 */
export function bareOctokit({ token, fetch } = {}) {
  if (token !== undefined && (typeof token !== 'string' || !token)) throw new TypeError('bareOctokit needs a token or none at all.');
  const octokit = new Octokit({ ...(token ? { auth: token } : {}), userAgent: USER_AGENT, request: fetch ? { fetch } : {} });
  octokit.hook.before('request', (options) => { options.headers['x-github-api-version'] = GITHUB_API_VERSION; });
  return octokit;
}

/**
 * Request key for a write (A8): `rmcp_<tool>_<sha256(account, tool, args)>_<10-minute bucket>`. `dryRun`, `confirm`,
 * `fields` and `detail` never change it, so previewing a write and then confirming it yield the same key. A caller's
 * `requestKey` argument replaces the arguments in the hash, so the same intent retried with different wording is
 * still one write.
 * @param {{ connection: { default_account: string }, now?: () => number }} ctx
 */
export function requestKey(ctx, tool, args = {}) {
  const account = String(args.owner ?? ctx.connection.default_account ?? '').toLowerCase();
  const basis = typeof args.requestKey === 'string' && args.requestKey
    ? canonical({ requestKey: args.requestKey })
    : canonical(Object.fromEntries(Object.entries({ ...args, ...(typeof args.owner === 'string' ? { owner: account } : {}) })
      .filter(([k]) => !KEY_EXCLUDED_ARGS.includes(k))));
  const digest = crypto.createHash('sha256').update(`${account}\n${tool}\n${basis}`).digest('hex');
  const bucket = Math.floor((ctx.now ?? Date.now)() / BUCKET_MS);
  return `rmcp_${tool}_${digest}_${bucket}`;
}

function resolveAccount(connection, owner) {
  const wanted = String(owner ?? connection.default_account ?? '');
  const match = (connection.accounts || []).find((login) => login.toLowerCase() === wanted.toLowerCase());
  if (!match) {
    throw new GithubClientError('outside_scope',
      `"${wanted}" is not one of the GitHub accounts this connection may use (${(connection.accounts || []).join(', ') || 'none'}).`,
      { account: wanted });
  }
  return match;
}

/**
 * Builds the Octokit for one request (A9: never shared between requests, so a token never outlives its request).
 * @param {object} ctx `{ connection, db, credentials, fetch?, now?, sleep?, budgetMs?, retryAfterBaseValue? }` where
 *   `credentials.token({ account, cred, scope })` returns the token string (A-5 supplies it).
 * @param {{ owner?: string, cred?: 'I'|'U'|'K'|'P', scope?: object }} target the account to act as and the credential kind
 */
export async function credentialFor(ctx, { owner, cred = 'I', scope, forceApp = false } = {}) {
  if (!CREDENTIAL_KINDS.includes(cred)) throw new TypeError(`Unknown credential kind "${cred}".`);
  // GOD-5: an "extra place" is an account the person added with their master token (no App installed there). Whatever the tool
  // asked for, the credential IS the master token, so every master-token refusal below applies to it unchanged.
  const wanted = String(owner ?? ctx.connection?.default_account ?? '').toLowerCase();
  const listed = (ctx.connection?.accounts || []).find((login) => login.toLowerCase() === wanted);
  const place = listed && typeof ctx.db?.getAccount === 'function' ? await ctx.db.getAccount(listed) : null;
  const extraPlace = place?.credential_kind === 'master' ? place : null;
  if (extraPlace) cred = 'M';
  if ((cred==='K'||cred==='P'||cred==='M') && ctx.connection?.pass===true &&
      typeof ctx.credentials?.authorizeOptionalRequest==='function')
    throw new GithubClientError('outside_scope',
      'Private optional credentials cannot be delegated to a service pass.');
  // The master token never works for a read-only connection, and never for a pass or a narrowed scope.
  if (cred==='M' && (ctx.connection?.profile==='read_only' || ctx.connection?.pass===true || scope?.repositories?.length || scope?.permissions))
    throw new GithubClientError('outside_scope',
      'The master token is not available to read-only connections or narrowed scopes.');
  const account = resolveAccount(ctx.connection, owner);
  // A pass limited to repositories gets installation tokens limited to them, whatever the tool asked for.
  const passRepos = Array.isArray(ctx.connection?.repos) ? ctx.connection.repos.map((slug) => slug.split('/')[1]) : null;
  const asked = passRepos && scope?.repositories?.length ? scope.repositories.filter((r) => passRepos.includes(String(r).toLowerCase())) : [];
  // Never wider than the pass: a request that names nothing inside the pass gets the pass's whole list, not "all repositories".
  const narrowed = passRepos ? { ...(scope ?? {}), repositories: asked.length ? asked : passRepos } : scope;
  if (cred === 'P' && (passRepos || narrowed?.permissions || narrowed?.repositories?.length))
    throw new GithubClientError('outside_scope', 'Package tokens cannot be narrowed to repository or permission-limited passes.');
  const fetchBot = async () => {
    const token = await ctx.credentials?.token({ account, cred, scope: narrowed, profile: ctx.connection?.profile });
    if (typeof token !== 'string' || !token) {
      throw new GithubClientError('no_credentials', extraPlace ? 'This extra place needs your master token.' : `No GitHub credential is set up for ${account}. Open the setup page to add one.`, { account });
    }
    return token;
  };
  // GOD-6 "Act as me": with a master token and the switch on, the person's own token makes the call and GitHub records the
  // person. The app's token is then read only if a request really needs it (`botToken`). Never for extra places (already M),
  // read-only connections, passes or narrowed scopes: `actAsFor` refuses those.
  let personal = null; let note = null;
  if (!extraPlace && !forceApp) {
    const me = await actAsFor(ctx, { cred, scope });
    if (me.on) {
      try {
        const mine = await ctx.credentials.token({ account, cred: 'M', profile: ctx.connection?.profile });
        if (typeof mine === 'string' && mine) personal = { token: mine, subject: me.subject, login: me.login };
        else note = 'your master token could not be read; using the app';
      } catch { note = 'your master token could not be read; using the app'; }
    } else if (me.reason && !me.quiet) note = me.reason;
  }
  if (personal) {
    let bot = null;
    return { account, token: null, place: null, personal, note, botToken: () => (bot ??= fetchBot()) };
  }
  const token = await fetchBot();
  return { account, token, place: extraPlace, personal: null, note, botToken: async () => token };
}

/**
 * GOD-5: what a request on an extra place may do. Changes need the place's "allow changes" switch (the guard gate says so
 * first, in plain words; this is the backstop for any path that does not go through the gate). A place limited to named
 * repositories may only reach those repositories through the REST API: GraphQL and owner-level addresses are refused
 * because the repository cannot be read out of them.
 */
export function assertPlaceRequest(place, account, method, url, write) {
  if (write && place.allow_changes !== true)
    throw new GithubClientError('outside_scope', `Changes are off for ${account}. Turn on 'allow changes' for it on My connection.`, { account });
  const list = place.allowed_repos;
  if (!Array.isArray(list) || !list.length) return;
  const parts = new URL(url, 'https://api.github.com').pathname.split('/');
  const safe = (v) => { try { return decodeURIComponent(v ?? '').toLowerCase(); } catch { return ''; } };
  const inside = parts[1] === 'repos' && safe(parts[2]) === account.toLowerCase() && list.some((r) => r.toLowerCase() === safe(parts[3]));
  if (!inside) throw new GithubClientError('outside_scope', 'That repository is not one of the places you added.', { account });
}

/** Replaces every BigInt in a parsed GitHub response by its exact decimal string; everything else is untouched. */
export function exactIntegers(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(exactIntegers);
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = exactIntegers(v);
    return out;
  }
  return value;
}

export async function githubFor(ctx, { owner, cred = 'I', scope } = {}) {
  const { account, token, place, personal, botToken, note: startNote } = await credentialFor(ctx, { owner, cred: cred, scope });
  if (place) cred = 'M';
  const now = ctx.now ?? Date.now;
  const deadline = now() + (ctx.budgetMs ?? DEFAULT_BUDGET_MS);
  const withinBudget = (retryAfterSeconds, retryCount) => retryCount < 1 && now() + retryAfterSeconds * 1000 <= deadline;
  const baseValue = ctx.retryAfterBaseValue ?? 1000;

  const octokit = new CompositeOctokit({
    // With "act as me" there is no single token: every request names its own (below), so a request that only the app may
    // make still gets the app's.
    ...(personal ? {} : { auth: token }),
    userAgent: USER_AGENT,
    request: ctx.fetch ? { fetch: ctx.fetch } : {},
    throttle: {
      id: account,
      retryAfterBaseValue: baseValue,
      global: noQueue, auth: noQueue, search: noQueue, write: noQueue, notifications: noQueue,
      onRateLimit: (retryAfter, _options, _octokit, retryCount) => withinBudget(retryAfter, retryCount),
      onSecondaryRateLimit: (retryAfter, _options, _octokit, retryCount) => withinBudget(retryAfter, retryCount)
    },
    retry: { retries: 2, retryAfterBaseValue: baseValue }
  });

  octokit.hook.wrap('request', async (request, options) => {
    // `options.url` is still a template here ("/repos/{owner}/{repo}"); the expanded, encoded URL is what GitHub sees.
    const { method: rawMethod, url } = octokit.request.endpoint.parse(options);
    const method = String(rawMethod || 'GET').toUpperCase();
    const write = isWrite(method, { ...options, url });
    if (place) assertPlaceRequest(place, account, method, url, write);
    const forced = options.request?.robinsonAs; // 'app' | 'me': set only by this module and the deliberate rule override
    const query = options.query ?? options.body?.query;
    const parsedUrl = new URL(url, 'https://api.github.com');
    const resource = resourceFor(method, url);
    // Reads made to decide which credential to use (branch rules, the pull request's base branch).
    const readWith = (as) => (route, params) => octokit.request(route, { ...params, request: { robinsonAs: as } });

    // ---- Which credential makes THIS request? (GOD-6) ----
    let asMe = false; let note = startNote;
    if (personal) {
      if (forced === 'me') asMe = true;
      else if (forced !== 'app' && !isAppOnly(method, url, query)) {
        const need = write ? await mustUseAppForBranch({ method, pathname: parsedUrl.pathname, options, query, owner: account, repo: parsedUrl.pathname.split('/')[3], read: readWith('app') }) : null;
        if (need) note = need.note; else asMe = true;
      }
      if (asMe && forced !== 'me') {
        const state = await ctx.db.getRateState(`~me:${personal.subject}`, resource).catch(() => null);
        if (state?.blocked_until) { asMe = false; note = `your own GitHub allowance is used up until ${formatDenver(new Date(state.blocked_until))}`; }
      }
    } else if (forced === 'me' && !place && cred !== 'M') {
      throw new GithubClientError('no_credentials', 'Only your own GitHub login can skip branch rules; add your master token and turn Act as me on.', { account });
    } else if (place && write && forced !== 'me' && forced !== 'app') {
      // An extra place has no app. A change to a branch that has rules is not made by an admin's token on its own: the person
      // must ask to override on purpose. (Tags, releases and similar keep working exactly as in GOD-5.)
      const need = await mustUseAppForBranch({ method, pathname: parsedUrl.pathname, options, query, owner: account, repo: parsedUrl.pathname.split('/')[3], read: readWith('me') });
      if (need && !need.always) throw new GithubClientError('outside_scope', `Branch rules apply to ${need.branch ?? 'this branch'}, and only the app may write there, but the app is not installed on ${account}. Ask to override the rules on purpose if you are allowed to.`, { account });
    }

    const attempt = async (useMe, why) => {
      const actual = useMe ? 'M' : cred;
      const rateKey = personal && useMe ? `~me:${personal.subject}` : account;
      // Classic package credentials never authorize arbitrary REST, GraphQL or foreign accounts.
      // Validate the expanded URL BEFORE any request or rate/write side effect.
      if ((actual === 'K' || actual === 'P' || actual === 'M') && typeof ctx.credentials?.authorizeOptionalRequest === 'function')
        await ctx.credentials.authorizeOptionalRequest({ account, kind: actual, method, url });
      else if (actual === 'P') await assertPackageRequest(ctx, account, method, url);
      // The wrapped `request` is already bound to `options`, so the object itself must be changed (a copy would be ignored).
      const sent = options;
      sent.headers = { ...sent.headers, 'x-github-api-version': GITHUB_API_VERSION };
      delete sent.headers['if-none-match']; // an earlier attempt's cache validator belongs to that credential only
      if (personal) sent.headers.authorization = `token ${useMe ? personal.token : await botToken()}`;
      await assertNotBlocked(ctx.db, rateKey, resource);
      if (write) {
        sent.request = { ...sent.request, retries: 0 }; // a write is never replayed after an error (A8)
        await takeWriteSlot(ctx.db, `${account}:${actual}`, { sleep: ctx.sleep });
      }
      const urlKey = !write && sent.request?.etag ? parsedUrl.pathname + parsedUrl.search : null;
      let cached = null;
      if (urlKey) {
        cached = await ctx.db.getEtag(rateKey, urlKey);
        if (cached) sent.headers = { ...sent.headers, 'if-none-match': cached.etag };
      }
      const noteActor = () => ctx.actor?.record?.({ as: useMe ? 'you' : 'app', note: why ?? null, viaUser: !useMe && cred === 'U' });
      let response;
      try {
        response = await request(sent);
      } catch (error) {
        if (error?.status === 304 && cached) { noteActor(); return { status: 200, url, headers: error.response?.headers ?? {}, data: cached.body, notModified: true }; }
        if (write) noteActor(); // a change may have been sent: it is on the record as made by this credential
        throw await asRateLimited(ctx, rateKey, resource, error);
      }
      // Octokit returns integers beyond 2^53 as BigInt (webhook delivery IDs are now that large). A BigInt cannot be saved to the
      // change journal or sent as JSON, so every one becomes its exact decimal text here, before anything else sees it.
      response.data = exactIntegers(response.data);
      noteActor();
      try {
        await recordRate(ctx.db, rateKey, response.headers, { status: response.status, fallbackResource: resource, now });
        const etag = response.headers?.etag;
        if (urlKey && etag) await ctx.db.putEtag(rateKey, urlKey, etag, response.data);
      } catch { /* bookkeeping must never turn a completed GitHub call into a failure */ }
      return response;
    };

    try {
      return await attempt(asMe, note);
    } catch (error) {
      if (!(asMe && personal && forced !== 'me' && Number.isInteger(error?.status))) throw error;
      const status = error.status;
      if (status === 401) {
        // GitHub no longer accepts the token. Remember it (so the next call goes straight to the app, with no loop), and never
        // repeat a change: a read is answered once by the app; a write says nothing was changed.
        try { await ctx.db.setSetting(`master_rejected_at.${personal.subject}`, new Date(now()).toISOString()); forgetActAs(ctx); } catch { /* the next 401 saves it again */ }
        if (!write) return await attempt(false, 'GitHub rejected your master token; this answer came from the app');
        throw new GithubClientError('no_credentials', 'GitHub rejected your master token, so nothing was changed. Calls now use the app. Run it again, or add a new master token on My connection.', { account });
      }
      if (!write && (status === 403 || status === 404)) return await attempt(false, 'your master token could not read this; the app did');
      if (write && status === 403 && error.response?.headers?.['x-github-sso'])
        throw Object.assign(new Error('Authorize your master token for SSO on GitHub, or turn Act as me off.'), { status: 403, safeMessage: true });
      throw error;
    }
  });
  return octokit;
}

async function assertPackageRequest(ctx, account, method, url) {
  const parsed = new URL(url, 'https://api.github.com');
  const parts = parsed.pathname.split('/');
  const owner = (() => { try { return decodeURIComponent(parts[2] ?? ''); } catch { return ''; } })();
  const row = await ctx.db.getAccount(account);
  const authenticated = parts[1] === 'user' && parts[2] === 'packages';
  const accountBound = authenticated
    ? row?.account_type === 'User' && row.package_actor?.toLowerCase() === account.toLowerCase()
    : ['orgs', 'users'].includes(parts[1]) && owner.toLowerCase() === account.toLowerCase() && parts[3] === 'packages';
  const suffix = '/' + parts.slice(authenticated ? 3 : 4).join('/');
  const record = /^\/(?:npm|maven|rubygems|docker|nuget|container)\/[^/]+(?:\/versions\/[1-9][0-9]*)?$/;
  const readable = ['GET', 'HEAD'].includes(method) && (suffix === '/' || record.test(suffix) ||
    /^\/(?:npm|maven|rubygems|docker|nuget|container)\/[^/]+\/versions$/.test(suffix));
  const restore = method === 'POST' && suffix.endsWith('/restore') && record.test(suffix.slice(0, -8));
  const deletion = method === 'DELETE' && record.test(suffix);
  if (parsed.origin !== 'https://api.github.com' || parsed.username || parsed.password ||
      !accountBound || !(readable || restore || deletion))
    throw new GithubClientError('outside_scope', 'This credential is restricted to package operations on its connected account and verified personal actor.');
  if (!readable && ctx.connection?.profile === 'read_only')
    throw new GithubClientError('outside_scope', 'A read-only connection cannot mutate packages.');
  const scopes = row?.package_scopes ?? [];
  const required = ['read:packages', ...(restore ? ['write:packages'] : deletion ? ['delete:packages'] : [])];
  if (!row?.package_enc || required.some(s => !scopes.includes(s)))
    throw new GithubClientError('no_credentials', `The package token needs ${required.join(' and ')}; verify it on the private setup page.`);
}

/** Records what a failed response says about rate limits and, when it is one, replaces it with `rate_limited`. */
async function asRateLimited(ctx, account, resource, error) {
  const headers = error?.response?.headers;
  const status = error?.status;
  const now = ctx.now ?? Date.now;
  const graphqlLimit = error?.message === 'GraphQL Rate Limit Exceeded';
  let recorded = null;
  try { recorded = headers ? await recordRate(ctx.db, account, headers, { status, fallbackResource: resource, now }) : null; } catch { /* see above */ }
  const limited = graphqlLimit || ((status === 403 || status === 429)
    && (recorded?.blockedUntil || /rate limit/i.test(String(error?.message ?? '')) || recorded?.remaining === 0));
  if (!limited) return error;
  let until = recorded?.blockedUntil;
  if (!until) {
    until = new Date(now() + 60_000);
    try { await ctx.db.recordRateState({ account, resource, remaining: recorded?.remaining ?? null, resetAt: recorded?.resetAt ?? null, blockedUntil: until }); } catch { /* see above */ }
  }
  return rateLimited(account, recorded?.resource ?? resource, until);
}

/**
 * Enumerate real GitHub pages up to an item AND request budget. An upstream
 * proxy can return an empty or duplicate page with rel="next" forever; never
 * let that keep destructive-cleanup preflights alive indefinitely.
 * `capped` means completeness is not established (more rows or pages may exist).
 */
export async function listAll(octokit, route, params = {}, { max = 1000 } = {}) {
  if(!Number.isSafeInteger(max)||max<1||max>10_000)
    throw new TypeError('Pagination cap must be an integer from 1 through 10000.');
  const requested=Number(params.per_page??100);
  const pageSize=Number.isInteger(requested)&&requested>0&&requested<=100?requested:100;
  const maxPages=Math.ceil(max/pageSize)+1;
  const items=[];
  let capped=false,pages=0;
  for await (const page of octokit.paginate.iterator(route, { per_page: 100, ...params })) {
    if(!Array.isArray(page?.data))
      throw new TypeError('GitHub list response must contain an array.');
    pages++;
    items.push(...page.data);
    const more=/rel="next"/.test(String(page.headers?.link??''));
    if(items.length>=max||pages>=maxPages) {
      capped=items.length>max||more;
      break;
    }
  }
  return {items:items.slice(0,max),capped};
}

/** Runs a GraphQL document. Tests validate every document against the vendored schema (fake GitHub). */
export async function graphql(octokit, query, variables = {}) {
  return await octokit.graphql(query, variables);
}
