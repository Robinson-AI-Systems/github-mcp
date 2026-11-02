// Summary mappers (C-1): the few fields a person reads from each kind of GitHub object. A read tool that names a `summaryType`
// returns these by default; `detail: 'full'` returns the whole object. People are shown as their login, lists of objects as
// names or counts. `author_association` travels with any object that has text, so the dispatcher can still mark text written
// by people without push access as `untrusted`.
const get = (o, path) => path.split('.').reduce((a, k) => (a === null || a === undefined ? undefined : a[k]), o);
const login = (path) => (o) => get(o, path)?.login;
const names = (path, key = 'name') => (o) => get(o, path)?.map((x) => x?.[key]).filter((x) => x !== undefined);
const count = (path) => (o) => (Array.isArray(get(o, path)) ? get(o, path).length : undefined);
const first = (...paths) => (o) => paths.map((p) => get(o, p)).find((v) => v !== undefined && v !== null);
const TEXT = ['body', 'title', 'message', 'text', 'description', 'name'];

const shape = (spec) => (o) => {
  const out = {};
  for (const [key, how] of Object.entries(spec)) {
    const v = typeof how === 'function' ? how(o) : get(o, how);
    if (v !== undefined) out[key] = v;
  }
  if (typeof o?.author_association === 'string' && TEXT.some((f) => typeof out[f] === 'string')) out.author_association = o.author_association;
  return out;
};

/** Commit messages are written by whoever can push (including to a fork): always marked untrusted (PUB-5 C). */
const always = (fn) => (o) => ({ ...fn(o), untrusted: true });

export const SUMMARIES = Object.freeze({
  repository: shape({ full_name: 'full_name', description: 'description', private: 'private', visibility: 'visibility', fork: 'fork', archived: 'archived', default_branch: 'default_branch',
    language: 'language', stars: 'stargazers_count', forks: 'forks_count', open_issues: 'open_issues_count', pushed_at: 'pushed_at', html_url: 'html_url' }),
  branch: shape({ name: 'name', protected: 'protected', sha: 'commit.sha' }),
  commit: always(shape({ sha: 'sha', message: 'commit.message', author: first('author.login', 'commit.author.name'), date: 'commit.author.date', verified: 'commit.verification.verified', parents: count('parents'), html_url: 'html_url' })),
  compare: always(shape({ status: 'status', ahead_by: 'ahead_by', behind_by: 'behind_by', total_commits: 'total_commits', merge_base: 'merge_base_commit.sha', files_changed: count('files'),
    commits: (o) => o.commits?.slice(0, 20).map((c) => ({ sha: c.sha, message: c.commit?.message?.split('\n')[0] })), html_url: 'html_url' })),
  // The list endpoint has merged_at but no merged flag (owner feedback 2026-11-02: say whether a closed PR was merged).
  pull_request: shape({ number: 'number', title: 'title', state: 'state', draft: 'draft', merged: (o) => (typeof o.merged === 'boolean' ? o.merged : Object.hasOwn(o, 'merged_at') ? o.merged_at !== null : undefined), merged_at: 'merged_at', user: login('user'), head: 'head.ref', head_sha: 'head.sha', base: 'base.ref',
    mergeable_state: 'mergeable_state', labels: names('labels'), updated_at: 'updated_at', html_url: 'html_url' }),
  review: shape({ id: 'id', user: login('user'), state: 'state', submitted_at: 'submitted_at', commit_id: 'commit_id', body: 'body', html_url: 'html_url' }),
  review_thread: shape({ id: 'id', resolved: 'isResolved', outdated: 'isOutdated', path: 'path', line: 'line', comments: (o) => o.comments?.totalCount ?? o.comments?.nodes?.length,
    first_comment: (o) => { const c = o.comments?.nodes?.[0]; return c ? { author: c.author?.login, body: c.body, author_association: c.authorAssociation } : undefined; } }),
  issue: shape({ number: 'number', title: 'title', state: 'state', state_reason: 'state_reason', user: first('author', 'user.login'), labels: (o) => (o.labels ?? []).map(l => typeof l === 'string' ? l : l?.name), assignees: (o) => (o.assignees ?? []).map(a => typeof a === 'string' ? a : a?.login), milestone: first('milestone.title', 'milestone'),
    comments: 'comments', is_pull_request: (o) => (o.pull_request ? true : undefined), created_at: 'created_at', updated_at: 'updated_at', html_url: 'html_url' }),
  comment: shape({ id: 'id', user: login('user'), created_at: 'created_at', updated_at: 'updated_at', body: 'body', html_url: 'html_url' }),
  label: shape({ name: 'name', color: 'color', description: 'description', default: 'default' }),
  milestone: shape({ number: 'number', title: 'title', state: 'state', open_issues: 'open_issues', closed_issues: 'closed_issues', due_on: 'due_on', html_url: 'html_url' }),
  workflow: shape({ id: 'id', name: 'name', path: 'path', state: 'state', html_url: 'html_url' }),
  run: shape({ id: 'id', name: 'name', title: 'display_title', event: 'event', status: 'status', conclusion: 'conclusion', branch: 'head_branch', head_sha: 'head_sha', run_number: 'run_number',
    run_attempt: 'run_attempt', actor: login('actor'), created_at: 'created_at', updated_at: 'updated_at', html_url: 'html_url' }),
  job: shape({ id: 'id', name: 'name', status: 'status', conclusion: 'conclusion', started_at: 'started_at', completed_at: 'completed_at', runner: 'runner_name',
    failed_steps: (o) => o.steps?.filter((s) => s.conclusion === 'failure').map((s) => s.name), html_url: 'html_url' }),
  check_run: shape({ id: 'id', name: 'name', status: 'status', conclusion: 'conclusion', started_at: 'started_at', completed_at: 'completed_at', app: 'app.slug', title: 'output.title',
    summary: 'output.summary', annotations: 'output.annotations_count', html_url: 'html_url' }),
  status: shape({ id: 'id', state: 'state', context: 'context', description: 'description', target_url: 'target_url', created_at: 'created_at' }),
  artifact: shape({ id: 'id', name: 'name', size_in_bytes: 'size_in_bytes', expired: 'expired', created_at: 'created_at', expires_at: 'expires_at' }),
  release: shape({ id: 'id', tag: 'tag_name', name: 'name', draft: 'draft', prerelease: 'prerelease', author: login('author'), target: 'target_commitish', created_at: 'created_at',
    published_at: 'published_at', assets: count('assets'), body: 'body', html_url: 'html_url' }),
  deployment: shape({ id: 'id', environment: 'environment', ref: 'ref', sha: 'sha', task: 'task', creator: login('creator'), production: 'production_environment', created_at: 'created_at', description: 'description' }),
  environment: shape({ name: 'name', created_at: 'created_at', updated_at: 'updated_at', protection_rules: count('protection_rules'), branch_policy: (o) => (o.deployment_branch_policy ? 'restricted' : 'any branch'), html_url: 'html_url' }),
  webhook: shape({ id: 'id', name: 'name', active: 'active', events: 'events', url: 'config.url', content_type: 'config.content_type', updated_at: 'updated_at', last_status: 'last_response.status' }),
  delivery: shape({ id: 'id', guid: 'guid', delivered_at: 'delivered_at', redelivery: 'redelivery', duration: 'duration', status: 'status', status_code: 'status_code', event: 'event', action: 'action' }),
  alert: shape({ number: 'number', state: 'state', severity: first('security_advisory.severity', 'security_vulnerability.severity', 'rule.security_severity_level', 'rule.severity'),
    summary: first('security_advisory.summary', 'rule.description', 'secret_type_display_name', 'secret_type'), package: 'dependency.package.name', location: 'most_recent_instance.location.path',
    created_at: 'created_at', html_url: 'html_url' }),
  member: shape({ login: 'login', id: 'id', type: 'type', role: 'role', site_admin: 'site_admin', html_url: 'html_url' }),
  team: shape({ id: 'id', name: 'name', slug: 'slug', description: 'description', privacy: 'privacy', permission: 'permission', parent: 'parent.slug', members: 'members_count', repos: 'repos_count', html_url: 'html_url' }),
  invitation: shape({ id: 'id', login: 'login', email: 'email', role: 'role', created_at: 'created_at', inviter: login('inviter'), failed: 'failed_reason' }),
  installation: shape({ id: 'id', account: login('account'), selection: 'repository_selection', app: 'app_slug', suspended_at: 'suspended_at', updated_at: 'updated_at', permissions: (o) => (o.permissions ? Object.keys(o.permissions) : undefined) }),
  usage_item: shape({ product: 'product', sku: 'sku', unit: first('unitType', 'unit_type'), quantity: 'quantity', price_per_unit: first('pricePerUnit', 'price_per_unit'),
    gross: first('grossAmount', 'gross_amount'), discount: first('discountAmount', 'discount_amount'), net: first('netAmount', 'net_amount') }),
  codespace: shape({ name: 'name', display_name: 'display_name', state: 'state', owner: login('owner'), repository: 'repository.full_name', machine: 'machine.name', created_at: 'created_at', last_used_at: 'last_used_at', web_url: 'web_url' })
});

export const SUMMARY_TYPES = Object.freeze(Object.keys(SUMMARIES));

/** Summarises one object or every object of a list. */
export function summarize(type, value) {
  const map = Object.hasOwn(SUMMARIES, type) ? SUMMARIES[type] : null;
  if (!map) throw new TypeError(`No summary is defined for "${type}".`);
  return Array.isArray(value) ? value.map((v) => map(v)) : map(value);
}
