// PG-STUCK-1: a Playground runtime that cannot make progress is recognised, removed and
// replaced (or reported plainly) instead of being retried forever.
//
// "Stuck" applies only to an operator-pool runtime that holds provider resources but never
// became usable: it is in a pre-attached phase and either its provider deployment reported an
// error, or no step of its provisioning/attachment advanced for the threshold below. Only the
// runtime allocation is removed; the person's native Git workspace (their files) is kept, and
// the next provision, attach or run creates a fresh runtime for it.
import {indexAllocation} from './index.js';
import {callNativeWorker} from '../native-git/client.js';

/** Default: 45 minutes without any provisioning or attachment progress. */
export const STUCK_DEFAULT_MINUTES = 45;
/** After this many runtimes in a row failed to start for one workspace, stop replacing them. */
export const MAX_FAILED_STARTS = 3;
// Phases that hold (or may hold) provider resources but are not yet a usable runtime.
// requested/waiting_resources are queued intents without provider resources and are never "stuck".
export const PRE_ATTACHED = Object.freeze(['creating', 'created', 'exposing', 'exposed', 'deploying', 'allocated', 'attaching']);

/**
 * The protected operator setting PLAYGROUND_STUCK_AFTER_MINUTES (whole minutes, 15–1440) or the
 * 45-minute default. A healthy runtime finishes each step (image pull or source build, deploy,
 * HTTPS name, each repository transfer window) in minutes; 45 minutes without any step advancing
 * is far past that, and short enough that a broken runtime does not hold host memory for hours.
 */
export function stuckAfterMs(env) {
  const raw = env?.PLAYGROUND_STUCK_AFTER_MINUTES;
  const minutes = raw === undefined || raw === '' ? STUCK_DEFAULT_MINUTES : Number(raw);
  return (Number.isInteger(minutes) && minutes >= 15 && minutes <= 1440 ? minutes : STUCK_DEFAULT_MINUTES) * 60000;
}

/** When the allocation last advanced (older rows have only their creation time). */
export const lastProgressAt = s => Number.isSafeInteger(s?.progressAt) ? s.progressAt : Number.isSafeInteger(s?.createdAt) ? s.createdAt : null;

/** Pure: why this allocation can no longer make progress, or null. */
export function stuckReason(s, {now = Date.now(), env, composeStatus} = {}) {
  if (!s || s.placement === 'device' || s.cleanupRequested || !PRE_ATTACHED.includes(s.phase)) return null;
  if (composeStatus === 'error') return 'runtime_failed_to_start';
  const since = lastProgressAt(s);
  return since !== null && now - since >= stuckAfterMs(env) ? 'runtime_stuck' : null;
}

/** Plain words for a stuck/replaced runtime. */
export function stuckExplanation(reason, env) {
  return reason === 'runtime_failed_to_start'
    ? 'its provider deployment reported an error'
    : `it made no progress for ${Math.round(stuckAfterMs(env) / 60000)} minutes`;
}
export const isRuntimeOnlyCleanup = s => s?.cleanupRequested === true && s.runtimeOnly === true;

/** Records (compare-and-set) that this runtime is to be removed while the workspace stays. */
export async function markStuck(ctx, s, reason, {now = Date.now(), env = ctx.env} = {}) {
  const key = 'playground.' + s.binding.slice(0, 40);
  const next = await ctx.db.compareAndSetSetting(key, s.revision, {...s, cleanupRequested: true, cleanupReason: reason, runtimeOnly: true, stuckAt: now,
    stuckAfterMs: stuckAfterMs(env), failedStarts: (Number.isSafeInteger(s.failedStarts) ? s.failedStarts : 0) + 1, revision: s.revision + 1});
  if (next) await indexAllocation(ctx, next);
  return next;
}

/**
 * Releases the source-side lock of an unfinished repository transfer so the person's workspace is
 * fully writable again once its runtime goes. Best effort, never renews the workspace lease; an
 * absent lock is fine.
 */
export async function releaseTransferLock(ctx, s) {
  if (!s?.transfer?.transferId || !s.native?.job) return;
  const job = {...s.native.job, brokerOrigin: undefined, allocationBinding: undefined};
  try { await callNativeWorker(ctx, {binding: s.native.binding, workspace_id: s.native.worker, job, action: 'attachment_export', options: {mode: 'release', transferId: s.transfer.transferId}, allowWrite: true, renewLease: false}); }
  catch { /* An absent lock is fine; the workspace close still checks its own state. */ }
}
