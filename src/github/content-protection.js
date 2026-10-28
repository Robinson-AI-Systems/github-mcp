// Provider credential detection shared by output shaping and pre-truncation text boundaries.
export const HIDDEN = '[hidden]';
// GitHub's stateless installation tokens (2026) are JWTs: `ghs_` + three base64url parts joined by dots (~520 characters),
// so a token shape must include `.`, `-` and `_` or redaction would stop at the first dot and leave the rest visible.
const TOKEN_SHAPES = [/rtc_pass_[A-Za-z0-9_-]{43,}/g, /\b(?:tac|trf)_[A-Za-z0-9_-]{40,}/g, /gh[pousr]_[A-Za-z0-9._-]{4,}/g, /github_pat_[A-Za-z0-9_]{4,}/g, /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g];
const RULE_INFO = [
  ['robinson-rtc-pass', 'Robinson RTC pass (43-character issued suffix)'],
  ['robinson-tenant-bearer', 'Robinson tenant access or refresh credential'],
  ['github-token', 'GitHub token prefix and payload'],
  ['github-fine-grained-token', 'GitHub fine-grained personal token'],
  ['private-key', 'Private key block']
];

/** Same matchers as redaction; returns locations/rules, NEVER matched values or snippets. */
export function contentProtectionReport(value, { maxFindings = 30 } = {}) {
  const text = String(value), findings = [];
  let total = 0;
  TOKEN_SHAPES.forEach((pattern, index) => {
    for (const match of text.matchAll(pattern)) {
      total++;
      if (findings.length >= maxFindings) continue;
      const prefix = text.slice(0, match.index), line = prefix.split('\n').length;
      findings.push({ rule: RULE_INFO[index][0], description: RULE_INFO[index][1],
        line, column: Array.from(prefix.slice(prefix.lastIndexOf('\n') + 1)).length + 1, column_unit: 'unicode_code_points',
        byte_offset: Buffer.byteLength(prefix), byte_length: Buffer.byteLength(match[0]),
        classification: 'format_match', credential_validity: 'not_checked' });
    }
  });
  return { detector_revision: '2026-10-28.1', total_findings: total,
    findings, findings_truncated: total > findings.length, matched_values_returned: false,
    byte_exact_available: total === 0, note: 'Format detection only; no match does not prove that a file contains no secrets.' };
}


/** Replaces token- and key-shaped text inside a string. */
export function redact(text) {
  let out = String(text);
  for (const shape of TOKEN_SHAPES) out = out.replace(shape, HIDDEN);
  return out;
}

/** Whole-output defense also catches credential-shaped property names and deep values. */
export const containsCredential = text => redact(text) !== String(text);


/** Provider excerpts can already end mid-credential; keep conservative prefix protection there. */
export const redactExcerpt = text => redact(text).replace(/rtc_pass_[A-Za-z0-9_-]+/g, HIDDEN);
