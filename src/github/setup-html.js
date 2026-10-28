// The private setup page's HTML (A4/A5/A11). Plain words for a non-developer owner. Every dynamic value is escaped; no script
// runs on the page; the only inputs that accept a secret are the token boxes and the passphrase boxes.
import { escapeHtml as h } from '../core/http.js';
import { installUrl } from './app-manifest.js';
import { unlockSection } from './unlock-html.js';

const STYLE = 'body{font:16px system-ui,sans-serif;max-width:640px;margin:4vh auto;padding:16px;line-height:1.5}form,.card{display:grid;gap:10px;margin:18px 0;padding:14px;border:1px solid #ccc;border-radius:10px}.card{display:block}input,select,button{font:inherit;padding:8px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f4f4;padding:10px;border-radius:6px}button{cursor:pointer}.ok{color:#116611}.todo{color:#8a5200}small{color:#555}';

const hidden = (name, value) => `<input type="hidden" name="${h(name)}" value="${h(value)}">`;
const passphrase = '<label>Administrator passphrase<input type="password" name="passphrase" required autocomplete="current-password"></label>';

function accountCard(a) {
  if (a.error) return `<div class="card"><strong>${h(a.login)}</strong><p>${h(a.error)}</p></div>`;
  const lines = [];
  const mark = (ok, good, todo) => `<li class="${ok ? 'ok' : 'todo'}">${h(ok ? good : todo)}</li>`;
  if (a.credential_kind === 'fine_grained') {
    lines.push(mark(a.fine_grained.present, `Fine-grained token saved (ends in ${a.fine_grained.last4}).`, 'No fine-grained token saved yet.'));
  } else {
    lines.push(mark(a.app.created, `GitHub App created${a.app.slug ? ` (${a.app.slug})` : ''}.`, 'The GitHub App has not been created yet.'));
    if (a.app.error) lines.push(`<li class="todo">${h(a.app.error)}</li>`);
    if (a.app.created) {
      const i = a.installation;
      lines.push(mark(i.status === 'active', `Installed on ${h(a.login)}${i.repository_selection ? ` (${h(i.repository_selection)} repositories)` : ''}.`,
        i.status === 'suspended' ? 'The installation is suspended on GitHub.' : 'The App is not installed on this account yet.'));
      if (i.missing_permissions?.length) lines.push(`<li class="todo">GitHub has not granted ${i.missing_permissions.length} requested permission(s): ${h(i.missing_permissions.slice(0, 8).join(', '))}${i.missing_permissions.length > 8 ? ', …' : ''}. Open the App's page on GitHub and accept the new permissions.</li>`);
    }
    lines.push(mark(a.user.authorized, `You are signed in as ${h(a.user.login || 'yourself')} for personal settings.`, a.user.error || 'Not authorized for personal settings yet (optional).'));
  }
  lines.push(`<li>${a.classic.present ? `Notifications token saved (ends in ${h(a.classic.last4)}, scopes: ${h((a.classic.scopes || []).join(', '))}).` : 'No notifications token (optional).'}</li>`);
  lines.push(`<li>${a.packages?.present ? `Package token saved for ${h(a.packages.actor)} (scopes: ${h((a.packages.scopes || []).join(', '))}).` : 'No package token (optional; package tools require one).'}</li>`);
  lines.push(`<li>Legacy restricted-grant production setting: <strong>${a.production_enabled ? 'on' : 'off'}</strong>${a.is_default ? ' · default account' : ''}</li>`);
  lines.push(`<li>Disposable scratch organization: <strong>${a.is_scratch ? 'yes' : 'no'}</strong></li>`);
  return `<div class="card"><strong>${h(a.label)}</strong> <small>${h(a.login)} · ${h(a.account_type)} · ${h(a.credential_kind === 'app' ? 'GitHub App' : 'fine-grained token')}</small><ul>${lines.join('')}</ul></div>`;
}

/**
 * @param {object} view `{ csrf, result?, revealed?, show?, accounts?, manifestForm?, installLink?, blocked?, keyHelp? }`
 */
/** One plain sentence on the estimated monthly hosting cost, with a warning line once it passes the owner's alert level. */
const publicCostLine = (c) => !c ? '' : `<p>Estimated hosting cost at this rate: about ${h(c.estimate_display)} a month (${h(String(c.monthCalls))} calls). This is a rough estimate from call counts, not a bill; your real charges are on Vercel and Neon.</p>` +
  (c.overAlert ? `<p class="notice"><strong>Heads up:</strong> the estimate is at or above your alert level of ${h(c.alert_display)} a month. Check Vercel and Neon usage, or pause new sign-ups.</p>` : '');

const dollarsOf = (cents) => `$${(Number(cents) / 100).toFixed(2)}`;
const num = (n) => Number(n ?? 0).toLocaleString('en-US');
/** PUB-5 B: the owner's one page of numbers. Counts, plus the GitHub name of the ten heaviest people this week (to prevent abuse and control cost). */
const publicUsageSection = (u) => {
  const sign = u.signups;
  const signLine = !sign ? '' : sign.paused
    ? `<p class="notice"><strong>New sign-ups: paused</strong> (${h(sign.reason ?? 'paused')}). People who are already connected keep working. To open them again, ${sign.manual ? 'remove GITHUB_PUBLIC_NEW_SIGNUPS or set it to open' : 'wait for usage to fall, or raise PUBLIC_COST_PAUSE_CENTS'}.</p>`
    : `<p>New sign-ups: <strong>open</strong>. They pause on their own if the estimated monthly cost reaches ${h(dollarsOf(sign.pauseCents))}. To pause by hand, set GITHUB_PUBLIC_NEW_SIGNUPS=paused.</p>`;
  const top = (u.top ?? []).length ? '<p><small>Heaviest users this week (calls, changes): ' +
    u.top.map((t) => `${h(t.login ?? 'name not available')} (${h(num(t.calls))}, ${h(num(t.writes))})`).join('; ') + '.</small></p>' : '';
  return `<h2>Public usage</h2><p>People connected through the public sign-in: ${h(num(u.peopleConnected))}. Active today: ${h(num(u.activeToday ?? 0))}; active this week: ${h(num(u.activeThisWeek ?? 0))}. ` +
    `Assistant calls today: ${h(num(u.lastDay.calls))} (${h(num(u.lastDay.writes ?? 0))} real changes, ${h(num(u.lastDay.errors))} errors). Last 7 days: ${h(num(u.lastWeek.calls))} calls.` +
    `${u.unreadable ? ` ${h(String(u.unreadable))} names could not be read.` : ''} ` +
    'The owner sees each person\'s daily counts, and the GitHub name of the ten heaviest users, to prevent abuse and control cost. Nothing else about anyone is shown here.</p>' +
    publicCostLine(u.cost) + signLine + top;
};

export function renderSetup({ csrf, result = '', revealed = null, show = '', accounts = null, manifestForm = null, installLink = null, blocked = '', keyHelp = '', productionNames = null, protectedList = null, spendLimits = null, ownPeopleExtra = null, secretEntry = null, oauthReadiness = null, connections = null, publicUsage = null, publicInvites = null }) {
  const form = (action, inner, button, extra = '') => `<form method="post" action="#setup-feedback" autocomplete="off">${hidden('csrf', csrf)}${hidden('action', action)}${extra}${inner}${passphrase}<button type="submit">${h(button)}</button></form>`;
  const login = '<label>GitHub account name (for example your organization or user name)<input name="login" required maxlength="39" autocomplete="off"></label>';
  const type = '<label>Account type<select name="accountType"><option value="Organization">Organization</option><option value="User">Personal user</option></select></label>';
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<title>Robinson GitHub MCP — private setup</title><style>${STYLE}</style></head><body>` +
    '<h1 id="setup-feedback">Robinson GitHub MCP — private setup</h1>' +
    '<p>Everything secret about GitHub is entered or created here, never in a chat. Each step asks for your administrator passphrase.</p>' +
    (blocked ? `<p role="alert"><strong>${h(blocked)}</strong></p>` : '') +
    (keyHelp ? `<p role="alert"><strong>${h(keyHelp)}</strong></p>` : '') +
    (result ? `<p role="status"><strong>Setup response:</strong> ${h(result)}</p>` : '') +
    (installLink ? `<p><a href="${h(installLink)}">Install the App on GitHub →</a></p>` : '') +
    (secretEntry ? `<h2>Type a secret for GitHub</h2><p>${h(secretEntry.summary)}</p><p><small>The value is sealed with GitHub's public key on this server and sent straight to GitHub. It is not saved, not logged and never shown to Claude. Link is good until ${h(secretEntry.expires)}.</small></p>` +
      form('enter-secret', '<label>Secret value<input type="password" name="value" required maxlength="48000" autocomplete="off"></label>', 'Seal and send to GitHub', hidden('id', secretEntry.id)) : '') +
    (revealed ? `<h2>One-time secret — copy it now</h2><pre>${h(revealed)}</pre><p>It has been deleted from the server and will not appear again.</p>` : '') +
    (manifestForm ? `<h2>Create the GitHub App</h2><p>GitHub will show you the App it is about to create. Check the account name, then click <em>Create GitHub App</em> on GitHub. The keys go straight to this server; you copy nothing.</p>
      <form method="post" action="${h(manifestForm.action)}">${hidden('manifest', manifestForm.manifest)}<button type="submit">Continue to GitHub</button></form>` : '') +
    (accounts ? `<h2>Your accounts</h2>${accounts.length ? accounts.map(accountCard).join('') : '<p>No accounts are set up yet. Create a GitHub App below.</p>'}` : '') +
    (oauthReadiness ? `<div class="card"><h2>Custom MCP OAuth connection status</h2>
      <p><strong>${h(oauthReadiness.summary)}</strong></p>
      <p>Registered clients: ${h(oauthReadiness.registered_clients)} · Non-revoked connector sessions: ${h(oauthReadiness.unrevoked_sessions)} · Current access tokens: ${h(oauthReadiness.usable_access_tokens)} · Stored refresh credentials: ${h(oauthReadiness.refresh_credentials)}</p>
      <p>Custom server address: <code>${h(oauthReadiness.mcp_url)}</code></p>
      <p>${h(oauthReadiness.next_action)}</p>
      <p><small>These are counts only. No client IDs or bearer secrets are shown. Recorded sessions are not proof of real custom-MCP acceptance. Production permissions stay independently controlled.</small></p></div>` : '') +
    (connections ? `<div class="card"><h2>Custom MCP connections (owner only)</h2><p>These identifiers are not passwords. Select the exact existing ChatGPT connection.</p><ul>${connections.map((c) => `<li><strong>${h(c.name)}</strong> — <code>${h(c.id)}</code> — ${h(c.mode.toUpperCase())} / ${h(c.profile)} — accounts: ${h(c.accounts.join(', '))}</li>`).join('')}</ul></div>` : '') +
    form('status', '', 'Show my accounts and check them with GitHub') +
    '<h2>1. Create the GitHub App for an account</h2><p>Private to that account. You will do this once for each account (your organization, and your personal account).</p>' +
    form('start-app', login + type, 'Prepare the GitHub App') +
    '<h2>2. Install the App</h2><p>After the App is created this page shows an install link. When GitHub sends you back here, the account turns green above.</p>' +
    '<h2>IN-06: Disposable scratch organization</h2><p>Only designate a separate organization containing nothing important. Preview developer tools can create and delete run-owned test repositories there. An active GitHub App installed on <strong>All repositories</strong> with the required permissions is mandatory. Production must stay OFF. Never mark your normal organization as disposable.</p>' +
    form('set-scratch', login + '<label>Scratch setting<select name="enabled"><option value="true">Enable for this disposable organization</option><option value="false">Disable scratch mode</option></select></label><label>Re-type the exact organization name<input name="confirmLogin" required maxlength="39" autocomplete="off"></label>', 'Save scratch organization setting') +
    '<h2>Hub RTC test pass (preview, read-only only)</h2><p>Create one short-lived pass scoped to the exact disposable scratch organization. It cannot authorize writes, production, spending or changes in any other account. Reveal once through this protected page, pass privately to the test runner, then revoke immediately.</p>' +
    form('create-rtc-pass', login + '<label>Expiry (days; max 30)<input type="number" name="days" min="1" max="30" value="1" required></label><label>Requests per minute (1–600; default 120)<input type="number" name="rate" min="1" max="600" value="120" required></label>', 'Create read-only RTC pass') +
    '<h2>Scoped service pass (own limits)</h2><p>A pass that can do more than read, but only what you tick here. Leave Areas and Repositories empty for everything the profile offers. Owner controls (connections, production switches, spend settings, secrets) are never available to a pass. Production passes work only on an account where production is already switched on. Reveal once, then revoke when finished.</p>' +
    form('create-scoped-pass', login + '<label>Profile<select name="profile"><option value="read_only">Read-only</option><option value="everyday">Everyday</option><option value="full">Full</option></select></label><label>Mode<select name="mode"><option value="preview">Preview</option><option value="production">Production</option></select></label><label>Allow changes<select name="writes"><option value="false">No</option><option value="true">Yes</option></select></label><label>Allow access changes (members, teams, keys)<select name="access"><option value="false">No</option><option value="true">Yes</option></select></label><label>Spend allowance in dollars (0 = none)<input name="spend" value="0" maxlength="9"></label><label>Areas (comma separated, optional)<input name="areas" maxlength="400"></label><label>Repositories as owner/name (comma separated, optional)<input name="repos" maxlength="2000"></label><label>Expiry (days; max 30, or 365 for Robinson\'s Toolkit)<input type="number" name="days" min="1" max="365" value="1" required></label><label>Robinson\'s Toolkit pass<select name="hub"><option value="false">No</option><option value="true">Yes</option></select></label><label>Requests per minute (1–600; default 120)<input type="number" name="rate" min="1" max="600" value="120" required></label>', 'Create scoped pass') +
    form('revoke-rtc-pass', '<label>RTC pass identifier (24 hex characters)<input name="passId" required minlength="24" maxlength="24" autocomplete="off"></label>', 'Revoke RTC pass') +
    '<h2>Private GitHub tenant pilot — owner only</h2><p>For an approved <strong>disposable scratch Organization</strong> with an active GitHub App and your already-authorized GitHub identity. A separate isolated tenant will be prepared after GitHub confirms both. Repeating this action uses the same tenant. Private pilot hosting must be explicitly configured first; this does not enable public sign-up, new GitHub permissions, paid activity or production-mode access.</p>' +
    form('bootstrap-private-pilot', login +
      '<label>Re-type the exact scratch organization<input name="confirmLogin" required maxlength="39" autocomplete="off"></label>' +
      '<label>Private-only confirmation<select name="confirmPilot"><option value="no">Do not create anything</option><option value="yes">I authorize a private, isolated scratch tenant</option></select></label>',
      'Prepare my private GitHub pilot tenant') +
    '<h2>Issue a private MCP client — owner only</h2><p>After GitHub confirms your disposable scratch App, register one exact client callback. The client ID and secret are revealed together on this protected page, once, for ten minutes. This is private testing, not a public connection or user invitation.</p>' +
    form('register-private-pilot-client', login +
      '<label>Re-type your scratch organization<input name="confirmLogin" required maxlength="39" autocomplete="off"></label>' +
      '<label>Exact HTTPS callback URL from the MCP client<input name="redirectUri" type="url" required maxlength="2048" autocomplete="off"></label>' +
      '<label>Confirmation<select name="confirmPilot"><option value="no">Do not create a client</option><option value="yes">Issue one private client for my scratch App</option></select></label>',
      'Issue private MCP client — reveal once') +
    '<h2>Invite another GitHub user to the PRIVATE test pilot — owner only</h2><p>Only controlled test access, NOT the permanent signup method for customers. GitHub must independently verify the invited person when they connect. No notification or public enrollment is sent.</p>' +
    form('invite-private-pilot-user',login+
      '<label>Re-type scratch organization<input name="confirmLogin" required maxlength="39" autocomplete="off"></label>'+
      '<label>Exact GitHub user to allowlist<input name="targetLogin" required maxlength="39" autocomplete="off"></label>'+
      '<label>Exact HTTPS callback from pilot client<input name="redirectUri" type="url" required maxlength="2048" autocomplete="off"></label>'+
      '<label>Confirmation<select name="confirmPilot"><option value="no">Do not allow anyone</option><option value="yes">Allow this specific private test user</option></select></label>',
      'Prepare one private pilot user connection')+
    '<h2>Private tenant fair-use limits — owner only</h2><p>Adjust request capacity for one verified disposable private tenant; not GitHub permission grants, account spending controls or the developer testing budget. A client cannot consume another tenant\'s quota. Default is 120 requests/client/minute and 600 requests/tenant/minute.</p>' +
    form('set-private-tenant-capacity',login+
      '<label>Re-type exact scratch organization<input name="confirmLogin" required maxlength="39" autocomplete="off"></label>'+
      '<label>Per-client requests per minute (1–600)<input type="number" name="clientRate" min="1" max="600" value="120" required></label>'+
      '<label>Whole tenant requests per minute (at least client rate; max 6000)<input type="number" name="tenantRate" min="1" max="6000" value="600" required></label>'+
      '<label>Confirmation<select name="confirmPilot"><option value="no">Do not change limits</option><option value="yes">Save my private tenant capacity</option></select></label>',
      'Save private fair-use limits') +
    '<h2>Revoke a private pilot — emergency stop</h2><p>Immediately disable all private pilot tokens and clients for the exact organization. Works even after GitHub sign-in is lost. No repositories, customers or database contents are deleted. A later separate owner-approved re-enrollment is required.</p>' +
    form('revoke-private-pilot', login +
      '<label>Re-type exact organization to revoke<input name="confirmLogin" required maxlength="39" autocomplete="off"></label>' +
      '<label>Explicit revoke confirmation<select name="confirmPilot"><option value="no">Keep existing access</option><option value="revoke">Revoke all private pilot sessions for this account</option></select></label>',
      'Revoke private pilot access') +
    '<h2>3. Authorize as me (optional, for personal settings)</h2>' +
    form('start-user-auth', login.replace('GitHub account name (for example your organization or user name)', 'Account whose App you are authorizing'), 'Authorize on GitHub') +
    '<h2>4. Turn on production for an account</h2><p>This legacy setting applies to restricted connections. Full owner connections already execute authorized changes with disclosure and verification; they do not need this switch. To enable a restricted connection, request the change and confirm it here within 10 minutes.</p>' +
    form('confirm-production', login.replace('GitHub account name (for example your organization or user name)', 'Account to turn production on for'), 'Turn on production') +
    '<h2>Upgrade existing custom connection to PRODUCTION</h2><p>If ChatGPT used its own sign-in and kept a FULL/PREVIEW server connection, first press Show my accounts and copy that custom connection ID. For a full owner connection, legacy account production flags do not prevent this update. It preserves the account and profile grant; GitHub permissions, explicit restrictions, secrets and write verification still apply. The official GitHub ChatGPT connector remains separate.</p>' +
    form('upgrade-connection-production', login + '<label>Existing custom connection ID<input name="connection" required maxlength="128" autocomplete="off"></label>', 'Upgrade this connection to PRODUCTION') +
    '<h2>Names that count as production</h2><p>A repository\'s default branch, its protected branches, tags, releases, settings and environments named production, prod or live always count as production. Add more names here (separated by commas; * is a wildcard). These names classify effects for disclosure and explicitly restricted grants; they do not block full owner operations.</p>' +
    (productionNames ? `<p><small>Environments: ${h(productionNames.environments.join(', ') || 'none')} · Branches: ${h(productionNames.branches.join(', ') || 'none')}</small></p>` : '') +
    form('set-production-names', '<label>Extra environment names<input name="environments" maxlength="400" autocomplete="off"></label><label>Extra branch names<input name="branches" maxlength="400" autocomplete="off"></label>', 'Save production names') +
    '<h2>Protected repositories and installations</h2><p>These entries restrict delegated connections and builder workflows; full owner operations are governed by GitHub permissions. <strong>pr-only</strong>: only pull requests (branches, commits, reviews, checks, issues) and merges on green at an exact head. <strong>locked</strong>: nothing at all. The protected setup page manages this legacy list. For an installation enter its number, or * for all of this server\'s own GitHub Apps.</p>' +
    (protectedList ? `<ul>${protectedList.map((e) => `<li><code>${h(e.kind)}</code> ${h(e.target)} — <strong>${h(e.level)}</strong> (${h(e.reason)})</li>`).join('')}</ul>` : '') +
    form('save-protected', '<label>Kind<select name="kind"><option value="repo">Repository (owner/name)</option><option value="installation">App installation</option></select></label><label>Repository or installation<input name="target" required maxlength="140" autocomplete="off"></label><label>Level<select name="level"><option value="pr-only">pr-only</option><option value="locked">locked</option></select></label><label>Reason<input name="reason" required maxlength="300" autocomplete="off"></label>', 'Add or change this entry') +
    form('remove-protected', '<label>Kind<select name="kind"><option value="repo">Repository</option><option value="installation">App installation</option></select></label><label>Repository or installation to remove<input name="target" required maxlength="140" autocomplete="off"></label>', 'Remove this entry') +
    '<h2>Monthly spend limit</h2><p>A legacy allowance for explicitly restricted connections, not a second spending veto on a full owner. Full owners can change standing preferences through authorized tools. Issued passes retain their own allowances; unknown costs are disclosed. Enter dollars, for example 25 or 19.50.</p>' +
    (spendLimits ? `<ul>${spendLimits.map((a) => `<li>${h(a.login)} — limit ${h(a.limit)}, used this month ${h(a.used)}</li>`).join('')}</ul>` : '') +
    form('set-spend-limit', login + '<label>New monthly limit in dollars<input name="dollars" required maxlength="12" inputmode="decimal" autocomplete="off"></label>', 'Set the spend limit') +
    '<h2>Your own people</h2><p>This legacy classification informs explicitly restricted grants. Full owner instructions execute with disclosure and do not need a separate notification approval. These always count: your connected accounts, their organization members, github-actions[bot] and this server\'s own App bots. Add other GitHub names here, separated by commas. Saving replaces this extra list.</p>' +
    (ownPeopleExtra ? `<p><small>Extra names: ${h(ownPeopleExtra.join(', ') || 'none')}</small></p>` : '') +
    form('set-own-people', '<label>Extra names<input name="logins" maxlength="1000" autocomplete="off"></label>', 'Save own people') +
    (publicUsage && publicUsage.peopleConnected > 0 ? publicUsageSection(publicUsage) : '') +
    (publicInvites ? `<h2>Invite list</h2><p>${publicInvites.on ? '<strong>Invite-only is ON.</strong> A new person can connect only if their GitHub name is below.' : 'Invite-only is OFF: anyone can connect. To turn it on, set GITHUB_PUBLIC_INVITE_ONLY=enabled for the production deployment.'} People who already connected are never locked out.</p>` +
      `<p><small>Invited: ${h(publicInvites.logins.join(', ') || 'nobody yet')}</small></p>` +
      form('add-invites', '<label>GitHub names to invite (separated by commas)<input name="logins" required maxlength="1000" autocomplete="off"></label>', 'Add to the invite list') +
      form('remove-invite', '<label>GitHub name to remove<input name="login" required maxlength="39" autocomplete="off"></label>', 'Remove from the invite list') : '') +
    '<h2>Delete a person\'s data</h2><p>For a person who connected through the public sign-in and asks to be removed. Type their personal GitHub account name twice. This deletes their sign-in, tokens and stored settings for good. It cannot be undone and never touches anyone else.</p>' +
    form('forget-person', '<label>GitHub account name<input name="login" required maxlength="39" autocomplete="off"></label><label>Type it again<input name="confirmLogin" required maxlength="39" autocomplete="off"></label><label><input type="checkbox" name="confirmDelete" value="yes"> Yes, delete this person\'s data</label>', 'Delete this person\'s data') +
    '<h2>Time zone</h2><p>Times shown to your assistants use this zone. If none is saved they show in UTC. Use a name like America/Denver.</p>' +
    form('set-time-zone', '<label>Time zone<input name="zone" maxlength="64" autocomplete="off" placeholder="UTC"></label>', 'Save time zone') +
    unlockSection({ form, login }) +
    (show ? `<h2>Reveal a one-time secret</h2>${form('reveal', '', 'Reveal this one-time secret', hidden('id', show))}` : '') +
    '</body></html>';
}

export const resultPage = ({ title, message, installSlug = null, back = true }) =>
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  `<title>${h(title)}</title><style>${STYLE}</style></head><body><h1>${h(title)}</h1><p>${h(message)}</p>` +
  (installSlug ? `<p><a href="${h(installUrl(installSlug))}">Install the App on GitHub →</a></p>` : '') +
  (back ? '<p><a href="/api/github/setup">Back to setup</a></p>' : '') + '</body></html>';
