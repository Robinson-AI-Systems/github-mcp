// PUB-7: the public-launch readiness report (the gate). It checks the eight launch conditions of the approved "Public App rollout
// plan" (docs/ROADMAP.md, 2026-10-23) against real evidence: repository files, the acceptance ledger (docs/STATUS.md block and
// docs/developer-evidence.json), the served trust pages, the saved load-test result, the key-rotation record, the PUB-8 removal
// tool, owner checklist boxes and the server's current switches. Each condition is met, not met (agent work) or needs owner (only
// Chris can do it), with the evidence used and the next step in plain words.
//
// It NEVER changes GITHUB_PUBLIC_CONNECT or any other setting, writes nothing and calls nothing outside this server. Its only
// output is when Chris should be asked. Switches are reported by name with fixed words, never a setting's value.
import { readFileSync } from 'node:fs';
import { checkLoadRecord, LOAD_MINIMUM } from './load-result.js';

// Literal URLs (not built paths) so the hosting bundler ships each file with the function that reads it.
const FILES = Object.freeze({
  status: new URL('../../docs/STATUS.md', import.meta.url),
  evidence: new URL('../../docs/developer-evidence.json', import.meta.url),
  ownerChecklist: new URL('../../docs/OWNER-CHECKLIST.md', import.meta.url),
  goLive: new URL('../../docs/GO-LIVE-CHECKLIST.md', import.meta.url),
  catalog: new URL('../../docs/TOOL-CATALOG.md', import.meta.url),
  workIndex: new URL('../../docs/pr-cards/work-index.json', import.meta.url),
  permissionsAudit: new URL('../../docs/audits/APP-PERMISSIONS-2026-10.md', import.meta.url),
  loadTest: new URL('../../docs/launch/load-test-result.json', import.meta.url),
  keyRotation: new URL('../../docs/launch/key-rotation.json', import.meta.url),
  vercel: new URL('../../vercel.json', import.meta.url),
  'tests/browser/sign-in.test.js': new URL('../../tests/browser/sign-in.test.js', import.meta.url)
});
const PATH_OF = Object.freeze({ 'docs/GO-LIVE-CHECKLIST.md': 'goLive', 'docs/STATUS.md': 'status' });

/** Reads one known evidence file; null when it is missing or not shipped with this server. */
export function readEvidenceFile(key) {
  const url = FILES[key] ?? FILES[PATH_OF[key]];
  if (!url) return null;
  try { return readFileSync(url, 'utf8'); } catch { return null; }
}

/** The exact owner checklist rows the gate reads (a ticked box means Chris did it). */
export const OWNER_ROWS = Object.freeze({
  lawyer: 'Review draft legal pages with a lawyer before public opening',
  appSettings: 'Confirm the GitHub App is set up for public use',
  realDevice: 'Real-device check before opening'
});
const OWNER_ASK = Object.freeze({
  lawyer: 'have a lawyer review the privacy, terms, security, support and status pages',
  appSettings: 'check the GitHub App settings page against docs/GO-LIVE-CHECKLIST.md section 3',
  realDevice: 'have a first-time person (or yourself, as a new person) connect on a real phone, install the App and add a token'
});
/** Acceptance rows (docs/STATUS.md block) the launch needs; `owner` = its prerequisite is a person's real sign-in. */
export const LAUNCH_ACCEPTANCE = Object.freeze([
  { id: 'GITHUB-HARD1-SIGNIN-NO-CAP', condition: 'connect_flow', owner: true, what: 'a first-time sign-in works on the live site' },
  { id: 'GITHUB-PUB5-HEADERS-LIMITS', condition: 'honest_acceptance', owner: true, what: 'live page headers, PKCE refusal and refresh replay' },
  { id: 'PLAYGROUND-COMMANDS', condition: 'honest_acceptance', owner: false, what: 'Playground (PLAY) commands on the live site' }
]);
export const TRUST_ROUTES = Object.freeze(['/privacy', '/terms', '/security', '/support', '/status']);

const json = (text) => { if (text == null) return null; try { return JSON.parse(text); } catch { return null; } };
const enumWord = (value, words) => (value == null || value === '' ? 'not set' : words.includes(value) ? value : 'set to another value');

/** The switches, by name, in fixed words (never a raw value). */
export function launchSwitches(env = {}) {
  return {
    GITHUB_PUBLIC_CONNECT: enumWord(env.GITHUB_PUBLIC_CONNECT, ['enabled']),
    GITHUB_PRIVATE_TENANT_PILOT: enumWord(env.GITHUB_PRIVATE_TENANT_PILOT, ['enabled']),
    GITHUB_PUBLIC_INVITE_ONLY: enumWord(env.GITHUB_PUBLIC_INVITE_ONLY, ['enabled']),
    GITHUB_PUBLIC_NEW_SIGNUPS: enumWord(env.GITHUB_PUBLIC_NEW_SIGNUPS, ['paused']),
    LEGAL_APPROVED: enumWord(env.LEGAL_APPROVED, ['yes']),
    STATUS_PAGE_APPROVED: enumWord(env.STATUS_PAGE_APPROVED, ['yes']),
    PUBLIC_SUPPORT_EMAIL: /^[^@\s]{1,64}@[^@\s]{1,190}\.[A-Za-z]{2,24}$/.test(String(env.PUBLIC_SUPPORT_EMAIL ?? '')) ? 'set' : 'not set',
    PUBLIC_COST_ALERT_CENTS: /^\d{1,9}$/.test(String(env.PUBLIC_COST_ALERT_CENTS ?? '')) ? 'set' : 'default (2000 = $20.00)'
  };
}

/** Reads the release-acceptance JSON block of docs/STATUS.md into { id: { status, nextAction } }; null when unreadable. */
export function acceptanceRows(text) {
  if (typeof text !== 'string') return null;
  const parts = text.split('<!-- release-acceptance:start -->');
  if (parts.length !== 2) return null;
  const body = /```json\s*\n([\s\S]*?)\n```/.exec(parts[1].split('<!-- release-acceptance:end -->')[0]);
  const rows = json(body?.[1]);
  if (!Array.isArray(rows)) return null;
  return Object.fromEntries(rows.filter((r) => typeof r?.id === 'string').map((r) => [r.id, { status: String(r.status ?? ''), nextAction: typeof r.nextAction === 'string' ? r.nextAction.slice(0, 240) : null }]));
}

/** { key: true (ticked) | false (open) | null (row missing) } for OWNER_ROWS. */
export function ownerRows(text) {
  const out = {};
  for (const [key, label] of Object.entries(OWNER_ROWS)) {
    const line = typeof text === 'string' ? text.split('\n').find((l) => /^\s*[-*] \[[ xX]\] /.test(l) && l.replace(/\*\*/g, '').includes('] ' + label)) : undefined;
    out[key] = line ? /\[[xX]\]/.test(line) : null;
  }
  return out;
}

/** Tool names whose catalog row names the card (Card column starts with it). */
export function catalogToolsForCard(text, card) {
  if (typeof text !== 'string') return [];
  const names = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('| `')) continue;
    const cells = line.split('|').map((c) => c.trim()).filter((c, i, a) => i > 0 && i < a.length - 1);
    if (cells.length === 8 && cells[7].split(' ')[0] === card) names.push(cells[0].replace(/`/g, ''));
  }
  return names;
}

/** Default code probes: real imports, so a missing or renamed piece of the product shows up as not met. */
async function probeCode() {
  const fn = (m, name) => typeof m?.[name] === 'function';
  const safe = async (path) => { try { return await import(path); } catch { return null; } };
  const [http, cleanup, cost, webhook, trust] = await Promise.all([
    safe('../tenancy/public-http.js'), safe('../tenancy/public-cleanup.js'), safe('../tenancy/usage-cost.js'), safe('../github/webhook.js'), safe('../tenancy/trust-pages.js')]);
  // The signature check, exercised with a fake secret: a right signature passes, a wrong or missing one is refused.
  let signature = false;
  if (fn(webhook, 'signatureMatches')) {
    const { createHmac } = await import('node:crypto');
    const body = Buffer.from('{"fake":true}'), secret = 'FAKE-webhook-secret-for-readiness';
    const good = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
    signature = webhook.signatureMatches(secret, body, good) === true && webhook.signatureMatches(secret, body, 'sha256=' + '0'.repeat(64)) === false
      && webhook.signatureMatches(secret, body, undefined) === false;
  }
  return {
    connectFlow: fn(http, 'publicAuthorize') && fn(http, 'publicApprove') && fn(http, 'publicManage'),
    forgetPage: fn(http, 'publicForget'), limitsPage: fn(http, 'publicLimits'), trustHandler: fn(http, 'publicTrust'),
    uninstallCleanup: fn(cleanup, 'createPublicCleanup'), costEstimate: fn(cost, 'estimatePublicCost') && fn(cost, 'publicSignupState'),
    webhookSignature: signature, trustPages: Array.isArray(trust?.TRUST_PAGES) ? [...trust.TRUST_PAGES] : []
  };
}

/** Gathers every fact the gate needs. `read` and `probe` are injectable for tests; nothing here writes. */
export async function gatherLaunchFacts({ env = process.env, now = Date.now(), read = readEvidenceFile, probe = probeCode, registryNames = null } = {}) {
  const names = registryNames ?? (await import('../tools/index.js')).registry.tools.map((t) => t.name);
  const work = json(read('workIndex'));
  const pub8Card = Array.isArray(work?.cards) ? work.cards.find((c) => c.id === 'PUB-8') : null;
  const catalog = read('catalog');
  const evidence = json(read('evidence'));
  const rotation = json(read('keyRotation'));
  const rewrites = json(read('vercel'))?.rewrites;
  const secrets = Array.isArray(rotation?.secrets) ? rotation.secrets.map((s) => {
    const procedureText = typeof s?.procedure === 'string' ? read(s.procedure) : null;
    const testText = typeof s?.rehearsal?.test === 'string' ? read(s.rehearsal.test) : null;
    return { id: String(s?.id ?? ''), name: String(s?.name ?? ''), procedure: s?.procedure ?? null, procedureOk: typeof procedureText === 'string' && procedureText.length > 0,
      rehearsal: s?.rehearsal ? { test: s.rehearsal.test, name: s.rehearsal.name } : null,
      rehearsalOk: typeof testText === 'string' && typeof s?.rehearsal?.name === 'string' && s.rehearsal.name.length > 8 && testText.includes(s.rehearsal.name) };
  }) : null;
  return {
    now, switches: launchSwitches(env),
    raw: { inviteOnly: env.GITHUB_PUBLIC_INVITE_ONLY === 'enabled', publicConnect: env.GITHUB_PUBLIC_CONNECT === 'enabled', legalApproved: env.LEGAL_APPROVED === 'yes',
      statusApproved: env.STATUS_PAGE_APPROVED === 'yes', supportEmail: launchSwitches(env).PUBLIC_SUPPORT_EMAIL === 'set' },
    code: await probe(),
    tools: { tokenPage: names.includes('github_master_token_link') },
    files: { permissionsAudit: !!read('permissionsAudit'), inviteDocumented: String(read('goLive') ?? '').includes('GITHUB_PUBLIC_INVITE_ONLY') },
    rewrites: Array.isArray(rewrites) ? rewrites.map((r) => String(r?.source ?? '')) : null,
    acceptance: acceptanceRows(read('status')),
    evidenceLayers: Array.isArray(evidence?.records) ? Object.fromEntries(evidence.records.map((r) => [String(r.layer), String(r.status)])) : null,
    owner: ownerRows(read('ownerChecklist')),
    loadTest: json(read('loadTest')),
    keyRotation: secrets,
    pub8: { status: pub8Card?.status ?? null, catalogTools: catalogToolsForCard(catalog, 'PUB-8'), registered: catalogToolsForCard(catalog, 'PUB-8').filter((n) => names.includes(n)) }
  };
}

const check = (ok, what, evidence, next, owner = false) => ({ ok: !!ok, owner, what, evidence, ...(ok ? {} : { next }) });

/** The eight conditions, each a list of checks built from the facts. Pure: same facts, same answer. */
function conditions(f) {
  const rows = f.acceptance;
  const accept = (id) => {
    const spec = LAUNCH_ACCEPTANCE.find((a) => a.id === id);
    const row = rows?.[id];
    return check(row?.status === 'PASSED', `Acceptance ${id}: ${spec.what}`,
      rows ? (row ? `docs/STATUS.md acceptance row ${id} is ${row.status}` : `docs/STATUS.md has no acceptance row ${id}`) : 'docs/STATUS.md acceptance block could not be read here',
      spec.owner ? `Chris: provide spare test sign-ins on the protected setup page (owner checklist "Test sign-ins for agents"); agents then run ${id} and record it.`
        : `Agents: run acceptance ${id} on the live site and record the result in docs/STATUS.md.`, spec.owner);
  };
  const ownerBox = (key, why) => check(f.owner?.[key] === true, why,
    f.owner?.[key] == null ? `docs/OWNER-CHECKLIST.md has no row "${OWNER_ROWS[key]}"` : `docs/OWNER-CHECKLIST.md row "${OWNER_ROWS[key]}" is ${f.owner[key] ? 'ticked' : 'not ticked'}`,
    `Chris: ${OWNER_ASK[key]} (docs/OWNER-CHECKLIST.md row "${OWNER_ROWS[key]}"); then an agent ticks the box.`, true);
  const load = checkLoadRecord(f.loadTest, { now: f.now });
  const loadCheck = check(load.ok, `Load test: at least ${LOAD_MINIMUM.people} simulated people, ${LOAD_MINIMUM.atOnce} at once, no errors, within ${LOAD_MINIMUM.maxAgeDays} days`,
    f.loadTest ? `docs/launch/load-test-result.json: ${f.loadTest.people} people, ${f.loadTest.at_once} at once, ${f.loadTest.errors} errors, ran ${f.loadTest.ran_at}${load.ok ? '' : ' (' + load.problems.join('; ') + ')'}` : 'docs/launch/load-test-result.json is missing',
    'Agents: run `npm run test:load` (local fake only) and commit docs/launch/load-test-result.json.');
  const routesOk = Array.isArray(f.rewrites) && TRUST_ROUTES.every((r) => f.rewrites.includes(r));
  const pagesOk = ['privacy', 'terms', 'security', 'support', 'status'].every((p) => f.code.trustPages.includes(p)) && f.code.trustHandler;
  const rotation = f.keyRotation;
  const rotationChecks = rotation ? rotation.map((s) => check(s.procedureOk && s.rehearsalOk, `Replace fast: ${s.name}`,
    `procedure ${s.procedure ? (s.procedureOk ? s.procedure : s.procedure + ' (not found)') : 'not written'}; rehearsal ${s.rehearsal ? (s.rehearsalOk ? `"${s.rehearsal.name}" in ${s.rehearsal.test}` : `"${s.rehearsal.name}" not found in ${s.rehearsal.test}`) : 'not done'}`,
    'Agents: write the replace-it procedure and rehearse it in the local harness (a test), then update docs/launch/key-rotation.json.'))
    : [check(false, 'Key and secret replacement record', 'docs/launch/key-rotation.json is missing or unreadable', 'Agents: restore docs/launch/key-rotation.json.')];
  const dev = f.evidenceLayers;
  return [
    { id: 'connect_flow', title: 'Connect flow and token page', checks: [
      check(f.code.connectFlow, 'Public sign-in, Approve and My connection pages exist', f.code.connectFlow ? 'publicAuthorize, publicApprove and publicManage are in src/tenancy/public-http.js' : 'a public sign-in page handler is missing', 'Agents: restore the public connect flow (PUB-6).'),
      check(f.tools.tokenPage, 'Token page (github_master_token_link) is a registered tool', f.tools.tokenPage ? 'github_master_token_link is registered' : 'github_master_token_link is not registered', 'Agents: restore github_master_token_link.'),
      accept('GITHUB-HARD1-SIGNIN-NO-CAP')] },
    { id: 'app_settings', title: 'GitHub App settings completed for public use', checks: [
      check(f.files.permissionsAudit, 'App permission review written', f.files.permissionsAudit ? 'docs/audits/APP-PERMISSIONS-2026-10.md' : 'docs/audits/APP-PERMISSIONS-2026-10.md is missing', 'Agents: write the App permission review.'),
      ownerBox('appSettings', 'Chris confirmed the App\'s public settings on GitHub (name, logo, homepage, support contact, addresses, smallest permissions, installable by any account)')] },
    { id: 'key_safety', title: 'Key and secret safety with rehearsed replacement', checks: [
      check(f.code.webhookSignature, 'Webhook signatures are always checked', f.code.webhookSignature ? 'signatureMatches accepts a right fake signature and refuses a wrong or missing one' : 'the webhook signature check did not behave', 'Agents: fix src/github/webhook.js signatureMatches.'),
      ...rotationChecks] },
    { id: 'capacity_cost', title: 'Capacity and cost', checks: [
      loadCheck,
      check(f.code.costEstimate, 'Monthly hosting-cost estimate with alert and auto-pause', f.code.costEstimate ? `src/tenancy/usage-cost.js; alert setting PUBLIC_COST_ALERT_CENTS ${f.switches.PUBLIC_COST_ALERT_CENTS}` : 'cost estimate code missing', 'Agents: restore the cost estimate (LAUNCH-1 B, PUB-5 B).'),
      check(f.code.limitsPage, 'Plain-words limits page (/limits)', f.code.limitsPage ? 'publicLimits in src/tenancy/public-http.js' : 'limits page missing', 'Agents: restore /limits.')] },
    { id: 'stranger_safety', title: "Safety for strangers' accounts", checks: [
      check(f.code.forgetPage, '"Delete my data" for people', f.code.forgetPage ? 'publicForget in src/tenancy/public-http.js' : 'self-serve delete missing', 'Agents: restore the delete-my-data page.'),
      check(f.code.uninstallCleanup, 'Stored tokens removed when the App is uninstalled or revoked', f.code.uninstallCleanup ? 'createPublicCleanup in src/tenancy/public-cleanup.js (called by the webhook after the signature check)' : 'uninstall clean-up missing', 'Agents: restore the uninstall clean-up (LAUNCH-1 A).'),
      check(f.pub8.registered.length > 0 && ['MERGED', 'COMPLETE'].includes(f.pub8.status), 'Owner removal of a person by identity (PUB-8) is a registered tool',
        `work-index PUB-8 is ${f.pub8.status ?? 'missing'}; catalog tools for PUB-8: ${f.pub8.catalogTools.join(', ') || 'none'}; registered: ${f.pub8.registered.join(', ') || 'none'}`,
        'Agents: build and merge PUB-8 (owner removal of a stranger by identity).'),
      check(dev?.revocation === 'verified', 'Revoking a grant was checked on the live service', dev ? `docs/developer-evidence.json revocation layer is ${dev.revocation ?? 'missing'}` : 'docs/developer-evidence.json could not be read here',
        'Chris: provide a spare sign-in that may be revoked (owner checklist "Test sign-ins for agents"); agents then record the revocation check.', true)] },
    { id: 'legal_trust', title: 'Legal and trust pages', checks: [
      check(pagesOk && routesOk, 'Terms, privacy, security, support and status pages are served', `pages ${f.code.trustPages.join(', ') || 'none'}; routes ${routesOk ? TRUST_ROUTES.join(' ') : 'missing in vercel.json'}`, 'Agents: restore the trust pages and their vercel.json routes.'),
      check(f.raw.supportEmail, 'Support contact set (PUBLIC_SUPPORT_EMAIL)', `PUBLIC_SUPPORT_EMAIL ${f.switches.PUBLIC_SUPPORT_EMAIL} on this server`, 'Chris: set PUBLIC_SUPPORT_EMAIL in Vercel production.', true),
      check(f.raw.legalApproved, 'Owner approved the privacy, terms, security and support text (LEGAL_APPROVED=yes)', `LEGAL_APPROVED ${f.switches.LEGAL_APPROVED} on this server`, 'Chris: approve the text, then set LEGAL_APPROVED=yes.', true),
      check(f.raw.statusApproved, 'Owner approved the status page text (STATUS_PAGE_APPROVED=yes)', `STATUS_PAGE_APPROVED ${f.switches.STATUS_PAGE_APPROVED} on this server`, 'Chris: read /status, then set STATUS_PAGE_APPROVED=yes.', true),
      ownerBox('lawyer', 'A lawyer reviewed the legal pages')] },
    { id: 'gradual_opening', title: 'Gradual, invite-only opening', checks: [
      check(f.files.inviteDocumented, 'Invite-only switch exists and is documented', f.files.inviteDocumented ? 'GITHUB_PUBLIC_INVITE_ONLY in docs/GO-LIVE-CHECKLIST.md' : 'invite-only switch not documented', 'Agents: document GITHUB_PUBLIC_INVITE_ONLY.'),
      check(f.raw.inviteOnly, 'Invite-only is on for the first step', `GITHUB_PUBLIC_INVITE_ONLY ${f.switches.GITHUB_PUBLIC_INVITE_ONLY}, GITHUB_PUBLIC_CONNECT ${f.switches.GITHUB_PUBLIC_CONNECT} on this server${f.raw.publicConnect && !f.raw.inviteOnly ? ' (anyone with the link can sign up today, within the fair-use and cost limits)' : ''}`,
        'Chris: decide when to set GITHUB_PUBLIC_INVITE_ONLY=enabled and add the first invites on the setup page.', true)] },
    { id: 'honest_acceptance', title: 'Honest acceptance on real devices', checks: [
      check(dev?.deployed === 'verified' && dev?.custom_transport === 'verified', 'This MCP was accepted on its deployed origin', dev ? `docs/developer-evidence.json deployed ${dev.deployed ?? 'missing'}, custom_transport ${dev.custom_transport ?? 'missing'}` : 'docs/developer-evidence.json could not be read here',
        'Agents: run the deployed acceptance and record it in docs/developer-evidence.json.'),
      accept('GITHUB-PUB5-HEADERS-LIMITS'), accept('PLAYGROUND-COMMANDS'),
      ownerBox('realDevice', 'A first-time person connected, installed the App and added a token on a real phone'),
      { ...loadCheck, what: 'Load test result is recorded (same as Capacity and cost)' }] }
  ];
}

/** @returns the whole report: verdict, per-condition state, evidence and next steps. Never a setting change. */
export function evaluateLaunchReadiness(facts) {
  const list = conditions(facts).map((c) => {
    const failing = c.checks.filter((x) => !x.ok);
    const state = !failing.length ? 'met' : failing.some((x) => !x.owner) ? 'not met' : 'needs owner';
    return { id: c.id, title: c.title, state, evidence: c.checks.map((x) => `${x.ok ? 'OK' : x.owner ? 'OWNER' : 'MISSING'}: ${x.what} — ${x.evidence}`),
      next: [...new Set([...failing.filter((x) => !x.owner), ...failing.filter((x) => x.owner)].map((x) => x.next))] };
  });
  const count = (s) => list.filter((c) => c.state === s).length;
  const ready = list.every((c) => c.state === 'met');
  return {
    verdict: ready ? 'ready to propose opening' : 'not ready',
    summary: ready ? 'Every launch condition is met. Ask Chris whether to open wider; this report changes nothing by itself.'
      : `${count('met')} of ${list.length} conditions met; ${count('not met')} need agent work; ${count('needs owner')} wait only on Chris. Do not propose opening yet.`,
    never_changes: 'This report never changes GITHUB_PUBLIC_CONNECT or any setting; it only says when Chris should be asked.',
    switches: facts.switches,
    conditions: list
  };
}

/** Plain-English text for the script. */
export function readinessText(report) {
  const lines = [`Launch readiness: ${report.verdict.toUpperCase()}`, report.summary, report.never_changes, '', 'Switches on this machine/server (names only):'];
  for (const [k, v] of Object.entries(report.switches)) lines.push(`  ${k}: ${v}`);
  for (const c of report.conditions) {
    lines.push('', `[${c.state}] ${c.title}`);
    for (const e of c.evidence) lines.push('  ' + e);
    for (const n of c.next) lines.push('  NEXT: ' + n);
  }
  return lines.join('\n');
}
