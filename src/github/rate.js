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

/**
 * Remembers what a response's headers say about the rate limit. A block is recorded when GitHub says the budget is
 * spent (`x-ratelimit-remaining: 0`) or sends `retry-after` with a 403/429 (the secondary limit).
 * @returns {Promise<{ resource: string, remaining: number|null, resetAt: Date|null, blockedUntil: Date|null }|null>}
 */
export async function recordRate(db, account, headers, { status = 200, fallbackResource = 'core', now = Date.now } = {}) {
  const observed=rateFromHeaders(headers,{status,fallbackResource,now});
  if(!observed)return null;
  const {resource,remaining,resetAt,blockedUntil}=observed;
  await db.recordRateState({ account, resource, remaining, resetAt, blockedUntil });
  return { resource, remaining, resetAt, blockedUntil };
}

/** Throws `rate_limited` (with the reset time in Denver time) when this account's bucket is currently blocked. */
export async function assertNotBlocked(db, account, resource, {onBlocked} = {}) {
  const state = await db.getRateState(account, resource);
  if (state?.blocked_until) {
    const until = new Date(state.blocked_until);
    onBlocked?.(state);
    throw rateLimited(account, resource, until);
  }
}

export function rateLimited(account, resource, until) {
  // GOD-6: a request made as the person is counted against the person's own GitHub allowance, kept under the key "~me:<id>".
  const optional=/^~cred:([UKPM]):(.+)$/.exec(String(account));
  const who=String(account).startsWith('~me:')?'your own GitHub login':
    optional?`${optional[2]} (${{U:'user',K:'notifications',P:'package',M:'God Mode'}[optional[1]]} credential)`:account;
  return new GithubClientError('rate_limited',
    `GitHub asked us to slow down for ${who} (${resource} limit). Try again after ${formatDenver(until)}.`,
    { reason: 'github_limit', resource, reset_at: until.toISOString(), reset_display: formatDenver(until) });
}

/** A bounded observation of GitHub's actual response headers, without guessed quotas. */
export function rateFromHeaders(headers,{status=200,fallbackResource='core',now=Date.now}={}){
  const h=Object.fromEntries(Object.entries(headers??{}).map(([k,v])=>[k.toLowerCase(),v]));
  const quota=(v)=>v!==undefined&&v!==null&&/^\d+$/.test(String(v))&&Number.isSafeInteger(Number(v))?Number(v):null;
  const remaining=quota(h['x-ratelimit-remaining']);
  const reset=quota(h['x-ratelimit-reset']);
  const retry=quota(h['retry-after']);
  if(remaining===null&&reset===null&&retry===null)return null;
  const resource=/^[a-z_]{2,40}$/.test(h['x-ratelimit-resource']??'')
    ?h['x-ratelimit-resource']:fallbackResource;
  const resetAt=reset!==null?new Date(reset*1000):null;
  const secondary=(status===403||status===429)&&retry!==null;
  const blockedUntil=secondary?new Date(now()+retry*1000):
    remaining===0&&resetAt?new Date(resetAt.getTime()+1000):null;
  return {resource,remaining,resetAt,blockedUntil,
    throttle:secondary?'secondary':remaining===0?'primary':null};
}

/** One request-scoped, tenant-local collection shared with nested dispatcher calls.
 * No network request and no global cache. Parallel observations for the same
 * credential/bucket retain the lowest remaining within one reset epoch. */
export function createRateCollector({now=Date.now,max=8}={}){
  const rows=new Map();
  return {
    record({account,credential,resource,observation,source='fresh'}){
      if(!observation||typeof account!=='string'||!credential)return;
      const r=observation.resource??resource;
      if(!/^[a-z_]{2,40}$/.test(r??''))return;
      const key=account.toLowerCase()+'|'+credential+'|'+r;
      const prev=rows.get(key);
      if(prev?.source==='fresh'&&source==='cached')return;
      const reset=observation.resetAt instanceof Date&&Number.isFinite(observation.resetAt.getTime())
        ?observation.resetAt.toISOString():null;
      const until=observation.blockedUntil instanceof Date&&observation.blockedUntil.getTime()>now()
        ?observation.blockedUntil.toISOString():null;
      const next={account,credential,resource:r,source,
        ...(Number.isSafeInteger(observation.remaining)&&observation.remaining>=0 &&
          (reset===null||Date.parse(reset)>now())?{remaining:observation.remaining}:{}),
        ...(reset?{reset_at:reset}:{}),...(until?{blocked_until:until}:{}),
        ...(observation.throttle?{throttle:observation.throttle}:{})};
      if(prev?.source==='fresh'&&source==='fresh'){
        const oldReset=Date.parse(prev.reset_at??'');
        const newReset=Date.parse(next.reset_at??'');
        if(Number.isFinite(oldReset)&&Number.isFinite(newReset)&&newReset<oldReset)return;
        if(oldReset===newReset&&Number.isSafeInteger(prev.remaining)&&Number.isSafeInteger(next.remaining))
          next.remaining=Math.min(prev.remaining,next.remaining);
      }
      rows.delete(key);rows.set(key,next);
    },
    snapshot(){
      const values=[...rows.values()];
      return {items:values.slice(-max),...(values.length>max?{more_observations:true}:{})};
    }
  };
}
