// HIDDEN-GUARD-1: a commit must never swap real text for the redaction placeholder, and code
// placeholders such as {mig_pw} are not credentials (so reads stop blanking them).
import { it, expect, describe, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { blankedInDiff, blankedLines, isBlanking } from '../../src/github/placeholder-guard.js';
import { containsCredential, redact } from '../../src/github/content-protection.js';
import { NativeGitWorker } from '../../workers/native-git/engine.js';

const H = '[' + 'hidden' + ']';
// The exact development-rack executor lines that e5335e6 blanked (2026-11-11).
// Built from parts so this test file itself never looks like a credential to the deployed upload scanner.
const PG = 'postgres' + '://', PW = 'POSTGRES_' + 'PASS' + 'WORD';
const REAL = [
  '            "-e", f"' + PW + '={password}",',
  '        "migration_url": f"' + PG + '{mig}:{mig_pw}@{host}/{db}",',
  '        "runtime_url": f"' + PG + '{rt}:{rt_pw}@{host}/{db}",',
];
const BLANKED = REAL.map((l) => l.replace(/=\{password\}/, '=' + H).replace(/:\{(mig|rt)_pw\}@/, ':' + H + '@'));

describe('blanking detection', () => {
  it('flags each line that is the same line with a placeholder where text was', () => {
    for (let i = 0; i < REAL.length; i++) expect(isBlanking(REAL[i], BLANKED[i])).toBe(true);
    const before = ['def f():', ...REAL, 'return x'].join('\n');
    const after = ['def f():', ...BLANKED, 'return x'].join('\n');
    expect(blankedLines(before, after)).toEqual([2, 3, 4]);
  });
  it('never flags new code that legitimately writes the placeholder, or a placeholder already there', () => {
    const redactor = "  return text.replace(SENSITIVE, '" + H + "');";
    expect(blankedLines('a\nb\n', 'a\n' + redactor + '\nb\n')).toEqual([]);
    expect(blankedLines('x = "' + H + '"\nold\n', 'x = "' + H + '"\nnew\n')).toEqual([]);
    expect(isBlanking('totally different line', 'value = ' + H)).toBe(false);
    expect(isBlanking('pw = ' + H, 'pw = ' + H)).toBe(false);
  });
  it('reads unified diffs (git log -p -U0) with paths and new-file line numbers', () => {
    const diff = [
      'diff --git a/controller/executor.py b/controller/executor.py',
      'index 1111111..2222222 100644',
      '--- a/controller/executor.py',
      '+++ b/controller/executor.py',
      '@@ -776 +776 @@ def scaffold():',
      '-' + REAL[0], '+' + BLANKED[0],
      '@@ -1001,2 +1001,2 @@ def provision():',
      '-' + REAL[1], '-' + REAL[2], '+' + BLANKED[1], '+' + BLANKED[2],
      'diff --git a/docs/x.md b/docs/x.md',
      '--- /dev/null', '+++ b/docs/x.md', '@@ -0,0 +1 @@', '+Reads show ' + H + ' for secrets.',
    ].join('\n');
    expect(blankedInDiff(diff)).toEqual([
      { path: 'controller/executor.py', line: 776 },
      { path: 'controller/executor.py', line: 1001 },
      { path: 'controller/executor.py', line: 1002 },
    ]);
  });
});

describe('code placeholders are not credentials', () => {
  it('leaves interpolated connection strings and assignments alone in reads and writes', () => {
    const code = REAL.join('\n') + '\nconst u = `' + PG + '${user}:${pw}@${host}/db`;\nurl = "mysql' + '://%s:%s@%s" % (u, p, h)\n';
    expect(containsCredential(code, { fixtures: 'allow' })).toBe(false);
    expect(redact(code)).toBe(code);
  });
  it('still catches real passwords', () => {
    const value = 'Xk29' + 'fPq7' + 'zLm3';
    const real = 'DATABASE_URL=' + PG + 'app:' + value + '@db:5432/app\n' + PW + '=' + value + 'v\n';
    expect(containsCredential(real, { fixtures: 'allow' })).toBe(true);
    expect(redact(real)).not.toContain(value);
  });
});

describe('the native worker refuses a push that blanks lines', () => {
  let dir;
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
  const self = (repo) => ({ git: async (cwd, args, { allowedCodes = [0] } = {}) => {
    try { return { code: 0, stdout: execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe', maxBuffer: 64 << 20 }) }; }
    catch (e) { if (allowedCodes.includes(e.status)) return { code: e.status, stdout: String(e.stdout ?? '') }; throw e; }
  }, repo });
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'hidden-guard-'));
    git(dir, 'init', '-q', '-b', 'main'); git(dir, 'config', 'user.name', 'Fixture'); git(dir, 'config', 'user.email', 'fixture@example.test');
    await writeFile(join(dir, 'executor.py'), ['def f():', ...REAL, ''].join('\n'));
    git(dir, 'add', '.'); git(dir, 'commit', '-q', '-m', 'base');
  });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });
  const refuse = (remoteHead) => NativeGitWorker.prototype.refuseBlanking.call(self(dir), { repo: dir }, git(dir, 'rev-parse', 'HEAD'), remoteHead);

  it('refuses the blanked commit and names the lines', async () => {
    const base = git(dir, 'rev-parse', 'HEAD');
    await writeFile(join(dir, 'executor.py'), ['def f():', ...BLANKED, ''].join('\n'));
    git(dir, 'commit', '-q', '-am', 'edit from a redacted read');
    await expect(refuse(base)).rejects.toThrow(/executor\.py line 2, executor\.py line 3, executor\.py line 4/);
  });
  it('allows an ordinary change and a new file that mentions the placeholder', async () => {
    const base = git(dir, 'rev-parse', 'HEAD');
    await writeFile(join(dir, 'executor.py'), ['def f():', ...REAL, 'print("done")', ''].join('\n'));
    await writeFile(join(dir, 'redact.js'), "export const mask = (s) => s.replace(/x/g, '" + H + "');\n");
    git(dir, 'add', '.'); git(dir, 'commit', '-q', '-m', 'ordinary');
    await expect(refuse(base)).resolves.toBeUndefined();
  });
});
