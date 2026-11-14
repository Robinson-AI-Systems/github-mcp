// PUSH-REFUSAL-RECEIPTS-1 (2026-11-13): a push refused for a deliberate fake test value can be
// allowed without the file ever reaching GitHub.
//
// Until now a push exception had to be verified against the file's blob on GitHub, but the push
// guard refuses that very blob, so the exception could never be granted for a file that was
// never on GitHub (a new test file, or a new fake value). Now the push guard records a receipt
// for each refused finding: path, blob, rule, line and the value fingerprint. No value, no source.
// `github_content_protection_check` lists a refused blob's findings from its receipts, and
// `github_security_scanner_configure` verifies a push exception for it through the push door
// using the same rule the guard applies (path + rule + value fingerprint). The real proof is
// still the next push: the guard re-checks every byte.
import {createHash} from 'node:crypto';

const MAX_RECEIPTS = 200, KEEP_MS = 7 * 24 * 3600 * 1000;
const SHA = /^[a-f0-9]{40}$/, FP = /^[a-f0-9]{64}$/;
export const refusalKey = (owner, repo) => 'scanner_refusals_' + createHash('sha256').update(JSON.stringify([String(owner).toLowerCase(), String(repo).toLowerCase()])).digest('hex').slice(0, 32);

/** Only well-formed, value-free receipts are kept. */
export function cleanReceipts(list) {
 if (!Array.isArray(list)) return [];
 const out = [];
 for (const r of list.slice(0, 50)) {
  if (!r || typeof r.path !== 'string' || !r.path || r.path.length > 1000 || r.path.startsWith('/') || /[\x00-\x1f]/.test(r.path)) continue;
  if (!SHA.test(r.blobSha ?? '') || typeof r.rule !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(r.rule) || !FP.test(r.valueFingerprint ?? '')) continue;
  out.push({ path: r.path, blobSha: r.blobSha, rule: r.rule, valueFingerprint: r.valueFingerprint, line: Number.isSafeInteger(r.line) ? r.line : null });
 }
 return out;
}

export async function recordRefusals(db, owner, repo, receipts, now = Date.now()) {
 const clean = cleanReceipts(receipts);
 if (!clean.length) return 0;
 const key = refusalKey(owner, repo);
 const stored = (await db.getSetting(key)) ?? { receipts: [] };
 const keep = (Array.isArray(stored.receipts) ? stored.receipts : []).filter(r => now - Date.parse(r.at) < KEEP_MS);
 const at = new Date(now).toISOString();
 const seen = new Set(keep.map(r => `${r.path}|${r.blobSha}|${r.rule}|${r.valueFingerprint}`));
 for (const r of clean) { const k = `${r.path}|${r.blobSha}|${r.rule}|${r.valueFingerprint}`; if (!seen.has(k)) { keep.push({ ...r, at }); seen.add(k); } }
 await db.setSetting(key, { receipts: keep.slice(-MAX_RECEIPTS) });
 return clean.length;
}

/** Save receipts without ever failing the caller, but never silently either: the answer says whether they were
 * saved, so the push hook can tell the person (Second Shift 2026-11-14: a failed save used to vanish). */
export async function saveRefusalReceipts(db, owner, repo, receipts, { log = console.error } = {}) {
 try { return { saved: await recordRefusals(db, owner, repo, receipts) }; }
 catch (error) {
  log('push refusal receipt not saved', `${owner}/${repo}`, String(error?.message ?? error).slice(0, 200));
  return { saved: 0, error: 'the refusal receipt could not be saved' };
 }
}

export async function refusalsFor(db, owner, repo, { path, blobSha }, now = Date.now()) {
 const stored = (await db.getSetting(refusalKey(owner, repo))) ?? { receipts: [] };
 return (Array.isArray(stored.receipts) ? stored.receipts : [])
  .filter(r => r.path === path && r.blobSha === blobSha && now - Date.parse(r.at) < KEEP_MS);
}

/** Exactly the push guard's exception rule (file-protection.js blockingPushFindings). */
export const receiptBlocked = (receipt, settings) => !(settings?.suppressions ?? []).some(s =>
 s.pushException === true && s.path === receipt.path && s.rule === receipt.rule && s.valueFingerprint === receipt.valueFingerprint);
