import { describe, it, expect } from 'vitest';
import { runWriteContract, makeWorld, doorsFor, parse } from '../../test/helpers/write-contract.js';
import * as releases from '../../src/tools/releases-write.js';

const A = { repo: 'hello' };
const draft = { id: 42, tag_name: 'v1.0.0', name: 'First', body: 'Notes', draft: true,
  prerelease: false, immutable: false, assets: [] };
const published = { ...draft, draft: false };
const BYTAG = 'GET /repos/{owner}/{repo}/releases/tags/{tag}';
const ONE = 'GET /repos/{owner}/{repo}/releases/{release_id}';
const POST = 'POST /repos/{owner}/{repo}/releases';
const PATCH = 'PATCH /repos/{owner}/{repo}/releases/{release_id}';
const DEL = 'DELETE /repos/{owner}/{repo}/releases/{release_id}';
const sequence = (gh, route, steps) => gh.when(route).replySequence(steps.map(([status, body]) => ({ status, body })));
const def = (name) => ({ tool: releases.tools.find((x) => x.name === name), handler: releases.handlers[name] });
const writes = (gh) => gh.calls.filter((x) => ['POST', 'PATCH', 'DELETE'].includes(x.method));
const call = async (name, w, args) => parse(await doorsFor(def(name))[0].call(w, args));

runWriteContract({
  label: 'github_release_create', definition: def('github_release_create'),
  args: { ...A, tag: 'v1.0.0', name: 'First', body: 'Notes' },
  profile: 'full', production: true, needsConfirm: true,
  arrange(gh, outcome) {
    gh.when(BYTAG).reply(404, { message: 'Not Found' });
    gh.when(POST).reply(201, draft);
    gh.when(ONE).reply(200, outcome === 'ok' ? draft : { ...draft, draft: false });
  }
});
runWriteContract({
  label: 'github_release_update', definition: def('github_release_update'),
  args: { ...A, releaseId: 42, name: 'Second' },
  profile: 'full', production: true, needsConfirm: true,
  arrange(gh, outcome) {
    sequence(gh, ONE, [[200, draft], [200, outcome === 'ok' ? { ...draft, name: 'Second' } : draft]]);
    gh.when(PATCH).reply(200, { ...draft, name: 'Second' });
  }
});
runWriteContract({
  label: 'github_release_delete', definition: def('github_release_delete'),
  args: { ...A, releaseId: 42 },
  profile: 'full', production: true, needsConfirm: true,
  arrange(gh, outcome) {
    sequence(gh, ONE, [[200, draft], outcome === 'ok'
      ? [404, { message: 'Not Found' }] : [200, draft]]);
    gh.when(DEL).reply(204, '');
  }
});

describe('G-5 release lifecycle safety', () => {
  it('creates a draft with generated notes by default without a tag deletion', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    w.gh.when(BYTAG).reply(404, { message: 'Not Found' });
    w.gh.when(POST).reply(201, draft);
    w.gh.when(ONE).reply(200, draft);
    const out = await call('github_release_create', w, { ...A, tag: 'v1.0.0', confirm: true });
    expect(out.status).toBe('applied');
    expect(writes(w.gh)[0].body).toMatchObject({
      tag_name: 'v1.0.0', draft: true, prerelease: false, generate_release_notes: true
    });
    expect(writes(w.gh)).toHaveLength(1);
    expect(w.gh.invalid).toEqual([]);
  });

  it('requires production connection when publishing directly', async () => {
    const w = await makeWorld({delegated:true, mode: 'preview', profile: 'full' });
    w.gh.when(BYTAG).reply(404, { message: 'Not Found' });
    const out = await call('github_release_create', w, { ...A, tag: 'v1.0.0', draft: false, confirm: true });
    expect(out).toMatchObject({ status: 'refused_by_guard', refusedBy: 'mode' });
    expect(writes(w.gh)).toEqual([]);
  });

  it('refuses duplicates rather than creating a second release', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    w.gh.when(BYTAG).reply(200, draft);
    const out = await call('github_release_create', w, { ...A, tag: 'v1.0.0', confirm: true });
    expect(out.status).not.toBe('applied');
    expect(writes(w.gh)).toEqual([]);
  });

  it('publishes a draft without resetting omitted fields', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    sequence(w.gh, ONE, [[200, draft], [200, published]]);
    w.gh.when(PATCH).reply(200, published);
    const out = await call('github_release_update', w, { ...A, releaseId: 42, draft: false, confirm: true });
    expect(out.status).toBe('applied');
    expect(writes(w.gh)[0].body).toEqual({ draft: false });
    expect(w.gh.invalid).toEqual([]);
  });

  it('refuses immutable published updates and deletion without sending writes', async () => {
    for (const name of ['github_release_update', 'github_release_delete']) {
      const w = await makeWorld({ mode: 'production', profile: 'full' });
      w.gh.when(ONE).reply(200, { ...published, immutable: true });
      const out = await call(name, w, { ...A, releaseId: 42,
        ...(name === 'github_release_update' ? { name: 'Changed' } : {}), confirm: true });
      expect(out.status).not.toBe('applied');
      expect(writes(w.gh)).toEqual([]);
    }
  });

  it('refuses missing release ids and never deletes a Git tag', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    w.gh.when(ONE).reply(404, { message: 'Not Found' });
    const out = await call('github_release_delete', w, { ...A, releaseId: 999, confirm: true });
    expect(out.status).not.toBe('applied');
    expect(writes(w.gh)).toEqual([]);
  });

  it('cannot confirm a created release if readback disagrees', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    w.gh.when(BYTAG).reply(404, { message: 'Not Found' });
    w.gh.when(POST).reply(201, draft);
    w.gh.when(ONE).reply(200, { ...draft, tag_name: 'v-other' });
    const out = await call('github_release_create', w, { ...A, tag: 'v1.0.0', confirm: true });
    expect(out.status).toBe('unconfirmed');
    expect(writes(w.gh)).toHaveLength(1);
  });
});
