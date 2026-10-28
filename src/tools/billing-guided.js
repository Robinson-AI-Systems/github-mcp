import { isOwnerConnection } from '../core/authority.js';
// O-4 owner-authority correction: provider-backed budget deletion and Codespaces access.
// The implementing agent has no license to use these endpoints on a real account.
// End users with actual delegated GitHub permissions can execute them through the
// normal confirmation, production, scoped-spend and one-send change journal.
import { defineGithubWrite } from './define-github-write.js';
import { ownerOf, octo, missing, refusal } from './github-write.js';
import { budgetInventory } from './billing-read.js';

const OWNER = { type: 'string', maxLength: 39 };
const ID = { type: 'string', minLength: 8, maxLength: 80 };
const LOGIN = { type: 'string', minLength: 1, maxLength: 39 };
const USERS = { type: 'array', minItems: 1, maxItems: 20, uniqueItems: true, items: LOGIN };
const org = (a, c) => ({ owner: ownerOf(a, c), scope: 'org', kind: 'org-billing' });
const BUDGETS = '/organizations/{org}/settings/billing/budgets';
const budget = (c, t, id) => missing(async () =>
  (await (await octo(c, t.owner)).request('GET ' + BUDGETS + '/{budget_id}',
    { org: t.owner, budget_id: id })).data);
const inventory = async (c, t) => {
  const x = await budgetInventory(await octo(c, t.owner), t.owner, 500);
  if (!x.complete) throw refusal('A complete budget inventory is required to change spending controls.');
  return x.budgets;
};
const budgetIds = (rows) => rows.map((x) => x.id);

export const deleteBudget = defineGithubWrite({
  name: 'github_billing_delete_budget', area: 'billing', audience: ['O'],
  description: 'Delete an exact verified budget with unbounded-cost disclosure, one-call owner execution and independent absence readback.',
  properties: { owner: OWNER, budgetId: ID, confirmBudgetId: ID },
  required: ['budgetId'],
  declarations: { production: 'always', confirm: 'always', spend: true, profiles: ['full'] },
  target: org,
  read: async (a, c, t) => {
    if ((a.confirmBudgetId !== undefined || !isOwnerConnection(c.connection)) && a.budgetId !== a.confirmBudgetId)
      throw refusal('Type the exact budget ID twice before deleting spending protection.');
    const current = await budget(c, t, a.budgetId);
    // After an earlier successful delete, the original request must still
    // reach the shared request-key journal and replay without a second DELETE.
    // A genuinely new request with an absent budget is rejected by apply.
    if (!current) return { current: null, otherIds: [] };
    if (current.id !== a.budgetId)
      throw refusal('The exact budget identity could not be verified.');
    const budgets = await inventory(c, t);
    if (!budgetIds(budgets).includes(a.budgetId))
      throw refusal('The budget inventory and exact budget record disagree.');
    return { current, otherIds: budgetIds(budgets).filter((id) => id !== a.budgetId) };
  },
  // Removing an enforced billing ceiling can expose unlimited future charges.
  // This is NOT a fabricated zero-dollar transaction or a known bounded cost.
  price: () => null,
  classify: () => ({ production: 'deletes an organization spending control, which can permit unbounded future billing' }),
  summarize: ({ args: a, target: t, before: b }) =>
    'DELETE budget ' + a.budgetId + ' in ' + t.owner + ', amount $' +
    (b.current?.budget_amount ?? 'already removed') + ', enforcement ' + String(b.current?.prevent_further_usage ?? 'unknown') +
    '; remaining budgets are NOT proof of an effective future charge limit',
  apply: ({ args: a, ctx, target: t, before: b }) => {
    if (!b.current) throw refusal('The exact budget is already absent; no deletion sent.', 404);
    return octo(ctx, t.owner).then((gh) => gh.request('DELETE ' + BUDGETS + '/{budget_id}',
      { org: t.owner, budget_id: a.budgetId }));
  },
  readAfter: async ({ args: a, ctx, target: t, response: r }) => {
    if (r?.data?.budget_id !== a.budgetId)
      throw refusal('GitHub did not acknowledge the exact deleted budget ID.');
    return { exact: await budget(ctx, t, a.budgetId),
      remaining: await inventory(ctx, t) };
  },
  verify: ({ args: a, before: b, after: x }) => !!x && x.exact === null &&
    !budgetIds(x.remaining).includes(a.budgetId) &&
    b.otherIds.every((id) => budgetIds(x.remaining).includes(id)),
  inverse: () => null,
  present: ({ args: a, after: x }) => ({
    deletedBudgetId: a.budgetId,
    otherBudgetCount: x?.remaining?.length ?? null,
    warning: 'Deleting a budget does not guarantee another budget will cap GitHub charges.'
  })
});

const VISIBILITY = ['disabled', 'selected_members', 'all_members',
  'all_members_and_outside_collaborators'];
const ACCESS = '/orgs/{org}/codespaces/access';
export const setCodespaceAccess = defineGithubWrite({
  name: 'github_codespace_set_org_access', area: 'codespace', audience: ['O'],
  description: 'Set genuine organization Codespaces access with metered-cost warning and explicit unverified provider acknowledgement.',
  properties: {
    owner: OWNER, visibility: { type: 'string', enum: VISIBILITY },
    usernames: USERS,
    replaceSelectedUsers: { type: 'boolean', description: 'Explicitly replace the existing selected-member list, which the GitHub API cannot read back.' }
  },
  required: ['visibility'],
  declarations: { production: 'always', confirm: 'always', spend: true, accessWidening: true, profiles: ['full'] },
  target: (a, c) => ({ ...org(a, c), kind: 'org-codespaces-access' }),
  read: async (a, c, t) => {
    if (a.visibility === 'selected_members' && (!a.usernames?.length || (a.replaceSelectedUsers !== true && (a.replaceSelectedUsers !== undefined || !isOwnerConnection(c.connection)))))
      throw refusal('Selected members need exact usernames and replaceSelectedUsers=true: GitHub replaces the old unreadable list.');
    if (a.visibility !== 'selected_members' && a.usernames?.length)
      throw refusal('Only selected_members mode accepts an exact user list.');
    const gh = await octo(c, t.owner);
    const identity = (await gh.request('GET /orgs/{org}', { org: t.owner })).data;
    if (!identity || identity.login?.toLowerCase() !== t.owner.toLowerCase())
      throw refusal('The organization identity could not be verified.');
    // A selected member must exist in this exact organization. We never try to
    // read an undocumented policy endpoint or assume its current selected list.
    for (const username of a.usernames ?? []) {
      const member = await gh.request('GET /orgs/{org}/memberships/{username}',
        { org: t.owner, username }).then((r) => r.data, () => null);
      if (member?.state !== 'active')
        throw refusal('Selected Codespaces user is not a verified active organization member.');
    }
    return { organization: identity.login, selectedUserCount: a.usernames?.length ?? 0 };
  },
  price: ({ args: a }) => a.visibility === 'disabled' ? 0 : null,
  classify: ({ args: a }) => ({
    production: 'changes organization-paid Codespaces access and possible ongoing compute/storage charges',
    accessWidening: a.visibility === 'disabled' ? null :
      'grants Codespaces access to ' + (a.visibility === 'selected_members' ? a.usernames.join(', ') : a.visibility)
  }),
  summarize: ({ args: a, target: t }) =>
    'SET organization Codespaces access for ' + t.owner + ' to ' + a.visibility +
    (a.usernames?.length ? '; REPLACE selected list with ' + a.usernames.join(', ') : '') +
    '; provider has no policy GET for independent verification; bills can continue without a hard cap',
  apply: ({ args: a, ctx, target: t }) => octo(ctx, t.owner).then((gh) =>
    gh.request('PUT ' + ACCESS, {
      org: t.owner, visibility: a.visibility,
      ...(a.visibility === 'selected_members' ? { selected_usernames: a.usernames } : {})
    })),
  readAfter: async ({ response: r }) => {
    if (r?.status !== 204)
      throw refusal('GitHub did not supply its expected 204 acknowledgement.');
    return { acknowledged: true, independentlyVerified: false };
  },
  // GitHub documents no GET for the organization policy. Never claim the
  // accepted PUT was independently confirmed by echoing our own input.
  verify: () => false,
  inverse: () => null,
  present: ({ args: a, target: t, after: x }) => ({
    requestedVisibility: a.visibility, acknowledged: x?.acknowledged === true,
    verified: false, verifyInGithub: 'https://github.com/organizations/' +
      encodeURIComponent(t.owner) + '/settings/codespaces',
    warning: 'GitHub acknowledged the request but provides no policy GET. Independently check the saved settings before relying on this change.'
  })
});

export const tools = [deleteBudget.tool, setCodespaceAccess.tool];
export const handlers = Object.fromEntries([
  [deleteBudget.tool.name, deleteBudget.handler],
  [setCodespaceAccess.tool.name, setCodespaceAccess.handler]
]);
