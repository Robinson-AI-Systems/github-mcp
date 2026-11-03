// One setup call for a Playground runtime. It works out where this workspace's allocation is and takes
// the next step(s) itself, so an agent no longer has to choose between provision, attach and resume.
// Every step it takes is an existing idempotent one (ensure/recover/attach/start); it adds no new way
// to create, widen or delete anything, and it never starts a replacement while a user dispose is running.
import {allocationRecord,provisionAllocation,recoverAllocation,recoveryPendingError,resumeAllocation} from './allocations.js';
import {attachRepository} from './attachment.js';
import {isRuntimeOnlyCleanup} from './stuck.js';

const PROVISIONING=['requested','waiting_resources','creating','created','exposing','exposed','deploying'];
const DISPOSING=['cleanup_requested','stopped','deleting'];

export const defaultSetupDeps={allocationRecord,provisionAllocation,recoverAllocation,attachRepository,resumeAllocation};

/**
 * Advance this workspace toward "runtime attached and reachable". Returns {stored, steps} where steps
 * names what this call did, in order: provision, replace, attach, resume. A call never waits for a
 * deployment to finish; call it again and it continues from wherever the runtime has got to.
 */
export async function setupAllocation(ctx, record, {size, availability = null, deps = {}} = {}) {
  const d = {...defaultSetupDeps, ...deps};
  const steps = [];
  let stored = await d.allocationRecord(ctx, record);

  // A dispose the person asked for is in flight: never start a replacement behind it.
  if (stored && DISPOSING.includes(stored.phase) && !isRuntimeOnlyCleanup(stored)) return {stored, steps};

  // Nothing yet, an earlier runtime is gone, one failed to start, or provisioning is still under way.
  if (!stored || stored.phase === 'disposed' || PROVISIONING.includes(stored.phase) || isRuntimeOnlyCleanup(stored)) {
    stored = await d.provisionAllocation(ctx, record, {size});
    steps.push('provision');
  }

  // Deployed but the repository is not on it yet. A runtime that stalled is replaced, never retried.
  if (['allocated', 'attaching'].includes(stored?.phase)) {
    const recovered = await d.recoverAllocation(ctx, record);
    if (recovered.pending) throw recoveryPendingError(recovered.reason, ctx.env);
    if (recovered.reason || recovered.stored?.phase === 'disposed') {
      stored = await d.provisionAllocation(ctx, record, {size});
      steps.push('replace');
    } else {
      stored = await d.attachRepository(ctx, record, {budgetMs: 15000});
      steps.push('attach');
    }
  } else if (stored?.phase === 'attached' && steps.length === 0 && typeof availability === 'function') {
    // Attached earlier. If commands cannot run because the runtime stopped, start it again. A runtime that
    // is merely still starting (retryable) is left alone: resume needs verified controls it does not have yet.
    const seen = await availability(ctx, record);
    if (seen?.execution_available !== true && seen?.retryable !== true) {
      stored = await d.resumeAllocation(ctx, record);
      steps.push('resume');
    }
  }
  return {stored, steps};
}

/** What the person or agent reads next, in plain words, from the allocation after setup. */
export function setupNext(allocation) {
  if (allocation?.phase === 'attached' && allocation.repositoryAttached === true)
    return 'The runtime is attached to this workspace. Read availability to confirm commands can run; setup does not run or verify a command.';
  if (allocation && DISPOSING.includes(allocation.phase))
    return 'This runtime is being removed. Call setup again in about a minute to get a fresh one.';
  return 'Setup is still in progress (' + (allocation?.phase ?? 'not started') + '). Call github_playground_workspace operation setup again with the same requestKey in about a minute; each call continues from where the runtime has got to.';
}
