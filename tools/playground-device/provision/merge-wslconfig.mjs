#!/usr/bin/env node
// PLAY-3 §3 step 3 — merge the Playground sizing keys into the user's
// existing %UserProfile%\.wslconfig WITHOUT clobbering anything: unknown
// sections and keys are preserved verbatim, keys the user already set are
// respected (theirs wins — the installer reports what it found instead of
// overriding a deliberate choice), and re-running is a no-op (idempotent).
// Conservative by construction: the only keys managed are the four sizing
// keys under [wsl2]; when the existing file cannot be parsed into sections
// at all, the merge refuses rather than risk rewriting a hand-edited file.
import {readFile, writeFile} from 'node:fs/promises';

export const MANAGED_KEYS = ['memory', 'processors', 'swap', 'networkingMode'];

// Recommended sizing: half of physical RAM clamped to [2 GB, 8 GB], half
// the logical processors clamped to [1, 8], 2 GB swap, mirrored networking.
export function recommendedSizing({memoryBytes, processors}) {
  const gb = Math.min(8, Math.max(2, Math.floor(memoryBytes / 2 / 1073741824)));
  const cpu = Math.min(8, Math.max(1, Math.floor(processors / 2)));
  return {memory: gb + 'GB', processors: String(cpu), swap: '2GB', networkingMode: 'mirrored'};
}

// Parse the small INI dialect .wslconfig uses: [section] headers, key=value
// lines, # and ; comments, blank lines. Returns the line list with section
// context, or throws on a key line outside any section.
export function parseWslConfig(text) {
  const lines = text.split(/\r?\n/);
  const entries = []; let section = null;
  lines.forEach((raw, i) => {
    const t = raw.trim();
    if (!t || t.startsWith('#') || t.startsWith(';')) return;
    const sec = /^\[([^\]]+)\]$/.exec(t);
    if (sec) { section = sec[1].trim().toLowerCase(); return; }
    const kv = /^([^=]+)=(.*)$/.exec(t);
    if (kv) { if (!section) throw new Error('key outside any section at line ' + (i + 1)); entries.push({section, key: kv[1].trim(), value: kv[2].trim(), line: i}); return; }
    throw new Error('unparsable line ' + (i + 1) + ': ' + t);
  });
  return {lines, entries};
}

// Pure merge: returns {text, changed, respected} — respected lists managed
// keys already present (left untouched, user's value wins).
export function mergeWslConfig(existingText, sizing) {
  const {lines, entries} = parseWslConfig(existingText ?? '');
  const present = new Map(entries.filter(e => e.section === 'wsl2').map(e => [e.key.toLowerCase(), e]));
  const respected = [], missing = [];
  for (const k of MANAGED_KEYS) (present.has(k.toLowerCase()) ? respected : missing).push(k);
  if (!missing.length) return {text: existingText ?? '', changed: false, respected};
  const additions = missing.map(k => k + '=' + sizing[k]);
  const out = [...lines];
  // Drop a single trailing empty line so appends land cleanly; the file is
  // re-terminated with exactly one newline below.
  while (out.length && out[out.length - 1] === '') out.pop();
  const wsl2Header = out.findIndex(l => /^\s*\[wsl2\]\s*$/i.test(l));
  if (wsl2Header === -1) out.push('[wsl2]', ...additions);
  else {
    // Insert after the last entry line of the [wsl2] section.
    let insertAt = wsl2Header + 1;
    for (let i = wsl2Header + 1; i < out.length; i++) {
      if (/^\s*\[/.test(out[i])) break;
      if (out[i].trim()) insertAt = i + 1;
    }
    out.splice(insertAt, 0, ...additions);
  }
  return {text: out.join('\n') + '\n', changed: true, respected};
}

export async function mergeWslConfigFile(path, sizing) {
  let existing = '';
  try { existing = await readFile(path, 'utf8'); } catch { existing = ''; }
  const r = mergeWslConfig(existing, sizing);
  if (r.changed) await writeFile(path, r.text);
  return r;
}
