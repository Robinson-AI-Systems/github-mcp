import { redact } from './util.js';
// Code scanning autofix (Y-8): ask GitHub to suggest a fix for an alert (a background job), then commit an accepted suggestion to a branch.
import { defineGithubWrite } from './define-github-write.js';
import { missing, octo, ownerOf, refusal } from './github-write.js';
import { productionReason } from './production-guard.js';
import { startJob } from './async-jobs.js';

const OWNER = { type: 'string', maxLength: 39 };
const REPO = { type: 'string', minLength: 1, maxLength: 100 };
const ALERT = { type: 'integer', minimum: 1, description: 'Code scanning alert number' };
const BASE = 'GET /repos/{owner}/{repo}/code-scanning/alerts/{alert_number}/autofix';
const repoTarget = (args, ctx) => ({ owner: ownerOf(args, ctx), repo: args.repo, scope: 'repo' });
const getFix = (ctx, t, n) => missing(async () => { const d = (await (await octo(ctx, t.owner)).request(BASE, { owner: t.owner, repo: t.repo, alert_number: n })).data; return { status: d.status, description: d.description ?? null, started_at: d.started_at ?? null }; });

const start = defineGithubWrite({
  name: 'github_code_scanning_autofix_start', area: 'code', audience: ['B', 'Op'],
  description: 'Ask GitHub to suggest a fix for a code scanning alert in the background; returns a job id for github_job_status.',
  properties: { owner: OWNER, repo: REPO, alertNumber: ALERT }, required: ['repo', 'alertNumber'],
  declarations: { production: 'never', confirm: 'when-needed', cred: 'I', profiles: ['full'] }, target: repoTarget,
  read: async (args, ctx, t) => ({ fix: await getFix(ctx, t, args.alertNumber) }),
  classify: () => ({}),
  summarize: ({ args, target: t, before }) => `Ask GitHub for a suggested fix for alert ${args.alertNumber} in ${t.owner}/${t.repo}${before.fix ? ` (a fix already exists: ${before.fix.status})` : ''}. Nothing in the repository changes.`,
  apply: async ({ args, ctx, target: t, before }) => {
    if (before.fix?.status === 'pending') throw refusal('A fix is already being prepared for this alert; nothing to do.');
    await (await octo(ctx, t.owner)).request('POST /repos/{owner}/{repo}/code-scanning/alerts/{alert_number}/autofix', { owner: t.owner, repo: t.repo, alert_number: args.alertNumber });
    return startJob(ctx, { kind: 'autofix', owner: t.owner, repo: t.repo, providerRef: String(args.alertNumber) });
  },
  readAfter: async ({ args, ctx, target: t }) => getFix(ctx, t, args.alertNumber),
  verify: ({ after }) => !!after && ['pending', 'success'].includes(after.status),
  present: ({ response, after }) => ({ ...response, fix_status: after?.status ?? null })
});

const commit = defineGithubWrite({
  name: 'github_code_scanning_autofix_commit', area: 'code', audience: ['B', 'Op'],
  description: 'Commit GitHub\'s suggested fix for a code scanning alert to a branch (a new commit; the branch decides production).',
  properties: { owner: OWNER, repo: REPO, alertNumber: ALERT, targetRef: { type: 'string', minLength: 1, maxLength: 250, description: 'Branch to commit to (required, so the production check knows what it touches)' },
    message: { type: 'string', maxLength: 500, description: 'Commit message (default: GitHub\'s)' } }, required: ['repo', 'alertNumber', 'targetRef'],
  declarations: { production: 'when-target', confirm: 'always', cred: 'I', profiles: ['full'] },
  target: (args, ctx) => ({ ...repoTarget(args, ctx), ref: args.targetRef }),
  read: async (args, ctx, t) => ({ fix: await getFix(ctx, t, args.alertNumber) }),
  classify: async ({ ctx, target: t }) => ({ production: await productionReason(ctx, t) }),
  summarize: ({ args, target: t, before }) => (before.fix?.status === 'success'
    ? `Commit the suggested fix for alert ${args.alertNumber} to branch ${args.targetRef} of ${t.owner}/${t.repo}${before.fix.description ? `: ${redact(String(before.fix.description)).slice(0, 120)}` : ''}`
    : `No ready fix for alert ${args.alertNumber} (${before.fix?.status ?? 'none started'}); nothing will be committed`),
  apply: async ({ args, ctx, target: t, before }) => {
    if (before.fix?.status !== 'success') throw refusal('There is no ready fix for this alert. Start one with github_code_scanning_autofix_start and wait until github_job_status says ready.');
    return (await octo(ctx, t.owner)).request('POST /repos/{owner}/{repo}/code-scanning/alerts/{alert_number}/autofix/commits', { owner: t.owner, repo: t.repo, alert_number: args.alertNumber,
      target_ref: args.targetRef, ...(args.message ? { message: args.message } : {}) });
  },
  readAfter: async ({ ctx, target: t, response }) => (response?.data?.sha ? missing(async () => (await (await octo(ctx, t.owner)).request('GET /repos/{owner}/{repo}/commits/{ref}', { owner: t.owner, repo: t.repo, ref: response.data.sha })).data.sha) : null),
  verify: ({ after, response }) => !!after && after === response.data.sha,
  inverse: () => null,
  present: ({ response }) => ({ sha: response.data.sha, target_ref: response.data.target_ref ?? null, note: 'A new commit was added. To undo it, revert the commit.' })
});

export const tools = [start.tool, commit.tool];
export const handlers = { [start.tool.name]: start.handler, [commit.tool.name]: commit.handler };
