// Turning CI logs into something short (BATCH-G decision G1). Pure functions: no network, no secrets. A raw log is never returned whole:
// callers get the last lines, the lines that look like errors, and a note when anything was cut. Long base64-looking runs are removed.
import zlib from 'node:zlib';
import { redactExcerpt } from './content-protection.js';

const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\s?/;
const ERROR_LINE = /##\[error\]|\bError:|\bERROR\b|\bFAIL(?:ED)?\b|✗|✖|Traceback \(most recent|^\s+at .+\(.+:\d+:\d+\)|Exception\b|npm ERR!|exit code [1-9]/;
const BASE64_RUN = /[A-Za-z0-9+/=]{200,}/;
const clean = (line) => {
  const text = line.replace(STAMP, '').replace(/\u001b\[[0-9;]*m/g, '').replace(/\r$/, '');
  return BASE64_RUN.test(text) ? text.replace(BASE64_RUN, '[long encoded text removed]') : text.slice(0, 400);
};

/** @returns {{ lines: number, tail: string[], errors: string[], errors_cut: boolean }} */
export function summarizeLog(text, { tailLines = 400, maxErrors = 40 } = {}) {
  const lines = redactExcerpt(String(text ?? '')).split('\n').map(clean);
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  const errors = [];
  for (const line of lines) if (ERROR_LINE.test(line) && !errors.includes(line)) errors.push(line);
  return { lines: lines.length, tail: lines.slice(-tailLines), ...(lines.length > tailLines ? { tail_cut: true } : {}), errors: errors.slice(0, maxErrors), errors_cut: errors.length > maxErrors };
}

// LOG-FAILURES-1 (2026-11-17, owner report: a run summary named five failing tests but
// not why the sixth failed, and finding it meant paging a 150,000-character log). Test
// runners print a failure marker, then the reason on the lines that follow. These are
// the markers of the runners in use; each failure keeps its own reason lines.
const FAIL_MARKERS = [
  { runner: 'xunit', at: /^\s*(?:\[xUnit\.net [^\]]*\]\s*)?(\S.*?)\s+\[FAIL\]\s*$/ },
  { runner: 'dotnet', at: /^\s*Failed\s+(\S.+?)\s+\[[^\]]*\]\s*$/ },
  { runner: 'node:test', at: /^\s*not ok \d+ - (.+)$/ },
  { runner: 'vitest/jest', at: /^\s*(?:FAIL\s+\S+\s+>\s+|●\s+)(.+)$/ },
  { runner: 'pytest', at: /^(?:FAILED|ERROR)\s+(\S+::\S+)(?:\s+-\s+.*)?$/ },
  { runner: 'go', at: /^\s*--- FAIL: (\S+)/ },
];
const NOISE = /^##\[(?:group|endgroup)\]|^\s*$/;

/**
 * The failing tests in a log, each with the lines that say why (assertion, exception, first stack frames).
 * @returns {Array<{ test: string, runner: string, line: number, reason: string[] }>}
 */
export function testFailures(text, { max = 12, reasonLines = 10 } = {}) {
  const lines = redactExcerpt(String(text ?? '')).split('\n').map(clean);
  const marker = (l) => { for (const m of FAIL_MARKERS) { const hit = m.at.exec(l); if (hit) return { runner: m.runner, test: hit[1].trim().slice(0, 200) }; } return null; };
  const out = []; const byTest = new Map();
  for (let i = 0; i < lines.length; i++) {
    const hit = marker(lines[i]);
    if (!hit) continue;
    const known = byTest.get(hit.test);
    if (known && known.reason.length) continue;
    if (!known && out.length >= max) continue;
    const reason = [];
    for (let j = i + 1; j < lines.length && reason.length < reasonLines; j++) {
      const next = marker(lines[j]);
      // dotnet test prints xUnit's "[FAIL]" line and then its own "Failed <test> [time]" for the
      // same test, with the reason after it: the same test's second marker continues the entry.
      if (next && next.test === hit.test) continue;
      if (next) break;
      if (!NOISE.test(lines[j])) reason.push(lines[j].trim().slice(0, 300));
    }
    if (known) { known.reason = reason; continue; }
    const entry = { test: hit.test, runner: hit.runner, line: i + 1, reason };
    byTest.set(hit.test, entry); out.push(entry);
  }
  return out;
}

/** Decodes what Octokit returns for a text download (a string, or bytes). */
export function textOfBody(data) {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) return new TextDecoder().decode(data);
  return String(data ?? '');
}

/**
 * Reads a zip archive held in memory (stored or deflated entries) through its central directory; no other format is accepted.
 * @returns {Array<{ name: string, text: string }>} text of each entry; entries over `maxEntryBytes` are cut.
 */
export function readZip(buffer, { maxEntries = 500, maxEntryBytes = 2_000_000 } = {}) {
  const buf = Buffer.from(buffer);
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i -= 1) if (buf.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new TypeError('The log archive is not a zip file.');
  const count = Math.min(buf.readUInt16LE(end + 10), maxEntries);
  let pos = buf.readUInt32LE(end + 16);
  const out = [];
  for (let n = 0; n < count; n += 1) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) break;
    const method = buf.readUInt16LE(pos + 10);
    const compressed = buf.readUInt32LE(pos + 20);
    const nameLength = buf.readUInt16LE(pos + 28); const extraLength = buf.readUInt16LE(pos + 30); const commentLength = buf.readUInt16LE(pos + 32);
    const local = buf.readUInt32LE(pos + 42);
    const name = buf.toString('utf8', pos + 46, pos + 46 + nameLength);
    pos += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + compressed);
    let bytes;
    if (method === 0) bytes = raw;
    else if (method === 8) { try { bytes = zlib.inflateRawSync(raw, { maxOutputLength: maxEntryBytes }); } catch { bytes = Buffer.from('[this log file is too large to read here]'); } }
    else continue;
    out.push({ name, text: bytes.subarray(0, maxEntryBytes).toString('utf8') });
  }
  return out;
}
