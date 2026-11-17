// PG-STUCK-1: a Playground runtime that cannot make progress is removed (only the runtime; the
// native workspace stays), replaced by the next provision/attach, and reported in plain words.
import {it, expect, describe} from 'vitest';
import {stuckAfterMs, stuckReason, STUCK_DEFAULT_MINUTES} from '../../src/playground/stuck.js';

const MIN = 60000;

describe('the stored threshold', () => {
  it('defaults to 45 minutes and accepts a whole-minute operator setting between 15 and 1440', () => {
    expect(STUCK_DEFAULT_MINUTES).toBe(45);
    expect(stuckAfterMs({})).toBe(45 * MIN);
    expect(stuckAfterMs({PLAYGROUND_STUCK_AFTER_MINUTES: '90'})).toBe(90 * MIN);
    for (const bad of ['5', '2000', '1.5', 'soon']) expect(stuckAfterMs({PLAYGROUND_STUCK_AFTER_MINUTES: bad})).toBe(45 * MIN);
  });
  it('is measured from the last step that made progress, and only for pre-attached operator-pool runtimes', () => {
    const t = 1_000_000_000_000, row = {phase: 'attaching', createdAt: t, progressAt: t + 30 * MIN};
    expect(stuckReason(row, {now: t + 70 * MIN})).toBeNull();
    expect(stuckReason(row, {now: t + 75 * MIN})).toBe('runtime_stuck');
    expect(stuckReason({phase: 'deploying', createdAt: t}, {now: t + 46 * MIN})).toBe('runtime_stuck');
    expect(stuckReason({phase: 'deploying', createdAt: t}, {now: t + MIN, composeStatus: 'error'})).toBe('runtime_failed_to_start');
    for (const phase of ['requested', 'waiting_resources', 'attached', 'disposed']) expect(stuckReason({phase, createdAt: t}, {now: t + 600 * MIN})).toBeNull();
    expect(stuckReason({phase: 'deploying', placement: 'device', createdAt: t}, {now: t + 600 * MIN})).toBeNull();
    expect(stuckReason({phase: 'deploying', cleanupRequested: true, createdAt: t}, {now: t + 600 * MIN})).toBeNull();
  });
});

// DOKPLOY-RETIRE-1 (2026-11-17): the sweep/replacement/attach tests drove a fake Dokploy server and are gone with the
// retired pool; a paired computer's runtime is handled by its own machine (tests/unit/fleet-dial-out.test.js).
