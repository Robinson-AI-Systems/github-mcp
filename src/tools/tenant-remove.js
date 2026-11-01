// PUB-8: the service owner removes ONE person and everything stored for them, found by identity id or by personal GitHub login.
// Owner-only: listed and callable only on the owner's own direct connection (`operatorOnly`, see src/core/registry.js); the
// handler re-checks it. Order: preview → confirm → each stored GitHub sign-in is revoked AT GitHUB first (and GitHub is asked
// whether it still accepts it) → the one SQL removal core → an independent readback. Journaled in the owner's change log.
// The owner's own identity is refused unless `includeOwnIdentity: true` is also given. No token or secret ever leaves this file.
import { defineGithubWrite, explainGithubError } from './define-github-write.js';
import { isOperatorConnection } from '../core/authority.js';
import { productionSql } from '../db.js';
import { createTenantRemoval, removalProven, revokeStoredSignIns } from '../tenancy/tenant-removal.js';

const safe = (message, code) => Object.assign(new TypeError(message), { safeMessage: true, safeCode: code });
/** The owner's root database store. A test may hand its own store on the database object. */
const storeFor = (ctx) => ctx.db?.tenantRemoval ?? createTenantRemoval({ rootSql: productionSql(), env: ctx.env ?? process.env });
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const sum = (plan, field) => plan.tenants.reduce((a, t) => a + (Array.isArray(t[field]) ? t[field].length : Number(t[field] ?? 0)), 0);

const remove = defineGithubWrite({
  name: 'github_tenant_remove',
  area: 'server', audience: ['Op'],
  description: 'Owner only: preview, then remove one person and all their stored data by identity or GitHub login; revokes their GitHub sign-ins first.',
  guidance: 'Call with dryRun first and read the preview; then confirm: true. Refuses your own identity unless includeOwnIdentity is true.',
  properties: {
    identity: { type: 'string', maxLength: 36, pattern: '^[0-9a-fA-F-]{36}$', description: 'The person\'s identity id' },
    login: { type: 'string', maxLength: 39, pattern: '^[A-Za-z0-9][A-Za-z0-9-]{0,38}$', description: 'Their personal GitHub login (never an organization)' },
    includeOwnIdentity: { type: 'boolean', description: 'Also allow removing the service owner\'s own identity' }
  },
  declarations: { production: 'never', cred: '—', profiles: ['full'], confirm: 'always' },
  target: (args, ctx) => {
    if (!isOperatorConnection(ctx.connection) || ctx.db?.playgroundScope?.tenantId) throw new TypeError('Only the service owner can remove a person, from the owner\'s own connection.');
    if ((args.identity === undefined) === (args.login === undefined)) throw new TypeError('Give exactly one of identity or login.');
    return { owner: String(ctx.connection.default_account), scope: 'server' };
  },
  read: async (args, ctx) => {
    const store = storeFor(ctx);
    const identityId = await store.resolve(args.identity !== undefined ? { identity: args.identity } : { login: args.login });
    const plan = identityId ? await store.plan(identityId) : null;
    // Nothing stored: the preview says so and a confirmed call sends nothing. (Not a read refusal, so the same request repeated
    // after a removal is answered as a replay of the recorded result.)
    if (!plan) return { absent: true, asked: args.identity ?? String(args.login).toLowerCase() };
    if (plan.owner && args.includeOwnIdentity !== true)
      throw safe('That is the service owner\'s own identity. Removing it needs includeOwnIdentity: true as well.', 'own_identity');
    const shared = plan.tenants.filter((t) => t.other_members > 0).length;
    if (shared) throw safe(`This person shares ${plural(shared, 'space')} with other people; remove those people's access first.`, 'shared_tenant');
    return plan;
  },
  classify: () => ({}),
  summarize: ({ before: p }) => p.absent ? `Nothing is stored for ${p.asked} (already removed or never connected); nothing would be removed.` : `REMOVE person ${p.identity_id}${p.logins.length ? ` (GitHub ${p.logins.join(', ')})` : ''}${p.owner ? ' — YOUR OWN identity' : ''}: `
    + `${plural(p.tenants.length, 'space')} (${p.tenants.map((t) => t.kind).join(', ') || 'none'}), revoke ${plural(sum(p, 'github_sign_ins'), 'stored GitHub sign-in')} at GitHub first, `
    + `${plural(sum(p, 'saved_keys'), 'saved key')}, ${plural(sum(p, 'assistant_connections'), 'assistant connection')}, ${plural(sum(p, 'async_jobs'), 'job')}, `
    + `${plural(sum(p, 'settings_rows'), 'setting')}, ${plural(sum(p, 'playground'), 'Playground allocation')} handed to cleanup, ${plural(sum(p, 'device_pointers'), 'device pointer')}. Irreversible.`,
  apply: async ({ ctx, before: plan }) => {
    if (plan.absent) throw Object.assign(new TypeError(`Nothing is stored for ${plan.asked}: no stored person matches that identity or login, so nothing was removed.`), { noOperationStarted: true });
    const store = storeFor(ctx);
    const tokens = await store.revocationTokens(plan);
    const revoked = [];
    if (tokens.length) {
      let app;
      try { app = await store.appClient(); } catch { throw Object.assign(new TypeError('The service App\'s OAuth client is unavailable, so no sign-in could be revoked and nothing was removed.'), { noOperationStarted: true }); }
      // Tokens first: each is revoked at GitHub before any stored data goes. A refusal stops here with nothing removed.
      revoked.push(...await revokeStoredSignIns({ tokens, app, fetch: ctx.fetch }));
    }
    const removed = await store.remove(plan);
    return { revoked, spaces_removed: removed };
  },
  readAfter: ({ ctx, before }) => storeFor(ctx).readback(before),
  verify: ({ after, response }) => removalProven(after) && response.revoked.every((r) => r.still_valid === false),
  present: ({ before, after, response }) => ({
    identity_id: before.identity_id, logins: before.logins, owner_identity: before.owner,
    removed: { spaces: response.spaces_removed, kinds: before.tenants.map((t) => t.kind), saved_keys: sum(before, 'saved_keys'),
      assistant_connections: sum(before, 'assistant_connections'), jobs: sum(before, 'async_jobs'), settings: sum(before, 'settings_rows') },
    github_sign_ins: response.revoked,
    readback: { identity_present: after.identity_present, spaces: after.tenants.map((t) => ({ tenant_id: t.tenant_id, record: t.tenant_row,
      namespace: t.namespace_present, shared_rows: t.shared_rows, device_pointers: t.device_pointers, playground_awaiting_sweep: t.playground_awaiting_sweep })) },
    note: 'Managed Playground allocations are disposed by the regular cleanup sweep through its "namespace removed" path. Their own classic token, if they added one, was removed from storage; only they can revoke it on GitHub.'
  }),
  // Our own plain refusals (nothing stored, App client missing) are shown as written; GitHub failures as usual.
  explain: (error, input) => error?.noOperationStarted === true && typeof error.message === 'string' ? error.message : explainGithubError(error, input),
  inverse: () => null
});

// The write layer asks owners for confirmation only for restricted connections; this tool always asks: without confirm: true
// it returns the preview (journaled as a preview) and changes nothing.
async function handler(args, ctx) {
  if (args && typeof args === 'object' && !Array.isArray(args) && args.confirm !== true && args.dryRun !== true) {
    const shown = await remove.handler({ ...args, dryRun: true }, ctx);
    const body = shown?.structuredContent;
    if (!body || body.status !== 'preview') return shown;
    const next = { ...body, status: 'needs_confirmation', needsConfirmation: true, prompt: 'Read the preview, then call again with confirm: true.' };
    return { ...shown, structuredContent: next, content: [{ type: 'text', text: JSON.stringify(next) }] };
  }
  return remove.handler(args, ctx);
}

export const definition = Object.freeze({ tool: Object.freeze({ ...remove.tool, operatorOnly: true }), handler });
export const tools = [definition.tool];
export const handlers = { [definition.tool.name]: handler };
