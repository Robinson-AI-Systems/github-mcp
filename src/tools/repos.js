// Repositories, read side (D-1 part 1): list, get, find, insights, traffic, activity, custom properties. Reads only; every call
// goes through `githubFor`. Results are plain objects the dispatcher shapes, cuts and (for lists) summarises.
import { listAll } from '../github/client.js';
import { defineRead } from './define-read.js';
import { plain, readerFor, requestStats } from './github-read.js';

const OWNER = { type: 'string', maxLength: 39, description: 'GitHub account (default: the connection\'s default account)' };
const REPO = { type: 'string', maxLength: 100 };
const slug = (owner, repo) => `${owner}/${repo}`;
const MAX_LIST = 300;

async function accountType(ctx, owner) {
  const row = await ctx.db.getAccount(owner);
  return row?.account_type === 'Organization' ? 'org' : 'user';
}

// PRIVATE-LIST-1 (2026-11-14): GET /users/{username}/repos returns PUBLIC repositories only, whoever asks, so listing a
// person's own account left out every private repository. The connection reads a personal account through the App
// installation on it, and GET /installation/repositories lists everything that installation can see, private included.
// Only when that route is not available to the credential does the list fall back to the public route, and it says so.
async function ownedUserRepos(octokit, owner, query, max) {
  // Paged by hand: this route wraps its list ({ total_count, repositories }), and the generic pager's handling of
  // wrapped lists depends on response fields some transports do not carry.
  const all = [];
  try {
    for (let page = 1; page <= 10; page += 1) {
      const { data } = await octokit.request('GET /installation/repositories', { per_page: 100, page });
      const rows = Array.isArray(data?.repositories) ? data.repositories : null;
      if (!rows) return null;
      all.push(...rows);
      if (rows.length < 100 || (Number.isInteger(data.total_count) && all.length >= data.total_count)) break;
    }
  } catch { return null; }
  const want = (r) => (r.owner?.login ?? '').toLowerCase() === owner.toLowerCase()
    && (query.type === 'public' ? !r.private : query.type === 'private' ? !!r.private
      : query.type === 'forks' ? !!r.fork : query.type === 'sources' ? !r.fork : true);
  const key = { created: 'created_at', updated: 'updated_at', pushed: 'pushed_at', full_name: 'full_name' }[query.sort] ?? 'pushed_at';
  const kept = all.filter(want).sort((a, b) => String(a[key] ?? '').localeCompare(String(b[key] ?? '')) * (query.direction === 'asc' ? 1 : -1));
  return { items: kept.slice(0, max), capped: kept.length > max };
}

export const repoList = defineRead({
  name: 'github_repo_list', area: 'repo', audience: ['B', 'Op'],
  description: 'List an account\'s repositories (type, sort, archived filter); newest activity first by default.',
  properties: {
    owner: OWNER,
    type: { type: 'string', enum: ['all', 'public', 'private', 'forks', 'sources', 'member'], description: 'Which repositories (default all)' },
    sort: { type: 'string', enum: ['created', 'updated', 'pushed', 'full_name'], description: 'Default pushed' },
    direction: { type: 'string', enum: ['asc', 'desc'] },
    archived: { type: 'string', enum: ['include', 'exclude', 'only'], description: 'Default include' },
    max: { type: 'integer', minimum: 1, maximum: MAX_LIST, description: 'At most this many (default 100)' }
  },
  summaryType: 'repository',
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const kind = await accountType(ctx, owner);
    const query = { type: args.type ?? 'all', sort: args.sort ?? 'pushed', direction: args.direction ?? (args.sort === 'full_name' ? 'asc' : 'desc') };
    let listed;
    if (kind === 'org') listed = await listAll(octokit, 'GET /orgs/{org}/repos', { org: owner, ...query }, { max: args.max ?? 100 });
    else if (query.type !== 'member') listed = await ownedUserRepos(octokit, owner, query, args.max ?? 100);
    const publicOnly = !listed && kind !== 'org' && query.type !== 'member';
    if (!listed) listed = await listAll(octokit, 'GET /users/{username}/repos', { username: owner, ...query, type: ['all', 'owner', 'member'].includes(query.type) ? query.type : 'owner' }, { max: args.max ?? 100 });
    const { items, capped } = listed;
    const archived = args.archived ?? 'include';
    const kept = items.filter((r) => (archived === 'include' ? true : archived === 'only' ? r.archived === true : r.archived !== true));
    return { owner, count: kept.length, ...(capped ? { more_exist: true, note: 'There are more repositories; raise max or narrow the type.' } : {}),
      ...(publicOnly ? { public_only: true, public_only_note: 'GitHub lists only public repositories of a personal account on this route; private ones are not shown (github_repo_find searches private ones too).' } : {}), items: kept };
  })
});

export const repoGet = defineRead({
  name: 'github_repo_get', area: 'repo', audience: ['B', 'O', 'Op'], compact: false,
  description: 'Inspect repository visibility, default branch, merge rules, security and custom properties.',
  properties: { owner: OWNER, repo: REPO },
  required: ['repo'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const repo = (await octokit.request('GET /repos/{owner}/{repo}', { owner, repo: args.repo })).data;
    const out = {
      full_name: repo.full_name, description: repo.description, homepage: repo.homepage, visibility: repo.visibility, private: repo.private, fork: repo.fork, archived: repo.archived, disabled: repo.disabled,
      is_template: repo.is_template, default_branch: repo.default_branch, topics: repo.topics, language: repo.language, size_kb: repo.size, pushed_at: repo.pushed_at, html_url: repo.html_url,
      features: { issues: repo.has_issues, projects: repo.has_projects, wiki: repo.has_wiki, discussions: repo.has_discussions, pages: repo.has_pages },
      merge_options: { merge_commit: repo.allow_merge_commit, squash: repo.allow_squash_merge, rebase: repo.allow_rebase_merge, auto_merge: repo.allow_auto_merge, delete_branch_on_merge: repo.delete_branch_on_merge, update_branch: repo.allow_update_branch },
      permissions: repo.permissions, security: repo.security_and_analysis ? Object.fromEntries(Object.entries(repo.security_and_analysis).map(([k, v]) => [k, v?.status])) : undefined
    };
    try {
      const rules = (await octokit.request('GET /repos/{owner}/{repo}/rules/branches/{branch}', { owner, repo: args.repo, branch: repo.default_branch })).data;
      out.default_branch_rules = Array.isArray(rules) ? { count: rules.length, types: [...new Set(rules.map((r) => r.type))] } : { count: 0, types: [] };
    } catch { out.default_branch_rules = { unknown: 'The rules on the default branch could not be read.' }; }
    try {
      const values = (await octokit.request('GET /repos/{owner}/{repo}/properties/values', { owner, repo: args.repo })).data;
      out.custom_properties = Object.fromEntries((values ?? []).map((p) => [p.property_name, p.value]));
    } catch { out.custom_properties = null; }
    return out;
  })
});

export const repoFind = defineRead({
  name: 'github_repo_find', area: 'repo', audience: ['Op'],
  description: 'Search this connection\'s accounts for repositories by name, topic or description, in plain words.',
  properties: { text: { type: 'string', minLength: 1, maxLength: 200, description: 'Words to look for' }, account: OWNER, max: { type: 'integer', minimum: 1, maximum: 100, description: 'Default 30' } },
  required: ['text'],
  summaryType: 'repository',
  handler: (args, ctx) => plain(async () => {
    const words = args.text;
    const allowed = ctx.connection.accounts;
    if (args.account && !allowed.some((a) => a.toLowerCase() === args.account.toLowerCase())) throw new TypeError(`"${args.account}" is not one of the GitHub accounts this connection may use (${allowed.join(', ')}).`);
    // ACCOUNT-ORDER-1 (2026-11-14): a search across every account stopped at the first account it could not read
    // (a linked account with no installation), so a search for the owner's own repo was refused. The default account
    // is searched first; an account that cannot be searched is skipped and named, never fatal.
    const def = ctx.connection.default_account;
    const targets = args.account ? [args.account]
      : [...allowed].sort((a, b) => (b === def) - (a === def));
    const items = [], skipped = [];
    for (const login of targets) {
      try {
        const { octokit } = await readerFor({ owner: login }, ctx);
        const kind = await accountType(ctx, login);
        const q = `${words.replace(/\b(user|org|repo|in|fork|is|archived):\S*/gi, '').trim()} ${kind === 'org' ? 'org' : 'user'}:${login}`.trim();
        const { data } = await octokit.request('GET /search/repositories', { q, per_page: Math.min(args.max ?? 30, 100), sort: 'updated', order: 'desc' });
        items.push(...(data.items ?? []));
      } catch (error) {
        if (args.account) throw error;
        skipped.push({ account: login, why: error instanceof TypeError ? String(error.message).slice(0, 160) : 'could not be searched right now' });
      }
    }
    if (!items.length && skipped.length === targets.length) throw new TypeError(`No account could be searched: ${skipped.map((s) => `${s.account} (${s.why})`).join('; ')}`);
    return { searched: targets.filter((t) => !skipped.some((s) => s.account === t)), ...(skipped.length ? { skipped } : {}), count: items.length, items: items.slice(0, args.max ?? 30) };
  })
});

export const repoGetInsights = defineRead({
  name: 'github_repo_get_insights', area: 'repo', audience: ['Op'],
  description: 'Languages, top contributors, community profile and a year of commit activity in one summary.',
  properties: { owner: OWNER, repo: REPO },
  required: ['repo'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const p = { owner, repo: args.repo };
    const languages = (await octokit.request('GET /repos/{owner}/{repo}/languages', p)).data;
    const total = Object.values(languages).reduce((a, b) => a + b, 0) || 1;
    const contributors = (await octokit.request('GET /repos/{owner}/{repo}/contributors', { ...p, per_page: 10 })).data;
    const community = (await octokit.request('GET /repos/{owner}/{repo}/community/profile', p)).data;
    const activity = await requestStats(octokit, 'GET /repos/{owner}/{repo}/stats/commit_activity', p, { sleep: ctx.sleep });
    const weeks = Array.isArray(activity.data) ? activity.data : [];
    return {
      repo: slug(owner, args.repo),
      languages: Object.fromEntries(Object.entries(languages).map(([k, v]) => [k, `${Math.round((v / total) * 1000) / 10}%`])),
      top_contributors: (Array.isArray(contributors) ? contributors : []).map((c) => ({ login: c.login, contributions: c.contributions })),
      community: { health_percentage: community.health_percentage, has: Object.fromEntries(Object.entries(community.files ?? {}).map(([k, v]) => [k, v !== null])) },
      commit_activity: activity.computing
        ? { status: 'GitHub is still computing this; try again in a minute.' }
        : { last_52_weeks: weeks.reduce((a, w) => a + w.total, 0), last_4_weeks: weeks.slice(-4).reduce((a, w) => a + w.total, 0) }
    };
  })
});

export const repoGetTraffic = defineRead({
  name: 'github_repo_get_traffic', area: 'repo', audience: ['Op', 'O'],
  description: 'Views, clones, top referrers and top paths for the last 14 days.',
  properties: { owner: OWNER, repo: REPO },
  required: ['repo'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const p = { owner, repo: args.repo };
    const views = (await octokit.request('GET /repos/{owner}/{repo}/traffic/views', p)).data;
    const clones = (await octokit.request('GET /repos/{owner}/{repo}/traffic/clones', p)).data;
    const referrers = (await octokit.request('GET /repos/{owner}/{repo}/traffic/popular/referrers', p)).data;
    const paths = (await octokit.request('GET /repos/{owner}/{repo}/traffic/popular/paths', p)).data;
    return {
      repo: slug(owner, args.repo), period: 'last 14 days',
      views: { total: views.count, unique: views.uniques }, clones: { total: clones.count, unique: clones.uniques },
      top_referrers: (referrers ?? []).slice(0, 10).map((r) => ({ referrer: r.referrer, views: r.count, unique: r.uniques })),
      top_paths: (paths ?? []).slice(0, 10).map((r) => ({ path: r.path, title: r.title, views: r.count, unique: r.uniques }))
    };
  })
});

export const repoListActivity = defineRead({
  name: 'github_repo_list_activity', area: 'repo', audience: ['Op', 'O'],
  description: 'Recent pushes, force pushes, branch creations and deletions, merges — who did what, when.',
  properties: {
    owner: OWNER, repo: REPO, ref: { type: 'string', maxLength: 200, description: 'Only this branch, e.g. refs/heads/main' },
    activity_type: { type: 'string', enum: ['push', 'force_push', 'branch_creation', 'branch_deletion', 'pr_merge', 'merge_queue_merge'] },
    max: { type: 'integer', minimum: 1, maximum: 100, description: 'Default 30' }
  },
  required: ['repo'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const { data } = await octokit.request('GET /repos/{owner}/{repo}/activity', {
      owner, repo: args.repo, per_page: args.max ?? 30, ...(args.ref ? { ref: args.ref } : {}), ...(args.activity_type ? { activity_type: args.activity_type } : {})
    });
    return { repo: slug(owner, args.repo), count: data.length, items: data.map((a) => ({ type: a.activity_type, ref: a.ref, who: a.actor?.login, when: a.timestamp, before: a.before, after: a.after })) };
  })
});

export const repoGetCustomProperties = defineRead({
  name: 'github_repo_get_custom_properties', area: 'repo', audience: ['O'],
  description: 'The custom property values set on a repository (an organization\'s own labels such as team or tier).',
  properties: { owner: OWNER, repo: REPO },
  required: ['repo'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const { data } = await octokit.request('GET /repos/{owner}/{repo}/properties/values', { owner, repo: args.repo });
    return { repo: slug(owner, args.repo), properties: Object.fromEntries((data ?? []).map((p) => [p.property_name, p.value])) };
  })
});

export const tools = [repoList, repoGet, repoFind, repoGetInsights, repoGetTraffic, repoListActivity, repoGetCustomProperties].map((d) => d.tool);
export const handlers = Object.fromEntries([repoList, repoGet, repoFind, repoGetInsights, repoGetTraffic, repoListActivity, repoGetCustomProperties].map((d) => [d.tool.name, d.handler]));
