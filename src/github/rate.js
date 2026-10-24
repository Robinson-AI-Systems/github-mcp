// Polite to GitHub, across server instances (A9). Three small jobs, all backed by the shared database so every
// Vercel instance sees the same state: spacing writes, remembering rate-limit headers, and refusing calls while
// GitHub has told us to wait.
import { GithubClientError, formatDenver } from './errors.js';

export const WRITE_SPACING_MS = 1000;
export const DEFAULT_MAX_SLOT_WAIT_MS = 5000;

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Which GitHub rate-limit bucket a request counts against (used before the response tells us). */
export function resourceFor(method, url) {
  const pathname = new URL(url, 'https://api.github.com').pathname;
  if (pathname.startsWith('/graphql')) return 'graphql';
  if (method === 'GET' && pathname.startsWith('/search/code')) return 'code_search';
  if (method === 'GET' && pathname.startsWith('/search/')) return 'search';
  return 'core';
}

/**
 * Waits for this installation's turn to write. At most one write per `spacingMs` per installation across every
 * instance (one atomic statement in the database). Refuses, reserving nothing, when the queue is longer than `maxWaitMs`.
 */
export async function takeWriteSlot(db, installationKey, { maxWaitMs = DEFAULT_MAX_SLOT_WAIT_MS, spacingMs = WRITE_SPACING_MS, sleep = realSleep } = {}) {
  const slot = await db.claimWriteSlot(installationKey, { spacingMs, maxWaitMs });
  if (!slot) {
    throw new GithubClientError('rate_limited',
      'Other changes to this GitHub account are already queued. Try again in a few seconds.',
      { reason: 'write_queue_busy', retry_after_seconds: Math.ceil(maxWaitMs / 1000) });
  }
  if (slot.waitMs > 0) await sleep(slot.waitMs);
  return slot.waitMs;
}

function number(value) {
  const n = Number(value);
  return value !== undefined && value !== null && value !== '' && Number.isFinite(n) ? n : null;
}

/**
 * Remembers what a response's headers say about the rate limit. A block is recorded when GitHub says the budget is
 * spent (`x-ratelimit-remaining: 0`) or sends `retry-after` with a 403/429 (the secondary limit).
 * @returns {Promise<{ resource: string, remaining: number|null, resetAt: Date|null, blockedUntil: Date|null }|null>}
 */
export async function recordRate(db, account, headers, { status = 200, fallbackResource = 'core', now = Date.now } = {}) {
  const h = Object.fromEntries(Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  const remaining = number(h['x-ratelimit-remaining']);
  const resetSeconds = number(h['x-ratelimit-reset']);
  const retryAfter = number(h['retry-after']);
  if (remaining === null && retryAfter === null) return null;
  const resource = h['x-ratelimit-resource'] || fallbackResource;
  const resetAt = resetSeconds === null ? null : new Date(resetSeconds * 1000);
  let blockedUntil = null;
  if (retryAfter !== null && (status === 403 || status === 429)) blockedUntil = new Date(now() + retryAfter * 1000);
  else if (remaining === 0 && resetAt) blockedUntil = new Date(resetAt.getTime() + 1000);
  await db.recordRateState({ account, resource, remaining, resetAt, blockedUntil });
  return { resource, remaining, resetAt, blockedUntil };
}

/** Throws `rate_limited` (with the reset time in Denver time) when this account's bucket is currently blocked. */
export async function assertNotBlocked(db, account, resource) {
  const state = await db.getRateState(account, resource);
  if (state?.blocked_until) {
    const until = new Date(state.blocked_until);
    throw rateLimited(account, resource, until);
  }
}

export function rateLimited(account, resource, until) {
  // GOD-6: a request made as the person is counted against the person's own GitHub allowance, kept under the key "~me:<id>".
  const who = String(account).startsWith('~me:') ? 'your own GitHub login' : account;
  return new GithubClientError('rate_limited',
    `GitHub asked us to slow down for ${who} (${resource} limit). Try again after ${formatDenver(until)}.`,
    { reason: 'github_limit', resource, reset_at: until.toISOString(), reset_display: formatDenver(until) });
}
