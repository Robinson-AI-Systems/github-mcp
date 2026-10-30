// GitHub MCP login policy (A-3b): what the authorize page offers, what a login may choose, which settings a token carries,
// and what a stored token means to the MCP endpoint. Plugs into the contract-generic handlers in src/core/.
import { CONNECTION_FIELDS, CONNECTION_LISTINGS, CONNECTION_MODES, CONNECTION_PROFILES, connectionSettings } from '../db.js';
import { escapeHtml } from '../core/http.js';

/** Account checkboxes post as `acct:<login>=on`, so a plain form body (one value per name) can carry several accounts. */
export const ACCOUNT_FIELD_PREFIX = 'acct:';

const HIDDEN_FIELDS = ['client_id', 'redirect_uri', 'response_type', 'code_challenge', 'code_challenge_method', 'state', 'resource'];
const camel = (field) => field.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const isProductionDeployment = (env) => env.VERCEL_ENV === 'production';
const selectedLogins = (params) => Object.keys(params).filter((k) => k.startsWith(ACCOUNT_FIELD_PREFIX) && params[k] === 'on').map((k) => k.slice(ACCOUNT_FIELD_PREFIX.length));
const option = (value, selected, label = value) => `<option value="${escapeHtml(value)}"${selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;

export function createGithubPolicy({ env = process.env } = {}) {
  return {
    async choices(db) { return db.listAccountsForLogin(); },

    page({ params, choices: accounts, client, error = '' }) {
      const chosen = new Set(selectedLogins(params));
      const noneChosen = chosen.size === 0;
      const defaultLogin = typeof params.default_account === 'string' ? params.default_account : accounts.find((a) => a.is_default)?.login;
      const listing = params.listing || (/claude/i.test(client?.client_name || '') ? 'catalog' : 'compact');
      const productionOffered = isProductionDeployment(env);
      const hidden = HIDDEN_FIELDS.map((name) => `<input type="hidden" name="${name}" value="${escapeHtml(params[name])}">`).join('');
      const rows = accounts.map((a) => {
        const on = noneChosen ? Boolean(a.is_default) : chosen.has(a.login);
        return `<label class="row"><input type="checkbox" name="${escapeHtml(ACCOUNT_FIELD_PREFIX + a.login)}" value="on"${on ? ' checked' : ''}> ${escapeHtml(a.label)} <small>${escapeHtml(a.login)}</small></label>`;
      }).join('');
      const defaults = accounts.map((a) => option(a.login, a.login === defaultLogin, `${a.label} (${a.login})`)).join('');
      const modeList = productionOffered ? ['production', 'preview'] : ['preview'];
      const chosenMode = modeList.includes(params.mode) ? params.mode : modeList[0];
      const modes = modeList.filter((m) => CONNECTION_MODES.includes(m)).map((m) => option(m, chosenMode === m)).join('');
      const names={read_only:'Read only — never change GitHub',everyday:'Everyday — routine changes (default)',
        full:'Full — every operation allowed by your real GitHub grant and user policy'};
      const profiles = CONNECTION_PROFILES.map(v=>option(v,(params.profile||'everyday')===v,names[v]||v)).join('');
      const listings = CONNECTION_LISTINGS.map((v) => option(v, listing === v)).join('');
      const addAccount = '<p><small>Not seeing an account you own? Add it on the <a href="/api/github/setup">setup page</a> (it installs the GitHub App on that account), then come back and reconnect.</small></p>';
      const intro = (accounts.length
        ? '<p>Choose which GitHub accounts this AI connection may use, its default account, and its permissions.</p>'
        : '<p>No GitHub accounts are connected yet. Add an account securely through the setup page first.</p>') + addAccount;
      const profileNote='<small>Full is included in normal GitHub connection setup; no God Mode or extra token is required. Full never changes your provider grant, installed repositories, production permissions or chosen safety limits.</small>';
      const modeNote = isProductionDeployment(env)
        ? '<small>Production is the default on this deployment; choose preview for a dry run.</small>'
        : '<small>This is a preview deployment: production mode is not available here.</small>';
      return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>Connect Robinson GitHub MCP</title><style>body{font:16px system-ui,sans-serif;max-width:430px;margin:6vh auto;padding:20px}form{display:grid;gap:14px}' +
        'input,select,button{font:inherit;padding:10px}button{cursor:pointer}p{line-height:1.5}.row{display:flex;gap:8px;align-items:center}.row input{padding:0}small{opacity:.7}</style></head><body>' +
        '<h1>Connect GitHub MCP</h1>' + (error ? `<p role="alert">${escapeHtml(error)}</p>` : '') + intro +
        `<form method="post">${hidden}` +
        `<fieldset><legend>GitHub accounts</legend>${rows}</fieldset>` +
        `<label>Default account<select name="default_account">${defaults}</select></label>` +
        `<label>Mode<select name="mode">${modes}</select></label>${modeNote}` +
        `<label>Profile<select name="profile">${profiles}</select></label>${profileNote}` +
        `<label>Tool listing<select name="listing">${listings}</select></label>` +
        '<label>Administrator passphrase<input type="password" name="passphrase" required autocomplete="current-password"></label>' +
        `<button type="submit"${accounts.length ? '' : ' disabled'}>Authorize this connection</button></form></body></html>`;
    },

    /** The login's choices, checked against the real account list. Production needs the production deployment. */
    validate({ params, choices: accounts }) {
      const known = new Map(accounts.map((a) => [a.login, a]));
      const picked = selectedLogins(params);
      if (!picked.length) return { error: 'Choose at least one GitHub account.' };
      if (picked.some((login) => !known.has(login))) return { error: 'Unknown GitHub account selected.' };
      const logins = accounts.map((a) => a.login).filter((login) => picked.includes(login));
      const defaultAccount = typeof params.default_account === 'string' && params.default_account ? params.default_account : (logins.length === 1 ? logins[0] : '');
      if (!logins.includes(defaultAccount)) return { error: 'The default account must be one of the selected accounts.' };
      if (!CONNECTION_MODES.includes(params.mode) || !CONNECTION_PROFILES.includes(params.profile) || !CONNECTION_LISTINGS.includes(params.listing)) {
        return { error: 'Invalid mode, profile or tool listing.' };
      }
      if (params.mode === 'production') {
        if (!isProductionDeployment(env)) return { error: 'Production mode is not available on this deployment.' };
      }
      return { settings: { defaultAccount, accounts: logins, mode: params.mode, profile: params.profile, listing: params.listing } };
    },

    /** One helper for the code → token grant: every CONNECTION_FIELDS value comes from the issuing row, never a default. */
    tokenSettings(record) {
      const settings = connectionSettings(record);
      return Object.fromEntries(CONNECTION_FIELDS.map((field) => [camel(field), settings[field]]));
    },

    /** What a stored token means to /api/mcp. Production connections work only on the production deployment (A10). */
    toConnection(record) {
      if (!CONNECTION_MODES.includes(record.mode) || !CONNECTION_PROFILES.includes(record.profile) || !CONNECTION_LISTINGS.includes(record.listing)) return null;
      if (!Array.isArray(record.accounts) || !record.accounts.length || !record.accounts.includes(record.default_account)) return null;
      if (record.mode === 'production' && !isProductionDeployment(env)) {
        return { refuse: { status: 403, body: { error: 'production_unavailable', error_description: 'Production connections work only on the production deployment.' } } };
      }
      return {
        connection: Object.freeze({
          client_id: record.client_id, default_account: record.default_account, accounts: Object.freeze([...record.accounts]),
          mode: record.mode, profile: record.profile, listing: record.listing
        })
      };
    }
  };
}
