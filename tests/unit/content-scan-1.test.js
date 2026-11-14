// CONTENT-SCAN-1 (2026-11-14, Chris approved): the contents-API writers (github_content_put_file,
// github_content_push_files, github_content_edit_files) refuse credential-shaped text the way a git push does:
// the same rules, documented FAKE fixtures allowed, the owner's exact push exceptions honoured, and a value
// already in the file on the branch never blocks an edit elsewhere in it. Every value is fake and built at runtime.
import { describe, expect, it } from 'vitest';
import { refuseNewSecrets } from '../../src/tools/code-write.js';
import { blockingPushFindings, valueFingerprint } from '../../src/github/file-protection.js';
import { defaultScannerSettings } from '../../src/github/scanner-policy.js';
import { containsCredential } from '../../src/github/content-protection.js';

const SAMPLE = ['postgres', '://demo_user:', 'demo', 'Pass9921', '@localhost:5432/app'].join('');
const target = { owner: 'example-org', repo: 'hello' };
const ctxWith = (settings = null) => ({ db: { getSetting: async () => (settings ? { revision: 1, history: [], settings } : null) } });

describe('CONTENT-SCAN-1', () => {
  it('refuses a new credential-shaped value, naming path, line, rule and the exception call', async () => {
    const err = await refuseNewSecrets(ctxWith(), target, [{ path: '.env.example', text: `A=1\nDATABASE_URL=${SAMPLE}\n`, previous: null }]).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('content_protection');
    expect(err.status).toBe(422);
    expect(err.message).toMatch(/"\.env\.example" line 2/);
    expect(err.message).toMatch(/github_secret_scanner configure/);
    expect(err.message).not.toContain('Pass9921');
    expect(err.findings[0]).toMatchObject({ path: '.env.example', line: 2 });
  });

  it('lets clean text and documented FAKE fixtures through', async () => {
    await expect(refuseNewSecrets(ctxWith(), target, [{ path: 'README.md', text: '# hello\nno secrets here\n' }])).resolves.toBeUndefined();
    await expect(refuseNewSecrets(ctxWith(), target, [{ path: 't.js', text: 'const token = "FAKE-access-token-1";\n' }])).resolves.toBeUndefined();
  });

  it('does not block an edit to a file whose value was already on the branch', async () => {
    const before = `DATABASE_URL=${SAMPLE}\n`;
    await expect(refuseNewSecrets(ctxWith(), target, [{ path: '.env.example', text: `${before}NEW=1\n`, previous: before }])).resolves.toBeUndefined();
    await expect(refuseNewSecrets(ctxWith(), target, [{ path: '.env.example', text: `${before}NEW=1\n`, previous: async () => before }])).resolves.toBeUndefined();
  });

  it('honours the owner\'s exact push exception for that path and value', async () => {
    const text = `DATABASE_URL=${SAMPLE}\n`;
    const [f] = blockingPushFindings('.env.example', text, defaultScannerSettings());
    const matched = Buffer.from(text).subarray(f.byte_offset, f.byte_offset + f.byte_length).toString();
    const settings = { ...defaultScannerSettings(), suppressions: [{ rule: f.rule, path: '.env.example', blobSha: 'a'.repeat(40),
      reason: 'documented sample address', pushException: true, valueFingerprint: valueFingerprint('.env.example', f.rule, matched) }] };
    await expect(refuseNewSecrets(ctxWith(settings), target, [{ path: '.env.example', text }])).resolves.toBeUndefined();
    // the same value in another file is still refused
    await expect(refuseNewSecrets(ctxWith(settings), target, [{ path: 'other.env', text }])).rejects.toMatchObject({ code: 'content_protection' });
  });
});

// CODE-REF-1: code that HANDS a password along is not a password; real values still block.
describe('CODE-REF-1', () => {
  const pushed = (t) => containsCredential(t, { fixtures: 'allow' });
  it('does not flag code that refers to a password', () => {
    expect(pushed("const auth = (token) => () => ({ host: 'h', database: 'd', username: 'x-access-token', password: token });")).toBe(false);
    expect(pushed('const host = h, database = d; const password = basicPassword(req.headers.authorization);')).toBe(false);
    expect(pushed('pool({ host: h, database: d, password: cfg.db.password, port: 5 });')).toBe(false);
  });
  it('still flags real values in connection strings and config', () => {
    const value = ['hun', 'ter', '2Zq'].join('');
    expect(pushed(`Server=db1;Database=app;User Id=sa;Password=${value};`)).toBe(true);
    expect(pushed(`host: db1\ndatabase: app\nport: 5432,\npassword: ${value}\n`)).toBe(true);
  });
  it('treats the bare word for a password in a sample address as a placeholder (pushes only)', () => {
    const sample = ['postgres://user:', 'pass', '@db.example.com/app'].join('');
    expect(pushed(sample)).toBe(false);
    expect(containsCredential(sample)).toBe(true); // reads still hide it
  });
});
