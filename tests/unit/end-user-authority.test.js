// AUTH-1: registry-wide proof that no money-capable or production tool is a developer-only refusal or a "guide only" stub, and that the
// spend rules protect the END USER's own choices. The building agents' no-spend rule lives in process (AGENTS.md), not in these tools.
import { describe, expect, it } from 'vitest';
import { registry } from '../../src/tools/index.js';
import { spendGate } from '../../src/tools/spend-guard.js';
import { SETTINGS } from '../../src/data/dashboard-map.js';
import { makeWorld } from '../../test/helpers/write-contract.js';

const spendTools = registry.tools.filter((t) => t.declarations?.spend);
const target = { owner: 'example-org' };
const unknown = { spendCents: 0, spendUnknown: true };

describe('every tool that can cost money is a real action for the end user', () => {
  it('there are money-capable tools and each one is a real write with a handler and delegated confirmation metadata', () => {
    expect(spendTools.length).toBeGreaterThanOrEqual(21);
    for (const t of spendTools) {
      expect(typeof registry.handlers[t.name], t.name).toBe('function');
      expect(t.annotations?.readOnlyHint, t.name + ' must change GitHub').toBe(false);
      expect(t.declarations.confirm, t.name).toBe('always');
      expect(t.description, t.name).not.toMatch(/guide[ds]? only|guided only/i);
    }
  });
  it('the paid areas named in the owner decision are real tools, not guides', () => {
    for (const name of ['github_hosted_runner_create', 'github_hosted_runner_scale_up', 'github_copilot_add_seats', 'github_copilot_team_seats',
      'github_copilot_agent_task_start', 'github_sponsor_set', 'github_billing_save_budget', 'github_codespace_create']) {
      expect(spendTools.map((t) => t.name), name).toContain(name);
    }
  });
});

describe('the spend rules protect the end user\'s own choices, for every money-capable tool', () => {
  for (const t of spendTools) {
    it(`${t.name}: owner unknown/known cost never adds a cap gate; delegated ceilings remain effective`, async () => {
      const w = await makeWorld({ mode: 'production', profile: 'full', gates: [spendGate()] });
      const gate = spendGate();
      const call = (ctx, classification = unknown) => gate({ name: t.name, args: {}, ctx, target, classification, declarations: t.declarations });
      // (a) price disclosure is the write lifecycle responsibility; this policy gate is neutral for owners.
      const open = await call(w.ctx);
      expect(open?.refuse, t.name).toBeUndefined();
      expect(open).toBeNull();
      // (b) old standing account caps cannot veto a current full-owner instruction.
      await w.db.setSpendLimitCents('example-org', 5000);
      const capped = await call(w.ctx);
      expect(capped).toBeNull();
      // (b2) known prices do not create owner policy gates either; a delegated ceiling still refuses.
      const over = await call(w.ctx, { spendCents: 9000, spendUnknown: false });
      expect(over).toBeNull();
      const delegate = { ...w.ctx, connection: { ...w.ctx.connection, pass: true, spend_limit_cents: 5000 } };
      expect(await call(delegate)).toMatchObject({ by: 'spend limit' });
      // (c) a delegation pass with money_limit 0 stays refused
      await w.db.setSpendLimitCents('example-org', 0);
      const pass = { ...w.ctx, connection: { ...w.ctx.connection, pass: true, client_id: 'no-money-pass', spend_limit_cents: 0 } };
      const none = await call(pass, { spendCents: 1900, spendUnknown: false });
      expect(none).toMatchObject({ refuse: expect.any(String) });
    });
  }
});

describe('provider-UI-only settings are the ones GitHub really has no API for', () => {
  const none = SETTINGS.filter((s) => s.apiAvailable === false);
  it('every UI-only setting says why in plain words and offers the exact steps', () => {
    expect(none.length).toBeGreaterThan(0);
    for (const s of none) {
      expect(s.reason.split(/\s+/).length, s.id).toBeGreaterThanOrEqual(4);
      expect(s.steps.length, s.id).toBeGreaterThan(0);
    }
  });
  it('project views and workflow deletion, which GitHub does have an API for, are not described as impossible', () => {
    const pw = none.find((s) => s.id === 'project-v2-workflows');
    expect(pw.reason).toContain('deleteProjectV2Workflow');
    expect(pw.reason).toContain('github_project_view_save');
  });
});
