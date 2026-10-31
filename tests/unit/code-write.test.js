import { describe, expect, it } from 'vitest';
import { runWriteContract, makeWorld, doorsFor, parse } from '../../test/helpers/write-contract.js';
import { protectionGate } from '../../test/helpers/fixture-gates.js';
import * as code from '../../src/tools/code-write.js';
import { protectedResourceGate } from '../../src/tools/protect-guard.js';

const def = (name) => ({ tool: code.tools.find((t) => t.name === name), handler: code.handlers[name] });
const R = { repo: 'hello' };
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const REPO = 'GET /repos/{owner}/{repo}';
const CONTENTS = 'GET /repos/{owner}/{repo}/contents/{path}';
const b64 = (text) => Buffer.from(text).toString('base64');
const file = (text, sha = 'f'.repeat(40)) => ({ type: 'file', path: 'docs/a.md', sha, size: text.length, encoding: 'base64', content: b64(text) });
const seq = (gh, route, steps) => gh.when(route).replySequence(steps.map(([status, body]) => ({ status, body })));
const writes = (gh) => gh.calls.filter((c) => !['GET', 'HEAD'].includes(c.method));
const gone = [404, { message: 'Not Found' }];
const mainIsDefault = (gh) => gh.when(REPO).reply(200, { default_branch: 'main', node_id: 'R_x', name: 'hello' });
const featureBranch = (gh) => {
  gh.when(REPO).reply(200, { default_branch: 'main', node_id: 'R_x', name: 'hello' });
  gh.when('GET /repos/{owner}/{repo}/branches/{branch}').reply(200, { protected: false, commit: { sha: A } });
  gh.when('GET /repos/{owner}/{repo}/rules/branches/{branch}').reply(200, []);
};
const PUT = { ...R, branch: 'main', path: 'docs/a.md', message: 'Update', content: 'new text' };

runWriteContract({
  label: 'github_content_put_file (default branch)', definition: def('github_content_put_file'), args: PUT, needsConfirm: true, production: true,
  arrange(gh, outcome) {
    mainIsDefault(gh);
    seq(gh, CONTENTS, [[200, file('old')], [200, file(outcome === 'ok' ? 'new text' : 'old')]]);
    gh.when('PUT /repos/{owner}/{repo}/contents/{path}').reply(200, { content: { sha: 'n' } });
  }
});

runWriteContract({
  label: 'github_content_delete_file (default branch)', definition: def('github_content_delete_file'), args: { ...R, branch: 'main', path: 'docs/a.md', message: 'Remove' }, needsConfirm: true, production: true,
  arrange(gh, outcome) {
    mainIsDefault(gh);
    seq(gh, CONTENTS, outcome === 'ok' ? [[200, file('old')], gone, [200, file('old')], gone] : [[200, file('old')], [200, file('old')]]);
    gh.when('DELETE /repos/{owner}/{repo}/contents/{path}').reply(200, { commit: { sha: 'n' } });
  }
});

runWriteContract({
  label: 'github_content_push_files (default branch)', definition: def('github_content_push_files'), args: { ...R, branch: 'main', message: 'Add\n\nbody text', files: [{ path: 'a.txt', content: 'x' }, { path: 'old.txt', delete: true }] }, needsConfirm: true, production: true,
  arrange(gh, outcome) {
    mainIsDefault(gh);
    seq(gh, 'GET /repos/{owner}/{repo}/branches/{branch}', [[200, { commit: { sha: A } }], [200, { commit: { sha: outcome === 'ok' ? B : A } }]]);
    gh.when('POST /graphql').reply(200, { data: { createCommitOnBranch: { commit: { oid: B, url: 'u' } } } });
  }
});

runWriteContract({
  label: 'github_content_edit_files (default branch)', definition: def('github_content_edit_files'), args: { ...R, branch: 'main', message: 'Fix', files: [{ path: 'docs/a.md', edits: [{ find: 'old', replace: 'new text' }] }] }, needsConfirm: true, production: true,
  arrange(gh, outcome) {
    mainIsDefault(gh);
    gh.when(CONTENTS).reply(200, file('old'));
    seq(gh, 'GET /repos/{owner}/{repo}/branches/{branch}', [[200, { commit: { sha: A } }], [200, { commit: { sha: outcome === 'ok' ? B : A } }]]);
    gh.when('POST /graphql').reply(200, { data: { createCommitOnBranch: { commit: { oid: B, url: 'u' } } } });
  }
});

runWriteContract({
  label: 'github_commit_comment', definition: def('github_commit_comment'), args: { ...R, sha: A, body: 'Thanks @outside-person' }, needsConfirm: true, notifies: ['outside-person'], conveyor: true,
  gatesFor: ({ protectedLevel }) => (protectedLevel ? [protectionGate(protectedLevel === 'pr-only' ? 'none' : protectedLevel)] : []),
  arrange(gh, outcome) {
    gh.when('GET /orgs/{org}/members').reply(200, [{ login: 'example-owner' }]);
    gh.when('GET /repos/{owner}/{repo}/commits/{ref}').reply(200, { sha: A });
    gh.when('POST /repos/{owner}/{repo}/commits/{commit_sha}/comments').reply(201, { id: 5, body: 'x' });
    gh.when('GET /repos/{owner}/{repo}/comments/{comment_id}').reply(200, { id: 5, body: outcome === 'ok' ? 'Thanks @outside-person' : 'different', html_url: 'u' });
  }
});

runWriteContract({
  label: 'github_git_update_ref (default branch)', definition: def('github_git_update_ref'), args: { ...R, ref: 'heads/main', sha: B }, needsConfirm: true, production: true, profile: 'full',
  arrange(gh, outcome) {
    mainIsDefault(gh);
    seq(gh, 'GET /repos/{owner}/{repo}/git/ref/{ref}', [[200, { object: { sha: A } }], [200, { object: { sha: outcome === 'ok' ? B : A } }]]);
    gh.when('GET /repos/{owner}/{repo}/compare/{basehead}').reply(200, { status: 'ahead', ahead_by: 1, behind_by: 0 });
    gh.when('POST /graphql').reply(200, { data: { updateRefs: { clientMutationId: null } } });
  }
});

describe('file and ref changes: extra checks (BATCH-D §4 D-2)', () => {
  const call = async (name, w, args) => parse(await doorsFor(def(name))[0].call(w, args));

  it('a file that changed between preview and confirm is refused with the new version, and nothing is written', async () => {
    const w = await makeWorld({ mode: 'production' });
    featureBranch(w.gh);
    seq(w.gh, CONTENTS, [[200, file('old', 'c'.repeat(40))]]);
    const out = await call('github_content_put_file', w, { ...PUT, branch: 'dev', expectedSha: 'a'.repeat(7), confirm: true });
    expect(out.status).toBe('rejected');
    expect(out.error).toContain('changed since the preview');
    expect(out.error).toContain('ccccccc');
    expect(writes(w.gh)).toEqual([]);
  });

  it('the preview shows the current version so it can be passed back as expectedSha', async () => {
    const w = await makeWorld();
    featureBranch(w.gh);
    seq(w.gh, CONTENTS, [[200, file('old', 'c'.repeat(40))]]);
    const out = await call('github_content_put_file', w, { ...PUT, branch: 'dev', dryRun: true });
    expect(out.preview).toContain('expectedSha: ccccccc');
  });

  it('on a feature branch an ordinary file write needs no confirmation and sends the file\'s current blob SHA', async () => {
    const w = await makeWorld();
    featureBranch(w.gh);
    seq(w.gh, CONTENTS, [[200, file('old', 'c'.repeat(40))], [200, file('new text')]]);
    w.gh.when('PUT /repos/{owner}/{repo}/contents/{path}').reply(200, { content: { sha: 'n' } });
    const out = await call('github_content_put_file', w, { ...PUT, branch: 'dev' });
    expect(out.status).toBe('applied');
    expect(writes(w.gh)[0].body).toMatchObject({ sha: 'c'.repeat(40), branch: 'dev', content: b64('new text'), message: 'Update' });
    expect(w.gh.invalid).toEqual([]);
  });

  it('a path with spaces and # reaches GitHub encoded; a path with .. is refused', async () => {
    const w = await makeWorld();
    featureBranch(w.gh);
    seq(w.gh, CONTENTS, [gone, [200, file('new text')]]);
    w.gh.when('PUT /repos/{owner}/{repo}/contents/{path}').reply(201, {});
    await call('github_content_put_file', w, { ...PUT, branch: 'dev', path: 'my docs/#a b.md' });
    const put = writes(w.gh)[0];
    expect(put.path).not.toMatch(/[ #]/);
    expect(put.params.path).toBe('my docs/#a b.md');
    const bad = await call('github_content_put_file', await makeWorld(), { ...PUT, branch: 'dev', path: '../secrets' });
    expect(bad.status).toBe('refused');
  });

  it('the undo of an update restores the previous text; the undo of a new file deletes it (audit G17)', async () => {
    const w = await makeWorld();
    featureBranch(w.gh);
    seq(w.gh, CONTENTS, [[200, file('old text')], [200, file('new text')]]);
    w.gh.when('PUT /repos/{owner}/{repo}/contents/{path}').reply(200, {});
    await call('github_content_put_file', w, { ...PUT, branch: 'dev' });
    expect((await w.db.getChange(1)).inverse).toMatchObject({ tool: 'github_content_put_file', args: { branch: 'dev', path: 'docs/a.md', content: 'old text' } });
    const w2 = await makeWorld();
    featureBranch(w2.gh);
    seq(w2.gh, CONTENTS, [gone, [200, file('new text')]]);
    w2.gh.when('PUT /repos/{owner}/{repo}/contents/{path}').reply(201, {});
    await call('github_content_put_file', w2, { ...PUT, branch: 'dev' });
    expect((await w2.db.getChange(1)).inverse).toMatchObject({ tool: 'github_content_delete_file', args: { branch: 'dev', path: 'docs/a.md' } });
  });

  it('a branch must be named: there is no default to write to', async () => {
    const w = await makeWorld();
    const { branch, ...noBranch } = PUT;
    expect(branch).toBe('main');
    const door = doorsFor(def('github_content_put_file'))[1];
    const out = await door.call(w, noBranch);
    expect(out.isError).toBe(true);
    expect(w.gh.calls).toEqual([]);
  });

  it('push_files commits through GraphQL with the head it read as expectedHeadOid, and an explicit expectedHead wins', async () => {
    const w = await makeWorld();
    featureBranch(w.gh);
    seq(w.gh, 'GET /repos/{owner}/{repo}/branches/{branch}', [[200, { protected: false, commit: { sha: A } }], [200, { commit: { sha: B } }]]);
    w.gh.when('POST /graphql').reply(200, { data: { createCommitOnBranch: { commit: { oid: B, url: 'u' } } } });
    const out = await call('github_content_push_files', w, { ...R, branch: 'dev', message: 'Add\n\nmore', files: [{ path: 'a.txt', content: 'x' }, { path: 'gone.txt', delete: true }] });
    expect(out).toMatchObject({ status: 'applied', result: { commit: B } });
    const input = w.gh.graphql[0].variables.input;
    expect(input).toMatchObject({ expectedHeadOid: A, branch: { repositoryNameWithOwner: 'example-org/hello', branchName: 'dev' }, message: { headline: 'Add', body: 'more' },
      fileChanges: { additions: [{ path: 'a.txt', contents: b64('x') }], deletions: [{ path: 'gone.txt' }] } });
    expect(w.gh.invalid).toEqual([]);
    const w2 = await makeWorld();
    featureBranch(w2.gh);
    seq(w2.gh, 'GET /repos/{owner}/{repo}/branches/{branch}', [[200, { protected: false, commit: { sha: B } }], [200, { commit: { sha: B } }]]);
    w2.gh.when('POST /graphql').reply(200, { errors: [{ message: 'Expected branch to point to aaaa but it did not' }] });
    const stale = await call('github_content_push_files', w2, { ...R, branch: 'dev', message: 'x', files: [{ path: 'a.txt', content: 'x' }], expectedHead: A });
    expect(w2.gh.graphql).toHaveLength(0); // refused before GitHub is asked to commit
    expect(stale.done).toBe(false);
    expect(JSON.stringify(stale)).toMatch(/moved since the preview/);
  });

  it('push_files refuses duplicate paths and an item with both content and delete', async () => {
    const w = await makeWorld();
    expect((await call('github_content_push_files', w, { ...R, branch: 'dev', message: 'x', files: [{ path: 'a', content: 'x' }, { path: 'a', content: 'y' }] })).error).toContain('listed twice');
    expect((await call('github_content_push_files', w, { ...R, branch: 'dev', message: 'x', files: [{ path: 'a', content: 'x', delete: true }] })).error).toContain('either content');
  });

  describe('edit_files', () => {
    const EDIT = (edits, extra = {}) => ({ ...R, branch: 'dev', message: 'Fix\n\nwhy', files: [{ path: 'docs/a.md', edits }], ...extra });
    const arrangeEdit = (w, text) => {
      featureBranch(w.gh);
      w.gh.when(CONTENTS).reply(200, file(text));
      seq(w.gh, 'GET /repos/{owner}/{repo}/branches/{branch}', [[200, { protected: false, commit: { sha: A } }], [200, { commit: { sha: B } }]]);
      w.gh.when('POST /graphql').reply(200, { data: { createCommitOnBranch: { commit: { oid: B, url: 'u' } } } });
    };
    it('sends only the edited file with the changed text and the head it read', async () => {
      const w = await makeWorld();
      arrangeEdit(w, 'one two two three');
      const out = await call('github_content_edit_files', w, EDIT([{ find: 'one', replace: '1' }, { find: 'two', replace: '2', all: true }]));
      expect(out).toMatchObject({ status: 'applied', result: { commit: B } });
      const input = w.gh.graphql[0].variables.input;
      expect(input).toMatchObject({ expectedHeadOid: A, message: { headline: 'Fix', body: 'why' }, fileChanges: { additions: [{ path: 'docs/a.md', contents: b64('1 2 2 three') }] } });
      expect(w.gh.invalid).toEqual([]);
    });
    it('refuses with a plain message, before asking GitHub to commit, when the branch moved since the preview', async () => {
      const w = await makeWorld();
      arrangeEdit(w, 'one two');
      const out = await call('github_content_edit_files', w, EDIT([{ find: 'one', replace: '1' }], { expectedHead: 'c'.repeat(40) }));
      expect(out.done).toBe(false);
      expect(JSON.stringify(out)).toMatch(/moved since the preview/);
      expect(w.gh.graphql).toHaveLength(0);
    });
    it('refuses text that is missing or ambiguous and changes nothing', async () => {
      for (const [edits, words] of [[[{ find: 'zzz', replace: 'x' }], 'was not found'], [[{ find: 'two', replace: 'x' }], 'appears 2 times'], [[{ find: 'one', replace: 'one' }], 'change nothing']]) {
        const w = await makeWorld();
        arrangeEdit(w, 'one two two');
        const out = await call('github_content_edit_files', w, EDIT(edits));
        expect(JSON.stringify(out)).toContain(words);
        expect(w.gh.graphql).toEqual([]);
      }
    });
    it('refuses a path listed twice', async () => {
      const w = await makeWorld();
      const dup = EDIT([{ find: 'a', replace: 'b' }]);
      dup.files.push(dup.files[0]);
      expect((await call('github_content_edit_files', w, dup)).error).toContain('listed twice');
    });
    it('edits by line number (replace, insert, delete) against the original numbering, then find-and-replace', async () => {
      const w = await makeWorld();
      arrangeEdit(w, 'a\nb\nc\nd\n');
      const args = EDIT([{ find: 'c', replace: 'C' }]);
      args.files[0].lineEdits = [{ startLine: 2, endLine: 2, replace: 'B1\nB2', expectFirstLine: 'b' }, { startLine: 3, endLine: 2, replace: 'new' }, { startLine: 4, endLine: 4, replace: '' }];
      const out = await call('github_content_edit_files', w, args);
      expect(out).toMatchObject({ status: 'applied' });
      expect(w.gh.graphql[0].variables.input.fileChanges.additions[0].contents).toBe(b64('a\nB1\nB2\nnew\nC\n'));
    });
    it('refuses line edits that are stale, overlapping, past the end, or backwards', () => {
      const t = 'a\nb\nc\n';
      const bad = (e, words) => expect(code.applyLineEdits(t, e, 'f').problems.join()).toContain(words);
      bad([{ startLine: 2, endLine: 2, replace: 'x', expectFirstLine: 'zzz' }], 'not the text you expected');
      bad([{ startLine: 1, endLine: 2, replace: 'x' }, { startLine: 2, endLine: 3, replace: 'y' }], 'overlap');
      bad([{ startLine: 2, endLine: 9, replace: 'x' }], 'past the end');
      bad([{ startLine: 3, endLine: 1, replace: 'x' }], 'backwards');
      expect(code.applyLineEdits(t, [{ startLine: 4, endLine: 3, replace: 'end' }], 'f').text).toBe('a\nb\nc\nend\n');
    });
    it('applyEdits is plain-text (no patterns) and applies edits in order', () => {
      expect(code.applyEdits('a.c abc', [{ find: 'a.c', replace: 'X' }], 'f').text).toBe('X abc');
      expect(code.applyEdits('a b', [{ find: 'a', replace: 'b' }, { find: 'b b', replace: 'c' }], 'f').text).toBe('c');
    });
  });

  describe('moving a ref', () => {
    const arrange = (gh, { current = A, dropped = 0, ahead = 1, status = 'ahead' } = {}) => {
      featureBranch(gh);
      seq(gh, 'GET /repos/{owner}/{repo}/git/ref/{ref}', [[200, { object: { sha: current } }], [200, { object: { sha: B } }]]);
      gh.when('GET /repos/{owner}/{repo}/compare/{basehead}').reply(200, { status, ahead_by: ahead, behind_by: dropped });
      gh.when('POST /graphql').reply(200, { data: { updateRefs: { clientMutationId: null } } });
    };
    const args = { ...R, ref: 'heads/dev', sha: B, confirm: true };

    it('sends beforeOid (compare-and-swap) and the full ref name', async () => {
      const w = await makeWorld({ profile: 'full' });
      arrange(w.gh);
      expect(await call('github_git_update_ref', w, args)).toMatchObject({ status: 'applied' });
      expect(w.gh.graphql[0].variables.input).toMatchObject({ repositoryId: 'R_x', refUpdates: [{ name: 'refs/heads/dev', afterOid: B, beforeOid: A }] });
      expect(w.gh.graphql[0].variables.input.refUpdates[0].force).toBeUndefined();
      expect(w.gh.invalid).toEqual([]);
    });
    it('a move that drops commits needs force: true, and the preview says how many', async () => {
      const w = await makeWorld({ profile: 'full' });
      arrange(w.gh, { dropped: 3, ahead: 0, status: 'behind' });
      const preview = await call('github_git_update_ref', w, { ...args, dryRun: true });
      expect(preview.preview).toContain('3 commit(s) would be dropped');
      expect(preview.preview).toContain('needs force: true');
      const refused = await call('github_git_update_ref', w, args);
      expect(refused.status).toBe('rejected');
      expect(w.gh.graphql).toEqual([]);
      const w2 = await makeWorld({ profile: 'full' });
      arrange(w2.gh, { dropped: 3, ahead: 0, status: 'behind' });
      expect(await call('github_git_update_ref', w2, { ...args, force: true })).toMatchObject({ status: 'applied' });
      expect(w2.gh.graphql[0].variables.input.refUpdates[0].force).toBe(true);
    });
    it('is refused when the ref moved since the preview', async () => {
      const w = await makeWorld({ profile: 'full' });
      arrange(w.gh, { current: 'c'.repeat(40) });
      const out = await call('github_git_update_ref', w, { ...args, expectedSha: A });
      expect(out.status).toBe('rejected');
      expect(out.error).toContain('moved since the preview');
      expect(w.gh.graphql).toEqual([]);
    });
    it('a delegated tag move honors mode; a supplied protection gate still refuses a default-branch move', async () => {
      const w = await makeWorld({ profile: 'full', delegated: true });
      arrange(w.gh);
      const tag = await call('github_git_update_ref', w, { ...R, ref: 'tags/v1', sha: B, confirm: true });
      expect(tag).toMatchObject({ status: 'refused_by_guard', refusedBy: 'mode' });
      const p = await makeWorld({ profile: 'full', delegated: true, mode: 'production', accounts: ['robinson-ai-systems'], gates: [protectedResourceGate()] });
      arrange(p.gh);
      mainIsDefault(p.gh);
      const out = await call('github_git_update_ref', p, { repo: 'github-mcp', ref: 'heads/main', sha: B, force: true, confirm: true });
      expect(out).toMatchObject({ status: 'refused_by_guard', refusedBy: 'protected resource' });
      expect(p.gh.graphql).toEqual([]);
    });
    it('the undo moves it back, expecting where this move put it', async () => {
      const w = await makeWorld({ profile: 'full' });
      arrange(w.gh);
      await call('github_git_update_ref', w, args);
      expect((await w.db.getChange(1)).inverse).toMatchObject({ tool: 'github_git_update_ref', args: { ref: 'heads/dev', sha: A, expectedSha: B } });
    });
  });

  it('a commit comment to your own people needs no confirmation', async () => {
    const w = await makeWorld();
    w.gh.when('GET /orgs/{org}/members').reply(200, [{ login: 'example-owner' }]);
    w.gh.when('GET /repos/{owner}/{repo}/commits/{ref}').reply(200, { sha: A });
    w.gh.when('POST /repos/{owner}/{repo}/commits/{commit_sha}/comments').reply(201, { id: 5 });
    w.gh.when('GET /repos/{owner}/{repo}/comments/{comment_id}').reply(200, { id: 5, body: 'ok @example-owner', html_url: 'u' });
    expect(await call('github_commit_comment', w, { ...R, sha: A, body: 'ok @example-owner' })).toMatchObject({ status: 'applied' });
    expect(w.gh.invalid).toEqual([]);
  });

  it('commenting on a line needs both path and line', async () => {
    const out = await call('github_commit_comment', await makeWorld(), { ...R, sha: A, body: 'x', path: 'a.js' });
    expect(out.status).toBe('refused');
  });
});
