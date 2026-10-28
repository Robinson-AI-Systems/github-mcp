import { redact } from './util.js';
// G-5 release lifecycle. Every mutation uses the shared confirmed, request-keyed
// write contract; publishing and deleting releases remain production operations.
import { defineGithubWrite } from './define-github-write.js';
import { missing, octo, ownerOf, refusal, slug } from './github-write.js';
import { productionReason } from './production-guard.js';

const OWNER = { type: 'string', maxLength: 39 };
const REPO = { type: 'string', minLength: 1, maxLength: 100 };
const TAG = { type: 'string', minLength: 1, maxLength: 250 };
const TEXT = { type: 'string', maxLength: 100000 };
const ID = { type: 'integer', minimum: 1 };
const ROUTES = {
  create: 'POST /repos/{owner}/{repo}/releases',
  one: 'GET /repos/{owner}/{repo}/releases/{release_id}',
  byTag: 'GET /repos/{owner}/{repo}/releases/tags/{tag}',
  update: 'PATCH /repos/{owner}/{repo}/releases/{release_id}',
  del: 'DELETE /repos/{owner}/{repo}/releases/{release_id}',
  notes: 'POST /repos/{owner}/{repo}/releases/generate-notes'
};
const target = (args, ctx) => ({ owner: ownerOf(args, ctx), repo: args.repo, scope: 'repo', kind: 'release' });
const path = (t, id) => ({ owner: t.owner, repo: t.repo, ...(id ? { release_id: id } : {}) });
const get = async (ctx, t, id) => missing(async () =>
  (await (await octo(ctx, t.owner)).request(ROUTES.one, path(t, id))).data);
const classifications = async ({ ctx, target: t, args, before }) => ({
  production: await productionReason(ctx, t),
  ...((args.draft === false && (before?.current?.draft || !before?.current))
    ? { notifies: ['repository watchers'] } : {})
});
const declarations = { production: 'always', confirm: 'always', profiles: ['full'] };
const describe = (t) => slug(t.owner, t.repo);
function assertMutable(current) {
  if (!current) throw refusal('Release not found.', 404);
  if (current.immutable && !current.draft)
    throw refusal('GitHub marks this published release immutable. No edits were sent.');
}

const create = defineGithubWrite({
  name: 'github_release_create', area: 'release', audience: ['B'],
  description: 'Create a draft release by default; publishing notifies watchers and needs production approval.',
  properties: { owner: OWNER, repo: REPO, tag: TAG,
    name: { type: 'string', maxLength: 250 }, body: TEXT, previousTag: TAG,
    targetCommitish: { type: 'string', minLength: 1, maxLength: 250 },
    draft: { type: 'boolean' }, prerelease: { type: 'boolean' },
    generateReleaseNotes: { type: 'boolean', description: 'Defaults to true.' },
    previewGeneratedNotes: { type: 'boolean', description: 'Also calculate notes during the preview; no release is created.' } },
  required: ['repo', 'tag'], declarations: { ...declarations, notifies: true }, target,
  read: async (args, ctx, t) => {
    const client = await octo(ctx, t.owner);
    const existing = await missing(async () => (await client.request(
      ROUTES.byTag, { ...path(t), tag: args.tag })).data);
    if ((!args.previewGeneratedNotes && !args.previousTag) || existing) return { existing };
    if (args.body !== undefined || args.generateReleaseNotes === false) {
      throw refusal('Generated-notes preview requires GitHub-generated notes, not an explicit body or disabled generation.');
    }
    // GitHub's generate-notes POST is a computation only: it does not create a release or tag.
    const { data } = await client.request(ROUTES.notes, {
      ...path(t), tag_name: args.tag,
      ...(args.previousTag ? { previous_tag_name: args.previousTag } : {}),
      ...(args.targetCommitish ? { target_commitish: args.targetCommitish } : {})
    });
    if (typeof data?.body !== 'string' || typeof data?.name !== 'string') {
      throw refusal('GitHub did not return a usable notes preview; no release was created.');
    }
    return { existing, generated: { name: data.name, body: data.body } };
  },
  classify: classifications,
  summarize: ({ args, before, target: t }) => before.existing
    ? `Release "${args.tag}" already exists in ${describe(t)}. It will not be duplicated.`
    : `Create ${args.draft === false ? 'PUBLISHED' : 'draft'} release "${args.tag}" in ${describe(t)}, ${args.generateReleaseNotes === false ? 'without' : 'with'} generated notes. Publishing creates the tag and notifies watchers. This cannot be automatically undone.${before.generated ? ` Current GitHub notes preview (may change before creation): ${before.generated.name} — ${redact(before.generated.body).slice(0, 600)}` : ''}`,
  apply: async ({ args, before, ctx, target: t }) => {
    if (before.existing) throw refusal(`Release "${args.tag}" already exists.`);
    return (await octo(ctx, t.owner)).request(ROUTES.create, {
      ...path(t), tag_name: args.tag, draft: args.draft ?? true,
      prerelease: args.prerelease ?? false, generate_release_notes: args.previousTag ? false : args.generateReleaseNotes ?? true,
      ...(args.previousTag ? { name: before.generated.name, body: before.generated.body } : {}),
      ...(args.name !== undefined ? { name: args.name } : {}),
      ...(args.body !== undefined ? { body: args.body } : {}),
      ...(args.targetCommitish ? { target_commitish: args.targetCommitish } : {})
    });
  },
  readAfter: async ({ ctx, target: t, response }) =>
    response.status === 201 && Number.isInteger(response.data?.id) ? get(ctx, t, response.data.id) : null,
  verify: ({ args, before, after }) => !!after && (!args.previousTag || after.body===before.generated?.body) && Number.isInteger(after.id) &&
    after.tag_name === args.tag && after.draft === (args.draft ?? true) &&
    after.prerelease === (args.prerelease ?? false) &&
    (args.name === undefined || after.name === args.name) &&
    (args.body === undefined || after.body === args.body),
  inverse: () => null,
  present: ({ after }) => ({ release_id: after?.id ?? null, tag: after?.tag_name,
    draft: after?.draft, html_url: after?.html_url, confirmed: !!after })
});

const update = defineGithubWrite({
  name: 'github_release_update', area: 'release', audience: ['B'],
  description: 'Update releases or publish drafts with confirmation; immutable releases refused.',
  properties: { owner: OWNER, repo: REPO, releaseId: ID, expectedTag: TAG,
    name: { type: 'string', maxLength: 250 }, body: TEXT,
    draft: { type: 'boolean' }, prerelease: { type: 'boolean' } },
  required: ['repo', 'releaseId'], declarations: { ...declarations, notifies: true }, target,
  read: async (args, ctx, t) => ({ current: await get(ctx, t, args.releaseId) }),
  classify: classifications,
  summarize: ({ args, before, target: t }) => before.current
    ? `Update release "${before.current.tag_name}" in ${describe(t)}. ${before.current.draft && args.draft === false ? 'PUBLISH: creates the tag and notifies watchers.' : 'Existing publication remains in place.'} Fields omitted are preserved; immutable published releases are refused.`
    : `Release ${args.releaseId} does not exist in ${describe(t)}.`,
  apply: async ({ args, before, ctx, target: t }) => {
    assertMutable(before.current);
    if(args.expectedTag){
      const current=await get(ctx,t,args.releaseId);
      if(current?.tag_name!==args.expectedTag||current.draft!==true)throw refusal('Expected draft/tag changed before publication.');
    }
    const patch = Object.fromEntries(['name', 'body', 'draft', 'prerelease']
      .filter((k) => Object.hasOwn(args, k)).map((k) => [k, args[k]]));
    if (!Object.keys(patch).length) throw refusal('Specify at least one release field to update.');
    return (await octo(ctx, t.owner)).request(ROUTES.update,
      { ...path(t, args.releaseId), ...patch });
  },
  readAfter: ({ args, ctx, target: t }) => get(ctx, t, args.releaseId),
  verify: ({ args, before, after }) => !!after && after.id === args.releaseId &&
    ['name', 'body', 'draft', 'prerelease'].every((k) =>
      after[k] === (Object.hasOwn(args, k) ? args[k] : before.current[k])),
  // No automatic undo: publication and immutable releases cannot be reconstructed safely.
  inverse: () => null,
  present: ({ after }) => ({ release_id: after?.id, tag: after?.tag_name,
    draft: after?.draft, prerelease: after?.prerelease, html_url: after?.html_url })
});

const del = defineGithubWrite({
  name: 'github_release_delete', area: 'release', audience: ['B'],
  description: 'Permanently delete a release without deleting its Git tag; cannot be undone automatically.',
  properties: { owner: OWNER, repo: REPO, releaseId: ID },
  required: ['repo', 'releaseId'], declarations, target,
  read: async (args, ctx, t) => ({ current: await get(ctx, t, args.releaseId) }),
  classify: classifications,
  summarize: ({ args, before, target: t }) => before.current
    ? `Permanently delete ${before.current.draft ? 'draft ' : ''}release "${before.current.tag_name}" (ID ${args.releaseId}) in ${describe(t)}, with ${before.current.assets?.length ?? 'unknown'} associated asset(s). The Git tag is left untouched; deletion cannot be undone.`
    : `Release ${args.releaseId} does not exist in ${describe(t)}.`,
  apply: async ({ args, before, ctx, target: t }) => {
    if (!before.current) throw refusal('Release not found.', 404);
    if (before.current.immutable && !before.current.draft)
      throw refusal('GitHub marks this published release immutable. Deletion is refused.');
    return (await octo(ctx, t.owner)).request(ROUTES.del, path(t, args.releaseId));
  },
  readAfter: ({ args, ctx, target: t }) => get(ctx, t, args.releaseId),
  verify: ({ after }) => after === null,
  inverse: () => null,
  present: ({ args, before }) => ({ deleted_id: args.releaseId,
    deleted_tag: before.current?.tag_name, git_tag_preserved: true, irreversible: true })
});

const defs = [create, update, del];
export const tools = defs.map((d) => d.tool);
export const handlers = Object.fromEntries(defs.map((d) => [d.tool.name, d.handler]));
