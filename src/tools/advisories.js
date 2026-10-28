import { redact } from './util.js';
// Y-7a: repository security advisories. Advisory text describes an unfixed hole, so it is treated as sensitive:
//  - no result and no change-log row ever contains the description; only its SHA-256 and length are kept;
//  - publishing makes the advisory PUBLIC and cannot be undone: it needs the GHSA id typed again and a production connection;
//  - a CVE request is irreversible too;
//  - a report to someone else's repository goes out as the signed-in user and is confirmed first (it reaches an outsider).
import { createHash } from 'node:crypto';
import { defineGithubWrite } from './define-github-write.js';
import { missing, octo, ownerOf, refusal } from './github-write.js';
import { githubFor } from '../github/client.js';
import { notifyOutsiders } from './people-guard.js';
import { LOGIN, REPO_NAME } from './public-read.js';

const OWNER = { ...LOGIN, description: 'Connected account (default account)' };
const GHSA = { type: 'string', pattern: '^GHSA(-[23456789cfghjmpqrvwx]{4}){3}$', description: 'Advisory id, for example GHSA-abcd-efgh-jkmn' };
const SEVERITY = { type: 'string', enum: ['critical', 'high', 'medium', 'low'] };
const VULNS = {
  type: 'array', minItems: 1, maxItems: 20,
  items: { type: 'object', additionalProperties: false, required: ['ecosystem', 'name'], properties: {
    ecosystem: { type: 'string', minLength: 1, maxLength: 40 }, name: { type: 'string', minLength: 1, maxLength: 200 },
    vulnerableVersionRange: { type: 'string', maxLength: 200 }, patchedVersions: { type: 'string', maxLength: 200 } } }
};
const CWES = { type: 'array', maxItems: 20, items: { type: 'string', pattern: '^CWE-[0-9]{1,5}$' }, uniqueItems: true };
const CREDITS = { type: 'array', maxItems: 20, items: { type: 'object', additionalProperties: false, required: ['login', 'type'], properties: { login: LOGIN, type: { type: 'string', enum: ['analyst', 'finder', 'reporter', 'coordinator', 'remediation_developer', 'remediation_reviewer', 'remediation_verifier', 'tool', 'sponsor', 'other'] } } } };
const sha = (text) => (typeof text === 'string' ? createHash('sha256').update(text).digest('hex') : null);
const repoTarget = (args, ctx) => {
  if (!args.repo) throw new TypeError('repo is required.');
  return { owner: ownerOf(args, ctx), repo: args.repo, scope: 'repo' };
};
const toVulns = (list) => list.map((v) => ({ package: { ecosystem: v.ecosystem, name: v.name }, ...(v.vulnerableVersionRange ? { vulnerable_version_range: v.vulnerableVersionRange } : {}), ...(v.patchedVersions ? { patched_versions: v.patchedVersions } : {}) }));

/** The log-safe view of an advisory: ids, state, severity, counts and a hash of the description - never its text. */
export const shapeAdvisory = (a) => (a ? {
  ghsa: a.ghsa_id, state: a.state, severity: a.severity ?? null, cveId: a.cve_id ?? null,
  summary: typeof a.summary === 'string' ? redact(a.summary).slice(0, 200) : null,
  packages: (a.vulnerabilities ?? []).map((v) => `${v.package?.ecosystem ?? '?'}/${v.package?.name ?? '?'}`).slice(0, 20),
  descriptionSha256: sha(a.description), descriptionLength: typeof a.description === 'string' ? a.description.length : 0,
  publishedAt: a.published_at ?? null, htmlUrl: a.html_url ?? null, privateFork: a.private_fork?.full_name ?? null
} : null);
const getAdvisory = (ctx, t, ghsa, gh = null) => missing(async () => (await (gh ?? await octo(ctx, t.owner)).request('GET /repos/{owner}/{repo}/security-advisories/{ghsa_id}', { owner: t.owner, repo: t.repo, ghsa_id: ghsa })).data);
const decl = (extra = {}) => ({ production: 'never', confirm: 'always', cred: 'I', profiles: ['full'], ...extra });

// ---- create / edit a draft ------------------------------------------------------------------------------------------
const save = defineGithubWrite({
  name: 'github_security_advisory_save', area: 'security', audience: ['O'],
  description: 'Create a draft security advisory or edit one. Text stays private; results show only a hash. Never changes its published state.',
  properties: { owner: OWNER, repo: REPO_NAME, ghsa: GHSA, summary: { type: 'string', minLength: 1, maxLength: 1024 }, description: { type: 'string', minLength: 1, maxLength: 65535 },
    severity: SEVERITY, cvssVector: { type: 'string', maxLength: 200 }, vulnerabilities: VULNS, cweIds: CWES, credits: CREDITS, startPrivateFork: { type: 'boolean', description: 'create only' } },
  required: ['repo'],
  declarations: decl({ production: 'when-target', confirm: 'when-needed', notifies: true }), target: repoTarget,
  read: async (args, ctx, t) => {
    if (args.severity && args.cvssVector) throw refusal('Give either severity or cvssVector, not both.');
    if (!args.ghsa) {
      if (!args.summary || !args.description || !args.vulnerabilities) throw refusal('A new advisory needs summary, description and vulnerabilities.');
      return { adv: null };
    }
    if (args.startPrivateFork) throw refusal('startPrivateFork only applies when creating an advisory.');
    if (!['summary', 'description', 'severity', 'cvssVector', 'vulnerabilities', 'cweIds', 'credits'].some((k) => args[k] !== undefined)) throw refusal('Give at least one field to change.');
    return { adv: shapeAdvisory(await getAdvisory(ctx, t, args.ghsa)) };
  },
  classify: async ({ args, ctx, before }) => ({
    ...(before?.adv?.state === 'published' ? { production: 'edits an advisory that is already PUBLIC' } : {}),
    ...(args.credits?.length ? await notifyOutsiders(ctx, { logins: args.credits.map((c) => c.login) }) : {})
  }),
  summarize: ({ args, target: t, before }) => (args.ghsa
    ? `Edit ${before.adv ? `${before.adv.state} advisory ${args.ghsa}` : `advisory ${args.ghsa} (not found)`} in ${t.owner}/${t.repo}: ${['summary', 'description', 'severity', 'cvssVector', 'vulnerabilities', 'cweIds', 'credits'].filter((k) => args[k] !== undefined).join(', ')} (description text is never shown)`
    : `Create a DRAFT advisory "${redact(String(args.summary)).slice(0, 80)}" in ${t.owner}/${t.repo} for ${args.vulnerabilities.length} package(s); it stays private until published`),
  apply: async ({ args, ctx, target: t, before }) => {
    const gh = await octo(ctx, t.owner);
    const body = {
      ...(args.summary !== undefined ? { summary: args.summary } : {}), ...(args.description !== undefined ? { description: args.description } : {}),
      ...(args.severity ? { severity: args.severity } : {}), ...(args.cvssVector ? { cvss_vector_string: args.cvssVector } : {}),
      ...(args.vulnerabilities ? { vulnerabilities: toVulns(args.vulnerabilities) } : {}), ...(args.cweIds ? { cwe_ids: args.cweIds } : {}), ...(args.credits ? { credits: args.credits } : {})
    };
    if (args.ghsa) {
      if (!before.adv) throw refusal('That advisory was not found; nothing was changed.', 404);
      return gh.request('PATCH /repos/{owner}/{repo}/security-advisories/{ghsa_id}', { owner: t.owner, repo: t.repo, ghsa_id: args.ghsa, ...body });
    }
    return gh.request('POST /repos/{owner}/{repo}/security-advisories', { owner: t.owner, repo: t.repo, ...body, ...(args.startPrivateFork ? { start_private_fork: true } : {}) });
  },
  readAfter: async ({ args, ctx, target: t, response }) => ({ adv: shapeAdvisory(await getAdvisory(ctx, t, args.ghsa ?? response?.data?.ghsa_id)) }),
  verify: ({ args, before, after }) => !!after.adv
    && (args.summary === undefined || after.adv.summary === redact(args.summary).slice(0, 200))
    && (args.description === undefined || after.adv.descriptionSha256 === sha(args.description))
    && (args.severity === undefined || after.adv.severity === args.severity)
    && (args.ghsa ? after.adv.state === before.adv.state : after.adv.state === 'draft'),
  inverse: () => null,
  present: ({ after }) => ({ advisory: after.adv, untrusted: true })
});

// ---- publish (public, irreversible) -------------------------------------------------------------------------------------
const publish = defineGithubWrite({
  name: 'github_security_advisory_publish', area: 'security', audience: ['O'],
  description: 'Publish a draft security advisory. This makes it PUBLIC and cannot be undone. Type the GHSA id again as confirmGhsa.',
  properties: { owner: OWNER, repo: REPO_NAME, ghsa: GHSA, confirmGhsa: GHSA }, required: ['repo', 'ghsa', 'confirmGhsa'],
  declarations: decl({ production: 'always' }),
  target: (args, ctx) => {
    if (args.confirmGhsa !== args.ghsa) throw new TypeError('confirmGhsa must be the same GHSA id as ghsa.');
    return repoTarget(args, ctx);
  },
  read: async (args, ctx, t) => ({ adv: shapeAdvisory(await getAdvisory(ctx, t, args.ghsa)) }),
  classify: ({ args }) => ({ production: `publishing ${args.ghsa} makes it public and cannot be undone` }),
  summarize: ({ args, target: t, before }) => (before.adv
    ? `PUBLISH advisory ${args.ghsa} "${before.adv.summary}" (${before.adv.severity ?? 'no severity'}; ${before.adv.packages.join(', ') || 'no packages'}) in ${t.owner}/${t.repo}. Its summary, description and affected versions become PUBLIC. No undo.`
    : `Advisory ${args.ghsa} was not found`),
  apply: async ({ args, ctx, target: t, before }) => {
    if (!before.adv) throw refusal('That advisory was not found; nothing was published.', 404);
    if (before.adv.state === 'published') throw refusal('That advisory is already published; nothing to do.');
    if (before.adv.state !== 'draft') throw refusal(`Only a draft can be published (this one is ${before.adv.state}).`);
    if (!before.adv.severity || !before.adv.packages.length) throw refusal('Give the advisory a severity and at least one affected package before publishing.');
    return (await octo(ctx, t.owner)).request('PATCH /repos/{owner}/{repo}/security-advisories/{ghsa_id}', { owner: t.owner, repo: t.repo, ghsa_id: args.ghsa, state: 'published' });
  },
  readAfter: async ({ args, ctx, target: t }) => ({ adv: shapeAdvisory(await getAdvisory(ctx, t, args.ghsa)) }),
  verify: ({ after }) => after.adv?.state === 'published',
  inverse: () => null,
  present: ({ after }) => ({ advisory: after.adv, public: true, undoable: false })
});

// ---- CVE request -----------------------------------------------------------------------------------------------------
const requestCve = defineGithubWrite({
  name: 'github_security_advisory_request_cve', area: 'security', audience: ['O'],
  description: 'Ask GitHub (as a CVE numbering authority) to reserve a CVE for an advisory. Cannot be withdrawn. The CVE id appears later.',
  properties: { owner: OWNER, repo: REPO_NAME, ghsa: GHSA }, required: ['repo', 'ghsa'],
  declarations: decl({ production: 'always' }), target: repoTarget,
  read: async (args, ctx, t) => ({ adv: shapeAdvisory(await getAdvisory(ctx, t, args.ghsa)) }),
  classify: ({ args }) => ({ production: `a CVE request for ${args.ghsa} cannot be withdrawn` }),
  summarize: ({ args, before }) => (before.adv ? `Request a CVE for advisory ${args.ghsa} (${before.adv.state}, "${before.adv.summary}"); cannot be withdrawn` : `Advisory ${args.ghsa} was not found`),
  apply: async ({ args, ctx, target: t, before }) => {
    if (!before.adv) throw refusal('That advisory was not found; nothing was requested.', 404);
    if (before.adv.cveId) throw refusal(`This advisory already has ${before.adv.cveId}; nothing to do.`);
    if (!['draft', 'published'].includes(before.adv.state)) throw refusal(`A CVE cannot be requested for a ${before.adv.state} advisory.`);
    return (await octo(ctx, t.owner)).request('POST /repos/{owner}/{repo}/security-advisories/{ghsa_id}/cve', { owner: t.owner, repo: t.repo, ghsa_id: args.ghsa });
  },
  readAfter: async ({ args, ctx, target: t }) => ({ adv: shapeAdvisory(await getAdvisory(ctx, t, args.ghsa)) }),
  verify: ({ after }) => !!after.adv,
  inverse: () => null,
  present: ({ after }) => ({ ghsa: after.adv?.ghsa, cveId: after.adv?.cveId ?? null, note: 'GitHub assigns the CVE id after review; check the advisory later.' })
});

// ---- report to someone else's repository (as the signed-in user) -------------------------------------------------------------
const report = defineGithubWrite({
  name: 'github_security_report_vulnerability', area: 'security', audience: ['O'],
  description: 'Privately report a vulnerability to ANOTHER repository\'s maintainers as you. It reaches an outsider, so it always asks first.',
  properties: { as: { ...LOGIN, description: 'Which connected account acts (default account)' }, owner: { ...LOGIN, description: 'Owner of the repository being reported to' }, repo: REPO_NAME,
    summary: { type: 'string', minLength: 1, maxLength: 1024 }, description: { type: 'string', minLength: 1, maxLength: 65535 }, severity: SEVERITY, cvssVector: { type: 'string', maxLength: 200 },
    vulnerabilities: VULNS, cweIds: CWES },
  required: ['owner', 'repo', 'summary', 'description'],
  declarations: decl({ notifies: true, cred: 'U' }),
  target: (args, ctx) => ({ owner: ownerOf({ owner: args.as }, ctx), scope: 'user', kind: 'user-settings' }),
  read: async (args) => {
    if (args.severity && args.cvssVector) throw refusal('Give either severity or cvssVector, not both.');
    return { to: `${args.owner}/${args.repo}` };
  },
  classify: async ({ args, ctx }) => notifyOutsiders(ctx, { logins: [args.owner] }),
  summarize: ({ args }) => `Send a PRIVATE vulnerability report "${redact(args.summary).slice(0, 80)}" to the maintainers of ${args.owner}/${args.repo} as you (description ${args.description.length} characters, never shown here)`,
  apply: async ({ args, ctx, target: t }) => {
    const gh = await githubFor(ctx, { owner: t.owner, cred: 'U' });
    return gh.request('POST /repos/{owner}/{repo}/security-advisories/reports', {
      owner: args.owner, repo: args.repo, summary: args.summary, description: args.description,
      ...(args.severity ? { severity: args.severity } : {}), ...(args.cvssVector ? { cvss_vector_string: args.cvssVector } : {}),
      ...(args.vulnerabilities ? { vulnerabilities: toVulns(args.vulnerabilities) } : {}), ...(args.cweIds ? { cwe_ids: args.cweIds } : {})
    });
  },
  readAfter: async ({ args, ctx, target: t, response }) => {
    const gh = await githubFor(ctx, { owner: t.owner, cred: 'U' });
    const ghsa = response?.data?.ghsa_id;
    return { adv: ghsa ? shapeAdvisory(await getAdvisory(ctx, { owner: args.owner, repo: args.repo }, ghsa, gh)) : null };
  },
  verify: ({ args, after }) => !!after.adv && after.adv.descriptionSha256 === sha(args.description),
  inverse: () => null,
  present: ({ args, after }) => ({ reportedTo: `${args.owner}/${args.repo}`, ghsa: after.adv?.ghsa ?? null, state: after.adv?.state ?? null })
});

const writes = [save, publish, requestCve, report];
export const tools = writes.map((d) => d.tool);
export const handlers = Object.fromEntries(writes.map((d) => [d.tool.name, d.handler]));
