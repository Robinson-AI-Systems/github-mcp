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
//
// GIT-DIRECT-1: a file over GitHub's 100 MiB limit is refused before anything reaches GitHub, with a
// plain Git LFS explanation. On the direct host a push larger than GitHub's 2 GB per-push limit is sent
// on in parts: successive first-parent ranges of the new history go to temporary refs
// (refs/robinson-git-remote/…), each under the limit, then one atomic, leased push moves the person's
// refs and deletes the temporary ones. Git answers "ok" only after that last push; if any part fails,
// the person's refs on GitHub are unchanged, temporary refs are removed, and exactly what GitHub has is
// reported.
//
// GIT-SSH-LEG-1: with NATIVE_GIT_GITHUB_TRANSPORT=ssh on the worker, step 3 goes over SSH with a temporary write deploy
// key for exactly this repository (github-ssh.js): added through the broker after the scan, removed through the broker
// right after the push (success or failure) and read back as gone; HTTPS when the key cannot be added, saying why. The
// read-back stays on HTTPS. Per-step timings and the transport go to the change log; one `remote:` line says how long
// sending to GitHub took. NATIVE_GIT_GITHUB_HTTP_VERSION adds `-c http.version=…` to the HTTPS git commands.
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { redactExcerpt, withProtectionContext, withRepositoryProtection } from '../../src/github/content-protection.js';
import { scannerSettings, defaultScannerSettings } from '../../src/github/scanner-policy.js';
import { catObjects, findingFor } from './upload.js';
import { callBroker, remotePrefix, runGit, tokenEnvironment } from './remote.js';
import { gitPrefix } from './engine.js';
import { ephemeralKey, httpVersionArgs, rememberLeftover, sshGitArgs, sshProblem } from './github-ssh.js';

const ZERO = '0'.repeat(40);
const MiB = 1024 * 1024;
const env = process.env;
const local = env.ROBINSON_REMOTE_LOCAL === '1';
const slug = String(env.ROBINSON_REMOTE_SLUG ?? 'this repository');
const number = (value, fallback) => { const n = Number(value); return Number.isSafeInteger(n) && n > 0 ? n : fallback; };
const FILE_LIMIT = number(env.ROBINSON_REMOTE_FILE_LIMIT, 100 * MiB);
const GITHUB_LIMIT = number(env.ROBINSON_REMOTE_GITHUB_LIMIT, 2048 * MiB);
/** Each part stays at 90% of GitHub's limit (a pack sent to GitHub can differ a little from the received one). */
const PART_BUDGET = Math.floor(GITHUB_LIMIT * 0.9);
const DIRECT = env.ROBINSON_REMOTE_DIRECT === '1';
const PUSH_TIMEOUT_MS = DIRECT ? 3600000 : 600000;
const RENEW_AFTER_MS = env.ROBINSON_REMOTE_LOCAL === '1' && env.ROBINSON_REMOTE_RENEW_MS !== undefined ? Number(env.ROBINSON_REMOTE_RENEW_MS) : 15 * 60000;
const TEMP_PREFIX = 'refs/robinson-git-remote/';
const MAX_PARTS = 25;
const short = id => String(id).slice(0, 12);
const sizeOf = n => n >= 1024 * MiB ? `${(n / (1024 * MiB)).toFixed(2)} GiB` : `${(n / MiB).toFixed(1)} MiB`;
const say = (...lines) => { for (const line of lines) process.stderr.write(String(line).replace(/[\x00-\x09\x0b-\x1f\x7f]/g, ' ') + '\n'); };
const nameOf = ref => ref.replace(/^refs\/(heads|tags)\//, '');
const describe = u => `${u.new === ZERO ? 'deleted' : u.old === ZERO ? 'created' : 'updated'} ${u.ref.startsWith('refs/tags/') ? 'tag' : 'branch'} ${nameOf(u.ref)}`;
// Text from GitHub can carry repository-controlled words (rule names, custom messages): shown as data only.
const HTTP_ARGS = httpVersionArgs(env.ROBINSON_REMOTE_HTTP_VERSION);
const WANT_SSH = env.ROBINSON_REMOTE_TRANSPORT === 'ssh' && /^ssh:\/\/git@(ssh\.)?github\.com(:443)?\//.test(String(env.ROBINSON_REMOTE_GITHUB_SSH ?? '')) || (local && env.ROBINSON_REMOTE_TRANSPORT === 'ssh' && Boolean(env.ROBINSON_REMOTE_GITHUB_SSH));
const seconds = ms => `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`;
const started = Date.now(), timing = {};
/** How this push reaches GitHub: `transport` actually used, `note` why SSH was not (plain words, no secrets). */
const leg = { transport: 'https', note: null, keyRemoved: undefined };
const untrusted = text => redactExcerpt(String(text)).replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);

async function main() {
 const updates = readFileSync(0, 'utf8').split('\n').filter(Boolean).map(line => { const [old, nw, ref] = line.split(' '); return { old, new: nw, ref }; });
 if (!updates.length) return 0;
 if (updates.length > 50) { say('Refused: a push through the git remote can change at most 50 branches or tags at once. Push fewer at a time.'); return 1; }
 const odd = updates.find(u => !/^refs\/(heads|tags)\/./.test(u.ref ?? ''));
 if (odd) { say('Refused: only branches (refs/heads/...) and tags (refs/tags/...) can be pushed through the git remote.'); return 1; }
 const claim = String(env.ROBINSON_REMOTE_CLAIM ?? ''), broker = String(env.ROBINSON_REMOTE_BROKER ?? '');
 const answer = await callBroker(broker, claim, { phase: 'push', updates });
 if (answer.allow !== true || typeof answer.credential !== 'string') { say('Refused by GitHub Unleashed before anything reached GitHub:', untrusted(answer.message ?? 'not allowed'), 'Nothing was pushed.'); return 1; }
 const credential = answer.credential, journal = answer.journal, actedAs = answer.acted_as;
 const report = (outcome, extra = {}) => callBroker(broker + (broker.includes('?') ? '&' : '?') + 'op=report', claim, { journal, outcome, updates, actedAs,
  transport: leg.transport, ...(leg.note ? { transportNote: leg.note } : {}), ...(HTTP_ARGS.length ? { httpVersion: env.ROBINSON_REMOTE_HTTP_VERSION } : {}),
  ...(leg.keyRemoved !== undefined ? { deployKeyRemoved: leg.keyRemoved } : {}), timing: { ...timing, total_ms: Date.now() - started }, ...extra }).catch(() => null);
 // 2. Content protection on every new object (the quarantine is visible through this hook's environment).
 const settings = scannerSettings(answer.scanner_policy?.settings ?? defaultScannerSettings());
 const rules = settings.additionalRules.filter(r => !settings.disabledRules.includes(r.id));
 const created = updates.filter(u => u.new !== ZERO).map(u => u.new);
 const scanStart = Date.now();
 if (created.length) {
  let findings;
  try { findings = await withProtectionContext(() => withRepositoryProtection(rules, () => scan(created, settings))); }
  catch (error) { await report('refused', { reason: error?.reason ?? 'content scan did not finish' }); if (error?.lines) say(...error.lines); else say(error?.refusal ? error.message : 'Refused: the pushed content could not be checked, so nothing was pushed. Push fewer or smaller files.'); return 1; }
  if (findings.length) {
   const first = findings[0];
   // PUSH-REFUSAL-RECEIPTS-1: value-free receipts (path, blob, rule, line, value fingerprint), so an
   // exception can be granted for a file that has never reached GitHub.
   const refusedFindings = findings.filter(f => f.blobSha && f.values).flatMap(f => f.values.map(v => ({ path: f.path, blobSha: f.blobSha, ...v }))).slice(0, 50);
   await report('refused', { reason: 'credential-shaped content', refusedFindings });
   say(`Refused: content protection found credential-shaped content in ${findings.length} file(s) or commit message(s), first ${JSON.stringify(first.path.slice(0, 120))} (${first.lines.length ? first.lines.join(', ') : first.rules.join(', ')}).`,
    'Nothing was pushed to GitHub. Remove the value from your commits (git commit --amend or git rebase -i), keep real secrets in protected setup, then push again.',
    'If it is a deliberate fake test value, the repository owner can allow exactly that value in that file: github_secret_scanner check (path + blobSha below; it works for this refused file even though it is not on GitHub) lists each finding\'s value_fingerprint, then github_secret_scanner configure adds a suppression with pushException: true and that valueFingerprint, verified through door "push". Edits elsewhere in the file keep the exception.',
    ...refusedFindings.slice(0, 6).map(r => `  ${JSON.stringify(r.path.slice(0, 120))} blobSha ${r.blobSha} line ${r.line} rule ${r.rule} value_fingerprint ${r.valueFingerprint}`));
   return 1;
  }
 }
 timing.scan_ms = Date.now() - scanStart;
 // 3. One atomic push to GitHub with a lease on what the client saw (in parts when it is over GitHub's limit).
 const remote = String(env.ROBINSON_REMOTE_GITHUB);
 const auth = { credential, at: Date.now(), renewals: 0 };
 const git = (args, timeoutMs = PUSH_TIMEOUT_MS) => runGit([...remotePrefix(local), ...HTTP_ARGS, ...args], { cwd: process.cwd(), env: tokenEnvironment(env, remote, auth.credential), timeoutMs });
 let plan = null;
 if (DIRECT && created.length) {
  try { plan = await planParts(updates); }
  catch (error) { await report('refused', { reason: error?.reason ?? 'push could not be measured' }); say(...(error?.lines ?? ['Refused: the size of this push could not be measured, so nothing was pushed to GitHub. Run git push again.'])); return 1; }
 }
 const keyUrl = broker + (broker.includes('?') ? '&' : '?') + 'op=key';
 let ssh = WANT_SSH ? await openSsh({ keyUrl, claim, journal, actedAs }) : null;
 /** Pushes (not read-backs) go over the leg in use; every push's time counts as sending to GitHub. */
 const push = async (args, timeoutMs = PUSH_TIMEOUT_MS) => {
  const start = Date.now();
  try { return ssh ? await runGit([...remotePrefix(local), ...sshGitArgs(), ...args.map(a => a === remote ? ssh.remote : a)], { cwd: process.cwd(), env: { ...env, ...ssh.env }, timeoutMs }) : await git(args, timeoutMs); }
  finally { timing.push_ms = (timing.push_ms ?? 0) + Date.now() - start; }
 };
 /** Removes the temporary deploy key (once); called right after the last push and again, as a backstop, at the end. */
 const leave = async () => { if (ssh) leg.keyRemoved = await ssh.close(); };
 try { return await send({ git, push, leave, report, updates, plan, created, auth, broker, claim, journal, actedAs, remote, swapToHttps: () => { ssh = null; } , usingSsh: () => Boolean(ssh) }); }
 finally { await leave(); }
}

async function send({ git, push, leave, report, updates, plan, auth, broker, claim, journal, actedAs, remote, swapToHttps, usingSsh }) {
 if (plan) {
  // Every part goes to its own temporary ref; nothing the person sees changes until the last push.
  const tag = randomBytes(6).toString('hex');
  const temps = [];
  for (let i = 0; i < plan.cuts.length; i++) {
   const temp = { ref: `${TEMP_PREFIX}${tag}/${i + 1}`, id: plan.cuts[i] };
   if (i > 0 && !await renew(auth, broker, claim, journal, actedAs)) return await partFailed({ git, push, leave, report, updates, temps, part: i + 1, parts: plan.cuts.length + 1, reason: 'GitHub authorization could not be renewed', pushed: null });
   let pushed; try { pushed = await push(['push', '--porcelain', '--no-verify', `--force-with-lease=${temp.ref}:`, '--', remote, `${temp.id}:${temp.ref}`]); } catch { pushed = null; }
   if (!acceptedBy(pushed, 1)) return await partFailed({ git, push, leave, report, updates, temps, part: i + 1, parts: plan.cuts.length + 1, pushed });
   temps.push(temp);
   say(`Sent part ${i + 1} of ${plan.cuts.length + 1} to GitHub (up to commit ${short(temp.id)}, about ${sizeOf(plan.sizes[i])}).`);
  }
  if (!await renew(auth, broker, claim, journal, actedAs)) return await partFailed({ git, push, leave, report, updates, temps, part: plan.cuts.length + 1, parts: plan.cuts.length + 1, reason: 'GitHub authorization could not be renewed', pushed: null });
  const specs = [...updates.map(u => (u.new === ZERO ? '' : u.new) + ':' + u.ref), ...temps.map(t => ':' + t.ref)];
  const leases = [...updates.map(u => `--force-with-lease=${u.ref}:${u.old === ZERO ? '' : u.old}`), ...temps.map(t => `--force-with-lease=${t.ref}:${t.id}`)];
  let pushed; try { pushed = await push(['push', '--atomic', '--porcelain', '--no-verify', ...leases, '--', remote, ...specs]); } catch { pushed = null; }
  if (!acceptedBy(pushed, specs.length)) return await partFailed({ git, push, leave, report, updates, temps, part: plan.cuts.length + 1, parts: plan.cuts.length + 1, pushed, final: true });
  return finish({ git, leave, report, updates, note: ` (sent in ${plan.cuts.length + 1} parts, each under GitHub's ${sizeOf(GITHUB_LIMIT)} per-push limit)` });
 }
 const specs = updates.map(u => (u.new === ZERO ? '' : u.new) + ':' + u.ref);
 const leases = updates.map(u => `--force-with-lease=${u.ref}:${u.old === ZERO ? '' : u.old}`);
 const once = run => { try { return run(['push', '--atomic', '--porcelain', '--no-verify', ...leases, '--', remote, ...specs]); } catch { return null; } };
 let pushed = await once(push).catch(() => null);
 // The SSH leg did not get an answer: if GitHub still has exactly what the client saw, send the same leased push over HTTPS.
 if (usingSsh() && !acceptedBy(pushed, updates.length) && !whyRefused(pushed).known) {
  const problem = sshProblem(pushed?.stderr);
  await leave(); swapToHttps();
  const now = await lsRemote(git, updates.map(u => u.ref));
  if (now && updates.every(u => (now.get(u.ref) ?? ZERO) === u.new)) return finish({ git, leave, report, updates, note: '' });
  if (now && updates.every(u => (now.get(u.ref) ?? ZERO) === u.old)) {
   Object.assign(leg, { transport: 'https', note: `${problem}; sent over HTTPS instead` });
   pushed = await once(push).catch(() => null);
  }
 }
 if (!acceptedBy(pushed, updates.length)) {
  await leave();
  const { known, reasons, fromGithub, stale } = whyRefused(pushed);
  await report(known ? 'rejected' : 'uncertain', { reason: (reasons[0] ?? fromGithub[0] ?? 'no answer').slice(0, 200) });
  if (!known) { say(`GitHub could not be reached or did not answer the push to ${slug}; its outcome is unknown.`, 'Run git fetch to see what GitHub has, then push again if needed.'); return 1; }
  say(`GitHub refused the push to ${slug}. Nothing was changed there.`);
  explain(reasons, fromGithub, stale);
  return 1;
 }
 return finish({ git, leave, report, updates, note: '' });
}

/**
 * GIT-SSH-LEG-1: a temporary key pair, its public half added through the broker as a write deploy key on this one
 * repository. Null (HTTPS, with `leg.note` saying why) when either step does not work.
 */
async function openSsh({ keyUrl, claim, journal, actedAs }) {
 const start = Date.now();
 let key;
 try { key = await ephemeralKey({ binary: local && env.ROBINSON_REMOTE_SSH_BINARY ? env.ROBINSON_REMOTE_SSH_BINARY : 'ssh', base: local && env.ROBINSON_REMOTE_SSH_TMP ? env.ROBINSON_REMOTE_SSH_TMP : null }); }
 catch { leg.note = 'a temporary SSH key could not be made on this worker (ssh-keygen missing?)'; timing.key_ms = Date.now() - start; return null; }
 const answer = await callBroker(keyUrl, claim, { action: 'add', journal, actedAs, public_key: key.publicKey, marker: key.id });
 timing.key_ms = Date.now() - start;
 if (answer.allow !== true || !Number.isSafeInteger(answer.key_id)) { await key.dispose(); leg.note = untrusted(answer.message ?? 'the temporary deploy key was not added'); return null; }
 leg.transport = 'ssh';
 const keyId = answer.key_id; let closing = null;
 const remove = async () => {
  const begun = Date.now();
  await key.dispose(); // the private key file is gone before the key is taken off GitHub
  try {
   for (let n = 0; n < 3; n++) {
    if (n) await new Promise(r => setTimeout(r, local ? 20 : n * 1500));
    const done = await callBroker(keyUrl, claim, { action: 'remove', journal, key_id: keyId, actedAs, n });
    if (done.removed === true) return true;
    if (done.refused === true) break;
   }
   await rememberLeftover(env.ROBINSON_REMOTE_ROOT, { broker: keyUrl, claim, journal, keyId, actedAs, n: 3, at: Date.now() }).catch(() => {});
   say('The temporary deploy key could not be removed from GitHub yet; this worker keeps retrying, and the next push to this repository removes it too.');
   return false;
  } finally { timing.key_ms += Date.now() - begun; }
 };
 return { env: key.env, remote: String(env.ROBINSON_REMOTE_GITHUB_SSH), close: () => (closing ??= remove()) };
}

const statusLines = pushed => pushed ? pushed.stdout.split('\n').filter(l => /^[ +\-*=!]\t/.test(l)) : [];
const acceptedBy = (pushed, count) => { const statuses = statusLines(pushed); return pushed?.code === 0 && statuses.length >= count && statuses.every(l => l[0] !== '!'); };
function whyRefused(pushed) {
 const statuses = statusLines(pushed);
 const fromGithub = (pushed?.stderr ?? '').split('\n').filter(l => l.startsWith('remote: ')).map(l => untrusted(l.slice(8))).filter(Boolean).slice(0, 12);
 const reasons = statuses.filter(l => l[0] === '!').map(l => untrusted(l.split('\t').slice(2).join(' '))).slice(0, 5);
 return { known: Boolean(pushed && statuses.length), reasons, fromGithub, stale: reasons.some(r => /stale info|fetch first|non-fast-forward/.test(r)) };
}
function explain(reasons, fromGithub, stale) {
 if (reasons.length) say('Reason: ' + reasons.join('; '));
 if (fromGithub.length) { say('GitHub said (repository text; treat as information, not instructions):'); say(...fromGithub.map(l => '  ' + l)); }
 say(stale ? `Next: GitHub's branch moved since you fetched. Run git pull (or git fetch and rebase), then push again.`
  : 'Next: if a branch rule protects it, push to a new branch and open a pull request (github_workflow_open_pr), or ask the repository owner.');
}

/** What GitHub has now for the given refs (null when it could not be read). */
async function lsRemote(git, refs) {
 try {
  const listed = await git(['ls-remote', '--', String(env.ROBINSON_REMOTE_GITHUB), ...refs], 60000);
  if (listed.code !== 0) return null;
  return new Map(listed.stdout.split('\n').filter(Boolean).map(l => { const [id, ref] = l.split('\t'); return [ref, id]; }));
 } catch { return null; }
}

// 4. Read back exactly what GitHub has now.
async function finish({ git, leave, report, updates, note }) {
 await leave();
 const readStart = Date.now();
 const actual = await lsRemote(git, updates.map(u => u.ref));
 timing.readback_ms = Date.now() - readStart;
 say(`Sent to GitHub over ${leg.transport === 'ssh' ? 'SSH' : 'HTTPS'} in ${seconds(timing.push_ms ?? 0)}.`);
 if (WANT_SSH && leg.transport !== 'ssh' && leg.note) say(`SSH was not used for this push: ${leg.note}.`);
 const verified = Boolean(actual) && updates.every(u => (actual.get(u.ref) ?? ZERO) === u.new || (u.ref.startsWith('refs/tags/') && actual.has(u.ref + '^{}') && actual.get(u.ref) === u.new));
 await report('applied', { remoteVerified: verified });
 say(`Pushed to GitHub ${slug}: ${updates.map(describe).join(', ')}${note}.${verified ? '' : ' (GitHub accepted it; the read-back did not confirm it yet — run git fetch to check.)'}`);
 return 0;
}

/** A part of a large push failed: remove the temporary refs, say exactly what GitHub has, refuse. */
async function partFailed({ git, push, leave, report, updates, temps, part, parts, pushed, reason = null, final = false }) {
 const why = pushed === null && !reason ? { known: false, reasons: [], fromGithub: [], stale: false } : whyRefused(pushed);
 let left = temps;
 if (temps.length) {
  try { await push(['push', '--porcelain', '--no-verify', ...temps.map(t => `--force-with-lease=${t.ref}:${t.id}`), '--', String(env.ROBINSON_REMOTE_GITHUB), ...temps.map(t => ':' + t.ref)], 600000); } catch { /* read back below */ }
 }
 await leave();
 const actual = await lsRemote(git, [...updates.map(u => u.ref), ...temps.map(t => t.ref)]);
 if (actual) left = temps.filter(t => actual.has(t.ref));
 const outcome = final && !why.known && !reason ? 'uncertain' : 'rejected';
 await report(outcome, { reason: `part ${part} of ${parts}: ${reason ?? why.reasons[0] ?? why.fromGithub[0] ?? 'no answer'}`.slice(0, 200) });
 say(final && outcome === 'uncertain'
  ? `GitHub did not answer the last part (${part} of ${parts}) of this large push to ${slug}; its outcome is unknown.`
  : `GitHub refused part ${part} of ${parts} of this large push to ${slug}${reason ? ` (${reason})` : ''}. Your branches and tags were not changed by it.`);
 say('What GitHub has now:');
 for (const u of updates) {
  const now = actual ? actual.get(u.ref) ?? null : undefined;
  const was = u.old === ZERO ? null : u.old;
  say(`  ${nameOf(u.ref)}: ${now === undefined ? 'could not be read (run git fetch)' : now === null ? 'does not exist' : 'at ' + short(now)}${now !== undefined && now === was ? ' (unchanged)' : now !== undefined && now === (u.new === ZERO ? null : u.new) ? ' (your new value)' : now !== undefined ? ' (changed by someone else)' : ''}`);
 }
 if (temps.length) say(left.length ? `  temporary refs still on GitHub (safe to delete): ${left.map(t => t.ref).join(', ')}` : `  the ${temps.length} temporary part ref(s) were removed again.`);
 if (!final || why.known) explain(why.reasons, why.fromGithub, why.stale);
 else say('Run git fetch to see what GitHub has, then push again if needed.');
 return 1;
}

/** A fresh GitHub credential before a later part when the current one is getting old (App tokens last an hour). */
async function renew(auth, broker, claim, journal, actedAs) {
 if (Date.now() - auth.at < RENEW_AFTER_MS) return true;
 if (auth.renewals >= 26) return false;
 const answer = await callBroker(broker, claim, { phase: 'renew', journal, actedAs, n: auth.renewals++ });
 if (answer.allow !== true || typeof answer.credential !== 'string') return false;
 auth.credential = answer.credential; auth.at = Date.now();
 return true;
}

/** Bytes (as stored, compressed) of the objects reachable from `tips` that GitHub does not have yet. */
async function usage(tips, sent) {
 const listed = await runGit([...gitPrefix(), 'rev-list', '--objects', '--disk-usage', ...tips, '--not', '--all', ...sent], { cwd: process.cwd(), env, timeoutMs: 600000 });
 const n = Number(listed.stdout.trim());
 if (listed.code !== 0 || !Number.isSafeInteger(n)) throw new TypeError('measure');
 return n;
}

/**
 * Null when the push fits in one go; otherwise the parts: first-parent commits whose new history, taken
 * in order, stays under PART_BUDGET each (binary search; the reachable set grows along a first-parent chain).
 */
async function planParts(updates) {
 const tips = updates.filter(u => u.new !== ZERO).map(u => u.new);
 const total = await usage(tips, []);
 if (total <= PART_BUDGET) return null;
 const cuts = [], sizes = [];
 for (const tip of tips) {
  const listed = await runGit([...gitPrefix(), 'rev-list', '--first-parent', '--reverse', tip, '--not', '--all', ...cuts], { cwd: process.cwd(), env, timeoutMs: 600000, maxOutputBytes: 64 * MiB });
  if (listed.code !== 0) throw new TypeError('measure');
  const chain = listed.stdout.split('\n').filter(Boolean);
  let start = 0;
  while (start < chain.length) {
   let lo = start, hi = chain.length - 1, best = -1, bestSize = 0;
   while (lo <= hi) {
    const mid = (lo + hi) >> 1, bytes = await usage([chain[mid]], cuts);
    if (bytes <= PART_BUDGET) { best = mid; bestSize = bytes; lo = mid + 1; } else hi = mid - 1;
   }
   if (best < 0) {
    const bytes = await usage([chain[start]], cuts);
    if (bytes > GITHUB_LIMIT) throw Object.assign(new TypeError('part'), { reason: 'one commit is over the GitHub push limit', lines: [
     `Refused: commit ${short(chain[start])} on its own adds about ${sizeOf(bytes)}, more than GitHub accepts in one push (${sizeOf(GITHUB_LIMIT)}). A push can be split only between commits. Nothing was pushed to GitHub.`,
     'Next: split that commit into smaller commits (git reset HEAD~1, then commit the files in several groups), and push again. Files over 100 MiB need Git LFS.'] });
    best = start; bestSize = bytes;
   }
   cuts.push(chain[best]); sizes.push(bestSize); start = best + 1;
   if (cuts.length > MAX_PARTS) throw Object.assign(new TypeError('parts'), { reason: 'too many parts', lines: [
    `Refused: this push would need more than ${MAX_PARTS + 1} parts of up to ${sizeOf(PART_BUDGET)} each. Nothing was pushed to GitHub.`, 'Next: push it in a few steps (git push origin <older-commit>:<branch> first).'] });
  }
 }
 // The last push moves the refs; anything left (annotated tag objects, side history) must fit in it.
 const rest = await usage(tips, cuts);
 if (rest > PART_BUDGET) throw Object.assign(new TypeError('rest'), { reason: 'history that cannot be split', lines: [
  `Refused: after splitting along each branch's main line, about ${sizeOf(rest)} of merged-in history remains, more than one push to GitHub may carry. Nothing was pushed to GitHub.`,
  'Next: push the merged-in branches first (git push origin <branch>), then this one.'] });
 return { cuts, sizes, total };
}

async function scan(heads, settings = null) {
 const listed = await runGit([...gitPrefix(), 'rev-list', '--objects', ...heads, '--not', '--all'], { cwd: process.cwd(), env, timeoutMs: 120000, maxOutputBytes: 64 * MiB });
 if (listed.code !== 0) throw Object.assign(new TypeError('Refused: the pushed commits could not be read, so nothing was pushed.'), { refusal: true });
 const names = new Map();
 for (const line of listed.stdout.split('\n').filter(Boolean)) { const space = line.indexOf(' '); names.set(space < 0 ? line : line.slice(0, space), space < 0 ? '' : line.slice(space + 1)); }
 if (names.size > 200000) throw Object.assign(new TypeError('Refused: too many new objects for one push through the git remote. Push in smaller steps.'), { refusal: true });
 const kinds = await runGit([...gitPrefix(), 'cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], { cwd: process.cwd(), env, input: Buffer.from([...names.keys()].join('\n') + '\n'), timeoutMs: 120000, maxOutputBytes: 32 * MiB });
 const ids = [];
 for (const [id, type, size] of kinds.stdout.split('\n').filter(Boolean).map(l => l.split(' '))) {
  if (type === 'blob' && Number(size) > FILE_LIMIT) { const file = JSON.stringify((names.get(id) || id).slice(0, 120)); throw Object.assign(new TypeError('file too large'), { refusal: true, reason: 'file over the GitHub file limit', lines: [
   `Refused: ${file} is ${sizeOf(Number(size))}, larger than the ${sizeOf(FILE_LIMIT)} GitHub accepts for one file. Nothing was pushed to GitHub.`,
   'GitHub keeps files that large only with Git LFS (Large File Storage), which stores the file outside the repository and commits a small pointer. GitHub LFS includes a free storage and bandwidth quota; use beyond it is paid.',
   'This git remote does not carry Git LFS uploads yet, so it will not set LFS up or buy anything for you.',
   `Next: remove the file from the commits (git rm --cached ${file}, then git commit --amend, or git rebase -i for an older commit), keep it outside Git or use Git LFS directly with GitHub, then push again.`] }); }
  if (['blob', 'commit', 'tag'].includes(type)) ids.push({ id, type });
 }
 const findings = [];
 const label = new Map(ids.map(o => [o.id, o.type === 'blob' ? names.get(o.id) || o.id : `${o.type} message ${o.id.slice(0, 12)}`]));
 if (ids.length) await catObjects(env.ROBINSON_REMOTE_ROOT, process.cwd(), ids.map(o => o.id), (id, type, bytes) => { const found = findingFor(label.get(id) ?? id, bytes, settings); if (found) findings.push(type === 'blob' ? { ...found, blobSha: id } : found); }, { env, timeoutMs: 300000 });
 return findings;
}

main().then(code => { process.exitCode = code; }, () => { say('Refused: the push could not be checked, so nothing was pushed to GitHub. Run git push again.'); process.exitCode = 1; });
