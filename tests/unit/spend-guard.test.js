import { describe, expect, it } from 'vitest';
import { denverMonthStart, spendGate, spendStatus } from '../../src/tools/spend-guard.js';
import { handlers } from '../../src/tools/server.js';
import { sampleSeat, SEAT_PRICE_CENTS } from '../../test/helpers/sample-writes.js';
import { NOW, makeWorld, parse } from '../../test/helpers/write-contract.js';

const seatArgs = { owner: 'example-org', usernames: ['a-user'] };
const arrange = (gh) => {
  const seats = (names) => ({ status: 200, body: { total_seats: names.length, seats: names.map((login) => ({ assignee: { login } })) } });
  gh.when('GET /orgs/{org}/copilot/billing/seats').replySequence([seats([]), seats(['a-user']), seats(['a-user']), seats(['a-user'])]);
  gh.when('POST /orgs/{org}/copilot/billing/selected_users').reply(201, { seats_created: 1 });
};
async function world(limitCents, extra = {}) {
  const w = await makeWorld({ mode: 'preview', profile: 'everyday', gates: [spendGate()], ...extra });
  await w.db.setSpendLimitCents('example-org', limitCents);
  arrange(w.gh);
  return w;
}
const run = (w, args, h = sampleSeat.handler) => h(args, w.ctx).then(parse);

describe('the start of the month in Denver', () => {
  it('handles summer time, winter time and the changeover', () => {
    const at = (iso) => denverMonthStart(Date.parse(iso)).toISOString();
    expect(at('2026-10-10T18:00:00Z')).toBe('2026-10-01T06:00:00.000Z');
    expect(at('2026-11-01T05:59:00Z')).toBe('2026-10-01T06:00:00.000Z');
    expect(at('2026-11-01T06:00:00Z')).toBe('2026-11-01T06:00:00.000Z');
    expect(at('2026-12-15T12:00:00Z')).toBe('2026-12-01T07:00:00.000Z');
    expect(at('2026-03-01T06:59:00Z')).toBe('2026-02-01T07:00:00.000Z');
  });
});

describe('the spend gate', () => {
  it('does not mistake the old developer default $0 for an end-user selected restriction', async () => {
    const w=await makeWorld({mode:'preview',profile:'everyday',gates:[spendGate()]});
    arrange(w.gh);
    const status=await spendStatus(w.ctx,'example-org');
    expect(status.limitEnabled).toBe(false);
    expect(status.remainingCents).toBeNull();
    const preview=await run(w,seatArgs);
    expect(preview.status).toBe('needs_confirmation');
    expect(preview.preview).toContain('COSTS $19.00');
    expect(w.gh.calls.every(c=>c.method==='GET')).toBe(true);
  });
  it('refuses at the default $0 and says how to raise it', async () => {
    const w = await world(0);
    const res = await run(w, { ...seatArgs, confirm: true });
    expect(res).toMatchObject({ status: 'refused_by_guard', refusedBy: 'spend limit' });
    expect(res.error).toContain('$0.00');
    expect(res.error).toContain('setup page');
    expect(w.gh.calls.filter((c) => c.method === 'POST')).toEqual([]);
  });
  it('allows a seat that fits, after asking, and counts it against the month', async () => {
    const w = await world(5000);
    const seats = (names) => ({ status: 200, body: { total_seats: names.length, seats: names.map((login) => ({ assignee: { login } })) } });
    w.gh.when('GET /orgs/{org}/copilot/billing/seats').replySequence([seats([]), seats([]), seats(['a-user']), seats(['a-user'])]);
    expect((await run(w, seatArgs)).status).toBe('needs_confirmation');
    expect((await run(w, { ...seatArgs, confirm: true })).status).toBe('applied');
    const status = await spendStatus(w.ctx, 'example-org');
    expect(status).toMatchObject({ limitCents: 5000, usedCents: SEAT_PRICE_CENTS, remainingCents: 5000 - SEAT_PRICE_CENTS });
  });
  it('refuses what would go over, naming used and remaining', async () => {
    const w = await world(3000);
    expect((await run(w, { ...seatArgs, confirm: true })).status).toBe('applied');
    const second = await run(w, { owner: 'example-org', usernames: ['b-user'], confirm: true });
    expect(second.status).toBe('refused_by_guard');
    expect(second.error).toContain('$19.00 of the $30.00');
    expect(second.error).toContain('$11.00 left');
  });
  it('a limit exactly equal to the cost is allowed', async () => {
    const w = await world(SEAT_PRICE_CENTS);
    expect((await run(w, { ...seatArgs, confirm: true })).status).toBe('applied');
  });
  it('spend from last month does not count, and previews do not count', async () => {
    const w = await world(SEAT_PRICE_CENTS);
    await w.db.recordChange({ account: 'example-org', mode: 'preview', tool: 'x', target: 'example-org', summary: 'preview', dryRun: true, spendCents: 99999 });
    expect((await spendStatus(w.ctx, 'example-org')).usedCents).toBe(0);
    const later = { ...w.ctx, now: () => NOW + 40 * 86_400_000 };
    expect((await spendStatus(later, 'example-org')).usedCents).toBe(0);
  });
  it('a change GitHub rejected does not use up the limit', async () => {
    const w = await world(SEAT_PRICE_CENTS);
    w.gh.when('POST /orgs/{org}/copilot/billing/selected_users').reply(422, { message: 'Validation Failed' });
    expect((await run(w, { ...seatArgs, confirm: true })).status).toBe('rejected');
    expect((await spendStatus(w.ctx, 'example-org')).usedCents).toBe(0);
  });
  it('never trusts the arguments for the amount', async () => {
    const w = await world(SEAT_PRICE_CENTS);
    const res = await run(w, { ...seatArgs, usernames: ['a-user', 'b-user'], confirm: true });
    expect(res.status).toBe('refused_by_guard');
  });
  it('ignores tools that cost nothing', async () => {
    const w = await world(0);
    const gate = spendGate();
    expect(await gate({ name: 'github_x', args: {}, ctx: w.ctx, target: { owner: 'example-org' }, classification: { spendCents: 0 }, declarations: {} })).toBeNull();
  });
  it('permits a declared billing-class action that reduces charges to zero under a user-selected zero limit',async()=>{
    const w=await makeWorld({mode:'production',profile:'full',gates:[spendGate()]});
    await w.db.setSpendLimitCents('example-org',0);
    const result=await spendGate()({name:'github_cost_reducing_action',
      args:{enabled:false},ctx:w.ctx,target:{owner:'example-org'},
      classification:{spendCents:0,spendUnknown:false},
      declarations:{spend:true}});
    expect(result).toBeNull();
    const passCtx={...w.ctx,connection:{...w.ctx.connection,pass:true,
      spend_limit_cents:0,client_id:'no-spend-test-pass'}};
    expect(await spendGate()({name:'github_cost_reducing_action',
      args:{enabled:false},ctx:passCtx,target:{owner:'example-org'},
      classification:{spendCents:0,spendUnknown:false},
      declarations:{spend:true}})).toBeNull();
  });
  it('refuses for an unknown account', async () => {
    const w = await world(5000);
    const v = await spendGate()({ name: 'github_x', args: {}, ctx: w.ctx, target: { owner: 'ghost' }, classification: { spendCents: 100 }, declarations: { spend: true } });
    expect(v.by).toBe('spend limit');
  });
});

describe('user delegation versus service-pass limits for metered billing', () => {
  it('permits an informed end-user preview without a cap but refuses unknown cost under an issued numerical service-pass allowance', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full', gates: [spendGate()] });
    const gate = spendGate();
    const unknown = { spendCents: 0, spendUnknown: true };
    const target = { owner: 'example-org' };
    const user = await gate({ name: 'github_metered', args: {}, ctx: w.ctx, target, classification: unknown, declarations: { spend: true } });
    expect(user).toBeNull();
    const passCtx = { ...w.ctx, connection: { ...w.ctx.connection, pass: true, client_id: 'issued-pass', spend_limit_cents: 5000 } };
    const limited = await gate({ name: 'github_metered', args: {}, ctx: passCtx, target, classification: unknown, declarations: { spend: true } });
    expect(limited).toMatchObject({ by: 'pass spend allowance' });
    expect(limited.refuse).toContain('cannot be bounded');
    const zero = await gate({ name: 'github_metered', args: {}, ctx: { ...passCtx, connection: { ...passCtx.connection, spend_limit_cents: 0 } }, target, classification: unknown, declarations: { spend: true } });
    expect(zero).toMatchObject({ by: 'pass spend allowance' });
  });
});

describe('github_set_spend_limit', () => {
  const lower = (w, limitCents, extra = {}) => handlers.github_set_spend_limit({ account: 'example-org', limitCents, ...extra }, w.ctx).then(parse);
  it('lowers the limit (and to zero), and shows dollars', async () => {
    const w = await world(5000, { profile: 'full' });
    expect((await lower(w, 1000, { dryRun: true })).status).toBe('preview');
    const res = await lower(w, 1000, { confirm: true });
    expect(res).toMatchObject({ status: 'applied', confirmed: true });
    expect(res.result.spend_limit).toBe('$10.00');
    expect((await w.db.getAccount('example-org')).spend_limit_cents).toBe(1000);
    expect((await lower(w, 0, { confirm: true })).status).toBe('applied');
  });
  it('lets the owner raise a standing preference directly', async () => {
    const w = await makeWorld({ profile: 'full', gates: [spendGate()] });
    await w.db.setSpendLimitCents('example-org', 1000);
    const res = await lower(w, 2000, { confirm: true });
    expect(res).toMatchObject({ status: 'applied', confirmed: true });
    expect((await w.db.getAccount('example-org')).spend_limit_cents).toBe(2000);
  });
  it('is refused on the read-only profile and for accounts outside the connection', async () => {
    const ro = await makeWorld({ profile: 'read_only', gates: [spendGate()] });
    expect((await lower(ro, 0)).status).toBe('refused');
    const w = await makeWorld({ profile: 'full', gates: [spendGate()] });
    expect((await handlers.github_set_spend_limit({ account: 'other-org', limitCents: 0 }, w.ctx).then(parse)).status).toBe('refused');
  });
});
