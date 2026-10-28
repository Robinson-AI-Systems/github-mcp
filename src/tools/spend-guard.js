import { isOwnerConnection } from '../core/authority.js';
// B4 spending: the developer's $0 budget is NOT an end-user product restriction.
// Users may choose an explicit monthly limit; otherwise price-known or price-unknown
// actions are available under their delegated production/approval policy with a truthful warning.
// RTC passes are separately scoped grants and their configured limits still apply.
import { dollars } from '../github/prices.js';

const DENVER = 'America/Denver';

/** The instant the current calendar month began in Denver (a Date). */
export function denverMonthStart(now) {
  const at = new Date(now);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: DENVER, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(at).filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]));
  const firstUtcGuess = Date.UTC(parts.year, parts.month - 1, 1, 0, 0, 0);
  // Denver is 6 or 7 hours behind UTC; the offset on the 1st decides which.
  for (const offsetHours of [6, 7]) {
    const candidate = new Date(firstUtcGuess + offsetHours * 3_600_000);
    const local = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: DENVER, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(candidate).filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]));
    if (local.year === parts.year && local.month === parts.month && local.day === 1 && local.hour === 0) return candidate;
  }
  throw new Error('Could not work out the start of the month in Denver.');
}

/** The source-of-truth end-user cap interpretation for every read and guard.
 * A historical developer default zero is NOT a user-selected product cap.
 * A user-selected zero remains enforceable; positive legacy caps stay effective. */
export function selectedSpendCap(row) {
  const value = Number(row?.spend_limit_cents);
  const cents = Number.isSafeInteger(value) && value >= 0 ? value : 0;
  const explicit = row?.spend_limit_explicit === true;
  const configured = explicit || cents > 0;
  return { configured, explicit, cents, limitCents: configured ? cents : null,
    newSpendingAllowedByCap: !configured || cents > 0 };
}

/** Limit, spent so far this month, and what is left for one account. */
export async function spendStatus(ctx, login) {
  const row = await ctx.db.getAccount(login);
  if (!row) return null;
  const now = (ctx.now ?? Date.now)();
  const since = denverMonthStart(now);
  const cap = selectedSpendCap(row);
  const limitCents = cap.cents;
  const limitEnabled = cap.configured;
  const usedCents = await ctx.db.sumSpendCents(row.login, since);
  return { login: row.login, limitEnabled, limitCents, usedCents,
    remainingCents: limitEnabled ? Math.max(0, limitCents - usedCents) : null, since };
}

/** The gate for `src/tools/gates.js`. It also enforces "the spend limit tool can only lower the limit". */
export function spendGate() {
  return async ({ name, args, ctx, target, classification, declarations }) => {
    if (isOwnerConnection(ctx.connection)) return null;
    if (name === 'github_set_spend_limit') {
      const status = await spendStatus(ctx, target.owner);
      if (status?.limitEnabled && Number.isSafeInteger(args.limitCents) && args.limitCents > status.limitCents) {
        return { refuse: `The limit is ${dollars(status.limitCents)} and this would raise it to ${dollars(args.limitCents)}. Only the setup page (with your passphrase) can raise it; this tool can only lower it.`, by: 'spend limit' };
      }
      return null;
    }
    if (!declarations?.spend && !(classification.spendCents > 0) && !classification.spendUnknown) return null;
    const status = await spendStatus(ctx, target.owner);
    if (!status) return { refuse: `${target.owner} is not a connected account, so its spend limit is unknown.`, by: 'spend limit' };
    const unknown = classification.spendUnknown === true;
    const cost = classification.spendCents || 0;
    // Turning off paid access or reducing enforcement exposure is free.
    // A user-selected $0 ceiling limits new spending, not cost-reducing actions.
    if (!unknown && cost === 0) return null;
    if (status.limitEnabled && status.limitCents <= 0) {
      return { refuse: `This costs money (${cost ? `about ${dollars(cost)} a month` : 'an amount GitHub bills'}) and the monthly spend limit for ${status.login} is $0.00. To allow spending, raise the limit on the setup page with your passphrase.`, by: 'spend limit' };
    }
    if (status.limitEnabled && unknown) return { refuse: `Your explicit ${dollars(status.limitCents)} monthly limit cannot be proven safe for unknown future charges. Change that user-selected limit or use a bounded operation.`, by: 'spend limit' };
    if (status.limitEnabled && status.usedCents + cost > status.limitCents) {
      return { refuse: `This would cost about ${dollars(cost)}; ${dollars(status.usedCents)} of the ${dollars(status.limitCents)} monthly limit for ${status.login} is already used this month (${dollars(status.remainingCents)} left). Raise the limit on the setup page if you want this.`, by: 'spend limit' };
    }
    if (ctx.connection?.pass === true) {
      const cap = Number(ctx.connection.spend_limit_cents) || 0;
      const used = await ctx.db.sumSpendCents(status.login, status.since, ctx.connection.client_id);
      if (cap <= 0) return { refuse: 'This user-issued pass has no spend allowance. Reissue the pass with the desired spending delegation.', by: 'pass spend allowance' };
      if (unknown) return { refuse: 'This pass has a numerical spending ceiling; unknown future charges cannot be bounded to it. Use a properly authorized full end-user connection or a verifiably bounded operation.', by: 'pass spend allowance' };
      if (used + cost > cap) return { refuse: `This pass may spend ${dollars(cap)} in total this month and has used ${dollars(used)}; this would cost about ${dollars(cost)}.`, by: 'pass spend allowance' };
    }
    return { confirm: unknown
      ? `GitHub may charge for this operation now and during later usage. No maximum future charge is guaranteed. You are acting as ${status.login}; check your billing controls before authorizing.`
      : status.limitEnabled
        ? `GitHub may charge ${dollars(cost)}; ${dollars(status.usedCents)} of your chosen ${dollars(status.limitCents)} monthly limit was used this month.`
        : `GitHub may charge about ${dollars(cost)}; this account has no user-configured MCP spending cap. Confirm with the account's actual delegated authority.` };
  };
}
