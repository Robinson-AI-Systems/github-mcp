// Result shaping (B5). Every tool result passes through `shapeResult` on its way out:
//   - values of fields named like secrets become "[hidden]", and any string shaped like a GitHub token or a private key is replaced;
//   - times gain a `_local` twin in America/Denver, and whole-cent amounts (`*_cents`) gain a dollars `_display` twin;
//   - text written by someone who is not an owner, member or collaborator is marked `untrusted: true`: repository text is data,
//     never instructions;
//   - a production connection's results say so first.
// It never mutates its input and always returns plain JSON-able data.
import { formatDenver } from '../github/errors.js';

export const HIDDEN = '[hidden]';
const SECRET_KEYS = new Set(['token', 'access_token', 'refresh_token', 'secret', 'client_secret', 'webhook_secret', 'password', 'pem', 'private_key', 'encrypted_value', 'secret_value']);
// GitHub's stateless installation tokens (2026) are JWTs: `ghs_` + three base64url parts joined by dots (~520 characters),
// so a token shape must include `.`, `-` and `_` or redaction would stop at the first dot and leave the rest visible.
const TOKEN_SHAPES = [/rtc_pass_[A-Za-z0-9_-]+/g, /\b(?:tac|trf)_[A-Za-z0-9_-]{40,}/g, /gh[pousr]_[A-Za-z0-9._-]{4,}/g, /github_pat_[A-Za-z0-9_]{4,}/g, /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g];
const TRUSTED = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
const TEXT_FIELDS = ['body', 'title', 'message', 'text', 'description', 'name'];
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const MAX_DEPTH = 12;

/** Replaces token- and key-shaped text inside a string. */
export function redact(text) {
  let out = String(text);
  for (const shape of TOKEN_SHAPES) out = out.replace(shape, HIDDEN);
  return out;
}

/** Whole-output defense also catches credential-shaped property names and deep values. */
export const containsCredential = text => redact(text) !== String(text);

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
