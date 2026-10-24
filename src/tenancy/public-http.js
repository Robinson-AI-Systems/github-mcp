// The web side of the public sign-in and of the person's "My connection" page. Plain-English pages, no scripts, strict CSP,
// and NO cookies: every step carries its own one-use handle (see public-connect.js for why that is safe). Every failure
// shows a short generic message; why a sign-in was refused goes to the server log only. Everything answers 404 while the
// flow is off.
import { createPublicConnect, PublicConnectError, publicConnectEnabled, MANAGE_PATH } from './public-connect.js';
import { TenantCapacityError, TENANT_RUNTIME_LIMITS as LIMITS } from './runtime-limits.js';
import { escapeHtml as h, paramsOf, publicOrigin, send } from '../core/http.js';
import { COMMON_ZONES } from '../core/time-zone.js';
import { renderTrustBody, TRUST_PAGES } from './trust-pages.js';
import { BRAND_CSS, brandHeader, brandFooter } from '../brand/brand.js';

const CSP = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self' https://github.com; base-uri 'none'; frame-ancestors 'none'";
const STYLE = BRAND_CSS + '.row{display:flex;justify-content:space-between;gap:10px;align-items:center;border-top:1px solid var(--border);padding:10px 0}' +
  '.row:first-of-type{border-top:0}.tag{font-size:.8rem;color:var(--muted)}.ok{color:var(--brand)}button.plain{background:none;border:1px solid var(--border);color:var(--text)}' +
  'a.button{display:block;text-align:center;font:600 16px Inter,-apple-system,sans-serif;color:#fff;background:var(--grad);border-radius:50px;padding:13px 20px;text-decoration:none}' +
  '.notice{border:1px solid var(--brand);border-radius:12px;padding:12px;margin:0 0 14px}';
const STEP = '/api/oauth/authorize';

function page(res, status, title, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  return send(res, status, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${h(title)}</title><style>${STYLE}</style></head><body><main>${brandHeader()}<h1>${h(title)}</h1>${body}${brandFooter()}</main></body></html>`, 'text/html; charset=utf-8');
}
// Internal reason only (never shown to the person, never a secret): lets the owner see why a step was refused.
function logRefusal(error, where = '') {
  try { console.error('[public-connect] refused', where, error?.name ?? 'none', error?.code ?? '', error?.why ?? '', String(error?.message ?? '').slice(0, 160)); } catch { /* logging must never break the page */ }
}
function failure(res, error, where = '') {
  logRefusal(error, where);
  if (error instanceof TenantCapacityError) {
    res.setHeader('Retry-After', String(error.retryAfterSeconds));
    return page(res, 429, 'Busy right now', '<p>This connection is temporarily busy. Please try again in a minute.</p>');
  }
  if (error instanceof PublicConnectError && error.code !== 'refused')
    return page(res, error.code === 'capacity' ? 503 : 403, error.code === 'capacity' ? 'Not available right now' : 'Could not connect', `<p>${h(error.message)}</p>`);
  return page(res, 403, 'This step has expired', '<p>Each page of the sign-in works once and only for a few minutes. Go back to your app and start connecting again. If you were already connected, you still are.</p>');
}
/** The last step back to the person's app: a small page that ends the redirect chain on our site, then sends them on.
 * (A redirect chain that began at one of our forms may not end on another site under our form rules; a plain page avoids it.) */
export function handoff(res, url) {
  let host = 'your app';
  try { host = new URL(url).host || host; } catch { /* keep the generic name */ }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('Referrer-Policy', 'no-referrer');
  return send(res, 200, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connected</title><meta http-equiv="refresh" content="0;url=${h(url)}"><style>${STYLE}</style></head><body><main>${brandHeader()}<h1>Done</h1><p>Returning you to <code>${h(host)}</code>…</p><p><a href="${h(url)}">Continue</a> if nothing happens.</p></main></body></html>`, 'text/html; charset=utf-8');
}
const off = (res) => send(res, 404, { error: 'not_found' });
const make = (env, deps) => deps.connect ?? createPublicConnect({ env, ...deps });
const go = (res, url, status = 302) => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('Location', url); return res.status(status).end(); };
/** A form post must come from our own pages. The handle inside the form is the real guard; this is a second check.
 * Some in-app browsers send no Origin, or "null"; anything naming another site is refused. */
const sameSite = (req, env) => { const o = String(req.headers?.origin ?? ''); return o === '' || o === 'null' || o === publicOrigin(env); };
const hidden = (name, value) => `<input type="hidden" name="${name}" value="${h(value)}">`;
const list = (items) => items.map(h).join(', ');

/** POST /api/oauth/register while the flow is on. */
export async function publicRegister(req, res, { env = process.env, ...deps } = {}) {
  res.setHeader('Cache-Control', 'no-store');
  if (!publicConnectEnabled(env)) return off(res);
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { error: 'method_not_allowed' }); }
  try {
    return send(res, 201, await make(env, deps).registerClient(paramsOf(req)));
  } catch (error) {
    if (error instanceof PublicConnectError && error.code === 'invalid_client_metadata') return send(res, 400, { error: 'invalid_client_metadata', error_description: error.message });
    if (error instanceof PublicConnectError && error.code === 'capacity') return send(res, 503, { error: 'temporarily_unavailable', error_description: error.message });
    return send(res, 503, { error: 'temporarily_unavailable' });
  }
}

/** /limits: the working limits in plain words. Read-only, no sign-in, nothing personal. Numbers come from the same settings the server enforces. */
export async function publicLimits(req, res, { env = process.env } = {}) {
  res.setHeader('Cache-Control', 'no-store');
  if (!publicConnectEnabled(env)) return off(res);
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(res, 405, { error: 'method_not_allowed' }); }
  const mb = (bytes) => `${Math.round(bytes / (1024 * 1024))} MB`;
  const hours = Math.round(LIMITS.resultMaxTtlSeconds / 3600);
  return page(res, 200, 'Limits', '<p>These limits keep the service fast and fair for everyone. Normal use never gets near them. When one is reached your assistant is told to wait a moment; nothing is lost or changed.</p>' +
    `<div class="row"><span><strong>Assistant calls</strong><br><small>How fast your assistants can use GitHub through us.</small></span><span>${LIMITS.mcpClientPerMinute} a minute per app, ${LIMITS.mcpTenantPerMinute} a minute in total</span></div>` +
    `<div class="row"><span><strong>Sign-in attempts</strong><br><small>Connecting or reconnecting an app.</small></span><span>${LIMITS.oauthClientPerMinute} a minute per app</span></div>` +
    `<div class="row"><span><strong>Saved results</strong><br><small>Long answers we keep so your assistant can fetch them.</small></span><span>kept up to ${hours} hours; each up to ${Math.round(LIMITS.resultMaxBytes / 1024)} KB; ${mb(LIMITS.resultsTenantBytesPerDay)} a day</span></div>` +
    `<div class="row"><span><strong>Background jobs</strong><br><small>Longer tasks that finish later.</small></span><span>${LIMITS.jobsTenantPending} waiting at once, ${LIMITS.jobsTenantPerDay} a day</span></div>` +
    '<div class="row"><span><strong>Extra names</strong><br><small>People you list as your own, beyond your accounts.</small></span><span>up to 50</span></div>' +
    '<p><small>GitHub has its own limits too; if GitHub asks us to slow down, your assistant is told when to try again. <a href="/connection">Back to My connection</a></small></p>');
}

/** /privacy /terms /security /support: public pages from the reviewed drafts (draft banner until the owner approves them). */
export async function publicTrust(req, res, { env = process.env } = {}) {
  res.setHeader('Cache-Control', 'no-store');
  if (!publicConnectEnabled(env)) return off(res);
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(res, 405, { error: 'method_not_allowed' }); }
  const name = String(paramsOf(req).page ?? '');
  if (!TRUST_PAGES.includes(name)) return page(res, 404, 'Not found', '<p>That page does not exist.</p>');
  const { title, html } = renderTrustBody(name, env);
  return page(res, 200, title, html);
}

/** GET /api/oauth/authorize for a pcl_ client: checked, then straight to GitHub. */
export async function publicAuthorize(req, res, { env = process.env, ...deps } = {}) {
  res.setHeader('Cache-Control', 'no-store');
  if (!publicConnectEnabled(env)) return off(res);
  if (req.method !== 'GET') return page(res, 410, 'This page has changed', '<p>The sign-in is simpler now. Go back to your app and start connecting again.</p>');
  try {
    const { url } = await make(env, deps).begin(paramsOf(req));
    return go(res, url);
  } catch (error) { return failure(res, error, 'authorize'); }
}

function approvePage(res, a) {
  const accounts = a.accounts.map((x) => `${h(x.login)} <span class="tag">${x.organization ? 'organization' : 'your account'}</span>`).join('<br>');
  const who = a.appName ? `<strong>${h(a.appName)}</strong> at <code>${h(a.appHost)}</code>` : `the app at <code>${h(a.appHost)}</code>`;
  return page(res, 200, 'Approve the connection',
    `<p>Signed in to GitHub as <strong>${h(a.signedInAs)}</strong>.</p>` +
    `<p>Let ${who} use these GitHub accounts?</p><p>${accounts}</p>` +
    `<form method="post" action="${STEP}">${hidden('step', 'approve')}${hidden('handle', a.handle)}${hidden('choice', 'approve')}` +
    '<div class="choice"><input type="checkbox" id="ro" name="read_only" value="yes"><label for="ro"><strong>Read-only</strong><small>Your assistant can look but cannot change anything. Leave unticked and it can make changes, each one shown to you first.</small></label></div>' +
    '<button type="submit" id="approve">Approve</button></form>' +
    `<form method="post" action="${STEP}">${hidden('step', 'approve')}${hidden('handle', a.handle)}${hidden('choice', 'cancel')}<button type="submit" class="plain" id="cancel">Cancel</button></form>` +
    (a.others.length ? `<p><small>${list(a.others)} can be added later from <a href="${h(a.manageUrl)}">My connection</a> (the App is not installed there yet).</small></p>` : '') +
    `<p><small>Only approve if you just started connecting from that app. You can change all of this later at <a href="${h(a.manageUrl)}">My connection</a>.</small></p>`);
}
function installPage(res, i) {
  return page(res, 200, i.again ? 'Still one step left' : 'One more step',
    `<p>Signed in to GitHub as <strong>${h(i.signedInAs)}</strong>.</p>` +
    (i.again
      ? '<p>We still cannot see an account you own with the App installed. Install it on your own account, or on an organization where you are an owner. If an organization owner must approve it, ask them, then connect again.</p>'
      : '<p>The Robinson GitHub MCP App is not installed on any account you own yet. Install it, choose which repositories it may use, and you come straight back here.</p>') +
    `<p><a class="button" id="install" href="${h(i.url)}">Install the App on GitHub</a></p>` +
    '<p><small>Changed your mind? Close this page; nothing was connected.</small></p>');
}
function forgetConfirmPage(res, f) {
  if (f.none) return page(res, 200, 'Nothing to delete', '<p>We found no data stored for this GitHub account. You can close this page.</p>');
  return page(res, 200, 'Confirm deletion', `<p>Signed in as <strong>${h(f.signedInAs)}</strong>. Press the button to delete everything stored about you for good. This cannot be undone.</p>` +
    `<form method="post" action="${STEP}">${hidden('forget', '1')}${hidden('action', 'confirm')}${hidden('handle', f.handle)}<button type="submit" id="delete">Yes, delete my data</button></form>`);
}
const when = (d) => { try { return new Date(d).toISOString().slice(0, 10); } catch { return ''; } };
function managePage(res, m) {
  if (m.none) return page(res, 200, 'Nothing connected yet', `<p>Signed in as <strong>${h(m.signedInAs)}</strong>, but no app has connected to your GitHub through us yet. Add Robinson GitHub MCP in your assistant (ChatGPT, Claude, …) and connect from there first.</p>`);
  const act = (action, text, { value = '', plain = false, id = action } = {}) => `<form method="post" action="${MANAGE_PATH}">${hidden('handle', m.handle)}${hidden('action', action)}${hidden('value', value)}<button type="submit" id="${h(id)}"${plain ? ' class="plain"' : ''}>${text}</button></form>`;
  const anyChanges = m.connections.some((c) => !c.readOnly);
  const label = (c) => c.readOnly ? 'read-only' : c.canChange ? 'can make changes' : 'preview only (changes are off for an account)';
  return page(res, 200, 'My connection',
    (m.notice ? `<p class="notice">${h(m.notice)}</p>` : '') +
    `<p>Signed in as <strong>${h(m.signedInAs)}</strong>.</p>` +
    '<h2>Accounts</h2>' + (m.accounts.length ? m.accounts.map((a) => `<div class="row"><span>${h(a.login)} <span class="tag">${a.organization ? 'organization' : 'your account'}</span></span><span class="tag">${a.active ? 'connected' : 'App removed'}</span></div>`).join('') : '<p class="muted">None yet.</p>') +
    m.offers.map((o) => act('add', `Add ${h(o.login)}`, { value: o.login, id: 'add-' + o.login })).join('') +
    (m.offers.length ? '<p><small>Adding opens GitHub to install the App there, then brings you back. Your apps get the new account straight away.</small></p>' : '') +
    '<h2>Apps using your GitHub</h2>' + (m.connections.length ? m.connections.map((c) => `<div class="row"><span>${h(c.name)} <span class="tag">${label(c)}</span></span></div>` +
      act('disconnect', `Disconnect ${h(c.name)}`, { value: c.clientId, plain: true, id: 'disconnect-' + c.clientId })).join('') : '<p class="muted">No app is connected right now.</p>') +
    (m.connections.length ? (anyChanges ? act('read_only', 'Make all my apps read-only', { plain: true }) : act('allow_changes', 'Let my apps make changes again', { plain: true })) : '') +
    '<h2>Master token (optional)</h2>' + (m.master.added
      ? `<p>Added${m.master.expiresAt ? ', runs out ' + h(when(m.master.expiresAt)) : ', never runs out'}. It unlocks what normal sign-in cannot (notifications, packages, gists, organization settings).</p>` +
        (m.master.unlocks?.length ? '<div id="master-unlocks">' + m.master.unlocks.map((u) => `<div class="row"><span>${h(u.area)}</span><span class="tag">${u.unlocked ? 'unlocked' : 'locked — tick “' + h(u.needs) + '”'}</span></div>`).join('') + '</div>' : '') +
        (m.master.actAs ? '<h3>Act as me</h3>' +
          `<p id="act-as-state">GitHub shows: <strong>${m.master.actAs.on && !m.master.actAs.expired && !m.master.actAs.rejected ? 'you' + (m.master.actAs.login ? ' (' + h(m.master.actAs.login) + ')' : '') : 'the Robinson GitHub MCP app'}</strong>${m.master.actAs.expired ? ' <small>(your master token ran out; add a new one)</small>' : m.master.actAs.rejected ? ' <small>(GitHub rejected your master token; add a new one)</small>' : ''}</p>` +
          act('act_as_me', m.master.actAs.on ? 'Act as me: turn off' : 'Act as me: turn on', { value: m.master.actAs.on ? 'off' : 'on', plain: true, id: 'act-as-me' }) +
          '<p><small>When on, GitHub records you as the one who made each change. Checks that only an app may post, and changes to branches with rules, still come from the app.</small></p>' +
          `<p id="rule-override-state">Allow overriding branch rules: <strong>${m.master.actAs.ruleOverride ? 'on' : 'off'}</strong></p>` +
          act('rule_override', m.master.actAs.ruleOverride ? 'Allow overriding branch rules: turn off' : 'Allow overriding branch rules: turn on', { value: m.master.actAs.ruleOverride ? 'off' : 'on', plain: true, id: 'rule-override' }) +
          '<p><small>When on, your assistant can skip a branch\'s rules for one change at a time, only when it asks to, shows you which rules, and you confirm. GitHub still decides whether you may.</small></p>' : '') +
        act('master', 'Replace or remove it', { plain: true })
      : '<p>Unlocks what normal sign-in cannot: notifications, packages, gists, organization settings and more. It has the power of your whole GitHub login, so only add it if you want that.</p>' + act('master', 'Add my master token')) +
    '<h2>Extra places (uses your master token)</h2>' + (m.master.added
      ? '<p>Add an organization you belong to, or one repository (owner/name), where the GitHub App is not installed. A new place starts read-only: your apps can look, and every change is refused until you allow changes for it. Read-only app connections cannot use extra places at all.</p>' +
        ((m.places ?? []).length ? m.places.map((pl) => `<div class="row"><span>${h(pl.login)}${pl.repos?.length ? ' <small>' + h(pl.repos.join(', ')) + '</small>' : ''} <span class="tag">${pl.changes ? 'changes allowed' : 'read-only'}</span></span></div>` +
          act('place_changes', pl.changes ? `Make ${h(pl.login)} read-only` : `Allow changes for ${h(pl.login)}`, { value: pl.login + ':' + (pl.changes ? 'off' : 'on'), plain: true, id: 'place-changes-' + pl.login }) +
          (pl.repos?.length ? pl.repos.map((r) => act('remove_place', `Remove ${h(pl.login)}/${h(r)}`, { value: pl.login + '/' + r, plain: true, id: 'remove-place-' + pl.login + '-' + r })).join('') : act('remove_place', `Remove ${h(pl.login)}`, { value: pl.login, plain: true, id: 'remove-place-' + pl.login }))).join('') : '<p class="muted">No extra places yet.</p>') +
        `<form method="post" action="${MANAGE_PATH}">${hidden('handle', m.handle)}${hidden('action', 'add_place')}<label>Organization or owner/repository<input type="text" name="value" id="place-value" maxlength="150" autocomplete="off"></label><button type="submit" id="add-place">Add place</button></form>`
      : '<p class="muted">Extra places need your master token. Add it above first.</p>') +
    '<h2>Time zone</h2>' +
    `<form method="post" action="${MANAGE_PATH}">${hidden('handle', m.handle)}${hidden('action', 'time_zone')}<label>Show times in<select name="value">` +
      COMMON_ZONES.map((z) => `<option value="${h(z)}"${z === m.timeZone ? ' selected' : ''}>${h(z.replace('_', ' '))}</option>`).join('') + '</select></label><button type="submit" id="save-zone">Save</button></form>' +
    `<h2>Leave</h2><p><a href="${STEP}?forget=1">Delete my data</a> removes everything we store about you.</p>` +
    '<p><small>This page works for 30 minutes. Open it again any time; you sign in with GitHub each time.</small></p>');
}
function render(res, result) {
  if (result.approve) return approvePage(res, result.approve);
  if (result.install) return installPage(res, result.install);
  if (result.manage) return managePage(res, result.manage);
  if (result.forget) return forgetConfirmPage(res, result.forget);
  if (result.go) return go(res, result.go, 303);
  if (result.redirect) return handoff(res, result.redirect);
  return failure(res, null, 'render');
}

/** POST /api/oauth/authorize step=approve: the Approve page was answered. */
export async function publicApprove(req, res, { env = process.env, ...deps } = {}) {
  res.setHeader('Cache-Control', 'no-store');
  if (!publicConnectEnabled(env)) return off(res);
  try {
    if (req.method !== 'POST' || !sameSite(req, env)) return failure(res, null, 'approve-origin');
    const p = paramsOf(req);
    return render(res, await make(env, deps).approve({ handle: p.handle, choice: p.choice, readOnly: p.read_only === 'yes' }));
  } catch (error) { return failure(res, error, 'approve'); }
}

/** /connection: GET shows the start page (or, with ?go=1, goes to GitHub); POST is one action on the page. */
export async function publicManage(req, res, { env = process.env, ...deps } = {}) {
  res.setHeader('Cache-Control', 'no-store');
  if (!publicConnectEnabled(env)) return off(res);
  try {
    const p = paramsOf(req), connect = make(env, deps);
    if (req.method === 'GET') {
      if (p.go === '1') return go(res, (await connect.startManage()).url);
      return page(res, 200, 'My connection', '<p>See and change how your assistants use your GitHub: add accounts, add the optional master token, make your apps read-only, pick your time zone, disconnect an app or delete your data.</p>' +
        `<p><a class="button" id="manage-sign-in" href="${MANAGE_PATH}?go=1">Sign in with GitHub</a></p><p><small>You never type a password or token here for this. <a href="/limits">See the limits</a>.</small></p>`);
    }
    if (req.method !== 'POST' || !sameSite(req, env)) return failure(res, null, 'manage-origin');
    return render(res, await connect.manageAction({ handle: p.handle, action: p.action, value: p.value }));
  } catch (error) { return failure(res, error, 'manage'); }
}

/** "Delete my data". GET shows what will happen; POST start goes to GitHub (proof it is them); POST confirm deletes. */
export async function publicForget(req, res, { env = process.env, ...deps } = {}) {
  res.setHeader('Cache-Control', 'no-store');
  if (!publicConnectEnabled(env)) return off(res);
  try {
    const p = paramsOf(req), connect = make(env, deps);
    if (req.method === 'GET') {
      return page(res, 200, 'Delete my data', '<p>This removes everything Robinson GitHub MCP stores about you: your sign-in, saved GitHub access, settings, change record and saved results. Your assistants stop working with your accounts straight away. Nothing on GitHub itself is changed or deleted.</p>' +
        '<p>First you sign in with GitHub so we know it is you. Then you confirm. This cannot be undone, but you can connect again later as a new person.</p>' +
        `<form method="post" action="${STEP}">${hidden('forget', '1')}${hidden('action', 'start')}<button type="submit" id="forget-start">Sign in with GitHub to continue</button></form>`);
    }
    if (req.method !== 'POST' || !sameSite(req, env)) return failure(res, null, 'forget-origin');
    if (p.action === 'confirm') {
      const deleted = await connect.forgetConfirm({ handle: p.handle });
      return page(res, 200, deleted ? 'Your data is deleted' : 'Nothing to delete', deleted
        ? '<p>Done. Your sign-in, saved access, settings, change record and saved results are removed for good. You can close this page.</p>'
        : '<p>We no longer hold any data for you. You can close this page.</p>');
    }
    return go(res, (await connect.startForget()).url, 303);
  } catch (error) { return failure(res, error, 'forget'); }
}

/** GET /api/github/user-callback when the state starts with pc. */
export async function publicCallback(req, res, { env = process.env, ...deps } = {}) {
  res.setHeader('Cache-Control', 'no-store');
  if (!publicConnectEnabled(env)) return off(res);
  try {
    return render(res, await make(env, deps).finish({ state: req.query?.state, code: req.query?.code }));
  } catch (error) { return failure(res, error, 'callback'); }
}

/** GET /api/github/setup?installation_id=…&state=pc.… : GitHub sent the person back after installing the App. */
export async function publicInstallReturn(req, res, { env = process.env, ...deps } = {}) {
  res.setHeader('Cache-Control', 'no-store');
  if (!publicConnectEnabled(env)) return off(res);
  try {
    return go(res, (await make(env, deps).resumeInstall({ state: req.query?.state })).url);
  } catch (error) { return failure(res, error, 'install-return'); }
}
/** An app still using the older private-pilot sign-in: point the person at the one sign-in everyone now uses. */
export function publicMoved(req, res) {
  return page(res, 410, 'Connect again', '<p>This connection uses an older sign-in that has been retired. In your app, remove Robinson GitHub MCP and add it again, then connect. It takes one sign-in with GitHub. Nothing on GitHub was changed.</p>' +
    `<p><a href="${MANAGE_PATH}">My connection</a> shows what is connected.</p>`);
}
export const publicFailure = failure;
