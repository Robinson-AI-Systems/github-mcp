import { redact } from './util.js';
// ENT-1 (reads): GitHub Enterprise through the person's master token (credential M). Every tool first proves the person
// administers the named enterprise (src/github/enterprise-access.js); nothing is sent for any other slug.
import { defineRead } from './define-read.js';
import { plain } from './github-read.js';
import { graphql } from '../github/client.js';
import { adminEnterprises, requireEnterprise, ENTERPRISE_SLUG } from '../github/enterprise-access.js';

const E = ENTERPRISE_SLUG;
const PER = { type: 'integer', minimum: 1, maximum: 100, description: 'Items per page (default 50)' };
const AFTER = { type: 'string', maxLength: 1024, description: 'Cursor from next_after of the previous page' };
const DAY = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Day, YYYY-MM-DD (for the 1-day reports)' };

/** next_after (the opaque cursor) from a Link header, only when it points at the same GitHub API resource. */
export function nextAfter(link, pathname) {
  const next = String(link ?? '').split(',').find((part) => /;\s*rel="?next"?\s*$/i.test(part.trim()));
  const address = next?.match(/<([^>]+)>/)?.[1];
  if (!address) return null;
  try {
    const url = new URL(address);
    if (url.origin !== 'https://api.github.com' || url.pathname !== pathname) return null;
    const after = url.searchParams.getAll('after');
    return after.length === 1 && after[0].length <= 1024 ? after[0] : null;
  } catch { return null; }
}
const page = async (gh, route, params, pathname) => {
  const response = await gh.request(route, params);
  return { data: response.data, next_after: nextAfter(response.headers?.link, pathname) };
};
const asList = (data) => (Array.isArray(data) ? data : []);

const list = defineRead({
  name: 'github_enterprise_list', area: 'enterprise', audience: ['O'],
  description: 'List the GitHub Enterprises you administer (slug and name). Needs your master token with enterprise permissions.',
  handler: (args, ctx) => plain(async () => ({ enterprises: await adminEnterprises(ctx) }))
});

const OVERVIEW = `query($slug: String!) { enterprise(slug: $slug) { name slug url createdAt billingEmail viewerIsAdmin
  ownerInfo { admins(first: 50) { totalCount nodes { login } } }
  members(first: 1) { totalCount }
  organizations(first: 100) { totalCount nodes { login } } } }`;
const overview = defineRead({
  name: 'github_enterprise_overview', area: 'enterprise', audience: ['O'],
  description: 'Read an enterprise you administer: name, created date, admins, member count and organizations (capped lists with totals).',
  properties: { enterprise: E }, required: ['enterprise'],
  handler: (args, ctx) => plain(async () => {
    const gh = await requireEnterprise(ctx, args.enterprise);
    const e = (await graphql(gh, OVERVIEW, { slug: args.enterprise })).enterprise;
    if (!e) throw new TypeError('GitHub did not return that enterprise.');
    const admins = e.ownerInfo?.admins, orgs = e.organizations;
    return { slug: e.slug, name: e.name, url: e.url, created_at: e.createdAt, billing_email: e.billingEmail ?? null, you_are_admin: e.viewerIsAdmin === true,
      admins: { total: admins?.totalCount ?? 0, logins: (admins?.nodes ?? []).filter(Boolean).map((n) => n.login) },
      members_total: e.members?.totalCount ?? 0,
      organizations: { total: orgs?.totalCount ?? 0, logins: (orgs?.nodes ?? []).filter(Boolean).map((n) => n.login), complete: (orgs?.totalCount ?? 0) <= (orgs?.nodes ?? []).length } };
  })
});

const shapeConfig = (c) => (c ? { id: c.id, name: c.name, description: c.description ?? null, target_type: c.target_type ?? null, enforcement: c.enforcement ?? null,
  settings: Object.fromEntries(Object.entries(c).filter(([k, v]) => typeof v === 'string' && !['name', 'description', 'url', 'html_url', 'created_at', 'updated_at', 'target_type', 'enforcement'].includes(k))) } : null);
const securityConfigs = defineRead({
  name: 'github_enterprise_security_configs', area: 'enterprise', audience: ['O'],
  description: 'Read enterprise code-security configurations: the list and defaults, or one configuration (optionally with its repositories).',
  properties: { enterprise: E, configurationId: { type: 'integer', minimum: 1 }, repositories: { type: 'boolean', description: 'With configurationId: also list the repositories using it' }, per_page: PER, after: AFTER },
  required: ['enterprise'],
  handler: (args, ctx) => plain(async () => {
    const gh = await requireEnterprise(ctx, args.enterprise);
    const base = `/enterprises/${encodeURIComponent(args.enterprise)}/code-security/configurations`;
    const per_page = args.per_page ?? 50, after = args.after ? { after: args.after } : {};
    if (args.configurationId) {
      const one = (await gh.request('GET /enterprises/{enterprise}/code-security/configurations/{configuration_id}', { enterprise: args.enterprise, configuration_id: args.configurationId })).data;
      if (!args.repositories) return { configuration: shapeConfig(one) };
      const repos = await page(gh, 'GET /enterprises/{enterprise}/code-security/configurations/{configuration_id}/repositories',
        { enterprise: args.enterprise, configuration_id: args.configurationId, per_page, ...after }, `${base}/${args.configurationId}/repositories`);
      return { configuration: shapeConfig(one), repositories: asList(repos.data).map((r) => ({ id: r.repository?.id ?? null, name: r.repository?.full_name ?? r.repository?.name ?? null, status: r.status ?? null })), next_after: repos.next_after };
    }
    const configs = await page(gh, 'GET /enterprises/{enterprise}/code-security/configurations', { enterprise: args.enterprise, per_page, ...after }, base);
    const defaults = (await gh.request('GET /enterprises/{enterprise}/code-security/configurations/defaults', { enterprise: args.enterprise })).data;
    return { configurations: asList(configs.data).map(shapeConfig), next_after: configs.next_after,
      defaults: asList(defaults).map((d) => ({ default_for_new_repos: d.default_for_new_repos ?? null, configuration_id: d.configuration?.id ?? null, name: d.configuration?.name ?? null })) };
  })
});

const shapeAlert = (a) => ({ number: a.number, state: a.state, severity: a.security_advisory?.severity ?? a.security_vulnerability?.severity ?? null,
  package: a.dependency?.package?.name ?? null, ecosystem: a.dependency?.package?.ecosystem ?? null, manifest: a.dependency?.manifest_path ?? null,
  repository: a.repository?.full_name ?? null, summary: redact(String(a.security_advisory?.summary ?? '')).slice(0, 200), created_at: a.created_at ?? null, url: a.html_url ?? null });
const dependabot = defineRead({
  name: 'github_enterprise_dependabot', area: 'enterprise', audience: ['O'],
  description: 'Read enterprise Dependabot alerts (filter by state and severity) or which repositories Dependabot may access.',
  properties: { enterprise: E, view: { type: 'string', enum: ['alerts', 'repository_access'], description: 'alerts (default) or repository_access' },
    state: { type: 'string', enum: ['open', 'dismissed', 'fixed', 'auto_dismissed'] }, severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] }, per_page: PER, after: AFTER, page: { type: 'integer', minimum: 1, maximum: 1000 } },
  required: ['enterprise'],
  handler: (args, ctx) => plain(async () => {
    const gh = await requireEnterprise(ctx, args.enterprise);
    const base = `/enterprises/${encodeURIComponent(args.enterprise)}/dependabot`;
    if (args.view === 'repository_access') {
      const d = (await gh.request('GET /enterprises/{enterprise}/dependabot/repository-access', { enterprise: args.enterprise, per_page: args.per_page ?? 50, page: args.page ?? 1 })).data;
      return { default_level: d.default_level ?? null, repositories: asList(d.accessible_repositories).map((r) => ({ id: r.id, name: r.full_name ?? r.name })) };
    }
    const alerts = await page(gh, 'GET /enterprises/{enterprise}/dependabot/alerts', { enterprise: args.enterprise, per_page: args.per_page ?? 30,
      ...(args.state ? { state: args.state } : {}), ...(args.severity ? { severity: args.severity } : {}), ...(args.after ? { after: args.after } : {}) }, `${base}/alerts`);
    return { alerts: asList(alerts.data).map(shapeAlert), next_after: alerts.next_after, untrusted: true };
  })
});

const REPORTS = { enterprise_1_day: ['enterprise-1-day', true], enterprise_28_day: ['enterprise-28-day/latest', false], repos_1_day: ['repos-1-day', true],
  user_teams_1_day: ['user-teams-1-day', true], users_1_day: ['users-1-day', true], users_28_day: ['users-28-day/latest', false] };
const copilotMetrics = defineRead({
  name: 'github_enterprise_copilot_metrics', area: 'enterprise', audience: ['O'],
  description: 'Read an enterprise Copilot usage report (1-day or latest 28-day); GitHub returns report download links.',
  properties: { enterprise: E, report: { type: 'string', enum: Object.keys(REPORTS) }, day: DAY }, required: ['enterprise', 'report'],
  handler: (args, ctx) => plain(async () => {
    const [path, needsDay] = REPORTS[args.report];
    if (needsDay && !args.day) throw new TypeError(`The ${args.report} report needs a day (YYYY-MM-DD).`);
    const gh = await requireEnterprise(ctx, args.enterprise);
    const route = `GET /enterprises/{enterprise}/copilot/metrics/reports/${path}`;
    return { report: args.report, ...(await gh.request(route, { enterprise: args.enterprise, ...(needsDay ? { day: args.day } : {}) })).data };
  })
});

export const readActionsSettings = async (gh, enterprise) => {
  const get = async (route) => (await gh.request(route, { enterprise })).data;
  const retention = await get('GET /enterprises/{enterprise}/actions/cache/retention-limit');
  const storage = await get('GET /enterprises/{enterprise}/actions/cache/storage-limit');
  const oidc = await get('GET /enterprises/{enterprise}/actions/oidc/customization/properties/repo');
  const inclusions = Array.isArray(oidc) ? oidc : (oidc?.include ?? oidc?.properties ?? []);
  return { cache_retention_days: retention?.max_cache_retention_days ?? null, cache_storage_gb: storage?.max_cache_size_gb ?? null,
    oidc_custom_properties: asList(inclusions).map((i) => ({ name: i.custom_property_name, source: i.inclusion_source ?? null })).sort((a, b) => a.name.localeCompare(b.name)) };
};
const actionsSettings = defineRead({
  name: 'github_enterprise_actions_settings', area: 'enterprise', audience: ['O'],
  description: 'Read enterprise Actions settings: cache retention and storage limits and OIDC custom-property inclusions.',
  properties: { enterprise: E }, required: ['enterprise'],
  handler: (args, ctx) => plain(async () => readActionsSettings(await requireEnterprise(ctx, args.enterprise), args.enterprise))
});

export const tools = [list.tool, overview.tool, securityConfigs.tool, dependabot.tool, copilotMetrics.tool, actionsSettings.tool];
export const handlers = { [list.tool.name]: list.handler, [overview.tool.name]: overview.handler, [securityConfigs.tool.name]: securityConfigs.handler,
  [dependabot.tool.name]: dependabot.handler, [copilotMetrics.tool.name]: copilotMetrics.handler, [actionsSettings.tool.name]: actionsSettings.handler };
