#!/usr/bin/env node
// MAP-COUNTS-1 (2026-11-18) + MAP-CLAIMS-1 (2026-11-20): every number and every dated or
// policy claim the relational map states about the code is checked at this commit, so the map
// cannot drift silently (Second Shift review runs of 2026-11-18 and 2026-11-20).
//
// docs/relational-map/counts.json lists each stated count:
//   { "name": "tools", "value": 517, "label": "tools", "files": ["README.md"],
//     "how": { "command": "python3 scripts/count-catalog.py", "match": "(\\d+) tools" } }
// "label" is the exact noun phrase the map states after the number ("243 models"); counts are
// checked as number+label pairs, so swapping two counts' numbers is caught. Grouped numbers
// (1,243) are read whole, "388-tool" reads as "388 tools"; signed, decimal-, letter-prefixed or approximation-marked forms
// (-243, 0.243, 1e243, "~ 243", "about 243") never count as the plain statement; an
// identifier between number and noun ("253 registered vercel_* tools") is still a count.
// "how" is one of:
//   { "files": "src/tools/*.js" }                       how many files match a simple glob (* and **)
//   { "matches": "regex", "in": "glob", "flags": "gm" } how many regex matches across those files
//   { "command": "...", "match": "regex with one (\\d+)" } a number read from a command's output
//
// docs/relational-map/claims.json ties each dated, live-state or policy claim to its source:
//   { "file": "01-entry-and-clients.md", "states": "Since 2026-11-08",
//     "source": { "in": "docs/STATUS.md", "matches": "^## 2026-11-08" } }
// "states" is text the map file must contain (whitespace-insensitive); "source" names a repo
// file (or glob) and a regex that must match there (or a "command" whose output must match).
//
// Checks: (1) each count's real value equals "value"; (2) each listed map file states that
// "<value> <label>" pair; (3) no map file states a count counts.json does not list for it;
// (4) each claim's text is in its map file and its source still says it; (5) every date
// (YYYY-MM-DD) in a map file sits inside some claim's "states" text for that file, so no date
// is asserted without a source. Exit 1 with the reason on any mismatch. Plain Node, no
// dependencies; run from the repo root.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execSync } from 'node:child_process';

const MAP = 'docs/relational-map';
// Generic count nouns, for recognising statements counts.json does not register.
// The registered labels are tried before these (longest first).
const GENERIC = 'tools?|ops|modules?|tables?|operations?|routes?|sections?|families|endpoints?|scopes?|services?|workers?|repos?|projects?|tests?|files?|models?|enums?|folders?|entries|groups?|crons?';
// Words allowed between a number and its noun: fixed qualifiers, or identifier-like tokens
// (anything with an underscore or a star, e.g. vercel_* or workspace_).
const QUALIFIER = '(?:registered|hand-built|catalog(?:ue)?|visible|MCP|vendored|schema|[A-Za-z0-9]*[_*][\\w*]*)';
const DATE_RE = /(?<![\d-])20\d\d-\d\d-\d\d(?![\d-])/g;

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
}
function glob(pattern) {
  const segs = pattern.split('/');
  const first = segs.findIndex((x) => /[*?]/.test(x));
  const base = (first < 0 ? segs.slice(0, -1) : segs.slice(0, first)).join('/') || '.';
  let re = '';
  for (let i = 0; i < segs.length; i++) {
    const last = i === segs.length - 1;
    if (segs[i] === '**') { re += '(?:[^/]+/)*'; continue; }
    re += segs[i].replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]') + (last ? '' : '/');
  }
  const rx = new RegExp('^' + re + '$');
  return walk(base).map((p) => relative('.', p).split('\\').join('/')).filter((p) => rx.test(p) && !p.includes('node_modules/'));
}
function run(command) {
  return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 });
}
function actual(how) {
  if (how.files) return glob(how.files).length;
  if (how.matches) {
    const re = new RegExp(how.matches, how.flags ?? 'gm');
    return glob(how.in).reduce((n, f) => n + (readFileSync(f, 'utf8').match(re) ?? []).length, 0);
  }
  if (how.command) {
    const m = new RegExp(how.match).exec(run(how.command));
    if (!m) throw new Error(`"${how.command}" printed nothing matching ${how.match}`);
    return Number(m[1]);
  }
  throw new Error('unknown "how": give files, matches or command');
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const flat = (s) => s.replace(/\s+/g, ' ');
// The last word's plural "s" is optional, so "388-tool registry" states "388 tools".
const labelRe = (label) => norm(label).split(' ').map(esc).join('\\s+').replace(/s$/, 's?');
const key = (n, label) => `${n} ${norm(label).replace(/s$/, '')}`;

const problems = [];
const spec = JSON.parse(readFileSync(join(MAP, 'counts.json'), 'utf8'));
for (const c of spec.counts) if (!c.label) problems.push(`${c.name}: counts.json entry has no "label" (the noun phrase the map states after the number)`);
const labels = [...new Set(spec.counts.filter((c) => c.label).map((c) => norm(c.label)))].sort((a, b) => b.length - a.length);
const COUNT_RE = new RegExp(`(?<![\\w.\\-/#:,])(?:~\\s*|(?:about|around|roughly|approximately)\\s+)?(\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\s+|-)(?:${QUALIFIER}\\s+){0,2}(${[...labels.map(labelRe), GENERIC].join('|')})(?![\\w-])`, 'gi');

const listed = new Map(); // file -> Set of stated "<value> <label>" pairs
for (const c of spec.counts) {
  if (!c.label) continue;
  let real;
  try { real = actual(c.how); } catch (e) { problems.push(`${c.name}: could not count (${e.message})`); continue; }
  if (real !== c.value) problems.push(`${c.name}: the map says ${c.value}, the code has ${real}. Update docs/relational-map/counts.json and the map text.`);
  for (const f of c.files) {
    const text = readFileSync(join(MAP, f), 'utf8');
    const pairRe = new RegExp(`(?<![\\d,.\\-+a-zA-Z])${c.value}(?:\\s+|-)(?:${QUALIFIER}\\s+){0,2}${labelRe(c.label)}(?![\\w-])`, 'gi');
    const stated = [...text.matchAll(pairRe)].some((m) => !/(?:about|around|roughly|approximately|~)\s*$/i.test(text.slice(Math.max(0, m.index - 16), m.index)));
    if (!stated) problems.push(`${c.name}: ${MAP}/${f} does not state "${c.value} ${c.label}"`);
    if (!listed.has(f)) listed.set(f, new Set());
    listed.get(f).add(key(c.value, c.label));
  }
}

const mapFiles = readdirSync(MAP).filter((n) => n.endsWith('.md'));
for (const f of mapFiles) {
  const text = readFileSync(join(MAP, f), 'utf8');
  for (const m of text.matchAll(COUNT_RE)) {
    const pair = key(m[1].replace(/,/g, ''), m[2]);
    if (/^(?:~|about|around|roughly|approximately)\b/i.test(m[0])) problems.push(`${MAP}/${f}: "${m[0]}" is an approximate count; state the exact number and list it in counts.json`);
    else if (!listed.get(f)?.has(pair)) problems.push(`${MAP}/${f}: "${flat(m[0])}" is a count that counts.json does not check for this file; add it there (with its label) or drop the number`);
  }
}

const claimsPath = join(MAP, 'claims.json');
const claims = existsSync(claimsPath) ? JSON.parse(readFileSync(claimsPath, 'utf8')).claims : [];
const covered = new Map(); // file -> list of [start, end) spans of flattened text covered by claims
for (const c of claims) {
  const where = `${c.file}: "${c.states}"`;
  if (!mapFiles.includes(c.file)) { problems.push(`claims.json: ${c.file} is not a map file`); continue; }
  const text = flat(readFileSync(join(MAP, c.file), 'utf8'));
  const at = text.indexOf(flat(c.states));
  if (at < 0) { problems.push(`claim ${where}: the map file no longer states this text`); continue; }
  if (!covered.has(c.file)) covered.set(c.file, []);
  for (let i = at; i >= 0; i = text.indexOf(flat(c.states), i + 1)) covered.get(c.file).push([i, i + flat(c.states).length]);
  const s = c.source ?? {};
  try {
    if (s.command) {
      if (!new RegExp(s.match, s.flags ?? 'm').test(run(s.command))) problems.push(`claim ${where}: "${s.command}" no longer prints ${s.match}`);
    } else if (s.in && s.matches) {
      const files = glob(s.in);
      if (!files.length) problems.push(`claim ${where}: source ${s.in} does not exist`);
      else if (!files.some((p) => new RegExp(s.matches, s.flags ?? 'm').test(readFileSync(p, 'utf8')))) problems.push(`claim ${where}: ${s.in} no longer matches ${s.matches}`);
    } else problems.push(`claim ${where}: give a source with "in"+"matches" or "command"+"match"`);
  } catch (e) { problems.push(`claim ${where}: could not check its source (${e.message})`); }
}
for (const f of mapFiles) {
  const text = flat(readFileSync(join(MAP, f), 'utf8'));
  const spans = covered.get(f) ?? [];
  for (const m of text.matchAll(DATE_RE)) {
    if (!spans.some(([a, b]) => m.index >= a && m.index + m[0].length <= b)) {
      problems.push(`${MAP}/${f}: the date ${m[0]} ("…${text.slice(Math.max(0, m.index - 40), m.index + 20).trim()}…") is not tied to a source; add it to claims.json or drop it`);
    }
  }
}

if (problems.length) { console.error('relational map out of step with the code:\n- ' + problems.join('\n- ')); process.exit(1); }
console.log(`relational map OK: ${spec.counts.length} counts and ${claims.length} claims checked against the code`);
