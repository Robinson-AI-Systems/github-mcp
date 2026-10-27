// Tools that describe this server and the connection using them (A-5c). Read-only: they read the database and call no GitHub
// endpoint. They show which credential types exist, never a credential, not even its last characters.
import { randomBytes } from 'node:crypto';
import {RetainedResultNotFound} from '../core/result-errors.js';
import { GITHUB_API_VERSION } from '../github/client.js';
import { GithubClientError, formatDenver } from '../github/errors.js';
import { defineGithubWrite } from './define-github-write.js';
import { publicOrigin } from '../core/http.js';
import { protectedList } from './protect-guard.js';
import { dollars as money } from '../github/prices.js';
import { spendStatus } from './spend-guard.js';
import { oneTimeStore } from '../dev/forwarders.js';
import { validateGrant } from '../rtc/pass-scope.js';
import { RULES, capText, fitToBudget, listKeyOf, pageOfBody, projectFields } from '../core/result-rules.js';
import { MASTER_AREAS, masterUnlocks } from '../github/master-areas.js';
import { actAsFor, loginFor } from '../github/act-as.js';

const DETAIL = { type: 'string', enum: ['brief', 'full'], description: 'brief (default) or full' };
const FIELDS = { type: 'array', items: { type: 'string', maxLength: 64 }, maxItems: 20, description: 'Only these fields of each account' };
const dollars = (cents) => `$${((Number(cents) || 0) / 100).toFixed(2)}`;
const when = (value) => (value ? formatDenver(value) : null);

function installationLabel(row) {
  if (row.credential_kind === 'master') return 'extra place (your master token)';
  if (row.credential_kind === 'fine_grained') return row.has_fine_grained ? 'token saved' : 'no token';
  if (row.app_id == null) return 'no GitHub App yet';
  return row.installation_status === 'active' ? 'installed' : row.installation_status === 'suspended' ? 'suspended' : 'not installed';
}
const placeOf = (row) => (row.credential_kind === 'master' ? { allow_changes: row.allow_changes === true, allowed_repos: row.allowed_repos ?? 'whole account' } : {});
const credentialsOf = (row) => ({
  I: row.credential_kind === 'master' ? false : row.credential_kind === 'fine_grained' ? row.has_fine_grained : row.installation_status === 'active',
  U: !!row.has_user_token,
  K: !!row.has_classic,
  P: !!row.has_package
});

/** Accounts this connection may use, default first. An account removed since the connection was made simply disappears. */
async function visibleAccounts(ctx) {
  const allowed = new Set(ctx.connection.accounts.map((login) => login.toLowerCase()));
  return (await ctx.db.listAccounts()).filter((a) => allowed.has(a.login.toLowerCase()));
}

function pick(entries, fields, key = 'login') {
  if (!fields?.length) return entries;
  const known = new Set(entries.flatMap((e) => Object.keys(e)));
  const unknown = fields.filter((f) => f !== key && !known.has(f));
  if (unknown.length && entries.length) throw new TypeError(`Unknown field: ${unknown.slice(0, 3).join(', ')}. Available: ${[...known].join(', ')}`);
  return entries.map((e) => Object.fromEntries([key, ...fields.filter((f) => f !== key)].filter((f) => f in e).map((f) => [f, e[f]])));
}

// GOD-3 (small part): tell the person when their master token is about to run out, so they can replace it in time.
const REMIND_DAYS = 14;
function masterExpiry(iso, now = Date.now()) {
  if (!iso) return { expires_at: 'never (until you remove it)' };
  const days = Math.ceil((new Date(iso).getTime() - now) / 86400000);
  return { expires_at: when(iso), expires_in_days: days,
    ...(days <= REMIND_DAYS ? { reminder: `Your master token runs out in ${days} day${days === 1 ? '' : 's'}. To keep it working, create a new one: ask for github_master_token_link and follow the steps (the new one replaces this one).` } : {}) };
}
async function whoami(args, ctx) {
  // One independent master-status read per tool call; never cache credentials
  // between requests. Account inventory and master state are independent.
  const [rows, master] = await Promise.all([
    visibleAccounts(ctx),
    typeof ctx.credentials?.masterStatus === 'function'
      ? ctx.credentials.masterStatus().catch(() => ({ enrolled: false }))
      : null
  ]);
  const accounts = [];
  const accountEntry = async (row) => {
    const rate = await ctx.db.getRateState(row.login, 'core');
    const entry = {
      login: row.login, label: row.label, type: row.account_type, is_default: row.login.toLowerCase() === ctx.connection.default_account.toLowerCase(),
      credentials: credentialsOf(row), production_enabled: !!row.production_enabled, ...placeOf(row),
      spend_limit: row.spend_limit_explicit || row.spend_limit_cents > 0 ? dollars(row.spend_limit_cents) : 'not configured',
      spend_limit_cents: row.spend_limit_explicit || row.spend_limit_cents > 0 ? row.spend_limit_cents : null,
      spend_limit_explicit: row.spend_limit_explicit === true || row.spend_limit_cents > 0,
      rate_core: rate ? { remaining: rate.remaining, resets_at: when(rate.reset_at), blocked_until: when(rate.blocked_until) } : { remaining: null, note: 'No call made yet' }
    };
    if (args.detail === 'full') Object.assign(entry, { setup: installationLabel(row), repository_selection: row.repository_selection ?? null, user_login: row.user_login ?? null, plan: row.plan_name ?? null });
    return entry;
  };
  // Account rate queries and the personal Act-as-me preference are unrelated
  // reads. Preserve deterministic account ordering; never fan out unboundedly.
  const mePromise = actAsFor(ctx, { cred: 'I', masterStatus: master });
  for (let i = 0; i < rows.length; i += 10) {
    accounts.push(...await Promise.all(rows.slice(i, i + 10).map(accountEntry)));
  }
  const me = await mePromise;
  // factsFor already obtained the personal-rate state when deciding whether
  // the personal token may act. Do not issue the identical SQL read twice.
  const facts = ctx.actAsCache?.facts;
  const mine = me.on
    ? facts?.subject === me.subject ? facts.rate : await ctx.db.getRateState(`~me:${me.subject}`, 'core').catch(() => null)
    : null;
  const acting_as = me.on
    ? { mode: 'you', login: me.login ?? (await loginFor(ctx, me.subject)), personal_rate: mine ? { remaining: mine.remaining, resets_at: when(mine.reset_at) } : { remaining: null, note: 'No call made yet' } }
    : { mode: 'app', login: null, ...(me.reason ? { reason: me.reason } : {}) };
  return {
    mode: ctx.connection.mode.toUpperCase(), profile: ctx.connection.profile, listing: ctx.connection.listing, acting_as,
    default_account: ctx.connection.default_account, api_version: GITHUB_API_VERSION,
    credential_types: { I: 'installation token (or fine-grained token)', U: 'your sign-in for personal settings', K: 'notifications-only classic token', P: 'package-only classic token', ...(master ? { M: 'your master token (everything your GitHub login can do, used only when the App cannot)' } : {}) },
    ...(master ? { master_token: master.enrolled ? { added: true, permissions: master.scopes, ...masterExpiry(master.expires_at), unlocks: masterUnlocks(master.scopes ?? []) } : { added: false, how_to_add: 'Ask the assistant to run github_master_token_link; it gives you a private link.', would_unlock: MASTER_AREAS.map((a) => a.area) } } : {}),
    // Public sign-ins have a page where the person adds accounts, the master token, read-only, time zone, or disconnects.
    ...(String(ctx.connection.client_id ?? '').startsWith('pcl_') ? (() => { try { return { my_connection_page: publicOrigin() + '/connection' }; } catch { return {}; } })() : {}),
    accounts: pick(accounts, args.fields)
  };
}

async function listAccounts(args, ctx) {
  const rows = await visibleAccounts(ctx);
  const accounts = rows.map((row) => {
    const entry = {
      login: row.login, label: row.label, account_type: row.account_type, credential_kind: row.credential_kind === 'app' ? 'GitHub App' : row.credential_kind === 'master' ? 'master token (extra place)' : 'fine-grained token', ...placeOf(row),
      setup: installationLabel(row), repository_selection: row.repository_selection ?? null,
      user_authorization: row.has_user_token ? `signed in as ${row.user_login ?? 'you'}` : 'not signed in',
      notifications_token: row.has_classic ? 'saved' : 'none', production_enabled: !!row.production_enabled, is_default: !!row.is_default
    };
    if (args.detail === 'full') Object.assign(entry, { installation_permissions: row.installation_permissions ?? {}, notifications_scopes: row.classic_scopes ?? [], plan: row.plan_name ?? null, last_checked: when(row.checked_at) });
    return entry;
  });
  return { count: accounts.length, accounts: pick(accounts, args.fields) };
}

async function listProtectedResources(args, ctx) {
  const entries = await protectedList(ctx.db);
  const rows = entries.map((e) => ({ kind: e.kind, target: e.target === '*' ? 'all of this server\'s own GitHub App installations' : e.target, level: e.level, reason: e.reason }));
  return {
    count: rows.length,
    levels: { 'pr-only': 'only pull requests (branches, commits, reviews, checks, issues) and merges on green at an exact head are allowed', locked: 'no change of any kind' },
    editable: 'only on the setup page, with your passphrase',
    protected: pick(rows, args.fields)
  };
}

const lower = (list) => list.map((l) => String(l).toLowerCase());
const sameLogin = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

/** Connector logins that use only accounts the current connection also has (the ones it is allowed to see and switch off). */
function connectionView(row, ctx) {
  const mine = new Set(lower(ctx.connection.accounts));
  const inside = row.accounts.filter((a) => mine.has(a.toLowerCase()));
  return { row, overlap: inside.length > 0, canRevoke: inside.length === row.accounts.length };
}

async function listConnections(args, ctx) {
  const rows = (await ctx.db.listConnections()).map((r) => connectionView(r, ctx)).filter((v) => v.overlap);
  const byClient = new Map();
  for (const { row, canRevoke } of rows) {
    const mine = byClient.get(row.client_id);
    // several live tokens of one login (access tokens are renewed): show the newest, and the latest use of any
    if (mine) { mine.last_used_at = [mine.last_used_at, row.last_used_at].filter(Boolean).sort().at(-1) ?? null; continue; }
    byClient.set(row.client_id, { ...row, canRevoke });
  }
  const entries = [...byClient.values()].map((r) => ({
    connection_id: r.client_id, name: r.client_name ?? r.client_id, is_this_connection: r.client_id === ctx.connection.client_id, mode: r.mode.toUpperCase(), profile: r.profile,
    default_account: r.default_account, accounts: r.accounts, access_expires: when(r.expires_at), last_used: when(r.last_used_at) ?? 'never', can_revoke_here: r.canRevoke,
    kind: r.kind === 'pass' ? 'service pass' : 'login',
    ...(r.kind === 'pass' && r.pass ? { pass_scope: { areas: r.pass.areas, repositories: r.pass.repos ?? 'all', writes_allowed: r.pass.allow_writes, access_changes_allowed: r.pass.allow_access_changes === true, production_allowed: r.pass.production_access, spend_allowance: dollars(r.pass.spend_allowance_cents), requests_per_minute: r.pass.rate_limit_per_minute } } : {}),
    ...(args.detail === 'full' ? { listing: r.listing, connected_since: when(r.created_at) } : {})
  }));
  return { count: entries.length, note: 'Logins and service passes both appear here. A login renews itself while it is used; switching either off ends it at once.', connections: pick(entries, args.fields, 'connection_id') };
}

async function recentChanges(args, ctx) {
  const mine = lower(ctx.connection.accounts);
  if (args.account && !mine.includes(String(args.account).toLowerCase())) throw new TypeError(`"${args.account}" is not one of the GitHub accounts this connection may use (${ctx.connection.accounts.join(', ')}).`);
  if (args.since !== undefined && Number.isNaN(Date.parse(args.since))) throw new TypeError('since must be a date such as 2026-10-01 or 2026-10-01T12:00:00Z.');
  const rows = await ctx.db.listChanges({ repo: args.repo ?? null, tool: args.tool ?? null, account: args.account ?? null, accounts: ctx.connection.accounts, since: args.since ?? null,
    includePreviews: args.includePreviews === true, limit: args.limit ?? 20 });
  const changes = rows.map((r) => ({
    id: r.id, at: r.at, tool: r.tool, account: r.account, repo: r.repo, summary: r.summary, mode: String(r.mode ?? '').toUpperCase() || null,
    confirmed: r.confirmed, production: !!r.production, accessWidening: !!r.accessWidening, notifies: r.notifies ?? [],
    ...(r.actedAs ? { acted_as: r.actedAs } : {}),
    cost: r.spendCents ? dollars(r.spendCents) : null,
    ...(r.dryRun ? { preview: true } : {}),
    ...(args.detail === 'full' ? { request_key: r.requestKey ?? null, github_request_id: r.githubRequestId ?? null, can_undo: !!r.inverse } : {})
  }));
  return { count: changes.length, note: args.includePreviews === true ? 'Previews and refusals are included.' : 'Previews and refusals are left out (set includePreviews to see them).', changes: pick(changes, args.fields, 'id') };
}

/** Pages through a big result kept behind a handle (C-1). Only the connection that made it can read it. */
async function getResult(args, ctx) {
  const owner = ctx.connection.client_id ?? ctx.connection.pass_id;
  const row = owner ? await ctx.db.getResult(args.handle, String(owner)) : null;
  if (!row) throw new RetainedResultNotFound();
  // Byte windows are explicit, complete file retrieval. The retained content
  // has already passed shaping and belongs only to this authenticated connection.
  if (args.byteOffset !== undefined || args.byteLength !== undefined) {
    if (args.page !== undefined || args.pageSize !== undefined || args.offset !== undefined || args.fields?.length)
      throw new TypeError('A byte window cannot be combined with pages, character offset or fields.');
    if (row.body?.type !== 'file' || typeof row.body.content !== 'string')
      throw new TypeError('Byte windows are available for retained file content only.');
    const original = Buffer.from(row.body.content, 'utf8');
    const offset = args.byteOffset ?? 0;
    if (offset > original.length) throw new TypeError('byteOffset exceeds the retained file size.');
    const bytes = original.subarray(offset, offset + (args.byteLength ?? 32768));
    return { handle: args.handle, path: row.body.path, sha: row.body.sha,
      type: 'file', encoding: 'base64', content_base64: bytes.toString('base64'),
      byte_offset: offset, byte_length: bytes.length, total_bytes: original.length,
      next_byte_offset: offset + bytes.length, complete: offset + bytes.length === original.length,
      expires: when(row.expires_at) };
  }
  // A page that would not fit gets a smaller page size (halved until it does); page_info says which size was used, so paging stays consistent.
  const keep = { alsoKeep: ['untrusted', 'page_info'], twins: ['_local', '_display'] };
  const listName = listKeyOf(row.body) === '' ? 'items' : listKeyOf(row.body);
  const build = (size) => {
    const page = pageOfBody(row.body, { page: args.page, pageSize: size });
    let value = page.value;
    let unknown = [];
    if (args.fields?.length) {
      const inList = listName && Array.isArray(value[listName]);
      const target = projectFields(inList ? value[listName] : value, args.fields, keep);
      unknown = target.unknown;
      value = inList ? { page_info: value.page_info, [listName]: target.value } : target.value;
    }
    const capped = capText(value, { offset: args.offset ?? 0 });
    return { capped, unknown, fit: fitToBudget(capped.value) };
  };
  const wanted = args.pageSize ?? RULES.pageSize;
  let size = wanted;
  let { capped, unknown, fit } = build(size);
  while (size > 1 && fit.fitted) { size = Math.ceil(size / 2); ({ capped, unknown, fit } = build(size)); }
  const reduced = size !== wanted;
  return {
    handle: args.handle, what: row.summary, ...(typeof fit.value === 'object' && !Array.isArray(fit.value) ? fit.value : { value: fit.value }),
    ...(unknown.length ? { unknown_fields: unknown.slice(0, 10) } : {}),
    ...(capped.cut.length ? { text_cut: capped.cut.slice(0, 10), more_text: 'Ask for that one field with fields and add the number of characters shown to offset.' } : {}),
    ...(reduced ? { note: `Pages were made smaller to fit (${size} per page). Keep using pageSize ${size} to continue.` } : {}),
    ...(fit.fitted ? { note: 'This page was still large and was shortened. Use a smaller pageSize or fewer fields.', shown: fit.shown, of: fit.of } : {}),
    expires: when(row.expires_at)
  };
}

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const readTools = [
  {
    name: 'github_whoami',
    area: 'server', audience: ['B', 'O', 'Op'], compact: true,
    description: 'Accounts this connection can use, mode (PREVIEW/PRODUCTION), profile, credential types per account (I, U, K, P), API version, rate budget, spend limit.',
    inputSchema: { type: 'object', properties: { detail: DETAIL, fields: FIELDS }, additionalProperties: false },
    annotations: readOnly
  },
  {
    name: 'github_master_token_link',
    area: 'server', audience: ['B', 'O', 'Op'],
    description: 'Get a private one-use link (10 minutes) to add or remove your optional master token, no reconnecting. Opens a plain-steps page; never paste the token in chat.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: readOnly, // only makes a short-lived private link; changes nothing on GitHub
    keepsResult: false
  },
  {
    name: 'github_credential_revoke',
    area: 'server', audience: ['B', 'O', 'Op'],
    description: 'Get a private one-use link (10 minutes) to cancel leaked GitHub tokens. You paste them on that page, never here; this tool takes no token.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: readOnly, // only makes a short-lived private link; GitHub is contacted from that page, by the person
    keepsResult: false
  },
  {
    name: 'github_list_accounts',
    area: 'server', audience: ['O'],
    description: 'Connected GitHub accounts this connection may use: App installation, repository selection, your sign-in, notifications token, production on/off.',
    inputSchema: { type: 'object', properties: { detail: DETAIL, fields: FIELDS }, additionalProperties: false },
    annotations: readOnly
  },
  {
    name: 'github_list_protected_resources',
    area: 'server', audience: ['O', 'B'],
    description: 'Repositories and installations this server refuses to change (its own repo, other Robinson servers) and the level: pr-only or locked.',
    inputSchema: { type: 'object', properties: { fields: FIELDS }, additionalProperties: false },
    annotations: readOnly
  },
  {
    name: 'github_list_connections',
    area: 'server', audience: ['O'],
    description: 'Connector logins that use your accounts: name, mode, profile, default account, when access expires, last used.',
    inputSchema: { type: 'object', properties: { detail: DETAIL, fields: FIELDS }, additionalProperties: false },
    annotations: readOnly
  },
  {
    name: 'github_recent_changes',
    area: 'server', audience: ['O', 'Op'],
    description: 'What was changed through this server, newest first. Filter by repo, tool, account or date; previews and refusals are hidden unless asked for.',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', maxLength: 140, description: 'owner/name' }, tool: { type: 'string', maxLength: 80 }, account: { type: 'string', maxLength: 39 },
        since: { type: 'string', maxLength: 40, description: 'Date or date-time, for example 2026-10-01' }, includePreviews: { type: 'boolean' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Default 20' }, detail: DETAIL, fields: FIELDS
      },
      additionalProperties: false
    },
    annotations: readOnly
  },
  {
    name: 'github_get_result',
    area: 'server', audience: ['B', 'O', 'Op'], compact: true, byteWindow: true,
    description: 'Read the rest of a big result kept behind a handle (res_…): a page at a time, only some fields, or more of a long text. Kept 24 hours.',
    inputSchema: {
      type: 'object',
      properties: {
        handle: { type: 'string', pattern: '^res_[A-Za-z0-9_-]{20,64}$', maxLength: 70 }, page: { type: 'integer', minimum: 1, maximum: 100000 },
        pageSize: { type: 'integer', minimum: 1, maximum: RULES.maxPageSize, description: `Default ${RULES.pageSize}` }, fields: FIELDS,
        offset: { type: 'integer', minimum: 0, maximum: 100000000, description: 'Start long text this many characters in' },
        byteOffset: { type: 'integer', minimum: 0, description: 'Exact byte offset of retained file content (zero-based)' },
        byteLength: { type: 'integer', minimum: 1, maximum: 32768, description: 'Exact bytes to read, up to 32768 (default 32768)' }
      },
      required: ['handle'],
      additionalProperties: false
    },
    annotations: readOnly,
    keepsResult: false
  }
];
async function masterTokenLink(args, ctx) {
  if (typeof ctx.credentials?.masterLink !== 'function' || ctx.connection?.pass === true)
    return { available: false, why: 'The master token can be added on a signed-in personal connection only.' };
  const clientId = ctx.connection?.client_id ?? ctx.clientId;
  const client = typeof ctx.db?.getOAuthClient === 'function' ? await ctx.db.getOAuthClient(clientId) : null;
  const redirectUri = client?.redirect_uris?.[0];
  if (!redirectUri) return { available: false, why: 'This connection cannot open the master token page.' };
  const made = await ctx.credentials.masterLink({ clientId, redirectUri });
  return {
    available: true, open_this_link: made.url, expires_in_minutes: made.expiresInMinutes, one_use: true,
    tell_the_person: 'Open the link in your browser. It shows four short steps: create the token on GitHub (every permission is pre-ticked), copy it, paste it on that page, tap Continue. Never paste the token into this chat.',
    note: ctx.connection?.profile === 'read_only' ? 'This connection is read-only, so the master token will not be used here until you reconnect with changes allowed.' : undefined
  };
}
async function credentialRevoke(args, ctx) {
  if (typeof ctx.credentials?.revokeLink !== 'function' || ctx.connection?.pass === true)
    return { available: false, why: 'Cancelling leaked tokens needs a signed-in personal connection.' };
  const clientId = ctx.connection?.client_id ?? ctx.clientId;
  const client = typeof ctx.db?.getOAuthClient === 'function' ? await ctx.db.getOAuthClient(clientId) : null;
  const redirectUri = client?.redirect_uris?.[0];
  if (!redirectUri) return { available: false, why: 'This connection cannot open the page for cancelling tokens.' };
  const made = await ctx.credentials.revokeLink({ clientId, redirectUri });
  return {
    available: true, open_this_link: made.url, expires_in_minutes: made.expiresInMinutes, one_use: true,
    tell_the_person: 'Open the link in your browser and paste the leaked token(s) on that page, one per line, then tap Cancel. GitHub then cancels them for good. Never paste a token into this chat.'
  };
}
const readHandlers = { github_credential_revoke: credentialRevoke, github_master_token_link: masterTokenLink, github_whoami: whoami, github_list_accounts: listAccounts, github_list_protected_resources: listProtectedResources, github_list_connections: listConnections, github_recent_changes: recentChanges, github_get_result: getResult };

// ---- Production switch (B-2): ask here, confirm on the setup page; turning it off needs no passphrase. ----
const PENDING_MINUTES = 10;
const accountTarget = (args) => ({ owner: args.account, scope: 'server' });
const readAccount = (args, ctx) => ctx.db.getAccount(args.account);
const noAccount = (account) => new GithubClientError('outside_scope', `There is no connected account called "${account}".`, { account });
const setupUrl = (ctx) => { try { return `${publicOrigin(ctx.env)}/api/github/setup`; } catch { return '/api/github/setup'; } };

const enableProduction = defineGithubWrite({
  name: 'github_enable_production',
  area: 'server', audience: ['O'],
  description: 'Step 1 of turning production on for an account: you then confirm with your passphrase on the setup page.',
  properties: { account: { type: 'string', maxLength: 39 } },
  required: ['account'],
  declarations: { production: 'never', accessWidening: true, confirm: 'always', cred: '—', profiles: ['full'] },
  target: accountTarget,
  read: readAccount,
  classify: ({ args, before }) => (before ? { accessWidening: `production connections could then change ${args.account}\'s real repositories` } : {}),
  summarize: ({ args, before }) => (before
    ? `Start turning production ON for ${args.account} (today: ${before.production_enabled ? 'already on' : 'off'}). Nothing changes until you confirm on the setup page within ${PENDING_MINUTES} minutes`
    : `There is no connected account called "${args.account}"`),
  apply: async ({ args, ctx, before }) => {
    if (!before) throw noAccount(args.account);
    await ctx.db.createSetupState({ state: randomBytes(32).toString('base64url'), purpose: 'enable_production', accountHint: before.login, ttlSeconds: PENDING_MINUTES * 60 });
  },
  readAfter: async ({ args, ctx }) => ({ pending: await ctx.db.hasPendingSetupState('enable_production', args.account), enabled: (await ctx.db.getAccount(args.account))?.production_enabled === true }),
  verify: ({ after }) => after.pending || after.enabled,
  present: ({ args, ctx, after }) => (after.enabled
    ? { production: 'already ON' }
    : { next_step: `Open ${setupUrl(ctx)}, find "Turn on production", enter ${args.account} and your passphrase, within ${PENDING_MINUTES} minutes.`, expires_in_minutes: PENDING_MINUTES })
});

const disableProduction = defineGithubWrite({
  name: 'github_disable_production',
  area: 'server', audience: ['O'],
  description: 'Turn production OFF for an account at once; every production connection to it stops being able to change anything.',
  properties: { account: { type: 'string', maxLength: 39 } },
  required: ['account'],
  declarations: { production: 'never', confirm: 'always', cred: '—', profiles: ['full'] },
  target: accountTarget,
  read: readAccount,
  classify: () => ({}),
  summarize: ({ args, before }) => (before ? `Turn production OFF for ${args.account} (today: ${before.production_enabled ? 'on' : 'already off'})` : `There is no connected account called "${args.account}"`),
  apply: async ({ args, ctx, before }) => {
    if (!before) throw noAccount(args.account);
    await ctx.db.setProductionEnabled(args.account, false);
  },
  readAfter: async ({ args, ctx }) => (await ctx.db.getAccount(args.account))?.production_enabled === true,
  verify: ({ after }) => after === false,
  present: ({ args }) => ({ production: `OFF for ${args.account}. Turning it on again needs the setup page and your passphrase.` })
});

const setSpendLimit = defineGithubWrite({
  name: 'github_set_spend_limit',
  area: 'server', audience: ['O'],
  description: 'Set an optional monthly spending cap (0 prevents spend); later increases to chosen caps require setup-page authorization.',
  properties: { account: { type: 'string', maxLength: 39 }, limitCents: { type: 'integer', minimum: 0, maximum: 100000000, description: 'New monthly limit in cents (1000 = $10.00)' } },
  required: ['account', 'limitCents'],
  declarations: { production: 'never', confirm: 'always', cred: '—', profiles: ['full'] },
  target: accountTarget,
  read: async (args, ctx) => spendStatus(ctx, args.account),
  classify: () => ({}),
  summarize: ({ args, before }) => (before
    ? `Set an explicit monthly spending cap for ${args.account} to ${money(args.limitCents)} (today ${before.limitEnabled ? money(before.limitCents) : 'no user-selected cap'}; ${money(before.usedCents)} tracked so far)`
    : `There is no connected account called "${args.account}"`),
  apply: async ({ args, ctx, before }) => {
    if (!before) throw noAccount(args.account);
    await ctx.db.setSpendLimitCents(args.account, args.limitCents);
  },
  readAfter: async ({ args, ctx }) => (await ctx.db.getAccount(args.account))?.spend_limit_cents,
  verify: ({ args, after }) => after === args.limitCents,
  present: ({ args, after }) => ({ spend_limit: money(after), spend_limit_cents: after, raising_it: `Only the setup page can raise it (account ${args.account}).` })
});


// R-1: an agent may mint a PREVIEW pass with no spending and no access changes. Production, spending and access-changing passes
// exist only on the passphrase-protected setup page. The pass itself is shown once on that page, never in this reply.
const createPass = defineGithubWrite({
  name: 'github_create_pass',
  area: 'server', audience: ['O'],
  description: 'Make a short-lived preview pass for the HTTPS API or Robinson\'s Toolkit. No spending or access changes. Shown once on the setup page.',
  properties: {
    account: { type: 'string', maxLength: 39 },
    profile: { type: 'string', enum: ['read_only', 'everyday'], description: 'read_only (default) or everyday' },
    allowWrites: { type: 'boolean', description: 'Let the pass make ordinary preview changes (everyday profile only)' },
    areas: { type: 'array', items: { type: 'string', maxLength: 31 }, maxItems: 40, description: 'Limit to these areas, such as pr or issue' },
    repos: { type: 'array', items: { type: 'string', maxLength: 140 }, maxItems: 50, description: 'Limit to these repositories, written owner/name' },
    days: { type: 'integer', minimum: 1, maximum: 30, description: 'Lifetime in days (default 1)' },
    ratePerMinute: { type: 'integer', minimum: 1, maximum: 600, description: 'Requests per minute (default 120)' }
  },
  required: ['account'],
  declarations: { production: 'never', confirm: 'always', cred: '—', profiles: ['full'] },
  target: accountTarget,
  read: async (args, ctx) => {
    const account = await ctx.db.getAccount(args.account);
    let grant = null; let problem = null;
    try { grant = validateGrant({ profile: args.profile ?? 'read_only', mode: 'preview', allowWrites: args.allowWrites === true, areas: args.areas, repos: args.repos, days: args.days, ratePerMinute: args.ratePerMinute }, args.account); } catch (error) { problem = error instanceof TypeError ? error.message : 'Those pass settings are not valid.'; }
    return { known: account != null && account.installation_status === 'active', grant, problem };
  },
  classify: () => ({}),
  summarize: ({ args, before }) => {
    if (!before.known) return `There is no connected, active account called "${args.account}"`;
    if (before.problem) return `Cannot make this pass: ${before.problem}`;
    const g = before.grant;
    return `Make a preview ${g.profile} pass for ${args.account} (changes ${g.allowWrites ? 'allowed' : 'not allowed'}; no spending; no access changes; ${g.days} day(s); ${g.ratePerMinute} requests per minute${g.areas ? `; areas ${g.areas.join(', ')}` : ''}${g.repos ? `; repositories ${g.repos.join(', ')}` : ''}). It is revealed once on the setup page.`;
  },
  apply: async ({ args, ctx, before }) => {
    if (!before.known) throw noAccount(args.account);
    if (before.problem) throw new GithubClientError('outside_scope', before.problem, { account: args.account });
    const g = before.grant;
    const pass = `rtc_pass_${randomBytes(32).toString('base64url')}`;
    const passId = randomBytes(12).toString('hex');
    const created = await ctx.db.createRtcPassGrant({ pass, passId, account: args.account, expiresAt: new Date(Date.now() + g.days * 86400000), grant: g });
    if (!created) throw new GithubClientError('outside_scope', 'The account could not carry this pass.', { account: args.account });
    try {
      const one = await oneTimeStore(ctx).issue({ account: args.account, kind: 'rtc-scoped-pass', secret: pass });
      return { passId, reveal: one.setupPath };
    } catch (error) {
      await ctx.db.revokeRtcPass(passId).catch(() => {});
      throw error;
    }
  },
  readAfter: async ({ ctx, response }) => (await ctx.db.listConnections()).filter((c) => c.client_id === `rtc-${response.passId}`).map((c) => ({ kind: c.kind })),
  verify: ({ after }) => after.length > 0 && after.every((c) => c.kind === 'pass'),
  inverse: ({ response }) => ({ tool: 'github_revoke_connection', args: { connection: `rtc-${response.passId}` } }),
  present: ({ args, response }) => ({ pass_id: response.passId, connection_id: `rtc-${response.passId}`, account: args.account, reveal: response.reveal, note: 'Open the reveal link in your browser and sign in with your passphrase. The pass is shown once.' })
});

// ---- Connection tools (B-8): the default account of this login, and switching a login off. ----
const connectionTarget = (args, ctx) => ({ owner: ctx.connection.default_account, scope: 'server' });
const thisClient = (ctx) => ctx.connection.client_id;

const setDefaultAccount = defineGithubWrite({
  name: 'github_set_default_account',
  area: 'server', audience: ['O'],
  description: 'Choose which account tools use when you leave out the owner. Applies to this connector login only.',
  properties: { account: { type: 'string', maxLength: 39, description: 'One of the accounts this connection may use' } },
  required: ['account'],
  declarations: { production: 'never', cred: '—', profiles: ['full'] },
  target: (args) => ({ owner: args.account, scope: 'server' }),
  read: async (args, ctx) => ({ current: ctx.connection.default_account, known: (await ctx.db.getAccount(args.account)) != null }),
  classify: () => ({}),
  summarize: ({ args, before }) => (before.known
    ? (sameLogin(before.current, args.account) ? `${args.account} is already the default account` : `Make ${args.account} the default account for this connection (today: ${before.current})`)
    : `There is no connected account called "${args.account}"`),
  apply: async ({ args, ctx, before }) => {
    if (!before.known) throw noAccount(args.account);
    if (!thisClient(ctx) || (await ctx.db.setConnectionDefaultAccount(thisClient(ctx), args.account)) < 1) throw new GithubClientError('outside_scope', `"${args.account}" is not one of the accounts this connection may use.`, { account: args.account });
  },
  readAfter: async ({ ctx }) => (await ctx.db.listConnections()).filter((c) => c.client_id === thisClient(ctx)).map((c) => c.default_account),
  verify: ({ args, after }) => after.length > 0 && after.every((a) => sameLogin(a, args.account)),
  present: ({ args }) => ({ default_account: args.account, note: 'Used from your next request on.' })
});

const revokeConnection = defineGithubWrite({
  name: 'github_revoke_connection',
  area: 'server', audience: ['O'],
  description: 'Switch one connector login or service pass off at once (find its id with github_list_connections). A login signs in again; a pass is gone for good.',
  properties: { connection: { type: 'string', maxLength: 200, description: 'The connection_id from github_list_connections' } },
  required: ['connection'],
  declarations: { production: 'never', confirm: 'always', cred: '—', profiles: ['full'] },
  target: connectionTarget,
  read: async (args, ctx) => {
    const found = (await ctx.db.listConnections()).filter((c) => c.client_id === args.connection).map((c) => ({ c, v: connectionView(c, ctx) }));
    if (!found.length || found.some(({ v }) => !v.overlap)) return null;
    return { name: found[0].c.client_name ?? args.connection, tokens: found.length, allowed: found.every(({ v }) => v.canRevoke), isThis: args.connection === thisClient(ctx) };
  },
  classify: () => ({}),
  summarize: ({ args, before }) => {
    if (!before) return `There is no live connection with the id "${args.connection}"`;
    if (!before.allowed) return `"${before.name}" also reaches accounts this connection cannot use, so it cannot be switched off from here`;
    return `Switch off "${before.name}"${before.isThis ? ' — THIS is the connection you are using now; it stops working immediately and must sign in again' : ''}`;
  },
  apply: async ({ args, ctx, before }) => {
    if (!before) throw new GithubClientError('outside_scope', `There is no live connection with the id "${args.connection}".`, { connection: args.connection });
    if (!before.allowed) throw new GithubClientError('outside_scope', 'That login reaches accounts this connection cannot use.', { connection: args.connection });
    await ctx.db.revokeConnection(args.connection);
  },
  readAfter: async ({ args, ctx }) => (await ctx.db.listConnections()).filter((c) => c.client_id === args.connection).length,
  verify: ({ after }) => after === 0,
  present: ({ args }) => ({ switched_off: args.connection, note: 'It has to sign in again to be used.' })
});

export const tools = [...readTools, enableProduction.tool, disableProduction.tool, setSpendLimit.tool, setDefaultAccount.tool, revokeConnection.tool, createPass.tool];
export const handlers = { ...readHandlers, [enableProduction.tool.name]: enableProduction.handler, [disableProduction.tool.name]: disableProduction.handler, [setSpendLimit.tool.name]: setSpendLimit.handler,
  [setDefaultAccount.tool.name]: setDefaultAccount.handler, [revokeConnection.tool.name]: revokeConnection.handler, [createPass.tool.name]: createPass.handler };
