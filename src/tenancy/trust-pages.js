// LAUNCH-1 C: the privacy notice, terms, security and support pages, served from the reviewed drafts in docs/legal/.
// Until the owner sets LEGAL_APPROVED=yes every page carries a visible "DRAFT - not yet reviewed by a lawyer; not in effect" banner
// and hides its "Effective:" line. The support email comes from PUBLIC_SUPPORT_EMAIL; while it is unset the pages say "coming soon".
// PUB-7 adds /status: how the service is set up right now (sign-in open, invite-only or paused; running version), read from the
// server's own switches. It has its own approval (STATUS_PAGE_APPROVED=yes) because the owner approved the other four pages on
// 2026-10-25 and has not seen this one. The pages are public and static: no sign-in, no personal data, no scripts.
import { readFileSync } from 'node:fs';
import { escapeHtml as h } from '../core/http.js';

// Literal URLs so the hosting bundler ships each file with the function.
const FILES = Object.freeze({
  privacy: { title: 'Privacy notice', file: new URL('../../docs/legal/PRIVACY-DRAFT.md', import.meta.url) },
  terms: { title: 'Terms of use', file: new URL('../../docs/legal/TERMS-DRAFT.md', import.meta.url) },
  security: { title: 'Security', file: new URL('../../docs/legal/SECURITY-DRAFT.md', import.meta.url) },
  support: { title: 'Support', file: new URL('../../docs/legal/SUPPORT-DRAFT.md', import.meta.url) },
  status: { title: 'Service status', file: new URL('../../docs/legal/STATUS-DRAFT.md', import.meta.url) }
});
export const TRUST_PAGES = Object.freeze(Object.keys(FILES));
/** The four pages the owner approved on 2026-10-25 (docs/legal/OWNER-REVIEW.md) and that the footer links to. */
export const LINKED_TRUST_PAGES = Object.freeze(['privacy', 'terms', 'security', 'support']);
const EMAIL = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;
export const legalApproved = (env = process.env) => env.LEGAL_APPROVED === 'yes';
export const statusPageApproved = (env = process.env) => env.STATUS_PAGE_APPROVED === 'yes';
export const pageApproved = (name, env = process.env) => (name === 'status' ? statusPageApproved(env) : legalApproved(env));
export const supportEmail = (env = process.env) => (EMAIL.test(String(env.PUBLIC_SUPPORT_EMAIL ?? '')) ? String(env.PUBLIC_SUPPORT_EMAIL) : null);
export const DRAFT_LABEL = 'DRAFT — not yet reviewed by a lawyer; not in effect.';

const cache = new Map();
const source = (name) => { if (!cache.has(name)) cache.set(name, readFileSync(FILES[name].file, 'utf8')); return cache.get(name); };

/** Inline text: escape first, then bold and the support-email placeholder, so nothing in a draft can become markup. */
function inline(text, email) {
  const safe = h(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const who = email ? `<a href="mailto:${h(email)}">${h(email)}</a>` : 'support email coming soon';
  return safe.replace(/\[support email\]/g, who);
}

/** What /status says about right now, from the server's own switches only (names and fixed words; never a setting's value). */
export function serviceStatus(env = process.env) {
  const signIn = env.GITHUB_PUBLIC_CONNECT === 'enabled' ? 'on' : 'off';
  const newPeople = signIn === 'off' ? 'closed'
    : env.GITHUB_PUBLIC_NEW_SIGNUPS === 'paused' ? 'paused by the owner'
      : env.GITHUB_PUBLIC_INVITE_ONLY === 'enabled' ? 'invite-only' : 'open';
  const sha = /^[0-9a-f]{40}$/.test(String(env.VERCEL_GIT_COMMIT_SHA ?? '')) ? String(env.VERCEL_GIT_COMMIT_SHA).slice(0, 12) : null;
  return { sign_in: signIn, new_people: newPeople, version: sha };
}
function statusBlock(env) {
  const s = serviceStatus(env);
  const row = (label, value, note = '') => `<div class="row"><span><strong>${h(label)}</strong>${note ? `<br><small>${h(note)}</small>` : ''}</span><span>${h(value)}</span></div>`;
  return '<h2>Right now</h2>' +
    row('Sign-in', s.sign_in === 'on' ? 'working' : 'switched off') +
    row('New people', s.new_people, s.new_people === 'open' ? 'Sign-ups can still pause on their own if the cost estimate reaches its limit.' : 'People who already have a connection keep working.') +
    row('Running version', s.version ?? 'not shown', 'The first characters of the code version this server runs.');
}

/** A tiny, fixed markdown subset (headings, bullets, paragraphs, bold) - enough for the drafts, nothing that can run code. */
export function renderTrustBody(name, env = process.env) {
  const email = supportEmail(env), approved = pageApproved(name, env);
  const out = []; let list = false;
  const close = () => { if (list) { out.push('</ul>'); list = false; } };
  for (const raw of source(name).split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim() || line.startsWith('# ')) { close(); continue; }
    if (/^Status:/.test(line)) { close(); if (!approved) out.push(`<p><small>${inline(line, email)}</small></p>`); continue; }
    // "Effective: <date>. Approved by the owner." is only true once the owner switch is set; a draft never shows it.
    if (/^Effective:/.test(line)) { close(); if (approved) out.push(`<p><small>${inline(line, email)}</small></p>`); continue; }
    if (line.startsWith('## ')) { close(); out.push(`<h2>${inline(line.slice(3), email)}</h2>`); continue; }
    if (line.startsWith('- ')) { if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${inline(line.slice(2), email)}</li>`); continue; }
    close(); out.push(`<p>${inline(line, email)}</p>`);
  }
  close();
  const banner = approved ? '' : `<p class="notice"><strong>${h(DRAFT_LABEL)}</strong> This text is a working draft and may change before it is final.</p>`;
  return { title: FILES[name].title, html: banner + (name === 'status' ? statusBlock(env) : '') + out.join('') };
}
