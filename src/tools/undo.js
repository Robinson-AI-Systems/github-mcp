import { redact } from './util.js';
// X-1: undo one finished change by running the clean opposite that was stored with it. Nothing here talks to GitHub:
// the opposite is handed back to the same dispatcher, so the target tool's own arguments check, profile, production
// switch, protected list, people/spend gates, preview/confirm, request key and change-log row all apply again.
// An undo is therefore an ordinary change with its own recorded opposite (undo of an undo works), and a change that was
// overtaken by a later change to the same thing is refused rather than overwritten.
import { toolsForProfile } from '../core/registry.js';

const CHANGE_ID = { type: 'integer', minimum: 1, maximum: 2147483647, description: 'The change number from github_recent_changes' };
const reply = (value, bad = false) => ({ structuredContent: value, content: [{ type: 'text', text: JSON.stringify(value) }], ...(bad ? { isError: true } : {}) });
const refuse = (reason, more = {}) => reply({ status: 'refused', done: false, reason, ...more }, true);
const sameLogin = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const NOT_PASSED = new Set(['dryRun', 'confirm', 'requestKey']);
const LATER_LIMIT = 100;

// What the right opposite is for changes that cannot be undone cleanly (BATCH-X X1). First match wins.
const NO_OPPOSITE = [
  [/^github_pr_(merge|update)|^github_workflow_merge/, 'A merge cannot be undone here. Open a revert pull request instead.'],
  [/^github_release_/, 'A published release has no clean opposite here. Delete the release or edit it.'],
  [/^github_repo_(delete|transfer)/, 'Deleting or transferring a repository cannot be undone here. Transfer it back from the new owner, or contact GitHub support about a recent deletion.'],
  [/^github_graphql_write/, 'This GraphQL change has no recorded clean opposite (a delete cannot be restored). Recreate the item with its own tool, or read the change summary for the exact opposite action.'],
  [/secret/, 'Secret values are never stored here. Set the value again on the setup page.'],
  [/invit|collab_add|member_add|org_invite/, 'A sent invitation cannot be taken back by an undo. Cancel the invitation instead.'],
  [/billing|spend|budget|seat|copilot|codespace/, 'Money-related changes have no automatic opposite. Seats removed are billed to the end of the cycle; review the billing page.'],
  [/delete_(run|log|artifact|package|cache)|artifact|package/, 'Deleted runs, logs, artifacts and packages cannot be restored once their restore window has passed.']
];
const adviceFor = (tool) => (NO_OPPOSITE.find(([pattern]) => pattern.test(String(tool)))?.[1]
  ?? 'This change has no recorded clean opposite. Read its summary in github_recent_changes and make the right opposite change yourself.');
const familyOf = (name) => String(name).split('_').slice(0, 2).join('_');

/** Later real changes that could have changed the same thing (same repository or account, same tool family). */
async function overtakenBy(ctx, row, innerName) {
  const families = new Set([familyOf(row.tool), familyOf(innerName)]);
  const rows = await ctx.db.listChanges({ account: row.account, repo: row.repo ?? null, limit: LATER_LIMIT });
  const sameThing = (r) => (row.repo ? sameLogin(r.repo ?? '', row.repo) : !r.repo);
  const later = rows.filter((r) => r.id > row.id && r.dryRun !== true && !String(r.summary ?? '').startsWith('REJECTED') && sameThing(r) && families.has(familyOf(r.tool)));
  // A full page whose oldest row is still newer than this change may be hiding more: the safe answer is "cannot prove".
  const unprovable = rows.length >= LATER_LIMIT && Math.min(...rows.map((r) => r.id)) > row.id;
  return { later, unprovable };
}

async function undoChange(args, ctx) {
  const connection = ctx.connection;
  if (!Array.isArray(connection?.accounts) || !connection.accounts.length || typeof ctx.callTool !== 'function' || !ctx.registry) {
    return refuse('Undo is unavailable on this connection.');
  }
  const row = await ctx.db.getChange(args.changeId);
  // A foreign or unknown change looks exactly the same: no probing other accounts' history.
  if (!row?.tool || !connection.accounts.some((login) => sameLogin(login, row.account))) return refuse(`There is no change number ${args.changeId} on your connected accounts.`);
  const about = { changeId: row.id, tool: row.tool, summary: row.summary };
  if (row.dryRun === true) return refuse('That entry was only a preview or a refusal. Nothing was changed, so there is nothing to undo.', about);
  if (row.confirmed !== true) return refuse('That change was never confirmed by reading it back, so what happened is unknown. Check the current state on GitHub before changing anything.', about);
  const inverse = row.inverse;
  if (!inverse) return refuse(adviceFor(row.tool), about);
  if (typeof inverse.tool !== 'string' || !/^github_[a-z0-9_]{2,70}$/.test(inverse.tool) || !inverse.args || typeof inverse.args !== 'object' || Array.isArray(inverse.args)) {
    return refuse('The recorded opposite is not usable, so it was not run.', about);
  }
  const inner = toolsForProfile(ctx.registry, connection.profile).find((t) => t.name === inverse.tool);
  if (!inner || inner.writes !== true || inner.writeContract !== 'defineWrite-v1') {
    return refuse(`The opposite needs ${inverse.tool}, which this connection's profile cannot use.`, about);
  }
  if (row.production === true && connection.mode !== 'production') {
    return refuse('That was a production change, and this connection is in preview mode. To undo it, connect again without "Read-only" ticked.', about);
  }
  const { later, unprovable } = await overtakenBy(ctx, row, inverse.tool);
  if (later.length) {
    const first = later[later.length - 1];
    return refuse(`This was already followed by a newer change (number ${first.id}: ${redact(String(first.summary)).slice(0, 160)}). Undoing the old one now could overwrite it. Undo the newer change first, or make the change by hand.`,
      { ...about, newerChanges: later.slice(-5).map((r) => r.id) });
  }
  if (unprovable) return refuse('So many newer changes exist that this one cannot be proven current. Make the change by hand.', about);

  const innerArgs = Object.fromEntries(Object.entries(inverse.args).filter(([key]) => !NOT_PASSED.has(key)));
  if (args.dryRun !== undefined) innerArgs.dryRun = args.dryRun;
  if (args.confirm !== undefined) innerArgs.confirm = args.confirm;
  innerArgs.requestKey = args.requestKey ?? `undo-${row.id}`;
  const result = await ctx.callTool(inverse.tool, innerArgs);
  const body = result?.structuredContent ?? null;
  return reply({ ...(body ?? { done: false, status: 'refused', reason: 'The opposite change gave no answer.' }), undoing: { ...about, runs: inverse.tool } }, result?.isError === true);
}

export const tools = [{
  name: 'github_undo_change', area: 'server', audience: ['Op'], usesRegistry: true, passthrough: true, profiles: ['everyday', 'full'],
  description: 'Undo one finished change by its number when it has a clean opposite; otherwise says what to do instead. Preview first, then confirm.',
  inputSchema: {
    type: 'object',
    properties: { changeId: CHANGE_ID, dryRun: { type: 'boolean', description: 'Preview the undo; nothing changes.' }, confirm: { type: 'boolean', description: 'Confirm the previewed undo.' },
      requestKey: { type: 'string', minLength: 4, maxLength: 128, description: 'Stable retry key.' } },
    required: ['changeId'], additionalProperties: false
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
}];
export const handlers = { github_undo_change: undoChange };
