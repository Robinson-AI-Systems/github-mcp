// CAP-6: which optional tool families (self-hosted runners, larger runners, merge queue, Copilot) each connected account
// is offered, and why a family is hidden, in plain words. The answers come from GitHub and are kept 10 minutes.
import { defineRead } from './define-read.js';
import { FEATURE_CACHE_MS, FEATURE_FAMILIES, decideConnection } from '../github/feature-gates.js';

const familiesRead = defineRead({
  name: 'github_feature_families', area: 'server', audience: ['B', 'O', 'Op'],
  description: 'Which runner, larger-runner, merge-queue and Copilot tool families each account is offered, and why one is hidden.',
  properties: { owner: { type: 'string', minLength: 1, maxLength: 39, description: 'One connected account (default: all)' },
    refresh: { type: 'boolean', description: 'Ask GitHub again instead of using the answer kept for 10 minutes' } },
  handler: async (args, ctx) => {
    const accounts = args.owner ? (ctx.connection.accounts ?? []).filter((a) => a.toLowerCase() === args.owner.toLowerCase()) : undefined;
    if (args.owner && !accounts.length) throw new TypeError(`"${args.owner}" is not one of the accounts this connection may use (${(ctx.connection.accounts ?? []).join(', ')}).`);
    const decisions = await decideConnection(ctx, { refresh: args.refresh === true, accounts });
    return {
      accounts: decisions.map((d) => ({ account: d.account, type: d.type, checked_at: d.checked_at,
        families: Object.fromEntries(Object.entries(d.families).map(([key, v]) => [key, { title: FEATURE_FAMILIES[key].title, offered: v.state === 'on', state: v.state, reason: v.reason }])) })),
      kept_minutes: FEATURE_CACHE_MS / 60000,
      how: 'on: listed and runs. off: hidden, and a call by name is refused with the reason. unknown: hidden from lists; a call by name still runs and GitHub decides. Nothing here turns a feature on or spends money.'
    };
  }
});

export const tools = [familiesRead.tool];
export const handlers = { [familiesRead.tool.name]: familiesRead.handler };
