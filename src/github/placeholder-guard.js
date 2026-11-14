// HIDDEN-GUARD-1 (2026-11-11): never commit a redaction placeholder in place of real text.
//
// Reads that pass through content protection (archive downloads, file reads, diffs) replace
// credential-shaped text with a placeholder. A copy edited from such a read and written back
// silently swaps real code for the placeholder: development-rack's executor lost its job
// database connection strings this way twice (2026-11-05 #4, 2026-11-11 e5335e6), and every
// new build's database login then failed. Content protection itself accepts the placeholder
// (it is not a credential), so nothing stopped it.
//
// The guard is exact, not a heuristic about secrets: a change is refused only when a line it
// ADDS contains a placeholder AND a line it REMOVES in the same place is that same line with
// the placeholder spots filled by something else, i.e. the change is precisely "redact this
// line". Brand-new lines that legitimately mention the placeholder (redaction code, tests,
// docs) are never touched, and nothing here reads, returns or logs the replaced text.
import { HIDDEN } from './secret-literals.js';

// The placeholder content protection writes ([hidden]) and the longer forms some fleet
// servers use ([hidden credential], [hidden signed URL]).
const PLACEHOLDER = /\[hidden(?: [A-Za-z][A-Za-z ]{0,30})?\]/g;
const MAX_LINE = 4000;
const MAX_PAIRS = 200000;

export const hasPlaceholder = (line) => { PLACEHOLDER.lastIndex = 0; return line.length <= MAX_LINE && PLACEHOLDER.test(line); };

function template(line) {
  PLACEHOLDER.lastIndex = 0;
  const parts = line.split(PLACEHOLDER);
  if (parts.length < 2) return null;
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return { prefix: parts[0], suffix: parts.at(-1), re: new RegExp('^' + parts.map(escape).join('(.+?)') + '$', 's') };
}

/** True when `removed` is exactly `added` with every placeholder spot holding other, non-placeholder text. */
export function isBlanking(removed, added) {
  if (removed === added || !hasPlaceholder(added) || removed.length > MAX_LINE) return false;
  const t = template(added);
  if (!t || !removed.startsWith(t.prefix) || !removed.endsWith(t.suffix)) return false;
  const m = t.re.exec(removed);
  if (!m) return false;
  return m.slice(1).every((fill) => fill.length > 0 && fill !== HIDDEN && !hasPlaceholder(fill));
}

/** Check one removed/added block (a diff hunk, or a whole file's old and new lines). */
function blankedIn(removed, added, lineOf) {
  const found = [];
  const candidates = added.map((line, i) => ({ line, i })).filter((x) => hasPlaceholder(x.line));
  if (!candidates.length || !removed.length) return found;
  const keep = new Set(removed);
  let work = 0;
  for (const { line, i } of candidates) {
    if (keep.has(line)) continue; // the same line was already there: not a new blanking
    for (const old of removed) {
      if (++work > MAX_PAIRS) return found;
      if (isBlanking(old, line)) { found.push(lineOf(i)); break; }
    }
  }
  return found;
}

/** Whole-file form: line numbers (1-based, in `after`) where a line of `before` was blanked. */
export function blankedLines(before, after) {
  if (typeof before !== 'string' || typeof after !== 'string' || before === after) return [];
  const old = before.split('\n'), now = after.split('\n');
  const oldSet = new Set(old), nowSet = new Set(now);
  // Only lines that changed can be a blanking: pair the new lines with the lines that disappeared.
  const gone = old.filter((l) => !nowSet.has(l));
  const fresh = now.map((line, i) => ({ line, i })).filter((x) => !oldSet.has(x.line));
  return blankedIn(gone, fresh.map((x) => x.line), (k) => fresh[k].i + 1);
}

/**
 * Unified-diff form (`git diff -U0` / `git log -p -U0`): [{ path, line }] for every added line
 * that blanks a removed line of the same hunk. Binary and header lines are ignored.
 */
export function blankedInDiff(diffText) {
  const findings = [];
  let path = null, next = 0, removed = [], added = [], addedAt = [];
  const flush = () => {
    if (path && added.length && removed.length) for (const line of blankedIn(removed, added, (i) => addedAt[i])) findings.push({ path, line });
    removed = []; added = []; addedAt = [];
  };
  for (const raw of String(diffText).split('\n')) {
    if (raw.startsWith('diff --git ')) { flush(); path = null; continue; }
    if (raw.startsWith('+++ ')) { const p = raw.slice(4); path = p === '/dev/null' ? null : p.replace(/^b\//, ''); continue; }
    if (raw.startsWith('--- ')) continue;
    if (raw.startsWith('@@')) { flush(); const m = /\+(\d+)/.exec(raw); next = m ? Number(m[1]) : 0; continue; }
    if (raw.startsWith('-')) { removed.push(raw.slice(1)); continue; }
    if (raw.startsWith('+')) { added.push(raw.slice(1)); addedAt.push(next++); continue; }
    if (raw.startsWith(' ')) { next++; continue; }
  }
  flush();
  return findings;
}

export function blankingRefusalText(findings) {
  const where = findings.slice(0, 5).map((f) => (f.path ? `${f.path} line ${f.line}` : `line ${f.line}`)).join(', ');
  return `Refused: this change would replace real text with the redaction placeholder ${HIDDEN} (${where}${findings.length > 5 ? ` and ${findings.length - 5} more` : ''}). `
    + 'That usually means the file was edited from a redacted read (archive download or file read), which hides credential-shaped text. '
    + 'Nothing was changed. Edit from a byte-exact copy instead (a git-mode download or clone), or leave those lines untouched.';
}
