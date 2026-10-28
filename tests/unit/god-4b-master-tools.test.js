// GOD-4 B: Copilot Spaces and the small master-token tools — nine write-contract checks per write, request shapes, and the plain
// answer when the master token is missing.
import { describe, expect, it } from 'vitest';
import { runWriteContract, makeWorld, parse } from '../../test/helpers/write-contract.js';
import * as spaces from '../../src/tools/copilot-spaces.js';
import * as small from '../../src/tools/small-master.js';

const withMaster = (scopes) => async (w) => {
  w.credentials.masterStatus = async () => ({ enrolled: true, scopes, expires_at: null });
  const base = w.credentials.token.bind(w.credentials);
  w.credentials.token = async (o) => (o.cred === 'M' ? 'ghp_FAKEmaster' : base(o));
};
const ME = { login: 'example-owner', id: 1, type: 'User', node_id: 'U1', avatar_url: 'https://example.test/a', gravatar_id: '', url: 'https://api.github.com/users/example-owner', html_url: 'https://github.com/example-owner', followers_url: 'x', following_url: 'x', gists_url: 'x', starred_url: 'x', subscriptions_url: 'x', organizations_url: 'x', repos_url: 'x', events_url: 'x', received_events_url: 'x', site_admin: false };
const SP = (over = {}) => ({ id: 11, number: 4, name: 'Plans', description: 'd', general_instructions: 'be brief', base_role: 'no_access', owner: ME, creator: ME, created_at: '2026-10-23T00:00:00Z', updated_at: '2026-10-23T00:00:00Z', html_url: 'https://github.com/copilot/spaces/example-owner/4', api_url: 'https://api.github.com/users/example-owner/copilot-spaces/4', ...over });
const seq = (gh, route, steps) => gh.when(route).replySequence(steps.map(([status, body]) => ({ status, body })));
const NF = [404, { message: 'Not Found' }];
const U = '/users/{username}/copilot-spaces';
const opts = (scopes) => ({ profile: 'full', needsConfirm: true, production: true, prepare: withMaster(scopes) });
const defs = (mod, name) => ({ tool: mod.tools.find((t) => t.name === name), handler: mod.handlers[name] });
const sp = (name) => defs(spaces, name);
const user = (gh) => gh.when('GET /user').reply(200, ME);

runWriteContract({ ...opts(['user', 'repo']), label: 'github_copilot_space_save (create)', definition: sp('github_copilot_space_save'), args: { name: 'Plans', generalInstructions: 'be brief' },
  arrange(gh, o) { user(gh); gh.when(`POST ${U}`).reply(201, SP()); gh.when(`GET ${U}/{space_number}`).reply(200, SP({ general_instructions: o === 'ok' ? 'be brief' : 'other' })); } });
runWriteContract({ ...opts(['user', 'repo']), label: 'github_copilot_space_save (edit)', definition: sp('github_copilot_space_save'), args: { spaceNumber: 4, name: 'Renamed' },
  arrange(gh, o) { user(gh); seq(gh, `GET ${U}/{space_number}`, [[200, SP()], [200, SP({ name: o === 'ok' ? 'Renamed' : 'Plans' })]]); gh.when(`PUT ${U}/{space_number}`).reply(200, SP({ name: 'Renamed' })); } });
runWriteContract({ ...opts(['user', 'repo']), label: 'github_copilot_space_delete', definition: sp('github_copilot_space_delete'), args: { spaceNumber: 4 },
  arrange(gh, o) { user(gh); seq(gh, `GET ${U}/{space_number}`, o === 'ok' ? [[200, SP()], NF] : [[200, SP()], [200, SP()]]); gh.when(`DELETE ${U}/{space_number}`).reply(204, null); } });
const person = { ...ME, login: 'alice', id: 9, actor_type: 'User' };
runWriteContract({ ...opts(['user', 'repo']), label: 'github_copilot_space_set_collaborator (add)', accessWidening: true, definition: sp('github_copilot_space_set_collaborator'), args: { spaceNumber: 4, actorType: 'User', actor: 'alice', role: 'reader' },
  arrange(gh, o) { user(gh); gh.when(`GET ${U}/{space_number}`).reply(200, SP());
    seq(gh, `GET ${U}/{space_number}/collaborators`, [[200, { collaborators: [] }], [200, { collaborators: o === 'ok' ? [{ ...person, role: 'reader' }] : [] }]]);
    gh.when(`POST ${U}/{space_number}/collaborators`).reply(201, { ...person, role: 'reader' }); } });
runWriteContract({ ...opts(['user', 'repo']), label: 'github_copilot_space_remove_collaborator', definition: sp('github_copilot_space_remove_collaborator'), args: { spaceNumber: 4, actorType: 'User', actor: 'alice' },
  arrange(gh, o) { user(gh); gh.when(`GET ${U}/{space_number}`).reply(200, SP());
    seq(gh, `GET ${U}/{space_number}/collaborators`, o === 'ok' ? [[200, { collaborators: [{ ...person, role: 'writer' }] }], [200, { collaborators: [] }]] : [[200, { collaborators: [{ ...person, role: 'writer' }] }], [200, { collaborators: [{ ...person, role: 'writer' }] }]]);
    gh.when(`DELETE ${U}/{space_number}/collaborators/{actor_type}/{actor_identifier}`).reply(204, null); } });
const RES = (md) => ({ id: 70, resource_type: 'free_text', metadata: md, created_at: '2026-10-23T00:00:00Z', updated_at: '2026-10-23T00:00:00Z' });
runWriteContract({ ...opts(['user', 'repo']), label: 'github_copilot_space_set_resource (attach)', definition: sp('github_copilot_space_set_resource'), args: { spaceNumber: 4, resourceType: 'free_text', metadata: { name: 'n', text: 'hello' } },
  arrange(gh, o) { user(gh); gh.when(`GET ${U}/{space_number}`).reply(200, SP());
    seq(gh, `GET ${U}/{space_number}/resources`, [[200, { resources: [] }], [200, { resources: [RES(o === 'ok' ? { name: 'n', text: 'hello' } : { name: 'n', text: 'other' })] }]]);
    gh.when(`POST ${U}/{space_number}/resources`).reply(201, RES({ name: 'n', text: 'hello' })); } });
runWriteContract({ ...opts(['user', 'repo']), label: 'github_copilot_space_remove_resource', definition: sp('github_copilot_space_remove_resource'), args: { spaceNumber: 4, resourceId: 70 },
  arrange(gh, o) { user(gh); gh.when(`GET ${U}/{space_number}`).reply(200, SP());
    seq(gh, `GET ${U}/{space_number}/resources`, o === 'ok' ? [[200, { resources: [RES({ text: 'x' })] }], [200, { resources: [] }]] : [[200, { resources: [RES({ text: 'x' })] }], [200, { resources: [RES({ text: 'x' })] }]]);
    gh.when(`DELETE ${U}/{space_number}/resources/{space_resource_id}`).reply(204, null); } });
runWriteContract({ ...opts(['project']), label: 'github_project_view_create', definition: defs(small, 'github_project_view_create'), args: { projectNumber: 3, name: 'Board', layout: 'board' },
  arrange(gh, o) { user(gh); gh.when('GET /users/{username}/projectsV2/{project_number}').reply(200, { number: 3, title: 'Plan' });
    gh.when('POST /users/{user_id}/projectsV2/{project_number}/views').reply(201, { id: 5, number: 2, name: o === 'ok' ? 'Board' : 'Other', layout: 'board' });
    gh.when('GET /users/{username}/projectsV2/{project_number}/views/{view_number}/items').reply(200, []); } });

const call = async (mod, name, w, args) => mod.handlers[name](args, w.ctx);
describe('GOD-4 B reads and the missing master token', () => {
  it('lists, reads and shapes Copilot Spaces on the master token', async () => {
    const w = await makeWorld({ profile: 'full', mode: 'production' }); await withMaster(['user', 'repo'])(w); user(w.gh);
    w.gh.when(`GET ${U}`).reply(200, { spaces: [SP()] });
    w.gh.when(`GET ${U}/{space_number}`).reply(200, SP());
    w.gh.when(`GET ${U}/{space_number}/collaborators`).reply(200, { collaborators: [{ ...person, role: 'reader' }] });
    w.gh.when(`GET ${U}/{space_number}/resources`).reply(200, { resources: [RES({ text: 'x' })] });
    expect((await call(spaces, 'github_copilot_space_list', w, {})).spaces[0]).toMatchObject({ number: 4, name: 'Plans' });
    const one = await call(spaces, 'github_copilot_space_get', w, { spaceNumber: 4 });
    expect(one.collaborators[0]).toMatchObject({ identifier: 'alice', role: 'reader' });
    expect(one.resources[0].id).toBe(70);
    expect(w.gh.calls.every((c) => c.route === 'GET /user' || c.headers.authorization?.includes('ghp_FAKEmaster'))).toBe(true);
    expect(w.gh.invalid).toEqual([]);
  });
  it('no tool can name another account for Copilot Spaces', () => {
    for (const t of spaces.tools) expect(Object.keys(t.inputSchema.properties)).not.toEqual(expect.arrayContaining(['username']));
  });
  const reads = [[spaces, 'github_copilot_space_list', {}, 'read:user'], [spaces, 'github_copilot_space_get', { spaceNumber: 4 }, 'user and repo'], [small, 'github_user_hovercard', { username: 'octocat' }, 'repo'], [small, 'github_classroom_list', {}, 'repo']];
  for (const [mod, name, args, scope] of reads) {
    it(`${name} without a master token says so plainly`, async () => {
      const w = await makeWorld({ profile: 'full', mode: 'production' });
      await expect(call(mod, name, w, args)).rejects.toThrow(new RegExp(`permission ${scope}`));
      expect(w.gh.calls).toEqual([]);
    });
  }
  it('a write without the master token is refused in plain words and sends nothing', async () => {
    const w = await makeWorld({ profile: 'full', mode: 'production' });
    const out = parse(await call(spaces, 'github_copilot_space_delete', w, { spaceNumber: 4, confirm: true }));
    expect(JSON.stringify(out)).toMatch(/permission user and repo/);
    expect(out.status).not.toBe('applied');
    expect(w.gh.calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });
  it('a token with only the copilot permission is refused (GitHub wants user and repo for these endpoints)', async () => {
    const w = await makeWorld({ profile: 'full', mode: 'production' }); await withMaster(['copilot'])(w);
    await expect(call(spaces, 'github_copilot_space_get', w, { spaceNumber: 4 })).rejects.toThrow(/user and repo/);
  });
  it('creating or editing a Space to base role reader is disclosed as PUBLIC and always asks', async () => {
    const w = await makeWorld({ profile: 'full', mode: 'production' }); await withMaster(['user', 'repo'])(w); user(w.gh);
    w.gh.when(`GET ${U}/{space_number}`).reply(200, SP());
    const create = parse(await call(spaces, 'github_copilot_space_save', w, { name: 'Open', baseRole: 'reader', dryRun: true }));
    expect(JSON.stringify(create)).toMatch(/PUBLICLY READABLE/);
    expect(JSON.stringify(create)).toMatch(/ACCESS CHANGE/);
    const edit = parse(await call(spaces, 'github_copilot_space_save', w, { spaceNumber: 4, baseRole: 'reader', dryRun: true }));
    expect(JSON.stringify(edit)).toMatch(/PUBLICLY READABLE/);
    expect(edit.needsConfirmation).toBe(false);
    const quiet = parse(await call(spaces, 'github_copilot_space_save', w, { spaceNumber: 4, name: 'x', dryRun: true }));
    expect(JSON.stringify(quiet)).not.toMatch(/PUBLICLY/);
  });
  it('Classroom closed by GitHub answers honestly', async () => {
    const w = await makeWorld({ profile: 'full', mode: 'production' }); await withMaster(['repo'])(w);
    w.gh.when('GET /classrooms').reply(410, { message: 'Gone' });
    expect(await call(small, 'github_classroom_list', w, {})).toMatchObject({ available: false, status: 410 });
  });
  it('Marketplace listing for a non-owner answers honestly, and for an owner lists plans', async () => {
    const w = await makeWorld({ profile: 'full', mode: 'production' }); await withMaster(['repo'])(w);
    w.gh.when('GET /marketplace_listing/plans').replySequence([{ status: 401, body: { message: 'Requires authentication' } }, { status: 200, body: [{ id: 1, number: 1, name: 'Free', monthly_price_in_cents: 0 }] }]);
    expect(await call(small, 'github_marketplace_listing', w, {})).toMatchObject({ available: false, status: 401 });
    expect((await call(small, 'github_marketplace_listing', w, {})).plans[0].name).toBe('Free');
  });
  it('hovercard sends subject only as a pair', async () => {
    const w = await makeWorld({ profile: 'full', mode: 'production' }); await withMaster(['repo'])(w);
    w.gh.when('GET /users/{username}/hovercard').reply(200, { contexts: [{ message: 'Member of X', octicon: 'organization' }] });
    await expect(call(small, 'github_user_hovercard', w, { username: 'octocat', subjectType: 'issue' })).rejects.toThrow(/go together/);
    expect((await call(small, 'github_user_hovercard', w, { username: 'octocat', subjectType: 'organization', subjectId: 5 })).contexts[0].message).toBe('Member of X');
    expect(w.gh.invalid).toEqual([]);
  });
});
