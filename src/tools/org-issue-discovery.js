import { redact } from './util.js';
// PAR-2: explicit, bounded org-wide issue field and type discovery.
// These are read operations: the matching write tools already live in org-planning.js.
import { defineRead } from './define-read.js';
import { orgReader } from './org-read.js';

const OWNER = { type: 'string', minLength: 1, maxLength: 39,
  description: 'Connected organization (defaults to the active GitHub account)' };
const MAX = { type: 'integer', minimum: 1, maximum: 100, description: 'Maximum returned items (default 50)' };
const cap = (s, n = 250) => typeof s === 'string' ? redact(s).slice(0, n) : null;
const nonnegative = (x) => Number.isSafeInteger(x) && x >= 0 ? x : null;
const text = (s, n) => cap(s, n);

const typeView = (x) => ({
  id: nonnegative(x.id), name: text(x.name, 100), description: text(x.description, 250),
  color: text(x.color, 30), is_enabled: x.is_enabled !== false
});
const fieldView = (x) => ({
  id: nonnegative(x.id), name: text(x.name, 100), description: text(x.description, 250),
  data_type: text(x.data_type, 40), visibility: text(x.visibility, 50),
  options: Array.isArray(x.options) ? x.options.slice(0, 50).map((o) => ({
    id: nonnegative(o.id), name: text(o.name, 100), description: text(o.description, 150),
    color: text(o.color, 20), priority: nonnegative(o.priority)
  })) : []
});

function definition(name, kind, route, projection) {
  return defineRead({
    name, area: 'org', audience: ['B', 'O', 'Op'],
    description: 'List a connected organization\'s ' + kind + ', including names, IDs and options, with an explicit result cap.',
    properties: { owner: OWNER, max: MAX },
    handler: (args, ctx) => orgReader(args, ctx, async (gh, org) => {
      const raw = (await gh.request(route, { org })).data;
      if (!Array.isArray(raw)) throw new TypeError('GitHub did not return an organization ' + kind + ' list.');
      if (raw.length > 500) throw new TypeError('GitHub returned an unusually large ' + kind + ' list.');
      const max = args.max ?? 50;
      const capped = raw.length > max;
      const items = raw.slice(0, max).map(projection);
      if (items.some(x => x.id === null || !x.name))
        throw new TypeError('GitHub returned an invalid ' + kind + ' record.');
      return { org, count: items.length, total: raw.length, complete: !capped, items,
        ...(capped ? { warning: 'Only the first ' + max + ' ' + kind + ' are shown.' } : {}) };
    })
  });
}
export const orgListIssueTypes = definition('github_org_list_issue_types', 'issue types',
  'GET /orgs/{org}/issue-types', typeView);
export const orgListIssueFields = definition('github_org_list_issue_fields', 'issue fields',
  'GET /orgs/{org}/issue-fields', fieldView);
export const tools = [orgListIssueTypes.tool, orgListIssueFields.tool];
export const handlers = Object.fromEntries([
  [orgListIssueTypes.tool.name, orgListIssueTypes.handler],
  [orgListIssueFields.tool.name, orgListIssueFields.handler]
]);
