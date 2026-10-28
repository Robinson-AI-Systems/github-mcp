// The write contract (B-1): the nine checks every write tool passes, through every door that exists. A tool's test calls
// `runWriteContract` once with its fixtures; the checks and the doors are the same for every tool, so a tool cannot pass by
// skipping a safety step the others pass.
// This matrix tests both selected everyday restrictions and full owner one-call
// execution; owner-authority.test.js separately proves shipped policy gates and pass isolation.
//   1 dryRun sends nothing and leaves a preview row            2 without confirm (when needed) nothing changes
//   3 with confirm: one write, read back, row with request key  4 same call again: replay, no second write
//   5 read-back mismatch: confirmed false + warning              6 production target: refused on preview, confirm on production
//   7 protected resource: refused naming the level               8 access change / outsider: confirm, names the people
//   9 spend: dollar line, refused at $0, from the price table, counts toward the limit
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createCredentials } from '../../src/github/credentials.js';
import { createDispatch } from '../../src/tools/dispatch.js';
import { mergeNamespaces } from '../../src/core/registry.js';
import * as meta from '../../src/tools/meta.js';
import { createFakeDb } from './fake-db.js';
import { makeFakeGitHub } from './fake-github.js';
import { protectionGate, spendGate } from './fixture-gates.js';

export const NOW = Date.UTC(2026, 9, 10, 18, 0, 0);
const ENV = { TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64url') };

/** A fresh world: fake database and GitHub, a fine-grained credential for example-org, and a connection of the given kind. */
export async function makeWorld({ mode = 'preview', profile = 'everyday', accounts = ['example-org'], gates = [], scratchAccount = false, advanceClockOnSleep = false, packageToken = false, packageUser = false, delegated = false, externalRoutes = [] } = {}) {
  // Long multi-step fixtures must let reserved write slots expire in virtual time.
  // Production spacing remains real; this only advances the fake clock after a simulated sleep.
  let offsetMs = 0;
  const clock = () => NOW + offsetMs;
  const db = createFakeDb({ clock });
  await db.initSchema();
  const gh = makeFakeGitHub({ routes: externalRoutes });
  // Most write-contract fixtures classify notification recipients and read org
  // members. An unconfigured fake route answers 501, which Octokit *retries*
  // with real backoff; hundreds of contract checks then take minutes for no
  // behavioral coverage. Default to explicit known own people. A test that
  // needs inaccessible membership overrides this route with 403.
  gh.when('GET /orgs/{org}/members').reply(200,
    [{ login: 'example-owner', id: 1, type: 'User' }]);
  const credentials = createCredentials({ db, env: ENV, fetch: gh.fetch, now: () => NOW });
  for (const login of accounts) {
    await db.upsertAccount({ login, accountId: 1000 + login.length, accountType: packageUser ? 'User' : 'Organization', label: login, credentialKind: scratchAccount ? 'app' : 'fine_grained', appId: scratchAccount ? 901 : null, isScratch: scratchAccount });
    if (scratchAccount) await db.setInstallation(login, { installationId: 902, repositorySelection: 'all', permissions: { contents: 'write', metadata: 'read' }, status: 'active' });
    if (packageToken) await credentials.storePackage(login, 'fixture-package-token-value-only', { scopes: ['read:packages', 'write:packages', 'delete:packages'], actor: packageUser ? login : 'example-owner' });
    await credentials.storeFineGrained(login, 'github_pat_FAKE0123456789abcdefghij', { expiresAt: null });
    await credentials.storeUserAuthorization(login, { userLogin: 'example-owner', accessToken: 'ghu_FAKE0123456789abcdefghij', expiresIn: 28800, refreshToken: 'ghr_FAKE0123456789abcdefghij', refreshExpiresIn: 15811200 });
  }
  // Mock-only App transport: obtain an existing fixture user token instead of minting a real App installation token.
  const fixtureCredentials = scratchAccount ? { ...credentials, token: ({ account }) => credentials.token({ account, cred: 'U' }) } : credentials;
  const connection = Object.freeze({ client_id: 'client-1', default_account: accounts[0], accounts: Object.freeze([...accounts]), mode, profile, listing: 'catalog', ...(delegated ? { pass: true,
    allow_writes: true, allow_access_changes: true, spend_limit_cents: 100000, areas: null, repos: null } : {}) });
  const ctx = { connection, db, env: ENV, credentials: fixtureCredentials, fetch: gh.fetch,
    now: clock, sleep: async (ms) => { if (advanceClockOnSleep) offsetMs += ms; },
    retryAfterBaseValue: 1, gates };
  return { db, gh, credentials: fixtureCredentials, connection, ctx };
}

// A GraphQL query is a POST but changes nothing; only a mutation counts as a write.
const writes = (gh) => gh.calls.filter((c) => !['GET', 'HEAD'].includes(c.method) && !(c.route === 'POST /graphql' && !/^\s*mutation\b/.test(String(c.body?.query ?? ''))));
export const parse = (result) => result.structuredContent?.full_payload_location === 'content[0].text'
  ? JSON.parse(result.content[0].text) : result.structuredContent ?? JSON.parse(result.content[0].text);

/** The doors that exist today: the handler itself, and the MCP dispatcher. Later batches add `github_call` and the HTTPS API. */
export function doorsFor(definition) {
  const registry = mergeNamespaces([{ tools: [definition.tool], handlers: { [definition.tool.name]: definition.handler } }]);
  const withMeta = mergeNamespaces([meta, { tools: [definition.tool], handlers: { [definition.tool.name]: definition.handler } }]);
  return [
    { name: 'handler', call: async (world, args) => definition.handler(args, world.ctx) },
    { name: 'dispatch', call: async (world, args) => createDispatch({ env: world.ctx.env, credentials: world.credentials, gates: world.ctx.gates, fetch: world.gh.fetch, now: world.ctx.now, sleep: world.ctx.sleep })
      .call(null, { registry, name: definition.tool.name, args, connection: world.connection, db: world.db }) },
    // door 3 (C-2): the same tool run by name through github_call - every guard must apply exactly the same
    { name: 'github_call', call: async (world, args) => createDispatch({ env: world.ctx.env, credentials: world.credentials, gates: world.ctx.gates, fetch: world.gh.fetch, now: world.ctx.now, sleep: world.ctx.sleep })
      .call(null, { registry: withMeta, name: 'github_call', args: { name: definition.tool.name, args }, connection: world.connection, db: world.db }) }
  ];
}

/**
 * @param {object} o
 * @param {string} o.label
 * @param {{ tool: object, handler: Function }} o.definition
 * @param {object} o.args valid arguments that classify exactly as described below
 * @param {(gh) => void} o.arrange sets the fake GitHub's replies; `mismatch` makes the read-back disagree with the intent
 * @param {boolean} o.needsConfirm whether these arguments need confirmation on a preview connection
 * @param {boolean} [o.production] a production change (refused on preview, confirmed on production)
 * @param {string[]} [o.notifies] outsiders the preview must name
 * @param {boolean} [o.accessWidening]
 * @param {number} [o.spendCents]
 * @param {object} [o.quietArgs] arguments for the same tool that need no confirmation (for an `M` tool: only own people)
 * @param {boolean} [o.conveyor] allowed under a `pr-only` protected resource
 * @param {string} [o.profile] the connection profile to test with (default everyday; use 'full' for a full-profile tool)
 * @param {(opts) => Function[]} [o.gatesFor] `({ protectedLevel, spendLimitCents })` -> gates; defaults to the fixture gates
 */
export function runWriteContract({ label, definition, args, arrange, needsConfirm, production = false, notifies = [], accessWidening = false, spendCents = 0, quietArgs = null,
  packageToken = false, conveyor = false, profile = 'everyday', scratchAccount = false, externalRoutes = [], previewOnly = false, expectedWrites = 1, advanceClockOnSleep = false, prepare = null, gatesFor = ({ protectedLevel, spendLimitCents }) => [...(protectedLevel ? [protectionGate(protectedLevel)] : []), spendGate({ limitCents: spendLimitCents ?? 0 })] }) {
  for (const door of doorsFor(definition)) {
    describe(`write contract: ${label} through ${door.name}`, () => {
      const world = async (options = {}, replies = 'ok') => {
        const w = await makeWorld({ profile, scratchAccount, advanceClockOnSleep, packageToken, externalRoutes, ...options, ...(options.gates === undefined ? { gates: gatesFor({ spendLimitCents: options.spendLimitCents ?? 100000 }) } : {}) });
        arrange(w.gh, replies);
        if (prepare) await prepare(w);
        return w;
      };
      const mode = production ? 'production' : 'preview';

      it('1. dryRun sends nothing and leaves a preview row', async () => {
        const w = await world({ mode });
        const out = parse(await door.call(w, { ...args, dryRun: true }));
        expect(out).toMatchObject({ done: false, status: 'preview' });
        expect(out.preview).toEqual(expect.any(String));
        expect(writes(w.gh)).toEqual([]);
        expect(await w.db.getChange(1)).toMatchObject({ dryRun: true, tool: definition.tool.name });
        expect(w.gh.invalid).toEqual([]);
      });

      if (needsConfirm) {
        it('2. full owners execute without confirm; restricted profiles ask first', async () => {
          const w = await world({ mode });
          const out = parse(await door.call(w, { ...args }));
          expect(out).toMatchObject(profile === 'full'
            ? { done: true, status: 'applied' }
            : { done: false, status: 'needs_confirmation', needsConfirmation: true });
          expect(writes(w.gh)).toHaveLength(profile === 'full' ? expectedWrites : 0);
        });
      }

      it('3. with confirm: exactly one write, read back, and a change-log row holding the request key', async () => {
        const w = await world({ mode });
        const out = parse(await door.call(w, { ...args, confirm: true }));
        expect(out).toMatchObject({ done: true, status: 'applied', confirmed: true, requestKey: expect.stringMatching(/^rmcp_/) });
        expect(writes(w.gh)).toHaveLength(expectedWrites);
        expect(w.gh.invalid).toEqual([]);
        const claim = await w.db.claimChange({ tool: definition.tool.name, summary: 'x', requestKey: out.requestKey });
        expect(claim).toMatchObject({ claimed: false, existing: { confirmed: true } });
      });

      it('4. the same call again within ten minutes sends nothing and says it was replayed', async () => {
        const w = await world({ mode });
        const first = parse(await door.call(w, { ...args, confirm: true }));
        const second = parse(await door.call(w, { ...args, confirm: true }));
        expect(second).toMatchObject({ status: 'replayed', replayed: true, requestKey: first.requestKey });
        expect(writes(w.gh)).toHaveLength(expectedWrites);
      });

      it('5. a read-back that disagrees is reported as unconfirmed with a warning', async () => {
        const w = await world({ mode }, 'mismatch');
        const out = parse(await door.call(w, { ...args, confirm: true }));
        expect(out).toMatchObject({ done: false, confirmed: false, status: 'unconfirmed' });
        expect(out.warning).toEqual(expect.any(String));
      });

      if (production) {
        it('6. owner production executes; restricted profiles honor mode and confirmation', async () => {
          const preview = await world({ mode: 'preview' });
          const refused = await door.call(preview, { ...args, confirm: true });
          if (profile === 'full') {
            expect(parse(refused)).toMatchObject({ status: 'applied', confirmed: true });
            expect(writes(preview.gh)).toHaveLength(expectedWrites);
          } else {
            expect(refused.isError).toBe(true);
            expect(parse(refused)).toMatchObject({ mode: 'PREVIEW', status: 'refused_by_guard', refusedBy: 'mode' });
            expect(writes(preview.gh)).toEqual([]);
          }
          const live = await world({ mode: 'production' });
          const out = parse(await door.call(live, { ...args }));
          expect(out).toMatchObject({ mode: 'PRODUCTION', status: profile === 'full' ? 'applied' : 'needs_confirmation' });
          expect(out.preview ?? out.summary).toContain('PRODUCTION');
          expect(writes(live.gh)).toHaveLength(profile === 'full' ? expectedWrites : 0);
        });
      } else {
        it('6. a tool that is never production is not refused by the mode', async () => {
          const w = await world({ mode: 'preview' });
          expect(parse(await door.call(w, { ...args, dryRun: true })).status).toBe('preview');
        });
      }

      it('7. a locked resource refuses everything; pr-only refuses what is not pull-request work', async () => {
        const locked = await world({ mode: previewOnly ? 'preview' : 'production', gates: gatesFor({ protectedLevel: 'locked' }) });
        const out = parse(await door.call(locked, { ...args, confirm: true }));
        expect(out).toMatchObject({ status: 'refused_by_guard' });
        expect(out.refusedBy).toContain('locked');
        expect(writes(locked.gh)).toEqual([]);
        const prOnly = await world({ mode: previewOnly ? 'preview' : 'production', gates: gatesFor({ protectedLevel: 'pr-only' }) });
        const res = parse(await door.call(prOnly, { ...args, confirm: true }));
        if (conveyor) expect(res.status).not.toBe('refused_by_guard');
        else expect(res).toMatchObject({ status: 'refused_by_guard' });
      });

      if (accessWidening || notifies.length) {
        it('8. access and notification disclosure accompanies owner execution or delegated confirmation', async () => {
          const w = await world({ mode });
          const out = parse(await door.call(w, { ...args }));
          expect(out).toMatchObject(profile === 'full' ? { status: 'applied' } : { status: 'needs_confirmation', needsConfirmation: true });
          for (const name of notifies) expect(out.preview ?? out.summary).toContain(name);
          if (accessWidening) expect(out.preview ?? out.summary).toContain('ACCESS CHANGE');
          expect(writes(w.gh)).toHaveLength(profile === 'full' ? expectedWrites : 0);
          if (quietArgs) {
            const quiet = await world({ mode });
            const ran = parse(await door.call(quiet, { ...quietArgs }));
            expect(ran).toMatchObject({ status: 'applied' });
          }
        });
      }

      if (spendCents > 0) {
        it('9. a spending change shows its cost from the price table, is refused at $0, and counts toward the limit', async () => {
          const w = await world({ mode, spendLimitCents: 100000 });
          const out = parse(await door.call(w, { ...args }));
          expect(out.preview ?? out.summary).toContain(`$${(spendCents / 100).toFixed(2)}`);
          if (profile !== 'full') expect(out.needsConfirmation).toBe(true);
          const zero = await world({ mode, gates: gatesFor({ spendLimitCents: 0 }) });
          const refused = parse(await door.call(zero, { ...args, confirm: true }));
          expect(refused).toMatchObject({ status: 'refused_by_guard', refusedBy: 'spend limit' });
          expect(refused.error).toContain('setup page');
          expect(writes(zero.gh)).toEqual([]);
          const tight = await world({ mode, gates: gatesFor({ spendLimitCents: spendCents - 1 }) });
          expect(parse(await door.call(tight, { ...args, confirm: true })).status).toBe('refused_by_guard');
          const exact = await world({ mode, gates: gatesFor({ spendLimitCents: spendCents }) });
          expect(parse(await door.call(exact, { ...args, confirm: true })).status).toBe('applied');
        });
      }
    });
  }
}
