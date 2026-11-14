#!/usr/bin/env node
// SELF-SCAN-1 (2026-11-14, Chris approved): scan this repository's own tracked files with the same gate a push
// through GitHub Unleashed uses, so a change that its own scanner would refuse (as content-protection.js once did)
// fails CI instead of surfacing at the next push. Deliberate exceptions live in docs/scanner-self-exceptions.json
// as value fingerprints (never values), exactly like the owner's push exceptions.
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { blockingPushFindings, valueFingerprint } from '../src/github/file-protection.js';
import { defaultScannerSettings } from '../src/github/scanner-policy.js';

const MAX_BYTES = 1_000_000;
const exceptions = JSON.parse(readFileSync(new URL('../docs/scanner-self-exceptions.json', import.meta.url), 'utf8')).exceptions ?? [];
const settings = { ...defaultScannerSettings(), suppressions: exceptions.map((e) => ({ ...e, blobSha: '0'.repeat(40), pushException: true })) };
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const blocked = [];
let scanned = 0;
for (const path of files) {
  let bytes;
  try { if (statSync(path).size > MAX_BYTES) continue; bytes = readFileSync(path); } catch { continue; }
  if (bytes.includes(0)) continue; // binary
  scanned++;
  const text = bytes.toString('utf8');
  for (const f of blockingPushFindings(path, text, settings)) {
    const matched = Buffer.from(text).subarray(f.byte_offset, f.byte_offset + f.byte_length).toString();
    blocked.push({ path, line: f.line, rule: f.rule, valueFingerprint: valueFingerprint(path, f.rule, matched) });
  }
}
if (blocked.length) {
  console.error(`self-scan: ${blocked.length} credential-shaped value(s) the push gate would refuse (values not shown):`);
  for (const b of blocked.slice(0, 50)) console.error(`  ${b.path}:${b.line} ${b.rule} valueFingerprint=${b.valueFingerprint}`);
  console.error('Remove them, build test values at runtime, or (for a deliberate false positive) add the fingerprint to docs/scanner-self-exceptions.json with a reason.');
  process.exit(1);
}
console.log(`self-scan: ${scanned} tracked text files pass the push gate (${exceptions.length} recorded exception(s)).`);
