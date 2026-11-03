// Ready-to-call continuations for kept results (the handle that github_get_result pages through).
// An agent that was cut short should never have to work out the next call: every cut result says exactly
// which call reads the rest. These are pure helpers shared by the read pipeline and github_get_result.

const TOOL = 'github_get_result';
const MAX_WINDOW_LINES = 500;

/** The field name a cut path ends in, for use in `fields` (path like `jobs[2].log` -> `log`). */
export function leafKey(path) {
  const leaf = String(path ?? '').replace(/\[\d+\]/g, '').split('.').filter(Boolean).pop();
  return typeof leaf === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(leaf) ? leaf : null;
}

/** The call for the next page of a kept list, or null when this was the last page / not a list. */
export function nextPageCall(handle, info, { fields, pageSize } = {}) {
  if (!info || !Number.isInteger(info.page) || !Number.isInteger(info.pages) || info.page >= info.pages) return null;
  return { tool: TOOL, arguments: { handle, page: info.page + 1, pageSize: pageSize ?? info.page_size,
    ...(Array.isArray(fields) && fields.length ? { fields } : {}) } };
}

/**
 * The call that reads what a long text field left out. Character-cut text continues by text offset;
 * a log that kept only its last lines continues by line window from the first line.
 */
export function textContinueCall(handle, cut, { offset = 0 } = {}) {
  if (!cut) return null;
  const field = leafKey(cut.path);
  if (!field) return null;
  if (cut.unit === 'lines') {
    const earlier = Math.max(0, cut.total - cut.kept);
    return earlier > 0 ? { tool: TOOL, arguments: { handle, fields: [field], startLine: 1, endLine: Math.min(earlier, MAX_WINDOW_LINES) },
      note: `The first ${earlier} of ${cut.total} lines were left out; this reads them (up to ${MAX_WINDOW_LINES} lines a call; continue with next_window).` } : null;
  }
  if (cut.unit === 'characters') return { tool: TOOL, arguments: { handle, fields: [field], offset: offset + cut.kept },
    note: `${cut.total - offset - cut.kept} more characters of ${field} are kept; this reads the next part.` };
  return null;
}

/** First text-bearing string under `key` in a retained body (bounded walk), or null. */
export function findText(body, key) {
  let seen = 0;
  const walk = (node, depth) => {
    if (seen++ > 20000 || depth > 8 || node === null || typeof node !== 'object') return null;
    if (Array.isArray(node)) { for (const item of node) { const hit = walk(item, depth + 1); if (hit !== null) return hit; } return null; }
    if (typeof node[key] === 'string' && node[key].length > 0) return node[key];
    for (const value of Object.values(node)) { const hit = walk(value, depth + 1); if (hit !== null) return hit; }
    return null;
  };
  return walk(body, 0);
}

/**
 * A window of whole lines from a text, at most `maxLines` lines and about `maxChars` characters, so a
 * window always fits one reply. Lines are 1-based and inclusive. A line longer than the character budget
 * is cut and reported, never skipped.
 */
export function lineWindow(text, { startLine = 1, endLine, maxLines = MAX_WINDOW_LINES, maxChars = 24000 } = {}) {
  const lines = text.split('\n');
  const total = lines.length;
  const start = Math.max(1, startLine);
  if (start > total) return { total_lines: total, start_line: start, end_line: total, text: '', complete: true, past_end: true };
  const wanted = Math.min(endLine ?? start + maxLines - 1, start + maxLines - 1, total);
  const out = [];
  let chars = 0, last = start - 1, cutLine = false;
  for (let n = start; n <= wanted; n++) {
    const line = lines[n - 1];
    if (chars + line.length + 1 > maxChars && out.length > 0) break;
    if (line.length + 1 > maxChars) { out.push(line.slice(0, maxChars)); last = n; cutLine = true; chars = maxChars; break; }
    out.push(line); chars += line.length + 1; last = n;
  }
  return { total_lines: total, start_line: start, end_line: last, text: out.join('\n'), complete: last >= total,
    ...(cutLine ? { line_cut: last } : {}) };
}

/** The call for the next line window after `window`, or null when it ended the text. */
export function nextWindowCall(handle, field, window, { endLine } = {}) {
  if (!window || window.complete || window.end_line >= (endLine ?? window.total_lines)) return null;
  return { tool: TOOL, arguments: { handle, fields: [field], startLine: window.end_line + 1,
    endLine: Math.min(window.end_line + MAX_WINDOW_LINES, endLine ?? window.total_lines) } };
}
