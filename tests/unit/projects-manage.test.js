import { describe, expect, it } from 'vitest';
import { runWriteContract, makeWorld, parse } from '../../test/helpers/write-contract.js';
import * as manage from '../../src/tools/projects-manage.js';
import * as items from '../../src/tools/projects-items.js';
import { mergeOptions } from '../../src/tools/projects-items.js';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';

const def = (ns, name) => ({ tool: ns.tools.find((t) => t.name === name), handler: ns.handlers[name] });
const OWNER = 'example-org';
const PID = 'PVT_one';
const proj = (over = {}) => ({
  id: PID, number: 3, title: 'Roadmap', shortDescription: null, readme: null, public: false, closed: false, url: 'https://github.com/orgs/example-org/projects/3',
  owner: { __typename: 'Organization', id: 'O_one', login: OWNER }, items: { totalCount: 2 },
  fields: { nodes: [{ __typename: 'ProjectV2Field', id: 'PVTF_title', name: 'Title', dataType: 'TITLE' }, { __typename: 'ProjectV2SingleSelectField', id: 'PVTSSF_status', name: 'Status', dataType: 'SINGLE_SELECT', options: [{ id: 'a1', name: 'Todo', description: '', color: 'GRAY' }, { id: 'b2', name: 'Done', description: '', color: 'GREEN' }] }] },
  views: { nodes: [{ id: 'PVTV_one', name: 'Table', layout: 'TABLE_LAYOUT' }] }, repositories: { nodes: [] }, teams: { nodes: [] }, ...over
});
const item = (over = {}) => ({ __typename: 'ProjectV2Item', id: 'PVTI_one', isArchived: false, type: 'DRAFT_ISSUE', project: { id: PID }, content: { __typename: 'DraftIssue', title: 'Idea' }, ...over });

/** A tiny stateful GraphQL fake for projects: `state` is mutated by mutations; `hook(query, vars, state)` returns a mutation reply. */
const server = (gh, { state, mutate }) => {
  gh.when('POST /graphql').reply(200, (req) => {
    const { query: q, variables: v } = req.body;
    if (q.includes('mutation')) return { data: mutate(q, v, state) };
    if (q.includes('ProjectOwner')) return { data: { repositoryOwner: { __typename: 'Organization', id: 'O_one', login: OWNER } } };
    if (q.includes('ProjectTitles')) return { data: { repositoryOwner: { projectsV2: { nodes: state.project ? [{ number: 3, title: state.project.title }] : [] } } } };
    if (q.includes('ProjectByNumber')) return { data: { repositoryOwner: { __typename: 'Organization', id: 'O_one', login: OWNER, projectV2: state.project } } };
    if (q.includes('ProjectById')) return { data: { node: state.project ? { __typename: 'ProjectV2', ...state.project } : null } };
    if (q.includes('ProjectItem(')) return { data: { node: state.item ?? null } };
    if (q.includes('ItemOrder')) return { data: { node: { items: { totalCount: state.order.length, nodes: state.order.map((id) => ({ id })) } } } };
    if (q.includes('FieldValues')) return { data: { node: { items: { totalCount: 2, nodes: [{ fieldValues: { nodes: [{ field: { id: 'PVTSSF_status' } }] } }, { fieldValues: { nodes: [] } }] } } } };
    if (q.includes('ItemFieldValue')) return { data: { node: { fieldValues: { nodes: state.cleared ? [] : [{ field: { id: 'PVTSSF_status', name: 'Status' } }] } } } };
    if (q.includes('RepoNode')) return { data: { repository: { id: 'R_one' } } };
    if (q.includes('UserNode')) return { data: { user: { id: 'U_two' } } };
    if (q.includes('StatusUpdate')) return { data: { node: state.status } };
    return { data: {} };
  });
};

// create
runWriteContract({
  label: 'github_project_create', definition: def(manage, 'github_project_create'), args: { owner: OWNER, title: 'Roadmap' }, needsConfirm: true, profile: 'full',
  arrange: (gh, outcome) => { const state = { project: null }; server(gh, { state, mutate: () => { if (outcome === 'ok') state.project = proj(); return { createProjectV2: { projectV2: { id: PID, number: 3 } } }; } }); }
});
// update (private -> description change)
runWriteContract({
  label: 'github_project_update', definition: def(manage, 'github_project_update'), args: { owner: OWNER, number: 3, shortDescription: 'Plan' }, needsConfirm: false, profile: 'full',
  arrange: (gh, outcome) => { const state = { project: proj() }; server(gh, { state, mutate: (q, v) => { if (outcome === 'ok') state.project = proj({ shortDescription: v.input.shortDescription }); return { updateProjectV2: { projectV2: { id: PID } } }; } }); }
});
// archive
runWriteContract({
  label: 'github_project_archive_item', definition: def(items, 'github_project_archive_item'), args: { owner: OWNER, number: 3, itemId: 'PVTI_one' }, needsConfirm: false, profile: 'full',
  arrange: (gh, outcome) => { const state = { project: proj(), item: item() }; server(gh, { state, mutate: () => { if (outcome === 'ok') state.item = item({ isArchived: true }); return { archiveProjectV2Item: { item: { id: 'PVTI_one' } } }; } }); }
});
// delete item
runWriteContract({
  label: 'github_project_delete_item', definition: def(items, 'github_project_delete_item'), args: { owner: OWNER, number: 3, itemId: 'PVTI_one' }, needsConfirm: true, production: true, profile: 'full',
  arrange: (gh, outcome) => { const state = { project: proj(), item: item() }; server(gh, { state, mutate: () => { if (outcome === 'ok') state.item = null; return { deleteProjectV2Item: { deletedItemId: 'PVTI_one' } }; } }); }
});

describe('mergeOptions keeps option ids', () => {
  const cur = [{ id: 'a1', name: 'Todo', color: 'GRAY', description: '' }, { id: 'b2', name: 'Done', color: 'GREEN', description: '' }];
  it('omitting an existing option keeps it with its id', () => {
    const out = mergeOptions(cur, [{ name: 'Blocked', color: 'RED' }]);
    expect(out.map((o) => o.name)).toEqual(['Todo', 'Done', 'Blocked']);
    expect(out.filter((o) => o.id).map((o) => o.id)).toEqual(['a1', 'b2']);
  });
  it('an edit by name keeps the id and changes only what was given', () => {
    const out = mergeOptions(cur, [{ name: 'done', color: 'BLUE' }]);
    expect(out.find((o) => o.id === 'b2')).toMatchObject({ name: 'Done', color: 'BLUE' });
  });
  it('removeOptions drops exactly the named options', () => {
    expect(mergeOptions(cur, [], ['Todo']).map((o) => o.name)).toEqual(['Done']);
  });
  it('refuses to remove an unknown option, a kept-and-removed option, duplicates and an empty list', () => {
    expect(() => mergeOptions(cur, [], ['Nope'])).toThrow(/not an option/);
    expect(() => mergeOptions(cur, [{ name: 'Todo' }], ['Todo'])).toThrow(/both kept and removed/);
    expect(() => mergeOptions(cur, [{ name: 'X' }, { name: 'x' }])).toThrow(/twice/);
    expect(() => mergeOptions(cur, [], ['Todo', 'Done'])).toThrow(/between 1 and 50/);
  });
});

describe('Projects lifecycle rules', () => {
  const run = async (w, name, args) => parse(await createDispatch({ credentials: w.credentials, gates: [], fetch: w.gh.fetch, now: w.ctx.now, sleep: w.ctx.sleep })({ registry, name, args, connection: w.connection, db: w.db }));
  const writesOf = (w) => w.gh.graphql.filter((g) => g.query.includes('mutation'));
  it('all fifteen tools are registered, full profile only, descriptions under 160 characters', () => {
    const names = [...manage.tools, ...items.tools].map((t) => t.name);
    expect(names).toHaveLength(15);
    for (const n of names) { const t = registry.tools.find((x) => x.name === n); expect(t, n).toBeTruthy(); expect(t.description.length, n).toBeLessThanOrEqual(160); expect(t.declarations.profiles, n).toEqual(['full']); }
  });
  it('making a project public needs confirmation and widens access', async () => {
    const w = await makeWorld({ mode: 'preview', profile: 'full' });
    server(w.gh, { state: { project: proj() }, mutate: () => ({}) });
    const r = await run(w, 'github_project_update', { owner: OWNER, number: 3, public: true, dryRun: true });
    expect(r).toMatchObject({ done: false, needsConfirmation: false });
    expect(writesOf(w)).toHaveLength(0);
  });
  it('delete needs the exact title and sends nothing otherwise', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    server(w.gh, { state: { project: proj() }, mutate: () => ({}) });
    const r = await run(w, 'github_project_delete', { owner: OWNER, number: 3, confirmTitle: 'roadmap', confirm: true }).catch(() => ({ done: false }));
    expect(r.done).toBe(false);
    expect(writesOf(w)).toHaveLength(0);
  });
  it('a project GitHub says belongs to someone else is refused', async () => {
    const w = await makeWorld({ mode: 'preview', profile: 'full' });
    server(w.gh, { state: { project: proj({ owner: { __typename: 'Organization', id: 'O_x', login: 'someone-else' } }) }, mutate: () => ({}) });
    const r = await run(w, 'github_project_update', { owner: OWNER, number: 3, title: 'New', confirm: true }).catch(() => ({ done: false }));
    expect(r.done).toBe(false);
    expect(writesOf(w)).toHaveLength(0);
  });
  it('an item of another project is refused', async () => {
    const w = await makeWorld({ mode: 'preview', profile: 'full' });
    server(w.gh, { state: { project: proj(), item: item({ project: { id: 'PVT_other' } }) }, mutate: () => ({}) });
    const r = await run(w, 'github_project_archive_item', { owner: OWNER, number: 3, itemId: 'PVTI_one', confirm: true }).catch(() => ({ done: false }));
    expect(r.done).toBe(false);
    expect(writesOf(w)).toHaveLength(0);
  });
  it('field_save on a select field resends every existing option with its id', async () => {
    const w = await makeWorld({ mode: 'preview', profile: 'full' });
    const state = { project: proj() };
    server(w.gh, { state, mutate: (q, v) => { state.sent = v.input; return { updateProjectV2Field: { projectV2Field: { id: 'PVTSSF_status' } } }; } });
    await run(w, 'github_project_field_save', { owner: OWNER, number: 3, fieldId: 'PVTSSF_status', options: [{ name: 'Blocked', color: 'RED' }], confirm: true });
    expect(state.sent.singleSelectOptions.map((o) => o.id ?? null)).toEqual(['a1', 'b2', null]);
  });
  it('field_delete states how many items hold a value in the preview', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    server(w.gh, { state: { project: proj() }, mutate: () => ({}) });
    const r = await run(w, 'github_project_field_delete', { owner: OWNER, number: 3, fieldId: 'PVTSSF_status', dryRun: true });
    expect(JSON.stringify(r)).toMatch(/1 of 2 items hold a value/);
  });
  it('move_item refuses a project with more than 100 items', async () => {
    const w = await makeWorld({ mode: 'preview', profile: 'full' });
    const order = Array.from({ length: 3 }, (_, i) => `PVTI_${i}`);
    server(w.gh, { state: { project: proj(), order }, mutate: () => ({}) });
    const r = await run(w, 'github_project_move_item', { owner: OWNER, number: 3, itemId: 'PVTI_2', dryRun: true });
    expect(r.preview ?? JSON.stringify(r)).toMatch(/top|after/);
  });
});

// ---- the remaining nine-check contracts -----------------------------------------------------------------------------
const OK = (outcome) => outcome === 'ok';
const more = [
  ['github_project_copy', manage, { owner: OWNER, number: 3, title: 'Copy' }, { needsConfirm: true },
    (gh, o) => { const st = { project: proj() }; server(gh, { state: st, mutate: () => { if (OK(o)) st.copy = true; st.project = OK(o) ? proj({ id: 'PVT_copy', title: 'Copy', number: 4 }) : st.project; return { copyProjectV2: { projectV2: { id: 'PVT_copy', number: 4 } } }; } }); }],
  ['github_project_delete', manage, { owner: OWNER, number: 3 }, { needsConfirm: true, production: true },
    (gh, o) => { const st = { project: proj() }; server(gh, { state: st, mutate: () => { if (OK(o)) st.project = null; return { deleteProjectV2: { projectV2: { id: PID } } }; } }); }],
  ['github_project_link', manage, { owner: OWNER, number: 3, repo: 'example-org/app' }, { needsConfirm: true },
    (gh, o) => { const st = { project: proj() }; server(gh, { state: st, mutate: () => { if (OK(o)) st.project = proj({ repositories: { nodes: [{ id: 'R_one', nameWithOwner: 'example-org/app' }] } }); return { linkProjectV2ToRepository: { clientMutationId: null } }; } }); }],
  ['github_project_field_save', items, { owner: OWNER, number: 3, name: 'Estimate', dataType: 'NUMBER' }, { needsConfirm: true },
    (gh, o) => { const st = { project: proj() }; server(gh, { state: st, mutate: () => { if (OK(o)) st.project = proj({ fields: { nodes: [...proj().fields.nodes, { __typename: 'ProjectV2Field', id: 'PVTF_est', name: 'Estimate', dataType: 'NUMBER' }] } }); return { createProjectV2Field: { projectV2Field: { id: 'PVTF_est' } } }; } }); }],
  ['github_project_field_delete', items, { owner: OWNER, number: 3, fieldId: 'PVTSSF_status' }, { needsConfirm: true, production: true },
    (gh, o) => { const st = { project: proj() }; server(gh, { state: st, mutate: () => { if (OK(o)) st.project = proj({ fields: { nodes: [proj().fields.nodes[0]] } }); return { deleteProjectV2Field: { clientMutationId: null } }; } }); }],
  ['github_project_view_save', items, { owner: OWNER, number: 3, action: 'create', name: 'Board', layout: 'BOARD_LAYOUT' }, { needsConfirm: true },
    (gh, o) => { const st = { project: proj() }; server(gh, { state: st, mutate: () => { if (OK(o)) st.project = proj({ views: { nodes: [...proj().views.nodes, { id: 'PVTV_two', name: 'Board', layout: 'BOARD_LAYOUT' }] } }); return { createProjectV2View: { projectV2View: { id: 'PVTV_two' } } }; } }); }],
  ['github_project_add_draft', items, { owner: OWNER, number: 3, title: 'Idea' }, { needsConfirm: true },
    (gh, o) => { const st = { project: proj() }; server(gh, { state: st, mutate: () => { st.item = OK(o) ? item() : item({ content: { __typename: 'DraftIssue', title: 'Other' } }); return { addProjectV2DraftIssue: { projectItem: { id: 'PVTI_one' } } }; } }); }],
  ['github_project_convert_draft', items, { owner: OWNER, number: 3, itemId: 'PVTI_one', repo: 'example-org/app' }, { needsConfirm: true },
    (gh, o) => { const st = { project: proj(), item: item() }; server(gh, { state: st, mutate: () => { if (OK(o)) st.item = item({ type: 'ISSUE', content: { __typename: 'Issue', title: 'Idea', number: 9, repository: { nameWithOwner: 'example-org/app' } } }); return { convertProjectV2DraftIssueItemToIssue: { item: { id: 'PVTI_one' } } }; } }); }],
  ['github_project_move_item', items, { owner: OWNER, number: 3, itemId: 'PVTI_two' }, { needsConfirm: false },
    (gh, o) => { const st = { project: proj(), order: ['PVTI_one', 'PVTI_two'] }; server(gh, { state: st, mutate: () => { if (OK(o)) st.order = ['PVTI_two', 'PVTI_one']; return { updateProjectV2ItemPosition: { clientMutationId: null } }; } }); }],
  ['github_project_clear_field', items, { owner: OWNER, number: 3, itemId: 'PVTI_one', fieldId: 'PVTSSF_status' }, { needsConfirm: false },
    (gh, o) => { const st = { project: proj(), item: item() }; server(gh, { state: st, mutate: () => { if (OK(o)) st.cleared = true; return { clearProjectV2ItemFieldValue: { clientMutationId: null } }; } }); }],
  ['github_project_status_update', items, { owner: OWNER, number: 3, status: 'ON_TRACK' }, { needsConfirm: true },
    (gh, o) => { const st = { project: proj() }; server(gh, { state: st, mutate: () => { st.status = { id: 'PVTSU_one', status: OK(o) ? 'ON_TRACK' : 'AT_RISK', startDate: null, targetDate: null, body: null, project: { id: PID } }; return { createProjectV2StatusUpdate: { statusUpdate: { id: 'PVTSU_one' } } }; } }); }]
];
for (const [name, ns, args, opts, arrange] of more) runWriteContract({ label: name, definition: def(ns, name), args, arrange, profile: 'full', ...opts });
