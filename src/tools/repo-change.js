// NATIVE-ERGO-1: github_repo_change — the most common job in one call: put a change on a branch,
// commit it, push it, and optionally open the pull request.
//
// It drives this connection's private native Git workspace (Git only, no runtime), so it reaches
// every repository the workspace tools reach, including ones the connection only collaborates on.
// Each native step carries its own request key derived from this intent's key, so a retry of the
// same intent replays finished steps from the worker's receipts and never commits or pushes twice.
// It uses only typed operations every deployed worker understands (no new worker features needed).
import { createHash } from 'node:crypto';
import { defineGithubWrite } from './define-github-write.js';
import { explainGithubError } from './errors.js';
import { githubFor, requestKey as intentKey } from '../github/client.js';
import { isOwnerConnection } from '../core/authority.js';
import { containsCredential } from '../github/content-protection.js';
import { nativeRecord, authorizeNativeRepo, callNativeWorker, nativeConnection } from '../native-git/client.js';
import { definiteFailure, porcelainPaths } from '../native-git/outcomes.js';
import { fitDigest } from '../native-git/relay.js';
import { nativeInternals } from './native-git.js';

const NAME = 'github_repo_change';
const { configured, safe, admitClone, openWorkspace, reusableWorkspace, beginUpload, uploadPreflight, uploadCommands, blockedNote } = nativeInternals;
const SHA = /^[a-f0-9]{40,64}$/;
const BRANCH = { type: 'string', minLength: 1, maxLength: 200 };
const PATH = { type: 'string', minLength: 1, maxLength: 4096 };
const MAX_FILE_BASE64 = 1400000;

// A relative workspace file path, the same rules the worker applies (refused here first, plainly).
function filePath(path) {
  if (typeof path !== 'string' || !path.length || path.length > 4096 || /[\x00-\x1f\x7f]/.test(path) || path.includes('\\') || path.includes(':') || path.startsWith('/')
    || path.split('/').some(p => !p || p === '.' || p === '..' || p.toLowerCase() === '.git')) throw safe(`${JSON.stringify(String(path).slice(0, 120))} is not a usable file path. Use a path relative to the repository root, like "src/app.js", outside .git.`, 'invalid_change_arguments');
  return path;
}
function branchName(name, label) {
  if (typeof name !== 'string' || !name.length || name.startsWith('-') || name.startsWith('refs/') || /[\s~^:?*[\\\x00-\x1f\x7f]/.test(name) || name.includes('..') || name.includes('@{') || name.endsWith('/') || name.endsWith('.lock'))
    throw safe(`${label} ${JSON.stringify(String(name).slice(0, 120))} is not a valid branch name.`, 'invalid_change_arguments');
  return name;
}
function checkArgs(a) {
  branchName(a.branch, 'branch'); if (a.base !== undefined) branchName(a.base, 'base');
  const files = a.files ?? [], removals = a.deletePaths ?? [];
  const beginning = a.upload !== undefined;
  if (beginning && (files.length || removals.length || a.upload_id || a.pr)) throw safe('upload prepares a one-time upload link first. Send files, deletePaths, upload_id and pr on the next call (with the returned workspace_id and upload_id).', 'invalid_change_arguments');
  if (!beginning && !files.length && !removals.length && !a.upload_id && !a.pr) throw safe('Nothing to change: give files, deletePaths or upload_id (or upload to get an upload link first). To open a PR for a branch that already has commits, give pr.', 'invalid_change_arguments');
  if (!beginning && (files.length || removals.length || a.upload_id) && typeof a.message !== 'string') throw safe('A commit message is required (message).', 'invalid_change_arguments');
  if (a.upload_id && !a.workspace_id) throw safe('upload_id belongs to a workspace: also give the workspace_id that the upload link was made for.', 'invalid_change_arguments');
  if (a.expectedHead !== undefined && a.expectedHead !== '' && !SHA.test(a.expectedHead)) throw safe('expectedHead must be the full commit SHA you last saw on the branch, or "" if the branch must not exist yet.', 'invalid_change_arguments');
  const seen = new Set();
  for (const file of files) {
    filePath(file.path);
    if (seen.has(file.path)) throw safe(`${JSON.stringify(file.path.slice(0, 120))} is listed twice.`, 'invalid_change_arguments'); seen.add(file.path);
    if ((file.content === undefined) === (file.base64 === undefined)) throw safe(`Give either content (text) or base64 for ${JSON.stringify(file.path.slice(0, 120))}, not both or neither.`, 'invalid_change_arguments');
    if (file.base64 !== undefined && !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.base64)) throw safe(`base64 for ${JSON.stringify(file.path.slice(0, 120))} is not canonical base64.`, 'invalid_change_arguments');
    const bytes = file.base64 !== undefined ? Buffer.from(file.base64, 'base64') : Buffer.from(file.content, 'utf8');
    if (bytes.toString('base64').length > MAX_FILE_BASE64) throw safe(`${JSON.stringify(file.path.slice(0, 120))} is larger than about 1 MB. Send larger or many files with upload: "archive" (or "git") instead.`, 'invalid_change_arguments');
    if (containsCredential(bytes.toString('utf8'), { fixtures: 'allow' })) throw safe(`${JSON.stringify(file.path.slice(0, 120))} contains something shaped like a credential, so it was not sent. Remove the value (keep real secrets out of the repository), or check it with github_git_workspace_read protection_check.`, 'content_protection');
  }
  for (const path of removals) { filePath(path); if (seen.has(path)) throw safe(`${JSON.stringify(path.slice(0, 120))} is both written and deleted; choose one.`, 'invalid_change_arguments'); }
  if (a.pr && (a.base ?? null) === a.branch) throw safe('A pull request needs a base branch different from branch.', 'invalid_change_arguments');
}
async function remoteHead(c, owner, repo, branch) {
  const gh = await githubFor(c, { owner, ...(!isOwnerConnection(c.connection) ? { scope: { repositories: [repo] } } : {}) });
  try { const found = await gh.request('GET /repos/{owner}/{repo}/git/ref/{ref}', { owner, repo, ref: `heads/${branch}` }); return found.data?.ref === `refs/heads/${branch}` && SHA.test(found.data?.object?.sha ?? '') ? found.data.object.sha : null; }
  catch (error) { if (error?.status === 404) return null; throw new TypeError(explainGithubError(error)); }
}
// Per connection and intent: another connection's same requestKey never sees this state.
const stateKey = (c, key) => 'repo_change.' + createHash('sha256').update(JSON.stringify([nativeConnection(c), key])).digest('hex').slice(0, 40);
const stepKey = (key, workspace, step) => 'rmcp_rc_' + createHash('sha256').update(JSON.stringify([key, workspace, step])).digest('hex').slice(0, 48);
const short = sha => typeof sha === 'string' ? sha.slice(0, 7) : null;

async function preflight(a, c, t) {
  configured(c); checkArgs(a);
  const repo = await authorizeNativeRepo(c, t.owner, t.repo);
  const base = a.base ?? repo.default_branch;
  if (!base) throw safe('The repository has no default branch yet; give base.', 'invalid_change_arguments');
  if (a.pr && base === a.branch) throw safe('A pull request needs a base branch different from branch.', 'invalid_change_arguments');
  const [branchHead, baseHead] = await Promise.all([remoteHead(c, t.owner, t.repo, a.branch), base === a.branch ? null : remoteHead(c, t.owner, t.repo, base)]);
  if (!branchHead && !baseHead) throw safe(`Neither ${a.branch} nor the base ${base} exists on GitHub. Give an existing base branch.`, 'invalid_change_arguments');
  // A retry of this same intent after it pushed sees its own commit; that is not "moved".
  const prior = await c.db.getSetting(stateKey(c, intentKey(c, NAME, a))).catch(() => null);
  if (a.expectedHead !== undefined && (branchHead ?? '') !== a.expectedHead && !a.allowMoved && !(prior?.commit && prior.commit === branchHead))
    throw safe(`The branch ${a.branch} moved: GitHub has ${branchHead ?? 'no such branch'}, you expected ${a.expectedHead || 'no branch'}. Nothing was changed. Review it, then call again with expectedHead ${branchHead ?? '""'}, or allowMoved: true to build on the current head.`, 'branch_moved');
  if (a.workspace_id) { const record = await nativeRecord(c, a.workspace_id); if (`${record.row.owner}/${record.row.repo}`.toLowerCase() !== `${t.owner}/${t.repo}`.toLowerCase()) throw safe('workspace_id belongs to another repository.', 'invalid_change_arguments'); }
  if (a.upload) { const id = a.workspace_id; if (id) await uploadPreflight(c, await nativeRecord(c, id)); }
  return { base, branchHead, baseHead };
}

// ---- The step machine. Every worker mutation has a stable key; replays come from the worker's receipts.
function machine(c, t, a, key, before) {
  const progress = [];
  const note = text => { progress.push(text); };
  const st = { generation: 0 };
  let record = null;
  const call = (body) => callNativeWorker(c, { binding: record.binding, job: record.job, workspace_id: record.worker, ...body });
  const inspect = async () => { const s = await call({ action: 'inspect' }); if (Number.isSafeInteger(s.generation)) st.generation = s.generation; return s; };
  const stopped = (why) => ({ stage: 'stopped', workspace_id: record?.row?.id ?? null, branch: a.branch, base: before.base, progress, warning: why });
  async function step(name, operation, options, { network = false } = {}) {
    let result;
    for (let attempt = 0; ; attempt++) {
      try { result = await call({ action: 'run', operation, options, requestKey: stepKey(key, record.row.id, name), expectedGeneration: st.generation, allowWrite: true, network }); break; }
      catch (error) {
        // Someone else moved the generation between our read and this step: read it again once.
        if (attempt === 0 && error.status === 400 && /generation/i.test(error.message)) { await inspect(); continue; }
        // A worker 400/404 is a check that refused before anything changed; anything else stays unknown.
        if (![400, 404].includes(error.status)) throw error;
        throw Object.assign(definiteFailure(operation, { status: 'refused', error: String(error.message ?? '').slice(0, 300) }, options), { outcomeDetails: { outcome: 'refused', operation, workspace_id: record.row.id, progress } });
      }
    }
    if (result.replayed) await inspect(); else if (Number.isSafeInteger(result.next_generation ?? result.generation)) st.generation = result.next_generation ?? result.generation;
    return result;
  }
  const fail = (operation, result, options) => { const error = definiteFailure(operation, result, options); error.outcomeDetails = { ...error.outcomeDetails, workspace_id: record?.row?.id, progress }; return error; };
  const ok = (operation, result, options) => {
    if (result.status === 'applied') return true;
    if (['rejected', 'refused', 'conflict'].includes(result.status)) throw fail(operation, result, options);
    return false;
  };
  return (async () => {
    const mapKey = stateKey(c, key);
    const saved = await c.db.getSetting(mapKey) ?? {};
    const remember = async patch => { Object.assign(saved, patch); await c.db.setSetting(mapKey, saved); };
    if (saved.stage === 'awaiting_upload') return { stage: 'awaiting_upload', workspace_id: saved.workspace_id, branch: a.branch, base: before.base, upload_id: saved.upload_id, progress: ['upload link already issued'], next: 'The upload link is shown once. If you no longer have it, call again with a new requestKey for a new link.' };
    // 1. The workspace: the one this intent already uses, the one given, a clean open one, or a fresh Git-only clone.
    let id = saved.workspace_id ?? a.workspace_id ?? null;
    if (id) { record = await nativeRecord(c, id); note(saved.workspace_id ? 'resumed workspace' : 'workspace given'); }
    if (!id && !a.fresh) {
      const candidate = await reusableWorkspace(c, t);
      if (candidate) {
        try {
          record = await nativeRecord(c, candidate);
          const s = await inspect();
          const local = await call({ action: 'read', operation: 'refs', options: { ref: 'refs/heads/' + a.branch } });
          const localHead = (local.stdout ?? '').split('\n').map(l => l.split('\0')).find(p => p[0] === 'refs/heads/' + a.branch)?.[1] ?? null;
          if (s.state === 'ready' && !s.status && !s.in_progress?.length && !s.conflicts?.length && (localHead === null || localHead === before.branchHead)) { id = candidate; note('reused open workspace'); }
          else record = null;
        } catch { record = null; }
      }
    }
    if (!id) {
      await admitClone(c);
      const opened = await openWorkspace(c, t, { branch: before.branchHead ? a.branch : before.base, leaseMinutes: 240 }, stepKey(key, null, 'open'));
      id = opened.workspace_id; await remember({ workspace_id: id, fresh: true });
      note('cloned a Git-only workspace');
      if (opened.result.state === 'opening') return { stage: 'cloning', workspace_id: id, branch: a.branch, base: before.base, progress, next: 'Large repository: still cloning. Call github_repo_change again with the same arguments and requestKey in a minute; it continues from here.' };
      if (opened.result.state !== 'ready') { record = null; return { stage: 'stopped', workspace_id: id, branch: a.branch, base: before.base, progress, warning: 'The clone did not report ready. Read github_git_workspace_read status for this workspace_id.' }; }
      record = await nativeRecord(c, id);
    } else if (!saved.workspace_id) await remember({ workspace_id: id, fresh: false });
    const s0 = await inspect();
    if (s0.state === 'opening') return { stage: 'cloning', workspace_id: id, branch: a.branch, base: before.base, progress, next: 'Still cloning. Call again with the same arguments and requestKey in a minute.' };
    if (s0.state !== 'ready') return stopped('The workspace is not ready; read its status, or call again with fresh: true.');

    // 2. Put the workspace on the branch at GitHub's head (or a new branch from the base).
    if (!saved.positioned) {
      if (!saved.fresh) { const r = await step('fetch', 'fetch', {}, { network: true }); if (!ok('fetch', r, {})) return stopped('fetch could not be confirmed.'); note('fetched'); }
      let s = await inspect();
      if (before.branchHead) {
        if (!(s.branch === a.branch && s.head === before.branchHead)) {
          const local = await call({ action: 'read', operation: 'refs', options: { ref: 'refs/heads/' + a.branch } });
          const exists = (local.stdout ?? '').split('\n').some(l => l.split('\0')[0] === 'refs/heads/' + a.branch);
          if (!exists) { const r = await step('branch_create', 'branch_create', { name: a.branch, ref: 'origin/' + a.branch }); if (!ok('branch_create', r, { name: a.branch })) return stopped('branch_create could not be confirmed.'); }
          if (s.branch !== a.branch) { const r = await step('switch', 'switch', { branch: a.branch }); if (!ok('switch', r, { branch: a.branch })) return stopped('switch could not be confirmed.'); }
          s = await inspect();
          if (s.head !== before.branchHead) { const r = await step('pull', 'pull', { branch: a.branch }, { network: true }); if (!ok('pull', r, { branch: a.branch })) return stopped('pull could not be confirmed.'); s = await inspect(); }
        }
        note(`on ${a.branch} at ${short(s.head)}`);
      } else {
        if (s.branch !== a.branch) {
          const r = await step('branch_create', 'branch_create', { name: a.branch, ref: 'origin/' + before.base });
          if (!ok('branch_create', r, { name: a.branch })) return stopped('branch_create could not be confirmed.');
          const w = await step('switch', 'switch', { branch: a.branch }); if (!ok('switch', w, { branch: a.branch })) return stopped('switch could not be confirmed.');
          s = await inspect();
        }
        note(`new branch ${a.branch} from ${before.base} at ${short(s.head)}`);
      }
      let lease = before.branchHead ?? '';
      if (before.branchHead && s.head !== before.branchHead) {
        if (!a.allowMoved) throw Object.assign(safe(`The branch ${a.branch} moved while this change was being prepared (GitHub now has ${s.head}). Nothing was committed or pushed. Review it and call again with a new requestKey, or with allowMoved: true to build on it.`, 'branch_moved'), { status: 409, outcomeDetails: { outcome: 'branch_moved', workspace_id: id, github_head: s.head, progress } });
        lease = s.head;
      }
      await remember({ positioned: true, lease, start: s.head });
    } else note('branch already prepared');

    // 3. A one-time upload link, when asked (the change itself comes on the next call).
    if (a.upload) {
      const chunks = await uploadPreflight(c, record);
      const begun = await beginUpload(c, { ...t, record }, { mode: a.upload, maxMegabytes: a.maxMegabytes }, stepKey(key, id, 'upload_begin'), chunks);
      await remember({ stage: 'awaiting_upload', upload_id: begun.upload_id });
      return { stage: 'awaiting_upload', workspace_id: id, branch: a.branch, base: before.base, upload_id: begun.upload_id, url: begun.url, direct: begun.direct ?? null, ...(begun.chunks ? { chunks: true, upload_base: begun.base ?? null } : {}), progress: [...progress, 'upload link issued'] };
    }

    // 4. The change: an applied upload, written files, deletions.
    if (a.upload_id) {
      const options = { uploadId: a.upload_id.slice(4), ...(a.path !== undefined ? { path: a.path } : {}) };
      let r;
      try { r = await call({ action: 'upload_apply', options, requestKey: stepKey(key, id, 'upload_apply'), expectedGeneration: st.generation, allowWrite: true }); }
      catch (error) { if (![400, 404].includes(error.status)) throw error; throw Object.assign(definiteFailure('upload apply', { status: 'refused', error: String(error.message).slice(0, 300) }), { outcomeDetails: { outcome: 'refused', workspace_id: id, progress } }); }
      if (r.status === 'refused') throw Object.assign(definiteFailure('upload apply', { status: 'refused', error: r.reason }), { outcomeDetails: { outcome: 'refused', workspace_id: id, progress } });
      if (r.status !== 'applied') return stopped('The upload could not be applied with confirmed state.');
      await inspect(); note(`upload applied (${(r.files_added ?? 0) + (r.files_changed ?? 0)} files)`);
    }
    let written = 0, removed = 0, absent = 0;
    for (const file of a.files ?? []) {
      const base64 = file.base64 ?? Buffer.from(file.content, 'utf8').toString('base64');
      const r = await step('write:' + file.path, 'write_file', { path: file.path, base64 });
      if (!ok('write_file', r, { path: file.path })) return stopped(`Writing ${file.path} could not be confirmed.`);
      written++;
    }
    for (const path of a.deletePaths ?? []) {
      let present = true;
      try { await call({ action: 'read', operation: 'read_file', options: { path, byteLength: 1 } }); } catch (error) { if (error.status === 404) present = false; else if (!/blocked by content protection/i.test(error.message)) throw error; }
      if (!present) { absent++; continue; }
      const r = await step('delete:' + path, 'remove_file', { path });
      if (!ok('remove_file', r, { path })) return stopped(`Deleting ${path} could not be confirmed.`);
      removed++;
    }
    if (written || removed || absent) note(`${written} written, ${removed} deleted${absent ? `, ${absent} already absent` : ''}`);

    // 5. Stage every change, commit, push with the lease read before the change.
    const changed = porcelainPaths((await inspect()).status);
    for (let i = 0; i < changed.length; i += 100) {
      const r = await step('add:' + i / 100, 'add', { paths: changed.slice(i, i + 100) });
      if (!ok('add', r, {})) return stopped('add could not be confirmed.');
    }
    let commit = null;
    if (a.message !== undefined) {
      const r = await step('commit', 'commit', { message: a.message });
      if (r.status === 'rejected' && !changed.length) note('no changes to commit');
      else if (!ok('commit', r, {})) return stopped('commit could not be confirmed.');
      else { commit = r.head; note(`committed ${short(commit)}`); }
    }
    let pushed = false;
    if (commit) {
      const r = await step('push', 'push', { branch: a.branch, expectedHead: saved.lease }, { network: true });
      if (r.status === 'uncertain' && /Expected remote head changed|Non-fast-forward/i.test(r.error ?? '')) throw fail('push', { ...r, status: 'refused' }, { branch: a.branch });
      if (!ok('push', r, { branch: a.branch }) || r.remote_verified !== true) return { ...stopped('The push could not be confirmed. Read github_git_workspace_read remote_refs before trying again.'), commit };
      pushed = true; note(`pushed ${a.branch}`);
      await remember({ commit });
    }
    const response = { stage: commit ? 'pushed' : 'no_changes', workspace_id: id, branch: a.branch, base: before.base, commit: commit ?? (before.branchHead ?? null), previous_head: saved.start ?? null, pushed, files_written: written, files_deleted: removed, progress };
    // 6. The pull request, through the existing guarded PR workflow (its own journal and checks).
    if (a.pr && (pushed || before.branchHead)) response.pr = await openPr(c, t, a, before, key);
    else if (a.pr) response.pr = { status: 'not_opened', reason: 'There is no branch on GitHub to open a pull request from (nothing changed).' };
    if (response.pr) progress.push(response.pr.number ? `PR #${response.pr.number} ${response.pr.status}` : `PR ${response.pr.status}`);
    return response;
  })();
}

async function openPr(c, t, a, before, key) {
  const [{ registry }, { createDispatch }] = await Promise.all([import('./index.js'), import('./dispatch.js')]);
  const dispatch = createDispatch({ env: c.env, credentials: c.credentials, gates: c.gates, fetch: c.fetch, now: c.now, sleep: c.sleep });
  const args = { owner: t.owner, repo: t.repo, head: a.branch, base: before.base, title: a.pr.title, ...(a.pr.body !== undefined ? { body: a.pr.body } : {}), ...(a.pr.draft !== undefined ? { draft: a.pr.draft } : {}), confirm: true, requestKey: 'rc_' + createHash('sha256').update(key).digest('hex').slice(0, 40) };
  let body = null;
  // The workflow opens once, then verifies with a fresh read on the next call ("existing").
  for (let i = 0; i < 2; i++) {
    let result; try { result = await dispatch.call(null, { registry, name: 'github_workflow_open_pr', args, connection: c.connection, db: c.db }); } catch { result = null; }
    body = result?.structuredContent ?? null;
    if (body?.status === 'existing' && body.done === true) return { status: 'opened', number: body.number, url: body.html_url ?? null, head_sha: body.head_sha ?? null };
    if (!body || !['pr_opened', 'labels_applied'].includes(body.status)) break;
  }
  return { status: 'not_opened', reason: String(body?.error ?? body?.next ?? body?.underlying_status ?? 'The pull request could not be confirmed.').slice(0, 300), next: 'The commit is pushed. Open the PR with github_workflow_open_pr (head ' + a.branch + ').' };
}

async function readBack(c, a, response) {
  if (!response?.workspace_id) return { ...response };
  const record = await nativeRecord(c, response.workspace_id);
  const call = body => callNativeWorker(c, { binding: record.binding, job: record.job, workspace_id: record.worker, ...body });
  if (response.stage === 'pushed') {
    const refs = await call({ action: 'read', operation: 'remote_refs', options: { ref: 'refs/heads/' + a.branch }, network: true });
    const { url: _u, direct: _d, ...rest } = response;
    return { ...rest, github_head: refs.refs?.['refs/heads/' + a.branch] ?? null };
  }
  if (response.stage === 'awaiting_upload') { const s = await call({ action: 'upload_status', options: { uploadId: String(response.upload_id).slice(4) } }); const { url: _u, direct: _d, ...rest } = response; return { ...rest, upload_state: s.state }; }
  const s = await call({ action: 'inspect' });
  return { ...response, workspace_state: s.state, clean: s.state === 'ready' && !s.status };
}
const verified = after => after.stage === 'pushed' ? SHA.test(after.commit ?? '') && after.github_head === after.commit
  : after.stage === 'no_changes' ? after.clean === true
  : after.stage === 'awaiting_upload' ? after.upload_state === 'awaiting'
  : after.stage === 'cloning' ? after.workspace_state === 'opening' : false;

function presentChange(a, after, response) {
  const v = after ?? response ?? {};
  const out = { stage: v.stage, workspace_id: v.workspace_id ?? null, branch: v.branch, base: v.base, commit: v.commit ?? null, ...(v.pr ? { pr: v.pr } : {}), files_written: v.files_written, files_deleted: v.files_deleted, progress: v.progress };
  if (v.stage === 'awaiting_upload') {
    if (typeof response?.url !== 'string') return { ...out, upload_id: v.upload_id, next: 'The upload link is shown only once. Call again with a new requestKey for a new link.' };
    const mode = a.upload;
    const shape = { chunks: response.chunks, base: response.upload_base };
    return { ...out, upload_id: v.upload_id, ...uploadCommands(mode, response.url, shape), single_use: true, if_blocked: blockedNote(response.url), ...(response.direct ? { direct_command: uploadCommands(mode, response.direct, shape).command } : {}),
      next: `Run the command within 10 minutes (it works once)${mode === 'git' ? ' from a clone whose commits build on the workspace branch' : ''}, then call github_repo_change again with workspace_id ${v.workspace_id}, upload_id ${v.upload_id}, branch ${v.branch}, message${mode === 'archive' ? ' (and deletePaths for removed files)' : ''} and pr if wanted. Do not publish the URL.` };
  }
  if (v.stage === 'pushed') return { ...out, next: v.pr?.number ? 'Watch CI with github_check_get_ci_state, then merge with github_workflow_merge_when_green.' : v.pr ? v.pr.next : 'Open a PR with pr (call again with the same branch), or github_workflow_open_pr.' };
  if (v.stage === 'no_changes') return { ...out, next: 'The files already matched the branch; nothing was committed or pushed.' };
  if (v.stage === 'cloning') return { ...out, next: v.next };
  return { ...out, ...(v.warning ? { warning: v.warning } : {}), next: 'Read github_git_workspace_read status for this workspace_id before trying again; the same call (same requestKey) continues safely.' };
}

const change = defineGithubWrite({
  name: NAME, area: 'git', audience: ['B', 'O', 'Op'],
  description: 'One call: write or delete files, commit, push to a branch, optionally open the PR.',
  guidance: 'One call instead of open, upload, add, commit, push and open PR. files: [{path, content}] for text or [{path, base64}] (each up to about 1 MB); deletePaths: paths to delete; message: the commit message; branch: new or existing; base: where a new branch starts and the PR targets (default the default branch); pr: {title, body, draft} opens the PR. It reuses a clean open workspace of the repository on this connection or clones a Git-only one, puts it on the branch at GitHub\'s head, writes, deletes, stages, commits and pushes with a lease on the head it read. expectedHead (the SHA you last saw, or "" for a new branch) refuses if the branch moved; allowMoved: true builds on the moved head instead. For larger or binary changes: call with upload: "archive" (or "git") to get a one-time upload command, run it, then call again with workspace_id, upload_id, message (and deletePaths). The same call again (same requestKey) continues an interrupted change and never commits or pushes twice. fresh: true always clones.',
  properties: { owner: { type: 'string', minLength: 1, maxLength: 39, pattern: '^[A-Za-z0-9-]+$' }, repo: { type: 'string', minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9_.-]+$' }, branch: BRANCH, base: BRANCH,
    files: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object', additionalProperties: false, required: ['path'], properties: { path: PATH, content: { type: 'string', maxLength: 1048576 }, base64: { type: 'string', maxLength: MAX_FILE_BASE64 } } } },
    deletePaths: { type: 'array', minItems: 1, maxItems: 100, items: PATH }, message: { type: 'string', minLength: 1, maxLength: 10000 },
    pr: { type: 'object', additionalProperties: false, required: ['title'], properties: { title: { type: 'string', minLength: 1, maxLength: 256 }, body: { type: 'string', maxLength: 65536 }, draft: { type: 'boolean' } } },
    expectedHead: { type: 'string', pattern: '^([a-f0-9]{40,64})?$' }, allowMoved: { type: 'boolean' }, fresh: { type: 'boolean' },
    upload: { type: 'string', enum: ['archive', 'git'] }, upload_id: { type: 'string', pattern: '^upl_[a-f0-9]{32}$' }, workspace_id: { type: 'string', pattern: '^job_[a-f0-9]{16}$' } },
  required: ['repo', 'branch'], declarations: { production: 'when-target', confirm: 'when-needed', profiles: ['full'] },
  explain: error => error?.safeMessage ? error.message : 'The change could not be confirmed. Call github_repo_change again with the same arguments and requestKey to continue it safely, or read the workspace status.',
  classifyError: error => [400, 401, 404, 409, 422, 429].includes(error?.status) ? 'rejected' : 'uncertain',
  target: (a, c) => ({ owner: a.owner ?? c.connection.default_account, repo: a.repo, ref: a.branch, scope: 'repo', kind: 'native-git' }),
  read: (a, c, t) => preflight(a, c, t),
  classify: ({ args: a }) => ({ production: `it pushes commits to ${a.branch} on GitHub${a.pr ? ' and opens a pull request' : ''}; GitHub permissions and repository rules apply` }),
  price: () => 0,
  summarize: ({ args: a, target: t, before }) => a.upload
    ? `Prepare ${a.branch} in a native workspace for ${t.owner}/${t.repo} and issue a one-time ${a.upload} upload link (nothing is committed yet)`
    : `Commit ${(a.files ?? []).length} file(s)${a.deletePaths ? `, ${a.deletePaths.length} deletion(s)` : ''}${a.upload_id ? ' and an upload' : ''} to ${a.branch} (${before?.branchHead ? `at ${short(before.branchHead)}` : `new from ${before?.base ?? 'the default branch'}`}) in ${t.owner}/${t.repo} and push it${a.pr ? `, then open a PR into ${before?.base ?? 'the default branch'}` : ''}`,
  apply: ({ args: a, ctx: c, target: t, requestKey, before }) => machine(c, t, a, requestKey, before),
  readAfter: ({ args: a, ctx: c, response }) => readBack(c, a, response),
  verify: ({ after }) => verified(after),
  // The same call again continues an interrupted change from the worker's step receipts.
  resumeReplay: true,
  refreshReplay: async ({ args: a, ctx: c, target: t, prior, recorded }) => {
    if (recorded) return prior;
    const before = await preflight(a, c, t);
    return readBack(c, a, await machine(c, t, a, intentKey(c, NAME, a), before));
  },
  essentials: shaped => shaped ? fitDigest({ stage: shaped.stage, branch: shaped.branch, commit: shaped.commit ?? null, ...(shaped.pr ? { pr: shaped.pr.number ? { number: shaped.pr.number, url: shaped.pr.url } : { status: shaped.pr.status } } : {}), ...(shaped.command ? { command: shaped.command, upload_id: shaped.upload_id, workspace_id: shaped.workspace_id } : { workspace_id: shaped.workspace_id }), progress: (shaped.progress ?? []).join('; ').slice(0, 300), ...(shaped.next ? { next: shaped.next } : {}) }, ['progress', 'next', 'workspace_id']) : null,
  present: ({ args: a, after, response }) => presentChange(a, after, response)
});

export const tools = [change.tool];
export const handlers = { [NAME]: change.handler };
