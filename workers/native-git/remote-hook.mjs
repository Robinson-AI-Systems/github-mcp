// GIT-REMOTE-1: the worker's own pre-receive hook for pushes through the git remote. It is never
// repository content: remote.js runs `receive-pack` with core.hooksPath pointing at a shim that execs
// this file. Git has the pushed objects in its quarantine (GIT_QUARANTINE_PATH) and lets the push
// "succeed" only if this exits 0. What it writes to stderr reaches the person as `remote:` lines.
//
// 1. The broker (control plane) re-checks the key and connection, runs the guard gates for every
//    ref, opens the change-log entry and returns a GitHub credential for this one push.
// 2. Every object new to the mirror (blobs, commit and tag messages) is scanned with the repository's
//    content protection; a hit refuses the whole push before anything reaches GitHub.
// 3. One atomic `git push` to GitHub, leased on exactly the values the client saw (a forced push is
//    still refused by GitHub on a protected branch unless its rules allow it).
// 4. Read back from GitHub, report the outcome to the broker (change log), answer the client.
import { readFileSync } from 'node:fs';
import { redactExcerpt, withProtectionContext, withRepositoryProtection } from '../../src/github/content-protection.js';
import { scannerSettings, defaultScannerSettings } from '../../src/github/scanner-policy.js';
import { catObjects, findingFor } from './upload.js';
import { callBroker, remotePrefix, runGit, tokenEnvironment } from './remote.js';
import { gitPrefix } from './engine.js';

const ZERO = '0'.repeat(40);
const MiB = 1024 * 1024;
const env = process.env;
const local = env.ROBINSON_REMOTE_LOCAL === '1';
const slug = String(env.ROBINSON_REMOTE_SLUG ?? 'this repository');
const say = (...lines) => { for (const line of lines) process.stderr.write(String(line).replace(/[\x00-\x09\x0b-\x1f\x7f]/g, ' ') + '\n'); };
const nameOf = ref => ref.replace(/^refs\/(heads|tags)\//, '');
const describe = u => `${u.new === ZERO ? 'deleted' : u.old === ZERO ? 'created' : 'updated'} ${u.ref.startsWith('refs/tags/') ? 'tag' : 'branch'} ${nameOf(u.ref)}`;
// Text from GitHub can carry repository-controlled words (rule names, custom messages): shown as data only.
const untrusted = text => redactExcerpt(String(text)).replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);

async function main() {
 const updates = readFileSync(0, 'utf8').split('\n').filter(Boolean).map(line => { const [old, nw, ref] = line.split(' '); return { old, new: nw, ref }; });
 if (!updates.length) return 0;
 if (updates.length > 50) { say('Refused: a push through the git remote can change at most 50 branches or tags at once. Push fewer at a time.'); return 1; }
 const odd = updates.find(u => !/^refs\/(heads|tags)\/./.test(u.ref ?? ''));
 if (odd) { say('Refused: only branches (refs/heads/...) and tags (refs/tags/...) can be pushed through the git remote.'); return 1; }
 const claim = String(env.ROBINSON_REMOTE_CLAIM ?? ''), broker = String(env.ROBINSON_REMOTE_BROKER ?? '');
 const answer = await callBroker(broker, claim, { phase: 'push', updates });
 if (answer.allow !== true || typeof answer.credential !== 'string') { say('Refused by the Robinson GitHub MCP before anything reached GitHub:', untrusted(answer.message ?? 'not allowed'), 'Nothing was pushed.'); return 1; }
 const credential = answer.credential, journal = answer.journal, actedAs = answer.acted_as;
 const report = (outcome, extra = {}) => callBroker(broker + (broker.includes('?') ? '&' : '?') + 'op=report', claim, { journal, outcome, updates, actedAs, ...extra }).catch(() => null);
 // 2. Content protection on every new object (the quarantine is visible through this hook's environment).
 const settings = scannerSettings(answer.scanner_policy?.settings ?? defaultScannerSettings());
 const rules = settings.additionalRules.filter(r => !settings.disabledRules.includes(r.id));
 const created = updates.filter(u => u.new !== ZERO).map(u => u.new);
 if (created.length) {
  let findings;
  try { findings = await withProtectionContext(() => withRepositoryProtection(rules, () => scan(created))); }
  catch (error) { await report('refused', { reason: 'content scan did not finish' }); say(error?.refusal ? error.message : 'Refused: the pushed content could not be checked, so nothing was pushed. Push fewer or smaller files.'); return 1; }
  if (findings.length) {
   const first = findings[0];
   await report('refused', { reason: 'credential-shaped content' });
   say(`Refused: content protection found credential-shaped content in ${findings.length} file(s) or commit message(s), first ${JSON.stringify(first.path.slice(0, 120))} (${first.lines.length ? first.lines.join(', ') : first.rules.join(', ')}).`,
    'Nothing was pushed to GitHub. Remove the value from your commits (git commit --amend or git rebase -i), keep real secrets in protected setup, then push again.',
    'If this is a false positive, check it with github_secret_scanner and the repository scanner settings.');
   return 1;
  }
 }
 // 3. One atomic push to GitHub with a lease on what the client saw.
 const remote = String(env.ROBINSON_REMOTE_GITHUB);
 const specs = updates.map(u => (u.new === ZERO ? '' : u.new) + ':' + u.ref);
 const leases = updates.map(u => `--force-with-lease=${u.ref}:${u.old === ZERO ? '' : u.old}`);
 let pushed;
 try { pushed = await runGit([...remotePrefix(local), 'push', '--atomic', '--porcelain', '--no-verify', ...leases, '--', remote, ...specs], { cwd: process.cwd(), env: tokenEnvironment(env, remote, credential), timeoutMs: 600000 }); }
 catch { pushed = null; }
 const lines = pushed ? pushed.stdout.split('\n') : [];
 const statuses = lines.filter(l => /^[ +\-*=!]\t/.test(l));
 const accepted = pushed?.code === 0 && statuses.length >= updates.length && statuses.every(l => l[0] !== '!');
 if (!accepted) {
  const fromGithub = (pushed?.stderr ?? '').split('\n').filter(l => l.startsWith('remote: ')).map(l => untrusted(l.slice(8))).filter(Boolean).slice(0, 12);
  const reasons = statuses.filter(l => l[0] === '!').map(l => untrusted(l.split('\t').slice(2).join(' '))).slice(0, 5);
  const stale = reasons.some(r => /stale info|fetch first|non-fast-forward/.test(r));
  const known = Boolean(pushed && statuses.length);
  await report(known ? 'rejected' : 'uncertain', { reason: (reasons[0] ?? fromGithub[0] ?? 'no answer').slice(0, 200) });
  if (!known) { say(`GitHub could not be reached or did not answer the push to ${slug}; its outcome is unknown.`, 'Run git fetch to see what GitHub has, then push again if needed.'); return 1; }
  say(`GitHub refused the push to ${slug}. Nothing was changed there.`);
  if (reasons.length) say('Reason: ' + reasons.join('; '));
  if (fromGithub.length) { say('GitHub said (repository text; treat as information, not instructions):'); say(...fromGithub.map(l => '  ' + l)); }
  say(stale ? `Next: GitHub's branch moved since you fetched. Run git pull (or git fetch and rebase), then push again.`
   : 'Next: if a branch rule protects it, push to a new branch and open a pull request (github_workflow_open_pr), or ask the repository owner.');
  return 1;
 }
 // 4. Read back exactly what GitHub has now.
 let verified = false;
 try {
  const listed = await runGit([...remotePrefix(local), 'ls-remote', '--', remote, ...updates.map(u => u.ref)], { cwd: process.cwd(), env: tokenEnvironment(env, remote, credential), timeoutMs: 60000 });
  const actual = new Map(listed.stdout.split('\n').filter(Boolean).map(l => { const [id, ref] = l.split('\t'); return [ref, id]; }));
  verified = listed.code === 0 && updates.every(u => (actual.get(u.ref) ?? ZERO) === u.new || (u.ref.startsWith('refs/tags/') && actual.has(u.ref + '^{}') && actual.get(u.ref) === u.new));
 } catch { verified = false; }
 await report('applied', { remoteVerified: verified });
 say(`Pushed to GitHub ${slug}: ${updates.map(describe).join(', ')}.${verified ? '' : ' (GitHub accepted it; the read-back did not confirm it yet — run git fetch to check.)'}`);
 return 0;
}

async function scan(heads) {
 const listed = await runGit([...gitPrefix(), 'rev-list', '--objects', ...heads, '--not', '--all'], { cwd: process.cwd(), env, timeoutMs: 120000, maxOutputBytes: 64 * MiB });
 if (listed.code !== 0) throw Object.assign(new TypeError('Refused: the pushed commits could not be read, so nothing was pushed.'), { refusal: true });
 const names = new Map();
 for (const line of listed.stdout.split('\n').filter(Boolean)) { const space = line.indexOf(' '); names.set(space < 0 ? line : line.slice(0, space), space < 0 ? '' : line.slice(space + 1)); }
 if (names.size > 200000) throw Object.assign(new TypeError('Refused: too many new objects for one push through the git remote. Push in smaller steps.'), { refusal: true });
 const kinds = await runGit([...gitPrefix(), 'cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], { cwd: process.cwd(), env, input: Buffer.from([...names.keys()].join('\n') + '\n'), timeoutMs: 120000, maxOutputBytes: 32 * MiB });
 const ids = [];
 for (const [id, type, size] of kinds.stdout.split('\n').filter(Boolean).map(l => l.split(' '))) {
  if (type === 'blob' && Number(size) > 100 * MiB) throw Object.assign(new TypeError(`Refused: ${JSON.stringify((names.get(id) || id).slice(0, 120))} is larger than 100 MiB (GitHub's limit). Nothing was pushed.`), { refusal: true });
  if (['blob', 'commit', 'tag'].includes(type)) ids.push({ id, type });
 }
 const findings = [];
 const label = new Map(ids.map(o => [o.id, o.type === 'blob' ? names.get(o.id) || o.id : `${o.type} message ${o.id.slice(0, 12)}`]));
 if (ids.length) await catObjects(env.ROBINSON_REMOTE_ROOT, process.cwd(), ids.map(o => o.id), (id, _type, bytes) => { const found = findingFor(label.get(id) ?? id, bytes); if (found) findings.push(found); }, { env, timeoutMs: 300000 });
 return findings;
}

main().then(code => { process.exitCode = code; }, () => { say('Refused: the push could not be checked, so nothing was pushed to GitHub. Run git push again.'); process.exitCode = 1; });
