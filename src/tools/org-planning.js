import { isOwnerConnection } from '../core/authority.js';
// Y-5b: organization issue types and issue fields, per-issue field values, interaction limits and autolinks.
// Issue types and fields are organization-wide; writes bind the connected organization and restricted grants retain confirmation.
// Everything is REST, read first and read back; deletes say how many things use the object when GitHub tells us.
import { defineGithubWrite } from './define-github-write.js';
import { missing, octo, ownerOf, refusal } from './github-write.js';
import { notifyOutsiders } from './people-guard.js';
import { LOGIN, REPO_NAME } from './public-read.js';

const ORG = { ...LOGIN, description: 'Connected organization (default account)' };
const REPO_BASE = { owner: { ...LOGIN, description: 'Repository owner (default account)' }, repo: REPO_NAME };
const COLORS = ['gray', 'blue', 'green', 'yellow', 'orange', 'red', 'pink', 'purple'];
const orgTarget = (args, ctx) => ({ owner: ownerOf(args, ctx), scope: 'org', kind: 'org-planning' });
const repoTarget = (args, ctx) => ({ owner: ownerOf(args, ctx), repo: args.repo, scope: 'repo' });
const low = (s) => String(s ?? '').toLowerCase();

/** Organization-wide objects only exist for organizations. */
const requireOrg = async (ctx, owner) => {
  const row = await ctx.db.getAccount(owner);
  if (row?.account_type !== 'Organization') throw refusal(`${owner} is not a connected organization; issue types and fields are organization features.`);
};
const listOrg = async (ctx, owner, what) => (await (await octo(ctx, owner)).request(`GET /orgs/{org}/${what}`, { org: owner })).data ?? [];
const decl = (extra = {}) => ({ production: 'never', confirm: 'always', cred: 'I', profiles: ['full'], ...extra });

// ---- issue types ------------------------------------------------------------------------------------------------------
const typeSave = defineGithubWrite({
  name: 'github_org_issue_type_save', area: 'org', audience: ['O'],
  description: 'Create an organization issue type (Bug, Task, ...) or edit one by id. Types appear on every repository of the organization.',
  properties: { org: ORG, typeId: { type: 'integer', minimum: 1 }, name: { type: 'string', minLength: 1, maxLength: 50 }, description: { type: 'string', maxLength: 200 }, color: { type: 'string', enum: COLORS }, isEnabled: { type: 'boolean' } },
  required: ['name'], declarations: decl(),
  target: (a, c) => orgTarget({ owner: a.org }, c),
  read: async (args, ctx, t) => {
    await requireOrg(ctx, t.owner);
    const types = (await listOrg(ctx, t.owner, 'issue-types')).filter(Boolean);
    const current = args.typeId ? types.find((x) => x.id === args.typeId) ?? null : null;
    if (args.typeId && !current) throw refusal(`Issue type ${args.typeId} was not found in ${t.owner}.`, 404);
    return { types, current, clash: !args.typeId ? types.find((x) => low(x.name) === low(args.name)) ?? null : null };
  },
  classify: () => ({}),
  summarize: ({ args, target: t, before }) => (before.current ? `Edit issue type "${before.current.name}" of ${t.owner}` : `Create issue type "${args.name}" for ${t.owner}`),
  apply: async ({ args, ctx, target: t, before }) => {
    const gh = await octo(ctx, t.owner);
    const body = { name: args.name, is_enabled: args.isEnabled ?? before.current?.is_enabled ?? true, ...(args.description !== undefined ? { description: args.description } : {}), ...(args.color !== undefined ? { color: args.color } : {}) };
    if (before.current) return gh.request('PUT /orgs/{org}/issue-types/{issue_type_id}', { org: t.owner, issue_type_id: before.current.id, ...body });
    if (before.clash) throw refusal(`An issue type named "${args.name}" already exists (id ${before.clash.id}); nothing was created.`);
    return gh.request('POST /orgs/{org}/issue-types', { org: t.owner, ...body });
  },
  readAfter: async ({ ctx, target: t, before, response }) => {
    const id = before.current?.id ?? response?.data?.id;
    return { type: (await listOrg(ctx, t.owner, 'issue-types')).find((x) => x?.id === id) ?? null };
  },
  verify: ({ args, after }) => !!after.type && after.type.name === args.name && (args.isEnabled === undefined || after.type.is_enabled === args.isEnabled) && (args.color === undefined || after.type.color === args.color) && (args.description === undefined || (after.type.description ?? '') === args.description),
  inverse: ({ args, before, after, target: t }) => (before.current
    ? { tool: 'github_org_issue_type_save', args: { org: t.owner, typeId: before.current.id, name: before.current.name, description: before.current.description ?? '', ...(before.current.color ? { color: before.current.color } : {}), isEnabled: before.current.is_enabled !== false } }
    : (after.type ? { tool: 'github_org_issue_type_delete', args: { org: t.owner, typeId: after.type.id, name: args.name } } : null)),
  present: ({ after }) => ({ type: { id: after.type.id, name: after.type.name, color: after.type.color ?? null, isEnabled: after.type.is_enabled !== false } })
});

const typeDelete = defineGithubWrite({
  name: 'github_org_issue_type_delete', area: 'org', audience: ['O'],
  description: 'Delete an organization issue type permanently. Optional name checks the target; full owners need only its typeId.',
  properties: { org: ORG, typeId: { type: 'integer', minimum: 1 }, name: { type: 'string', minLength: 1, maxLength: 50 } }, required: ['typeId'],
  declarations: decl({ production: 'always' }),
  target: (a, c) => orgTarget({ owner: a.org }, c),
  read: async (args, ctx, t) => {
    await requireOrg(ctx, t.owner);
    const current = (await listOrg(ctx, t.owner, 'issue-types')).find((x) => x?.id === args.typeId) ?? null;
    if (current && (args.name !== undefined || !isOwnerConnection(ctx.connection)) && current.name !== args.name) throw refusal('name must be exactly the issue type\'s current name.');
    let used = null;
    if (current) {
      const found = await missing(async () => (await (await octo(ctx, t.owner)).request('GET /search/issues', { q: `org:${t.owner} type:"${current.name}"`, per_page: 1 })).data);
      used = Number.isInteger(found?.total_count) ? found.total_count : null;
    }
    return { current, used };
  },
  classify: ({ before }) => (before?.current ? { production: `deleting issue type "${before.current.name}" removes it from ${before.used ?? 'an unknown number of'} issues and cannot be undone` } : {}),
  summarize: ({ args, before }) => (before.current ? `DELETE issue type "${before.current.name}": used by ${before.used ?? 'an unknown number of'} issues (no undo)` : `Issue type ${args.typeId} no longer exists`),
  apply: async ({ args, ctx, target: t, before }) => {
    if (!before.current) throw refusal('The issue type no longer exists; nothing was deleted.', 404);
    return (await octo(ctx, t.owner)).request('DELETE /orgs/{org}/issue-types/{issue_type_id}', { org: t.owner, issue_type_id: args.typeId });
  },
  readAfter: async ({ args, ctx, target: t }) => ({ gone: !(await listOrg(ctx, t.owner, 'issue-types')).some((x) => x?.id === args.typeId) }),
  verify: ({ after }) => after.gone === true,
  inverse: () => null,
  present: ({ args, before }) => ({ deleted: args.typeId, name: before.current?.name ?? null, issuesAffected: before.used, restorable: false })
});

// ---- issue fields -----------------------------------------------------------------------------------------------------
const FIELD_OPTION = { type: 'object', additionalProperties: false, required: ['name', 'color'], properties: { name: { type: 'string', minLength: 1, maxLength: 50 }, color: { type: 'string', enum: COLORS }, id: { type: 'integer', minimum: 1 } } };
/** Keep every current option (with its id) unless named in removeOptions; apply edits by name; append new ones. Priority = position. */
export function mergeFieldOptions(current = [], wanted = [], remove = []) {
  const gone = new Set(remove.map(low));
  const have = new Map(current.map((o) => [low(o.name), o]));
  for (const r of remove) if (!have.has(low(r))) throw refusal(`removeOptions names "${r}", which is not an option of this field.`);
  const seen = new Set();
  for (const w of wanted) { if (seen.has(low(w.name))) throw refusal(`Option "${w.name}" is listed twice.`); seen.add(low(w.name)); if (gone.has(low(w.name))) throw refusal(`Option "${w.name}" is both kept and removed.`); }
  const out = [];
  for (const cur of current) {
    if (gone.has(low(cur.name))) continue;
    const w = wanted.find((x) => low(x.name) === low(cur.name));
    out.push({ id: cur.id, name: cur.name, color: w?.color ?? cur.color ?? 'gray' });
  }
  for (const w of wanted) if (!have.has(low(w.name))) out.push({ name: w.name, color: w.color });
  return out.map((o, i) => ({ ...o, priority: i + 1 }));
}
const fieldSave = defineGithubWrite({
  name: 'github_org_issue_field_save', area: 'org', audience: ['O'],
  description: 'Create an organization issue field (text, number, date, select) or edit one. Select options keep their ids unless named in removeOptions.',
  properties: { org: ORG, fieldId: { type: 'integer', minimum: 1 }, name: { type: 'string', minLength: 1, maxLength: 50 }, description: { type: 'string', maxLength: 200 }, dataType: { type: 'string', enum: ['text', 'date', 'single_select', 'multi_select', 'number'] },
    visibility: { type: 'string', enum: ['organization_members_only', 'all'] }, options: { type: 'array', maxItems: 50, items: FIELD_OPTION }, removeOptions: { type: 'array', maxItems: 50, items: { type: 'string', maxLength: 50 } } },
  required: [], declarations: decl(),
  target: (a, c) => orgTarget({ owner: a.org }, c),
  read: async (args, ctx, t) => {
    await requireOrg(ctx, t.owner);
    const fields = (await listOrg(ctx, t.owner, 'issue-fields')).filter(Boolean);
    const isSelect = (f) => ['single_select', 'multi_select'].includes(f);
    if (!args.fieldId) {
      if (!args.name || !args.dataType) throw refusal('A new field needs name and dataType.');
      if (isSelect(args.dataType) && !args.options?.length) throw refusal('A select field needs at least one option.');
      if (!isSelect(args.dataType) && (args.options || args.removeOptions)) throw refusal('Options only apply to select fields.');
      return { fields, current: null, clash: fields.find((f) => low(f.name) === low(args.name)) ?? null, merged: isSelect(args.dataType) ? mergeFieldOptions([], args.options) : null };
    }
    const current = fields.find((f) => f.id === args.fieldId);
    if (!current) throw refusal(`Issue field ${args.fieldId} was not found in ${t.owner}.`, 404);
    if (args.dataType && args.dataType !== current.data_type) throw refusal('A field\'s type cannot be changed.');
    if (args.name === undefined && args.description === undefined && args.visibility === undefined && !args.options && !args.removeOptions) throw refusal('Say what to change.');
    if (!isSelect(current.data_type) && (args.options || args.removeOptions)) throw refusal('Options only apply to select fields.');
    return { fields, current, clash: null, merged: isSelect(current.data_type) && (args.options || args.removeOptions) ? mergeFieldOptions(current.options ?? [], args.options, args.removeOptions) : null };
  },
  classify: () => ({}),
  summarize: ({ args, target: t, before }) => (before.current ? `Edit issue field "${before.current.name}" of ${t.owner}${before.merged ? `; options after: ${before.merged.map((o) => o.name).join(', ')}` : ''}` : `Create ${args.dataType} issue field "${args.name}" for ${t.owner}`),
  apply: async ({ args, ctx, target: t, before }) => {
    const gh = await octo(ctx, t.owner);
    const body = { ...(args.name !== undefined ? { name: args.name } : {}), ...(args.description !== undefined ? { description: args.description } : {}), ...(args.visibility ? { visibility: args.visibility } : {}), ...(before.merged ? { options: before.merged } : {}) };
    if (before.current) return gh.request('PATCH /orgs/{org}/issue-fields/{issue_field_id}', { org: t.owner, issue_field_id: before.current.id, ...body });
    if (before.clash) throw refusal(`An issue field named "${args.name}" already exists (id ${before.clash.id}); nothing was created.`);
    return gh.request('POST /orgs/{org}/issue-fields', { org: t.owner, data_type: args.dataType, ...body, name: args.name });
  },
  readAfter: async ({ ctx, target: t, before, response }) => {
    const id = before.current?.id ?? response?.data?.id;
    return { field: (await listOrg(ctx, t.owner, 'issue-fields')).find((f) => f?.id === id) ?? null };
  },
  verify: ({ args, before, after }) => {
    const f = after.field;
    if (!f || (args.name !== undefined && f.name !== args.name)) return false;
    if (args.visibility && f.visibility !== args.visibility) return false;
    if (before.merged) {
      const got = f.options ?? [];
      if (got.length !== before.merged.length || before.merged.some((m) => !got.some((g) => low(g.name) === low(m.name)))) return false;
      return before.merged.filter((m) => m.id).every((m) => got.some((g) => g.id === m.id));
    }
    return true;
  },
  inverse: ({ args, before, after, target: t }) => {
    if (!before.current) return after.field ? { tool: 'github_org_issue_field_delete', args: { org: t.owner, fieldId: after.field.id, name: args.name } } : null;
    return args.name !== undefined && args.name !== before.current.name && !before.merged ? { tool: 'github_org_issue_field_save', args: { org: t.owner, fieldId: before.current.id, name: before.current.name } } : null;
  },
  present: ({ after }) => ({ field: { id: after.field.id, name: after.field.name, dataType: after.field.data_type, visibility: after.field.visibility ?? null, options: (after.field.options ?? []).map((o) => ({ id: o.id, name: o.name })) } })
});

const fieldDelete = defineGithubWrite({
  name: 'github_org_issue_field_delete', area: 'org', audience: ['O'],
  description: 'Delete an organization issue field and its values permanently. Optional name checks the target; full owners need only its fieldId.',
  properties: { org: ORG, fieldId: { type: 'integer', minimum: 1 }, name: { type: 'string', minLength: 1, maxLength: 50 } }, required: ['fieldId'],
  declarations: decl({ production: 'always' }),
  target: (a, c) => orgTarget({ owner: a.org }, c),
  read: async (args, ctx, t) => {
    await requireOrg(ctx, t.owner);
    const current = (await listOrg(ctx, t.owner, 'issue-fields')).find((f) => f?.id === args.fieldId) ?? null;
    if (current && (args.name !== undefined || !isOwnerConnection(ctx.connection)) && current.name !== args.name) throw refusal('name must be exactly the issue field\'s current name.');
    return { current };
  },
  classify: ({ before }) => (before?.current ? { production: `deleting issue field "${before.current.name}" erases its value on every issue and cannot be undone` } : {}),
  summarize: ({ args, before }) => (before.current ? `DELETE issue field "${before.current.name}" and every value stored in it (no undo)` : `Issue field ${args.fieldId} no longer exists`),
  apply: async ({ args, ctx, target: t, before }) => {
    if (!before.current) throw refusal('The issue field no longer exists; nothing was deleted.', 404);
    return (await octo(ctx, t.owner)).request('DELETE /orgs/{org}/issue-fields/{issue_field_id}', { org: t.owner, issue_field_id: args.fieldId });
  },
  readAfter: async ({ args, ctx, target: t }) => ({ gone: !(await listOrg(ctx, t.owner, 'issue-fields')).some((f) => f?.id === args.fieldId) }),
  verify: ({ after }) => after.gone === true,
  inverse: () => null,
  present: ({ args, before }) => ({ deleted: args.fieldId, name: before.current?.name ?? null, restorable: false })
});

// ---- per-issue field values -------------------------------------------------------------------------------------------
const VALUES_ROUTE = '/repos/{owner}/{repo}/issues/{issue_number}/issue-field-values';
const readValues = async (gh, t, number) => ((await gh.request(`GET ${VALUES_ROUTE}`, { owner: t.owner, repo: t.repo, issue_number: number })).data ?? []).filter(Boolean);
const valueOf = (v) => v?.single_select_option?.name ?? (v?.multi_select_options ? v.multi_select_options.map((o) => o.name).join(',') : v?.value);
const setFields = defineGithubWrite({
  name: 'github_issue_set_fields', area: 'issue', audience: ['Op', 'O'],
  description: 'Set organization issue field values on an issue (up to 25 fields at once). Fields not listed keep their value. Subscribers are notified.',
  properties: { ...REPO_BASE, number: { type: 'integer', minimum: 1 }, fields: { type: 'array', minItems: 1, maxItems: 25, items: { type: 'object', additionalProperties: false, required: ['fieldId', 'value'], properties: { fieldId: { type: 'integer', minimum: 1 }, value: { type: ['string', 'number'] } } } } },
  required: ['number', 'fields'], declarations: decl({ confirm: 'when-needed', notifies: true }), target: repoTarget,
  read: async (args, ctx, t) => {
    if (new Set(args.fields.map((f) => f.fieldId)).size !== args.fields.length) throw refusal('Each field id may appear only once.');
    return { values: await readValues(await octo(ctx, t.owner), t, args.number) };
  },
  classify: ({ ctx, target: t }) => notifyOutsiders(ctx, { repoOwner: t.owner }),
  summarize: ({ args, target: t, before }) => `Set ${args.fields.length} issue field value(s) on ${t.owner}/${t.repo}#${args.number} (today ${before.values.length} set)`,
  apply: async ({ args, ctx, target: t, before }) => {
    const same = args.fields.every((f) => before.values.some((v) => v.issue_field_id === f.fieldId && String(valueOf(v)) === String(f.value)));
    if (same) throw refusal('Those values are already set; nothing to do.');
    const merged = new Map(before.values.map((v) => [v.issue_field_id, { field_id: v.issue_field_id, value: valueOf(v) }]));
    for (const f of args.fields) merged.set(f.fieldId, { field_id: f.fieldId, value: f.value });
    return (await octo(ctx, t.owner)).request(`PUT ${VALUES_ROUTE}`, { owner: t.owner, repo: t.repo, issue_number: args.number, issue_field_values: [...merged.values()] });
  },
  readAfter: async ({ args, ctx, target: t }) => ({ values: await readValues(await octo(ctx, t.owner), t, args.number) }),
  verify: ({ args, after }) => args.fields.every((f) => after.values.some((v) => v.issue_field_id === f.fieldId && String(valueOf(v)) === String(f.value))),
  inverse: ({ args, before, target: t }) => {
    const back = args.fields.map((f) => before.values.find((v) => v.issue_field_id === f.fieldId)).filter(Boolean);
    return back.length === args.fields.length ? { tool: 'github_issue_set_fields', args: { owner: t.owner, repo: t.repo, number: args.number, fields: back.map((v) => ({ fieldId: v.issue_field_id, value: valueOf(v) })) } } : null;
  },
  present: ({ after }) => ({ values: after.values.map((v) => ({ fieldId: v.issue_field_id, name: v.issue_field_name ?? null, value: valueOf(v) })) })
});

// ---- interaction limits -----------------------------------------------------------------------------------------------
const LIMITS = ['existing_users', 'contributors_only', 'collaborators_only'];
const EXPIRY = ['one_day', 'three_days', 'one_week', 'one_month', 'six_months'];
const limitRoute = (scope) => (scope === 'org' ? '/orgs/{org}/interaction-limits' : '/repos/{owner}/{repo}/interaction-limits');
const limitParams = (scope, t) => (scope === 'org' ? { org: t.owner } : { owner: t.owner, repo: t.repo });
const readLimit = async (gh, scope, t) => { const d = (await gh.request(`GET ${limitRoute(scope)}`, limitParams(scope, t))).data; return d?.limit ? { limit: d.limit, expires: d.expires_at ?? null } : { limit: null, expires: null }; };
const interaction = defineGithubWrite({
  name: 'github_interaction_limit_set', area: 'repo', audience: ['O'],
  description: 'Temporarily limit who may comment, open issues or open pull requests on a repository or organization, or lift the limit.',
  properties: { owner: { ...LOGIN, description: 'Repository owner / organization (default account)' }, repo: REPO_NAME, scope: { type: 'string', enum: ['repo', 'org'] }, limit: { type: 'string', enum: [...LIMITS, 'none'] }, expiry: { type: 'string', enum: EXPIRY } },
  required: ['scope', 'limit'], declarations: decl(),
  target: (a, c) => ({ owner: ownerOf(a, c), ...(a.scope === 'repo' ? { repo: a.repo } : {}), scope: a.scope === 'repo' ? 'repo' : 'org' }),
  read: async (args, ctx, t) => {
    if (args.scope === 'repo' && !args.repo) throw refusal('scope repo needs repo.');
    if (args.scope === 'org') await requireOrg(ctx, t.owner);
    return { current: await readLimit(await octo(ctx, t.owner), args.scope, t) };
  },
  classify: () => ({}),
  summarize: ({ args, target: t, before }) => `${args.limit === 'none' ? 'Lift the interaction limit' : `Limit interactions to ${args.limit}${args.expiry ? ` for ${args.expiry}` : ''}`} on ${t.owner}${t.repo ? `/${t.repo}` : ''} (today ${before.current.limit ?? 'none'})`,
  apply: async ({ args, ctx, target: t, before }) => {
    const gh = await octo(ctx, t.owner);
    if ((before.current.limit ?? 'none') === args.limit && args.limit === 'none') throw refusal('No interaction limit is set; nothing to do.');
    if (args.limit === 'none') return gh.request(`DELETE ${limitRoute(args.scope)}`, limitParams(args.scope, t));
    return gh.request(`PUT ${limitRoute(args.scope)}`, { ...limitParams(args.scope, t), limit: args.limit, ...(args.expiry ? { expiry: args.expiry } : {}) });
  },
  readAfter: async ({ args, ctx, target: t }) => ({ current: await readLimit(await octo(ctx, t.owner), args.scope, t) }),
  verify: ({ args, after }) => (after.current.limit ?? 'none') === args.limit,
  inverse: ({ args, before, target: t }) => ({ tool: 'github_interaction_limit_set', args: { owner: t.owner, ...(t.repo ? { repo: t.repo } : {}), scope: args.scope, limit: before.current.limit ?? 'none' } }),
  present: ({ args, after }) => ({ scope: args.scope, limit: after.current.limit ?? 'none', expires: after.current.expires })
});

// ---- autolinks --------------------------------------------------------------------------------------------------------
const listAutolinks = async (gh, t) => ((await gh.request('GET /repos/{owner}/{repo}/autolinks', { owner: t.owner, repo: t.repo })).data ?? []).filter(Boolean);
const autolinkSave = defineGithubWrite({
  name: 'github_repo_autolink_save', area: 'repo', audience: ['O'],
  description: 'Add an autolink reference (a key prefix like TICKET- that links to an external URL template containing <num>) to a repository.',
  properties: { ...REPO_BASE, keyPrefix: { type: 'string', minLength: 1, maxLength: 50 }, urlTemplate: { type: 'string', minLength: 10, maxLength: 500, pattern: '^https://[^\\s]*<num>[^\\s]*$' }, isAlphanumeric: { type: 'boolean' } },
  required: ['keyPrefix', 'urlTemplate'], declarations: decl(), target: repoTarget,
  read: async (args, ctx, t) => ({ links: await listAutolinks(await octo(ctx, t.owner), t) }),
  classify: () => ({}),
  summarize: ({ args, target: t }) => `Add autolink ${args.keyPrefix} -> ${args.urlTemplate} on ${t.owner}/${t.repo}`,
  apply: async ({ args, ctx, target: t, before }) => {
    if (before.links.some((l) => l.key_prefix === args.keyPrefix)) throw refusal(`An autolink for ${args.keyPrefix} already exists; delete it first to change it.`);
    return (await octo(ctx, t.owner)).request('POST /repos/{owner}/{repo}/autolinks', { owner: t.owner, repo: t.repo, key_prefix: args.keyPrefix, url_template: args.urlTemplate, is_alphanumeric: args.isAlphanumeric ?? true });
  },
  readAfter: async ({ ctx, target: t }) => ({ links: await listAutolinks(await octo(ctx, t.owner), t) }),
  verify: ({ args, after }) => after.links.some((l) => l.key_prefix === args.keyPrefix && l.url_template === args.urlTemplate),
  inverse: ({ args, after, target: t }) => { const l = after.links.find((x) => x.key_prefix === args.keyPrefix); return l ? { tool: 'github_repo_autolink_delete', args: { owner: t.owner, repo: t.repo, autolinkId: l.id } } : null; },
  present: ({ args, after }) => ({ autolink: after.links.find((l) => l.key_prefix === args.keyPrefix) ?? null })
});
const autolinkDelete = defineGithubWrite({
  name: 'github_repo_autolink_delete', area: 'repo', audience: ['O'],
  description: 'Delete an autolink reference from a repository. Existing text keeps its words; only the automatic link disappears.',
  properties: { ...REPO_BASE, autolinkId: { type: 'integer', minimum: 1 } }, required: ['autolinkId'], declarations: decl(), target: repoTarget,
  read: async (args, ctx, t) => ({ link: (await listAutolinks(await octo(ctx, t.owner), t)).find((l) => l.id === args.autolinkId) ?? null }),
  classify: () => ({}),
  summarize: ({ args, target: t, before }) => (before.link ? `Delete autolink ${before.link.key_prefix} (${before.link.url_template}) from ${t.owner}/${t.repo}` : `Autolink ${args.autolinkId} no longer exists`),
  apply: async ({ args, ctx, target: t, before }) => {
    if (!before.link) throw refusal('The autolink no longer exists; nothing was deleted.', 404);
    return (await octo(ctx, t.owner)).request('DELETE /repos/{owner}/{repo}/autolinks/{autolink_id}', { owner: t.owner, repo: t.repo, autolink_id: args.autolinkId });
  },
  readAfter: async ({ args, ctx, target: t }) => ({ gone: !(await listAutolinks(await octo(ctx, t.owner), t)).some((l) => l.id === args.autolinkId) }),
  verify: ({ after }) => after.gone === true,
  inverse: ({ before, target: t }) => (before.link ? { tool: 'github_repo_autolink_save', args: { owner: t.owner, repo: t.repo, keyPrefix: before.link.key_prefix, urlTemplate: before.link.url_template, isAlphanumeric: before.link.is_alphanumeric !== false } } : null),
  present: ({ args }) => ({ deleted: args.autolinkId })
});

const writes = [typeSave, typeDelete, fieldSave, fieldDelete, setFields, interaction, autolinkSave, autolinkDelete];
export const tools = writes.map((d) => d.tool);
export const handlers = Object.fromEntries(writes.map((d) => [d.tool.name, d.handler]));
