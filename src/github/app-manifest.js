// The GitHub App manifest (BATCH-A A4/A5): one list of permissions, reviewed in this file, posted to GitHub by the owner's
// browser. GitHub then redirects back with a one-hour code that the server exchanges for the App's key and secrets.
//
// Permission names: every name below appears in GitHub's `server-to-server-permissions.json` (github/docs @ be38ec5d,
// `src/github-apps/data/fpt-2026-03-10/`) and, where the REST description's `app-permissions` schema also has it, spells it
// identically (`tests/unit/app-manifest.test.js` checks both). Account-level (user) permissions are NOT requested yet: that file
// and the REST description name several of them differently (`emails` / `email_addresses`, `keys` / `git_ssh_keys`), and GitHub
// rejects a manifest with an unknown name. Batch O adds them in its own card, verified then (DECISIONS 2026-10-10).
// Y-1 (DECISIONS 2026-10-16): account permissions stay out of the manifest because they cannot be verified without a real
// GitHub round trip; they are reached through the OAuth user route (credential U) and the owner checklist
// (`app-permissions-review` in the dashboard map). `repository_advisories` is not in the pinned description: advisories use `security_events`.
export const REPOSITORY_PERMISSIONS = Object.freeze({
  actions: 'write', administration: 'write', attestations: 'read', checks: 'write', codespaces: 'write', codespaces_secrets: 'write',
  contents: 'write', dependabot_secrets: 'write', deployments: 'write', discussions: 'write', environments: 'write', issues: 'write',
  metadata: 'read', pages: 'write', pull_requests: 'write', repository_custom_properties: 'write', repository_hooks: 'write',
  secret_scanning_alerts: 'write', secrets: 'write', security_events: 'write', statuses: 'write', actions_variables: 'write',
  vulnerability_alerts: 'write', workflows: 'write',
  // Y-1: packages (delete/restore), merge queues and build-artifact metadata records. These names are in the REST
  // description's app-permissions schema (checked by tests/unit/app-manifest.test.js); an existing App must be edited by the owner.
  packages: 'write', merge_queues: 'write', artifact_metadata: 'write'
});

// GitHub.com does not expose organization_packages in App settings despite its presence in the REST token schema.
// Do not request it or diagnose its absence as missing owner consent (GitHub Community #32195; checked 2026-10-17).
export const ORGANIZATION_PERMISSIONS = Object.freeze({
  members: 'write', organization_actions_variables: 'write', organization_administration: 'write', organization_copilot_agent_settings: 'write', organization_codespaces: 'write',
  organization_codespaces_secrets: 'write', organization_codespaces_settings: 'write', organization_copilot_seat_management: 'write',
  organization_custom_org_roles: 'read', organization_custom_properties: 'write', organization_dependabot_secrets: 'write',
  organization_hooks: 'write', organization_personal_access_token_requests: 'write', organization_personal_access_tokens: 'write',
  organization_plan: 'read', organization_projects: 'write', organization_secrets: 'write', organization_user_blocking: 'write',
  // Y-1: self-hosted runner administration and the organization event feed.
  organization_self_hosted_runners: 'write', organization_events: 'read'
});

/** Y-1: permissions added after the first Apps were created. An existing App never gains them by itself (Batch Y decision Y9). */
export const Y1_ADDED_PERMISSIONS = Object.freeze({
  packages: 'write', merge_queues: 'write', artifact_metadata: 'write',
  organization_self_hosted_runners: 'write', organization_events: 'read'
});

export const MANIFEST_PERMISSIONS = Object.freeze({ ...REPOSITORY_PERMISSIONS, ...ORGANIZATION_PERMISSIONS });

const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
export const isValidLogin = (login) => typeof login === 'string' && LOGIN.test(login);

/** GitHub App names are unique across GitHub and at most 34 characters. */
export function appNameFor(login) {
  if (!isValidLogin(login)) throw new TypeError('A GitHub account name is required.');
  return `robinson-mcp-${login}`.slice(0, 34).replace(/-+$/, '');
}

/**
 * @param {{ origin: string, login: string }} options `origin` is the server's HTTPS origin (PUBLIC_BASE_URL)
 * @returns the manifest object. Webhook events: none chosen; GitHub sends `installation` and `installation_repositories`
 *   to every App's webhook, which is all the server listens for (A12).
 */
export function buildManifest({ origin, login }) {
  return {
    name: appNameFor(login),
    url: origin,
    description: `Private GitHub Unleashed by Robinson AI Systems server access for ${login}. Created from the server's own setup page; owned and installed only by ${login}.`,
    hook_attributes: { url: `${origin}/api/github/webhook`, active: true },
    redirect_url: `${origin}/api/github/manifest-callback`,
    callback_urls: [`${origin}/api/github/user-callback`],
    setup_url: `${origin}/api/github/setup`,
    setup_on_update: false,
    public: false,
    request_oauth_on_install: false,
    default_events: [],
    default_permissions: { ...MANIFEST_PERMISSIONS }
  };
}

/** Where the owner's browser posts the manifest (`manifest` form field) for this account. */
export function manifestFormUrl({ login, accountType, state }) {
  if (!isValidLogin(login)) throw new TypeError('A GitHub account name is required.');
  if (typeof state !== 'string' || state.length < 32) throw new TypeError('A setup state is required.');
  const base = accountType === 'Organization' ? `https://github.com/organizations/${login}/settings/apps/new` : 'https://github.com/settings/apps/new';
  return `${base}?state=${encodeURIComponent(state)}`;
}

/** The page where the owner installs the App on the account that owns it. */
export const installUrl = (slug) => `https://github.com/apps/${encodeURIComponent(slug)}/installations/new`;
