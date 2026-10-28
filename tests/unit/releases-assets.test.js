import { describe, it, expect } from 'vitest';
import { runWriteContract, makeWorld, doorsFor, parse } from '../../test/helpers/write-contract.js';
import * as assets from '../../src/tools/releases-assets.js';

const REL = 'GET /repos/{owner}/{repo}/releases/{release_id}';
const ASSET = 'GET /repos/{owner}/{repo}/releases/assets/{asset_id}';
const DEL = 'DELETE /repos/{owner}/{repo}/releases/assets/{asset_id}';
const file = { id: 7, name: 'build.zip', size: 512, download_count: 8 };
const release = { id: 42, tag_name: 'v1', draft: true, immutable: false, assets: [file] };
const def = { tool: assets.tools.find((x) => x.name === 'github_release_delete_asset'), handler: assets.handlers.github_release_delete_asset };
const args = { repo: 'hello', releaseId: 42, assetId: 7 };
const sequence = (gh, route, bodies) => gh.when(route).replySequence(bodies.map((body) =>
  body === null ? { status: 404, body: { message: 'Not Found' } } : { status: 200, body }));
const changed = (gh) => gh.calls.filter((x) => x.method === 'DELETE');
const call = async (w, extra = {}) => parse(await doorsFor(def)[0].call(w, { ...args, ...extra }));
runWriteContract({
  label: 'github_release_delete_asset', definition: def, args,
  profile: 'full', production: false, needsConfirm: true,
  arrange(gh, outcome) {
    sequence(gh, REL, [release, release]);
    sequence(gh, ASSET, [file, file, outcome === 'ok' ? null : file]);
    gh.when(DEL).reply(204, '');
  }
});

describe('G-5 release asset deletion', () => {
  it('previews a draft asset with its name and download count, no mutation', async () => {
    const w = await makeWorld({ profile: 'full' });
    w.gh.when(REL).reply(200, release); w.gh.when(ASSET).reply(200, file);
    const out = await call(w, { dryRun: true });
    expect(JSON.stringify(out)).toMatch(/build.zip/);
    expect(JSON.stringify(out)).toMatch(/8 downloads/);
    expect(changed(w.gh)).toHaveLength(0);
  });
  it('requires production approval when the actual release is published', async () => {
    const w = await makeWorld({delegated:true, mode: 'preview', profile: 'full' });
    w.gh.when(REL).reply(200, { ...release, draft: false });
    w.gh.when(ASSET).reply(200, file);
    const out = await call(w, { confirm: true });
    expect(out.status).toBe('refused_by_guard');
    expect(changed(w.gh)).toHaveLength(0);
  });
  it('refuses a missing or wrongly associated asset and immutable published release', async () => {
    for (const r of [{ ...release, assets: [] }, { ...release, draft: false, immutable: true }]) {
      const w = await makeWorld({ mode: 'production', profile: 'full' });
      w.gh.when(REL).reply(200, r); w.gh.when(ASSET).reply(200, file);
      expect((await call(w, { confirm: true })).status).not.toBe('applied');
      expect(changed(w.gh)).toHaveLength(0);
    }
  });
  it('refuses publication between preview and apply', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    sequence(w.gh, REL, [release, { ...release, draft: false }]);
    w.gh.when(ASSET).reply(200, file);
    expect((await call(w, { confirm: true })).status).not.toBe('applied');
    expect(changed(w.gh)).toHaveLength(0);
  });
});
