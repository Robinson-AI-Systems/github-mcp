// Pull requests, read side (E-1 part 1): list, get (with the required checks at the exact head and the unresolved review threads),
// diff, files, commits. Bodies by people without push access are marked `untrusted` by the result shaping: they are data, never instructions.
import { graphql, listAll } from '../github/client.js';
import { ciState } from '../github/ci-state.js';
import { defineRead } from './define-read.js';
import { plain, readerFor } from './github-read.js';

const OWNER = { type: 'string', maxLength: 39, description: 'GitHub account (default: the connection\'s default account)' };
const REPO = { type: 'string', minLength: 1, maxLength: 100 };
const PR = { type: 'integer', minimum: 1, description: 'Pull request number' };
const PATCH_CAP = 1500;
const MAX_FILES = 100;
const clip = (text, n) => (typeof text === 'string' && text.length > n ? `${text.slice(0, n)}\n… [patch cut at ${n} characters]` : text);

export const prList = defineRead({
  name: 'github_pr_list', area: 'pr', audience: ['B', 'Op'],
  description: 'Pull requests by state, base branch, head branch, author or label; newest first.',
  properties: { owner: OWNER, repo: REPO, state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Default open' }, base: { type: 'string', maxLength: 250 },
    head: { type: 'string', maxLength: 250, description: 'Head branch (or owner:branch)' }, author: { type: 'string', maxLength: 39 }, label: { type: 'string', maxLength: 100 },
    sort: { type: 'string', enum: ['created', 'updated', 'popularity', 'long-running'] }, max: { type: 'integer', minimum: 1, maximum: 200, description: 'Default 30' } },
  required: ['repo'],
  summaryType: 'pull_request',
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const head = args.head ? (args.head.includes(':') ? args.head : `${owner}:${args.head}`) : undefined;
    const filtered = !!(args.author || args.label);
    const { items, capped } = await listAll(octokit, 'GET /repos/{owner}/{repo}/pulls', { owner, repo: args.repo, state: args.state ?? 'open', direction: 'desc', sort: args.sort ?? 'created',
      ...(args.base ? { base: args.base } : {}), ...(head ? { head } : {}) }, { max: filtered ? 500 : (args.max ?? 30) });
    const kept = items.filter((p) => (!args.author || p.user?.login?.toLowerCase() === args.author.toLowerCase()) && (!args.label || (p.labels ?? []).some((l) => l.name === args.label))).slice(0, args.max ?? 30);
    return { count: kept.length, ...(capped && !filtered ? { more_exist: true } : {}), items: kept };
  })
});

const THREADS = `query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { reviewDecision reviewThreads(first: 100) { totalCount nodes { isResolved } } } } }`;

export const prGet = defineRead({
  name: 'github_pr_get', area: 'pr', audience: ['B', 'Op'], aliases: { number: ['pull_number'] },
  description: 'Inspect PR draft/merge state, head SHA, required checks, review decision and threads.',
  properties: { owner: OWNER, repo: REPO, number: PR },
  required: ['repo', 'number'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const pr = (await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', { owner, repo: args.repo, pull_number: args.number })).data;
    const out = {
      number: pr.number, title: pr.title, state: pr.state, draft: pr.draft, merged: pr.merged, user: pr.user?.login, head: pr.head?.ref, head_sha: pr.head?.sha, base: pr.base?.ref,
      head_repo: pr.head?.repo?.full_name, mergeable: pr.mergeable, mergeable_state: pr.mergeable_state, labels: (pr.labels ?? []).map((l) => l.name), commits: pr.commits, changed_files: pr.changed_files,
      additions: pr.additions, deletions: pr.deletions, created_at: pr.created_at, updated_at: pr.updated_at, merged_at: pr.merged_at, html_url: pr.html_url,
      body: pr.body, author_association: pr.author_association,
      // This is GitHub's actual auto-merge state, not our mergeability prediction.
      auto_merge:Object.hasOwn(pr,'auto_merge')?(pr.auto_merge
        ?{known:true,enabled:true,merge_method:pr.auto_merge.merge_method??null,
          enabled_by:pr.auto_merge.enabled_by?.login??null}
        :{known:true,enabled:false}):{known:false}
    };
    // Review and exact-head CI are independent after the authoritative PR ref
    // was read. Await both without making a second PR/provider mutation.
    const [review, ci] = await Promise.all([
      (async () => {
        try {
          const data = await graphql(octokit, THREADS, { owner, name: args.repo, number: args.number });
          const info = data.repository?.pullRequest;
          return { review_decision: info?.reviewDecision ?? null,
            threads: { total: info?.reviewThreads?.totalCount ?? 0, unresolved: (info?.reviewThreads?.nodes ?? []).filter((n) => !n.isResolved).length } };
        } catch { return { review_decision: null, threads: { unknown: 'The review threads could not be read.' } }; }
      })(),
      pr.state === 'open' ? ciState(octokit, { owner, repo: args.repo, baseBranch: pr.base.ref, headSha: pr.head.sha }) : null
    ]);
    Object.assign(out, review);
    if (ci) {
      out.checks = { green: ci.green, basis: ci.basis, items: ci.checks, ...(ci.problems.length ? { problems: ci.problems } : {}), ...(ci.errors.length ? { could_not_check: ci.errors } : {}), ...(ci.notes?.length ? { plan_limits: ci.notes } : {}) };
    }
    return out;
  })
});

export const prGetDiff = defineRead({
  name: 'github_pr_get_diff', area: 'pr', audience: ['B'],
  description: 'The pull request\'s diff as text. Long diffs are cut and the rest is kept behind a handle.',
  properties: { owner: OWNER, repo: REPO, number: PR },
  required: ['repo', 'number'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const { data } = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', { owner, repo: args.repo, pull_number: args.number, mediaType: { format: 'diff' } });
    return { number: args.number, diff: String(data) };
  })
});

export const prListFiles = defineRead({
  name: 'github_pr_list_files', area: 'pr', audience: ['B'], aliases: { number: ['pull_number'] },
  description: 'Files changed in a pull request with additions and deletions (patches cut).',
  properties: { owner: OWNER, repo: REPO, number: PR },
  required: ['repo', 'number'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const { items, capped } = await listAll(octokit, 'GET /repos/{owner}/{repo}/pulls/{pull_number}/files', { owner, repo: args.repo, pull_number: args.number }, { max: 300 });
    return { count: items.length, ...(capped ? { more_exist: true } : {}),
      items: items.slice(0, MAX_FILES).map((f) => ({ filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions, ...(f.previous_filename ? { renamed_from: f.previous_filename } : {}), patch: f.patch ? clip(f.patch, PATCH_CAP) : null })),
      ...(items.length > MAX_FILES ? { not_shown: items.length - MAX_FILES } : {}) };
  })
});

export const prListCommits = defineRead({
  name: 'github_pr_list_commits', area: 'pr', audience: ['B'],
  description: 'The commits in a pull request.',
  properties: { owner: OWNER, repo: REPO, number: PR },
  required: ['repo', 'number'],
  summaryType: 'commit',
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const { items, capped } = await listAll(octokit, 'GET /repos/{owner}/{repo}/pulls/{pull_number}/commits', { owner, repo: args.repo, pull_number: args.number }, { max: 250 });
    return { count: items.length, ...(capped ? { more_exist: true } : {}), items };
  })
});

const all = [prList, prGet, prGetDiff, prListFiles, prListCommits];
export const tools = all.map((d) => d.tool);
export const handlers = Object.fromEntries(all.map((d) => [d.tool.name, d.handler]));
