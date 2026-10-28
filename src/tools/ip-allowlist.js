// IP allow-list entries: exact enrolled owner, current provider authority, one send and independent node readback.
import { isIP } from 'node:net';
import { createHash } from 'node:crypto';
import { defineRead } from './define-read.js';
import { defineGithubWrite } from './define-github-write.js';
import { ownerOf, octo, refusal } from './github-write.js';
import { requireEnterprise, ENTERPRISE_SLUG } from '../github/enterprise-access.js';
import { graphql } from '../github/client.js';
import { redact, containsCredential } from '../github/content-protection.js';
const OWNER = { type: 'string', minLength: 1, maxLength: 39 };
const ID = { type: 'string', minLength: 1, maxLength: 256 };
const VALUE = { type: 'string', minLength: 3, maxLength: 64 };
const NAME = { type: ['string', 'null'], maxLength: 256 };
const target = (a, c) => {
 if (containsCredential(JSON.stringify(a))) throw new TypeError('Credential-shaped values belong in protected setup, not IP policy arguments.');
 const owner = ownerOf(a, c);
 if (!c.connection.accounts?.some(x => x.toLowerCase() === owner.toLowerCase())) throw new TypeError('IP allow-list owner is outside this connection.');
 if ((c.connection.pass || c.connection.kind === 'pass') && c.connection.repos?.length) throw new TypeError('An account-wide IP allow list is outside this repository-restricted pass.');
 return { owner, scope: 'org', kind: 'ip-allow-list', enterprise: a.enterprise ?? null };
};
const properties = { owner: OWNER, enterprise: ENTERPRISE_SLUG };
const nameHash = name => createHash('sha256').update(JSON.stringify(name || null)).digest('hex');
function range(value) {
 const [address, prefix, extra] = String(value).split('/'); const family = isIP(address);
 if (!family || extra !== undefined || prefix !== undefined && (!/^\d{1,3}$/.test(prefix) || Number(prefix) > (family === 4 ? 32 : 128))) throw new TypeError('Use an IPv4/IPv6 address or canonical network CIDR.');
 return value;
}
async function client(c, t) {
 if (t.enterprise) return requireEnterprise(c, t.enterprise, { scope: 'admin:enterprise' });
 if ((await c.db.getAccount(t.owner))?.account_type !== 'Organization') throw refusal('Name an enrolled organization, or provide an administered enterprise slug.');
 return octo(c, t.owner);
}
const OWNER_QUERY = 'query IpOwner($slug: String!) { enterprise(slug: $slug) { id slug } }';
const ORG_QUERY = 'query IpOwnerOrganization($login: String!) { organization(login: $login) { id login } }';
async function owner(c, t) {
 const gh = await client(c, t);
 const result = await graphql(gh, t.enterprise ? OWNER_QUERY : ORG_QUERY, t.enterprise ? { slug: t.enterprise } : { login: t.owner });
 const value = t.enterprise ? result.enterprise : result.organization;
 if (!value?.id || String(t.enterprise ? value.slug : value.login).toLowerCase() !== (t.enterprise ?? t.owner).toLowerCase()) throw refusal('GitHub did not verify the exact IP allow-list owner.');
 return { id: value.id, type: t.enterprise ? 'Enterprise' : 'Organization', label: t.enterprise ?? t.owner };
}
const FIELDS = '__typename id allowListValue isActive name owner { __typename ... on Enterprise { id } ... on Organization { id } ... on App { id } }';
const ENTRY_QUERY = `query IpEntry($id: ID!) { node(id: $id) { __typename ... on IpAllowListEntry { ${FIELDS} } } }`;
async function rawEntry(c, t, id, parent) {
 const node = (await graphql(await client(c, t), ENTRY_QUERY, { id })).node;
 if (node === null) return null;
 if (node?.__typename !== 'IpAllowListEntry' || node.id !== id || node.owner?.id !== parent.id || node.owner?.__typename !== parent.type) throw refusal('IP entry identity does not belong to the requested owner.');
 if (typeof node.allowListValue !== 'string' || typeof node.isActive !== 'boolean' || !Object.hasOwn(node, 'name') || node.name !== null && typeof node.name !== 'string') throw refusal('GitHub returned an incomplete IP entry; nothing can safely overwrite it.');
 range(node.allowListValue);
 return node;
}
const view = node => node && ({ id: node.id, value: node.allowListValue, active: node.isActive, name: node.name === null ? null : redact(node.name), name_hash: nameHash(node.name), name_exact: node.name === null || redact(node.name) === node.name, untrusted: true });
const equal = (a,b) => a?.id === b?.id && a?.value === b?.value && a?.active === b?.active && a?.name_hash === b?.name_hash;
const declaration = { production: 'always', confirm: 'always', accessWidening: true, cred: 'I,M', profiles: ['full'] };
const listed = defineRead({
 name: 'github_ip_allowlist_list', area: 'enterprise', audience: ['O'],
 description: 'Page IP allow-list entries for an enrolled organization or administered enterprise; expose real cursors and owner identity.',
 properties: { ...properties, cursor: { type: 'string', maxLength: 512 }, max: { type: 'integer', minimum: 1, maximum: 100 } },
 handler: async (a,c) => {
  const t = target(a,c), parent = await owner(c,t), gh = await client(c,t);
  const selection = `ipAllowListEntries(first: $first, after: $after) { nodes { ${FIELDS} } pageInfo { hasNextPage endCursor } }`;
  const query = t.enterprise ? `query IpEntries($slug: String!, $first: Int!, $after: String) { enterprise(slug: $slug) { id ownerInfo { ${selection} } } }` : `query IpEntriesOrganization($login: String!, $first: Int!, $after: String) { organization(login: $login) { id ${selection} } }`;
  const data = await graphql(gh, query, { ...(t.enterprise ? { slug: t.enterprise } : { login: t.owner }), first: a.max ?? 30, after: a.cursor ?? null });
  const container = t.enterprise ? data.enterprise : data.organization, page = t.enterprise ? container?.ownerInfo?.ipAllowListEntries : container?.ipAllowListEntries;
  if (container?.id !== parent.id || !Array.isArray(page?.nodes) || typeof page.pageInfo?.hasNextPage !== 'boolean' || page.pageInfo.hasNextPage && !page.pageInfo.endCursor) throw refusal('GitHub returned an incomplete IP inventory; absence is not verified.');
  const items = page.nodes.map(node => {
   if (!node?.id || node.__typename !== 'IpAllowListEntry' || typeof node.allowListValue !== 'string' || typeof node.isActive !== 'boolean' || !Object.hasOwn(node,'name') || node.name !== null && typeof node.name !== 'string') throw refusal('GitHub returned an incomplete IP entry; inventory absence is not verified.');
   range(node.allowListValue);
   if (node?.owner?.id !== parent.id || node.owner.__typename !== parent.type) throw refusal('IP inventory contains an entry outside its verified owner.');
   return view(node);
  });
  return { owner: parent, items, next_cursor: page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null, complete: !page.pageInfo.hasNextPage, untrusted: true };
 }
});
const save = defineGithubWrite({
 name: 'github_ip_allowlist_save', area: 'enterprise', audience: ['O'],
 description: 'Create or update an exact IP allow-list entry with owner proof, concurrent-change check, omitted-field preservation and readback.',
 properties: { ...properties, entryId: ID, value: VALUE, active: { type: 'boolean' }, name: NAME }, declarations: declaration,
 target: (a,c) => { if (a.value !== undefined) range(a.value); if (!a.entryId && a.value === undefined) throw new TypeError('A new IP entry requires value; an update requires entryId.'); return target(a,c); },
 read: async (a,c,t) => { const parent = await owner(c,t); const entry = a.entryId ? await rawEntry(c,t,a.entryId,parent) : null; if (a.entryId && !entry) throw refusal('IP entry no longer exists.',404); return { owner: parent, entry: view(entry) }; },
 classify: ({ before }) => ({ production: 'IP allow lists control access to this account', accessWidening: `IP entry change for ${before?.owner?.label ?? 'the requested owner'}; an incorrect network can widen access or lock users out` }),
 summarize: ({ args:a, before:b }) => `${a.entryId ? 'Update' : 'Create'} IP allow-list entry in ${b.owner.label}: ${a.value ?? b.entry?.value}; active=${a.active ?? b.entry?.active ?? true}`,
 apply: async ({ args:a, ctx:c, target:t, before:b }) => {
  const parent = await owner(c,t); if (parent.id !== b.owner.id) throw refusal('The IP owner changed.');
  const current = a.entryId ? await rawEntry(c,t,a.entryId,parent) : null;
  if (a.entryId && !equal(view(current),b.entry)) throw refusal('IP entry changed; refresh before updating it.');
  const input = { ...(a.entryId ? { ipAllowListEntryId: a.entryId } : { ownerId: parent.id }), allowListValue: a.value ?? current?.allowListValue, isActive: a.active ?? current?.isActive ?? true, name: a.name !== undefined ? a.name : current?.name ?? null };
  const mutation = a.entryId ? 'updateIpAllowListEntry' : 'createIpAllowListEntry';
  const type = a.entryId ? 'UpdateIpAllowListEntryInput' : 'CreateIpAllowListEntryInput';
  const data = await graphql(await client(c,t), `mutation IpEntrySave($input: ${type}!) { ${mutation}(input: $input) { ipAllowListEntry { id } } }`, { input });
  return { entryId: data[mutation]?.ipAllowListEntry?.id ?? null };
 },
 readAfter: async ({ ctx:c, target:t, before:b, response:r }) => { if (!r.entryId) throw refusal('GitHub did not return an independently readable entry ID.'); const parent = await owner(c,t); if (parent.id !== b.owner.id) throw refusal('IP owner changed.'); return view(await rawEntry(c,t,r.entryId,parent)); },
 verify: ({ args:a, before:b, after:x }) => !!x && (!a.entryId || x.id === a.entryId) && x.value === (a.value ?? b.entry?.value) && x.active === (a.active ?? b.entry?.active ?? true) && x.name_hash === (a.name !== undefined ? nameHash(a.name) : b.entry?.name_hash ?? nameHash(null)),
 present: ({ after }) => ({ entry: after, independently_read: !!after })
});
const remove = defineGithubWrite({
 name: 'github_ip_allowlist_delete', area: 'enterprise', audience: ['O'],
 description: 'Delete one verified IP allow-list entry and independently confirm absence; removing the wrong network can lock users out.',
 properties: { ...properties, entryId: ID }, required: ['entryId'], declarations: { ...declaration, destructive: true }, target,
 read: async (a,c,t) => { const parent = await owner(c,t); return { owner: parent, entry: view(await rawEntry(c,t,a.entryId,parent)) }; },
 classify: () => ({ destructive: true, production: 'removing an allowed network may lock users out', accessWidening: 'account-wide IP access policy changes' }),
 summarize: ({ args:a, before:b }) => `Delete IP allow-list entry ${a.entryId} from ${b.owner.label}`,
 apply: async ({ args:a, ctx:c, target:t, before:b }) => {
  const parent = await owner(c,t); if (parent.id !== b.owner.id) throw refusal('IP owner changed.');
  const current = view(await rawEntry(c,t,a.entryId,parent));
  if (!current || !equal(current,b.entry)) throw refusal('IP entry changed or no longer exists; nothing deleted.');
  return graphql(await client(c,t), 'mutation IpEntryDelete($input: DeleteIpAllowListEntryInput!) { deleteIpAllowListEntry(input: $input) { clientMutationId } }', { input: { ipAllowListEntryId: a.entryId } });
 },
 readAfter: async ({ args:a, ctx:c, target:t, before:b }) => { const parent = await owner(c,t); if (parent.id !== b.owner.id) throw refusal('IP owner changed.'); return { entry: view(await rawEntry(c,t,a.entryId,parent)) }; },
 verify: ({ after }) => after?.entry === null, present: ({ after }) => ({ deleted: after?.entry === null })
});
export const tools = [listed.tool,save.tool,remove.tool];
export const handlers = Object.fromEntries([listed,save,remove].map(t=>[t.tool.name,t.handler]));
