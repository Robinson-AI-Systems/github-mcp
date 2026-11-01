// PUB-7: the public-launch readiness gate. Each condition is met / not met / needs owner from evidence; the verdict is "ready to
// propose opening" only when all eight are met; the owner tool refuses anyone but the server owner; nothing is ever changed.
import { describe, expect, it } from 'vitest';
import { acceptanceRows, catalogToolsForCard, evaluateLaunchReadiness, gatherLaunchFacts, launchSwitches, ownerRows, OWNER_ROWS, readEvidenceFile } from '../../src/launch/readiness.js';
import { checkLoadRecord, loadTestRecord, LOAD_TARGET } from '../../src/launch/load-result.js';
import { isServerOwner } from '../../src/tools/launch-readiness.js';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';
import { createFakeDb } from '../../test/helpers/fake-db.js';

const NOW = Date.parse('2026-11-01T12:00:00Z');
const goodLoad = () => loadTestRecord({ people: 50, at_once: 10, calls_per_person: 5, total_seconds: 9, errors: 0, sign_in: { n: 50, p50_ms: 1, p95_ms: 2, max_ms: 3 },
  whoami_calls: { n: 250, p50_ms: 1, p95_ms: 2, max_ms: 3 }, database_rows: { tenants: 50, identities: 50, public_clients: 50 } }, { ranAt: '2026-10-31T12:00:00.000Z', commit: 'a'.repeat(40) });
const passed = { status: 'PASSED', nextAction: null };
/** Every fact a fully ready launch would show. */
function readyFacts() {
  const env = { GITHUB_PUBLIC_CONNECT: 'enabled', GITHUB_PRIVATE_TENANT_PILOT: 'enabled', GITHUB_PUBLIC_INVITE_ONLY: 'enabled', LEGAL_APPROVED: 'yes', STATUS_PAGE_APPROVED: 'yes', PUBLIC_SUPPORT_EMAIL: 'help@example.test' };
  return {
    now: NOW, switches: launchSwitches(env),
    raw: { inviteOnly: true, publicConnect: true, legalApproved: true, statusApproved: true, supportEmail: true },
    code: { connectFlow: true, forgetPage: true, limitsPage: true, trustHandler: true, uninstallCleanup: true, costEstimate: true, webhookSignature: true,
      trustPages: ['privacy', 'terms', 'security', 'support', 'status'] },
    tools: { tokenPage: true },
    files: { permissionsAudit: true, inviteDocumented: true },
    rewrites: ['/', '/privacy', '/terms', '/security', '/support', '/status'],
    acceptance: { 'GITHUB-HARD1-SIGNIN-NO-CAP': passed, 'GITHUB-PUB5-HEADERS-LIMITS': passed, 'PLAYGROUND-COMMANDS': passed },
    evidenceLayers: { deployed: 'verified', custom_transport: 'verified', revocation: 'verified' },
    owner: { lawyer: true, appSettings: true, realDevice: true },
    loadTest: goodLoad(),
    keyRotation: [{ id: 'k', name: 'A key', procedure: 'docs/GO-LIVE-CHECKLIST.md', procedureOk: true, rehearsal: { test: 't', name: 'n' }, rehearsalOk: true }],
    pub8: { status: 'MERGED', catalogTools: ['github_public_person_remove'], registered: ['github_public_person_remove'] }
  };
}
const state = (report, id) => report.conditions.find((c) => c.id === id).state;

describe('launch readiness evaluation', () => {
  it('says "ready to propose opening" only when all eight conditions are met, and never changes anything', () => {
    const report = evaluateLaunchReadiness(readyFacts());
    expect(report.conditions.map((c) => c.id)).toEqual(['connect_flow', 'app_settings', 'key_safety', 'capacity_cost', 'stranger_safety', 'legal_trust', 'gradual_opening', 'honest_acceptance']);
    expect(report.conditions.every((c) => c.state === 'met' && c.next.length === 0)).toBe(true);
    expect(report.verdict).toBe('ready to propose opening');
    expect(report.never_changes).toMatch(/never changes GITHUB_PUBLIC_CONNECT/);
  });

  // One mutation per condition: [condition, expected state, how the evidence changes].
  const cases = [
    ['connect_flow', 'not met', (f) => { f.code.connectFlow = false; }],
    ['connect_flow', 'not met', (f) => { f.tools.tokenPage = false; }],
    ['connect_flow', 'needs owner', (f) => { f.acceptance['GITHUB-HARD1-SIGNIN-NO-CAP'] = { status: 'BLOCKED' }; }],
    ['app_settings', 'not met', (f) => { f.files.permissionsAudit = false; }],
    ['app_settings', 'needs owner', (f) => { f.owner.appSettings = false; }],
    ['key_safety', 'not met', (f) => { f.code.webhookSignature = false; }],
    ['key_safety', 'not met', (f) => { f.keyRotation[0].rehearsalOk = false; }],
    ['key_safety', 'not met', (f) => { f.keyRotation = null; }],
    ['capacity_cost', 'not met', (f) => { f.loadTest = null; }],
    ['capacity_cost', 'not met', (f) => { f.loadTest.errors = 2; }],
    ['capacity_cost', 'not met', (f) => { f.now = NOW + 200 * 86400000; }],
    ['capacity_cost', 'not met', (f) => { f.code.costEstimate = false; }],
    ['stranger_safety', 'not met', (f) => { f.pub8 = { status: 'APPROVED', catalogTools: [], registered: [] }; }],
    ['stranger_safety', 'not met', (f) => { f.code.uninstallCleanup = false; }],
    ['stranger_safety', 'needs owner', (f) => { f.evidenceLayers.revocation = 'unverified'; }],
    ['legal_trust', 'not met', (f) => { f.rewrites = ['/privacy']; }],
    ['legal_trust', 'needs owner', (f) => { f.owner.lawyer = null; }],
    ['legal_trust', 'needs owner', (f) => { f.raw.legalApproved = false; }],
    ['legal_trust', 'needs owner', (f) => { f.raw.statusApproved = false; }],
    ['gradual_opening', 'needs owner', (f) => { f.raw.inviteOnly = false; }],
    ['gradual_opening', 'not met', (f) => { f.files.inviteDocumented = false; }],
    ['honest_acceptance', 'not met', (f) => { f.acceptance['PLAYGROUND-COMMANDS'] = { status: 'BLOCKED' }; }],
    ['honest_acceptance', 'not met', (f) => { f.evidenceLayers.deployed = 'unverified'; }],
    ['honest_acceptance', 'needs owner', (f) => { f.owner.realDevice = false; }],
    ['honest_acceptance', 'needs owner', (f) => { f.acceptance = { ...f.acceptance, 'GITHUB-PUB5-HEADERS-LIMITS': undefined }; }]
  ];
  for (const [id, expected, mutate] of cases) {
    it(`${id} becomes "${expected}" when its evidence says so (${mutate.toString().slice(7, 70)})`, () => {
      const facts = readyFacts(); mutate(facts);
      const report = evaluateLaunchReadiness(facts);
      expect(state(report, id)).toBe(expected);
      expect(report.verdict).toBe('not ready');
      const c = report.conditions.find((x) => x.id === id);
      expect(c.next.length).toBeGreaterThan(0);
      if (expected === 'needs owner') expect(c.next.every((n) => n.startsWith('Chris:'))).toBe(true);
    });
  }

  it('reports switches by name in fixed words, never a raw value', () => {
    const s = launchSwitches({ GITHUB_PUBLIC_CONNECT: 'enabled', GITHUB_PUBLIC_INVITE_ONLY: 'surprise-value', PUBLIC_SUPPORT_EMAIL: 'help@example.test', PUBLIC_COST_ALERT_CENTS: '999' });
    expect(s).toMatchObject({ GITHUB_PUBLIC_CONNECT: 'enabled', GITHUB_PUBLIC_INVITE_ONLY: 'set to another value', PUBLIC_SUPPORT_EMAIL: 'set', PUBLIC_COST_ALERT_CENTS: 'set', LEGAL_APPROVED: 'not set' });
    expect(JSON.stringify(s)).not.toContain('help@example.test');
    expect(JSON.stringify(s)).not.toContain('surprise-value');
  });

  it('reads the acceptance block, the owner boxes and catalog rows from text', () => {
    const status = 'x\n<!-- release-acceptance:start -->\n```json\n[{"id":"A-1","status":"PASSED"},{"id":"B-2","status":"BLOCKED","nextAction":"later"}]\n```\n<!-- release-acceptance:end -->\n';
    expect(acceptanceRows(status)).toEqual({ 'A-1': { status: 'PASSED', nextAction: null }, 'B-2': { status: 'BLOCKED', nextAction: 'later' } });
    expect(acceptanceRows('no block')).toBeNull();
    const boxes = ownerRows(`- [x] ${OWNER_ROWS.lawyer}. Done.\n- [ ] **${OWNER_ROWS.appSettings}**: later\n`);
    expect(boxes).toEqual({ lawyer: true, appSettings: false, realDevice: null });
    expect(catalogToolsForCard('| `github_a` | x | — | N | — | O | R | PUB-8 built #1 |\n| `github_b` | x | — | N | — | O | R | PUB-7 |', 'PUB-8')).toEqual(['github_a']);
  });

  it('gathers facts from the real repository and computes a verdict from them (this repository today)', async () => {
    const facts = await gatherLaunchFacts({ env: {}, now: NOW });
    expect(facts.code.webhookSignature).toBe(true);
    expect(facts.code.trustPages).toEqual(expect.arrayContaining(['privacy', 'terms', 'security', 'support', 'status']));
    expect(facts.acceptance).not.toBeNull();
    expect(facts.keyRotation.find((k) => k.id === 'token_encryption_key')).toMatchObject({ procedureOk: true, rehearsalOk: true });
    expect(Object.values(facts.owner)).toEqual([false, false, false]);
    const report = evaluateLaunchReadiness(facts);
    expect(report.verdict).toBe('not ready');
    expect(state(report, 'gradual_opening')).toBe('needs owner');
    expect(readEvidenceFile('nope')).toBeNull();
  });
});

describe('saved load-test result', () => {
  it('keeps numbers only, and accepts only a recent, error-free, local run of at least 50 people 10 at once', () => {
    const record = loadTestRecord({ people: 50, at_once: 10, calls_per_person: 5, errors: 0, first_errors: ['call: secret text'], sign_in: { n: 50 }, whoami_calls: { n: 250 } }, { ranAt: '2026-10-31T00:00:00Z', commit: 'not-a-sha' });
    expect(JSON.stringify(record)).not.toContain('secret text');
    expect(record).toMatchObject({ target: LOAD_TARGET, source_commit: null });
    expect(checkLoadRecord(record, { now: NOW }).ok).toBe(true);
    expect(checkLoadRecord({ ...record, people: 10 }, { now: NOW }).problems.join()).toMatch(/only 10 simulated people/);
    expect(checkLoadRecord({ ...record, target: 'https://github.robinsonaisystems.com' }, { now: NOW }).ok).toBe(false);
    expect(checkLoadRecord(null).ok).toBe(false);
  });
});

describe('github_launch_readiness (owner only, every door)', () => {
  const owner = Object.freeze({ client_id: 'cl_owner', default_account: 'example-org', accounts: Object.freeze(['example-org']), mode: 'preview', profile: 'full', listing: 'catalog' });
  const data = (r) => (r.structuredContent?.full_payload_location === 'content[0].text' ? JSON.parse(r.content[0].text) : r.structuredContent);
  async function run(connection, name, args, credentials = null) {
    const db = createFakeDb(); await db.initSchema();
    return createDispatch({ env: { GITHUB_PUBLIC_CONNECT: 'enabled' }, credentials })({ registry, name, args, connection, db });
  }
  it('answers the owner directly and through github_call, small and read-only', async () => {
    const direct = await run(owner, 'github_launch_readiness', {});
    expect(direct.isError).toBeUndefined();
    const out = data(direct);
    expect(out.verdict).toBe('not ready');
    expect(out.conditions).toHaveLength(8);
    expect(Buffer.byteLength(JSON.stringify(out))).toBeLessThan(8192);
    const viaCall = data(await run(owner, 'github_call', { name: 'github_launch_readiness', args: { detail: 'full' } }));
    expect(JSON.stringify(viaCall)).toContain('GITHUB_PUBLIC_CONNECT');
    expect(registry.tools.find((t) => t.name === 'github_launch_readiness').annotations.readOnlyHint).toBe(true);
  });
  it('refuses public people, private tenants, passes and tenant-scoped credentials', async () => {
    for (const [connection, credentials] of [
      [{ ...owner, client_id: 'pcl_someone' }, null], [{ ...owner, client_id: 'tcl_someone' }, null],
      [{ ...owner, pass: true, pass_id: 'p1', kind: 'pass' }, null], [owner, { operationAuthority: async () => null }]]) {
      const r = await run(connection, 'github_launch_readiness', {}, credentials);
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toMatch(/Only the server owner/);
    }
    expect(isServerOwner({ connection: owner })).toBe(true);
    expect(isServerOwner({ connection: null })).toBe(false);
  });
});
