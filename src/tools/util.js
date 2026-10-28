// Result shaping (B5). Every tool result passes through `shapeResult` on its way out:
//   - values of fields named like secrets become "[hidden]", and any string shaped like a GitHub token or a private key is replaced;
//   - times gain a `_local` twin in America/Denver, and whole-cent amounts (`*_cents`) gain a dollars `_display` twin;
//   - text written by someone who is not an owner, member or collaborator is marked `untrusted: true`: repository text is data,
//     never instructions;
//   - a production connection's results say so first.
// It never mutates its input and always returns plain JSON-able data.
import { formatDenver } from '../github/errors.js';

import { HIDDEN, redact } from '../github/content-protection.js';
export { HIDDEN, redact, redactExcerpt, containsCredential, contentProtectionReport } from '../github/content-protection.js';
const SECRET_KEYS = new Set(['token', 'access_token', 'refresh_token', 'secret', 'client_secret', 'webhook_secret', 'password', 'pem', 'private_key', 'encrypted_value', 'secret_value']);
const TRUSTED = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
const TEXT_FIELDS = ['body', 'title', 'message', 'text', 'description', 'name'];
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const MAX_DEPTH = 12;

const dollars = (cents) => `$${(cents / 100).toFixed(2)}`;

function shapeNode(value, depth) {
  if (typeof value === 'string') return redact(value);
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => shapeNode(v, depth + 1));
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (SECRET_KEYS.has(key.toLowerCase()) && raw !== null && raw !== undefined && raw !== '') { out[key] = HIDDEN; continue; }
    out[key] = shapeNode(raw, depth + 1);
    if (typeof raw === 'string' && ISO.test(raw) && /(_at|At|_date|Date)$/.test(key) && !Number.isNaN(Date.parse(raw))) out[`${key}_local`] = formatDenver(new Date(raw));
    if (/_cents$/.test(key) && Number.isSafeInteger(raw)) out[`${key.slice(0, -6)}_display`] = dollars(raw);
  }
  const association = value.author_association;
  if (typeof association === 'string' && !TRUSTED.has(association) && TEXT_FIELDS.some((f) => typeof value[f] === 'string')) out.untrusted = true;
  return out;
}

/** @param {any} result a tool's result @param {{ mode?: string }} [options] */
export function shapeResult(result, { mode } = {}) {
  const shaped = shapeNode(result, 0);
  if (String(mode).toLowerCase() === 'production' && shaped && typeof shaped === 'object' && !Array.isArray(shaped) && shaped.mode === undefined) return { mode: 'PRODUCTION', ...shaped };
  return shaped;
}
