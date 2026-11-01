// PAR-1: parity with GitHub's official MCP server. Seven tools: Copilot review request, Code Quality (list/get/setup),
// GitHub docs search, bulk project item edits and stargazers; plus the two clearer descriptions.
import { describe, expect, it } from 'vitest';
import { makeWorld, parse, runWriteContract } from '../../test/helpers/write-contract.js';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';
import * as reviews from '../../src/tools/reviews-write.js';
import * as quality from '../../src/tools/code-quality.js';
import * as projects from '../../src/tools/projects-write.js';
import { docsSearchUrl, searchDocs } from '../../src/github/docs-search.js';

const def = (ns, name) => ({ tool: ns.tools.find((t) => t.name === name), handler: ns.handlers[name] });
async function call(w, name, args = {}, fetch = w.gh.fetch) {
  const run = createDispatch({ env: w.ctx.env, credentials: w.credentials, fetch, now: w.ctx.now, sleep: w.ctx.sleep, gates: [] });
  const result = await run({ registry, name, args, connection: w.connection, db: w.db });
  try { return parse(result); } catch { return { done: false, isError: true, error: result.content?.[0]?.text ?? '' }; } // a plain-words refusal is text, not JSON
}
const nonGet = (gh) => gh.calls.filter((c) => !['GET', 'HEAD'].includes(c.method) && !(c.route === 'POST /graphql' && !/^\s*mutation\b/.test(String(c.body?.query ?? ''))));

// ---- 1. Copilot review ----------------------------------------------------------------------------------------------------------------
const PR = 'GET /repos/{owner}/{repo}/pulls/{pull_number}';
const prBody = (state = 'open') => ({ number: 4, state, node_id: 'PR_kwDOcopilot', head: { sha: 'a'.repeat(40) } });
const state = (requested, reviews = []) => ({ data: { node: { reviewRequests: { nodes: requested ? [{ requestedReviewer: { __typename: 'Bot', login: 'copilot-pull-request-reviewer' } }] : [] },
  reviews: { nodes: reviews } } } });
const arrangeCopilot = (gh, outcome) => {
  gh.when(PR).reply(200, prBody());
  gh.when('POST /graphql').replySequence([
    { status: 200, body: state(false) },
    { status: 200, body: { data: { requestReviewsByLogin: { pullRequest: { id: 'PR_kwDOcopilot' } } } } },
    { status: 200, body: state(outcome === 'ok') }
  ]);
};
runWriteContract({ label: 'github_review_request_copilot', definition: def(reviews, 'github_review_request_copilot'), needsConfirm: true, strictSpend: true,
  args: { repo: 'hello', number: 4 }, arrange: arrangeCopilot });

describe('PAR-1 Copilot review request', () => {
  it('sends the bot login with union: true and the PR node id, and nothing else', async () => {
    const w = await makeWorld();
    arrangeCopilot(w.gh, 'ok');
    const out = await call(w, 'github_review_request_copilot', { repo: 'hello', number: 4, confirm: true });
    expect(out).toMatchObject({ status: 'applied', confirmed: true });
    const mutation = w.gh.graphql.find((g) => /mutation/.test(g.query));
    expect(mutation.variables.input).toEqual({ pullRequestId: 'PR_kwDOcopilot', botLogins: ['copilot-pull-request-reviewer'], union: true });
    expect(w.gh.invalid).toEqual([]);
    expect(out.result.note).toMatch(/3.10 minutes/);
  });
  it('says "again" when Copilot already reviewed, and accepts a newer Copilot review as confirmation', async () => {
    const w = await makeWorld();
    w.gh.when(PR).reply(200, prBody());
    const old = [{ author: { login: 'copilot-pull-request-reviewer' }, submittedAt: '2026-10-24T10:00:00Z' }];
    w.gh.when('POST /graphql').replySequence([
      { status: 200, body: state(false, old) },
      { status: 200, body: { data: { requestReviewsByLogin: { pullRequest: { id: 'PR_kwDOcopilot' } } } } },
      { status: 200, body: state(false, [...old, { author: { login: 'copilot-pull-request-reviewer' }, submittedAt: '2026-10-24T10:05:00Z' }]) }
    ]);
    const out = await call(w, 'github_review_request_copilot', { repo: 'hello', number: 4, confirm: true });
    expect(out.summary).toMatch(/again/);
    expect(out.status).toBe('applied');
  });
  it('refuses a closed pull request before any write', async () => {
    const w = await makeWorld();
    w.gh.when(PR).reply(200, prBody('closed'));
    const out = await call(w, 'github_review_request_copilot', { repo: 'hello', number: 4, confirm: true });
    expect(out.done).toBe(false);
    expect(JSON.stringify(out)).toMatch(/open pull request/);
    expect(nonGet(w.gh)).toEqual([]);
  });
  it('turns a GitHub refusal into the plain "not available" message', async () => {
    const w = await makeWorld();
    w.gh.when(PR).reply(200, prBody());
    w.gh.when('POST /graphql').replySequence([
      { status: 200, body: state(false) },
      { status: 200, body: { errors: [{ message: 'Could not resolve to a Bot with the login of copilot-pull-request-reviewer.' }] } }
    ]);
    const out = await call(w, 'github_review_request_copilot', { repo: 'hello', number: 4, confirm: true });
    expect(out.done).toBe(false);
    expect(JSON.stringify(out)).toMatch(/Copilot code review is not available on this repository/);
  });
});

// ---- 2. Code quality ------------------------------------------------------------------------------------------------------------------
const FINDINGS = 'GET /repos/{owner}/{repo}/code-quality/findings';
const SETUP = '/repos/{owner}/{repo}/code-quality/setup';
const finding = (n = 1) => ({ number: n, state: 'open', url: `https://api.github.com/repos/example-org/hello/code-quality/findings/${n}`, created_at: '2026-10-24T10:00:00Z',
  rule: { id: 'js/unused-var', title: 'Unused variable', help: 'h', severity: 'warning', category: 'maintainability' },
  location: { path: 'src/a.js', start_line: 3, end_line: 3 }, message: { text: 'x'.repeat(500), markdown: 'm' } });
const arrangeSetup = (gh, outcome) => {
  gh.when(`GET ${SETUP}`).replySequence([
    { status: 200, body: { state: 'not-configured', languages: [] } },
    { status: 200, body: outcome === 'ok' ? { state: 'configured', languages: ['python'], runner_type: 'standard', ai_findings_option: 'disabled' } : { state: 'not-configured', languages: [] } }
  ]);
  gh.when(`PATCH ${SETUP}`).reply(202, {});
};
runWriteContract({ label: 'github_code_quality_setup', definition: def(quality, 'github_code_quality_setup'), needsConfirm: true, production: true, profile: 'full',
  args: { repo: 'hello', state: 'configured', languages: ['python'] }, arrange: arrangeSetup });

describe('PAR-1 Code Quality', () => {
  it('lists shaped findings with the cursor from the Link header, and caps the message at 300 characters', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    w.gh.when(FINDINGS).reply(200, [finding(1), finding(2)], { link: '<https://api.github.com/repositories/1/code-quality/findings?per_page=2&after=CUR%3D%3D>; rel="next"' });
    const out = await call(w, 'github_code_quality_list', { repo: 'hello', state: 'open', max: 2, after: 'PREV' });
    expect(out.items).toHaveLength(2);
    expect(out.items[0]).toMatchObject({ number: 1, state: 'open', path: 'src/a.js', start_line: 3, rule: { id: 'js/unused-var', severity: 'warning' } });
    expect(out.items[0].message.length).toBeLessThanOrEqual(301);
    expect(out.next).toBe('CUR==');
    const sent = w.gh.calls.find((c) => c.route === FINDINGS);
    expect(sent.query).toMatchObject({ state: 'open', per_page: '2', after: 'PREV' });
    expect(w.gh.invalid).toEqual([]);
  });
  it('gets one finding (message up to 2,000 characters) or the setup', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    w.gh.when('GET /repos/{owner}/{repo}/code-quality/findings/{finding_number}').reply(200, finding(5));
    w.gh.when(`GET ${SETUP}`).reply(200, { state: 'configured', languages: ['go'], runner_type: 'standard', ai_findings_option: 'on_push', schedule: 'weekly' });
    const one = await call(w, 'github_code_quality_get', { repo: 'hello', number: 5 });
    expect(one).toMatchObject({ number: 5, message: 'x'.repeat(500) });
    const cfg = await call(w, 'github_code_quality_get', { repo: 'hello', setup: true });
    expect(cfg.setup).toMatchObject({ state: 'configured', languages: ['go'], aiFindingsOption: 'on_push' });
    const neither = await call(w, 'github_code_quality_get', { repo: 'hello' });
    expect(JSON.stringify(neither)).toMatch(/finding number, or setup: true/);
  });
  it('answers 404 with the plain "not turned on" sentence', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    w.gh.when(FINDINGS).reply(404, { message: 'Not Found' });
    const out = await call(w, 'github_code_quality_list', { repo: 'hello' });
    expect(JSON.stringify(out)).toMatch(/Code quality is not turned on for example-org\/hello/);
  });
  it('setup: nothing to change is refused; no setting at all is refused; undo restores the previous setup', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    arrangeSetup(w.gh, 'ok');
    const none = await call(w, 'github_code_quality_setup', { repo: 'hello', confirm: true });
    expect(none.done).toBe(false);
    expect(nonGet(w.gh)).toEqual([]);
    const done = await call(w, 'github_code_quality_setup', { repo: 'hello', state: 'configured', languages: ['python'], confirm: true });
    expect(done.status).toBe('applied');
    const sent = w.gh.calls.find((c) => c.method === 'PATCH');
    expect(sent.body).toEqual({ state: 'configured', languages: ['python'] });
    expect((await w.db.getChange(1)).inverse).toMatchObject({ tool: 'github_code_quality_setup', args: { state: 'not-configured' } });
    expect(w.gh.invalid).toEqual([]);
  });
});

// ---- 3. Docs search -------------------------------------------------------------------------------------------------------------------
const hit = (over = {}) => ({ id: '1', url: 'https://docs.github.com/en/actions/learn', title: 'Learn <mark>Actions</mark>', breadcrumbs: ['Actions', 'Learn'],
  highlights: { title: ['Learn <mark>Actions</mark>'], content: ['Use <mark>workflows</mark> to <b>automate</b> tasks.'] }, ...over });
const docsFetch = (handler) => async (url, init) => handler(url, init);
const reply = (body, over = {}) => ({ ok: true, status: 200, url: 'https://docs.github.com/api/search/v1', json: async () => body, ...over });

describe('PAR-1 docs search', () => {
  it('builds exactly the fixed origin and path with the query encoded', () => {
    const url = docsSearchUrl('a b&c=d #x', 3);
    expect(url.origin).toBe('https://docs.github.com');
    expect(url.pathname).toBe('/api/search/v1');
    expect(url.searchParams.get('query')).toBe('a b&c=d #x');
    expect(url.search).not.toMatch(/[ #]/);
    expect([...url.searchParams.keys()].sort()).toEqual(['language', 'query', 'size', 'version']);
  });
  it('turns the site-relative links GitHub really returns into full docs.github.com links', async () => {
    const fetch = docsFetch(() => reply({ meta: { found: { value: 2 } }, hits: [hit({ url: '/en/rest/branches/branch-protection' }), hit({ url: '//evil.example/x' }), hit({ url: 'javascript:alert(1)' })] }));
    const out = await searchDocs({ query: 'branch', max: 5, fetch });
    expect(out.items.map((i) => i.url)).toEqual(['https://docs.github.com/en/rest/branches/branch-protection']);
  });
  it('strips tags, drops non-docs links, sends no credentials, and refuses redirects', async () => {
    const seen = [];
    const fetch = docsFetch((url, init) => { seen.push({ url: String(url), init }); return reply({ meta: { found: { value: 42 } }, hits: [hit(), hit({ url: 'https://evil.example/x' })] }); });
    const out = await searchDocs({ query: 'actions', max: 5, fetch });
    expect(out.total).toBe(42);
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toEqual({ title: 'Learn Actions', url: 'https://docs.github.com/en/actions/learn', breadcrumbs: 'Actions > Learn', snippet: 'Use workflows to automate tasks.' });
    expect(seen[0].init.redirect).toBe('error');
    expect(Object.keys(seen[0].init.headers).sort()).toEqual(['accept', 'user-agent']);
    expect(JSON.stringify(seen[0].init)).not.toMatch(/authorization|token/i);
  });
  it('refuses an answer from another origin, and gives the plain message on timeout or a bad status (one retry at most)', async () => {
    let calls = 0;
    await expect(searchDocs({ query: 'x', fetch: docsFetch(() => { calls += 1; return reply({ hits: [] }, { url: 'https://other.example/api' }); }) })).rejects.toThrow(/help search did not answer/);
    expect(calls).toBe(2);
    calls = 0;
    await expect(searchDocs({ query: 'x', fetch: docsFetch(() => { calls += 1; return reply({}, { ok: false, status: 503 }); }) })).rejects.toThrow(/https:\/\/docs.github.com yourself/);
    expect(calls).toBe(2);
    await expect(searchDocs({ query: 'x', fetch: docsFetch(() => { throw new Error('timeout'); }) })).rejects.toThrow(/did not answer/);
  });
  it('works through the tool with no GitHub call at all', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    const fetch = docsFetch(() => reply({ meta: { found: { value: 1 } }, hits: [hit()] }));
    const out = await call(w, 'github_docs_search', { query: 'actions workflows', max: 3 }, fetch);
    expect(out.items[0].title).toBe('Learn Actions');
    expect(w.gh.calls).toEqual([]);
  });
});

// ---- 4. Bulk project edits ------------------------------------------------------------------------------------------------------------
const R = {
  project: 'GET /orgs/{org}/projectsV2/{project_number}', fields: 'GET /orgs/{org}/projectsV2/{project_number}/fields',
  item: 'GET /orgs/{org}/projectsV2/{project_number}/items/{item_id}', patch: 'PATCH /orgs/{org}/projectsV2/{project_number}/items/{item_id}'
};
function arrangeBulk(gh, outcome, { failOn = null } = {}) {
  const updated = new Set();
  gh.when(R.project).reply(200, { id: 1, node_id: 'PVT_TEST', number: 9, title: 'Roadmap' });
  gh.when(R.fields).reply(200, [{ id: 3, name: 'Status', data_type: 'text' }, { id: 4, name: 'Note', data_type: 'text' }]);
  gh.when(R.item).reply(200, (req) => {
    const id = Number(req.params.item_id);
    return { id, node_id: `PVTI_${id}`, content: { id: 100 + id }, fields: updated.has(id) ? [{ id: 3, value: outcome === 'ok' ? 'Doing' : 'Wrong' }] : [{ id: 3, value: 'Todo' }] };
  });
  gh.when(R.patch).reply(200, (req) => { updated.add(Number(req.params.item_id)); return {}; });
  if (failOn) gh.when(R.patch).replySequence([{ status: 200, body: {} }, { status: 422, body: { message: 'Validation Failed' } }]);
}
runWriteContract({ label: 'github_project_set_items', definition: def(projects, 'github_project_set_items'), needsConfirm: true, expectedWrites: 2,
  args: { number: 9, items: [{ itemId: 21, fields: [{ id: 3, value: 'Doing' }] }, { itemId: 22, fields: [{ id: 3, value: 'Doing' }] }] }, arrange: arrangeBulk });

describe('PAR-1 bulk project edits', () => {
  const items = (n) => Array.from({ length: n }, (_, i) => ({ itemId: 20 + i, fields: [{ id: 3, value: 'Doing' }] }));
  it('updates three items with one PATCH each, in order, and the undo holds the previous values', async () => {
    const w = await makeWorld({ mode: 'production' });
    arrangeBulk(w.gh, 'ok');
    const out = await call(w, 'github_project_set_items', { number: 9, items: items(3), confirm: true });
    expect(out).toMatchObject({ status: 'applied', result: { updated: 3, of: 3, failed: null } });
    const patches = w.gh.calls.filter((c) => c.method === 'PATCH');
    expect(patches.map((c) => c.params.item_id)).toEqual(['20', '21', '22']);
    expect((await w.db.getChange(1)).inverse).toMatchObject({ tool: 'github_project_set_items', args: { items: [{ itemId: 20, fields: [{ id: 3, value: 'Todo' }] }, { itemId: 21 }, { itemId: 22 }] } });
    expect(w.gh.invalid).toEqual([]);
  });
  it('confirms and builds the undo from GitHub\'s real text-value shape ({raw, html}), as the first live test showed', async () => {
    const w = await makeWorld({ mode: 'production' });
    const updated = new Set();
    w.gh.when(R.project).reply(200, { id: 1, node_id: 'PVT_TEST', number: 9, title: 'Roadmap' });
    w.gh.when(R.fields).reply(200, [{ id: 3, name: 'Note', data_type: 'text' }]);
    w.gh.when(R.item).reply(200, (req) => { const id = Number(req.params.item_id);
      return { id, node_id: `PVTI_${id}`, content: { id: 100 + id }, fields: [{ id: 3, data_type: 'text', value: updated.has(id) ? { raw: 'Doing', html: 'Doing' } : { raw: 'Todo', html: 'Todo' } }] }; });
    w.gh.when(R.patch).reply(200, (req) => { updated.add(Number(req.params.item_id)); return {}; });
    const out = await call(w, 'github_project_set_items', { number: 9, items: items(2), confirm: true });
    expect(out).toMatchObject({ status: 'applied', result: { updated: 2, of: 2, failed: null } });
    expect((await w.db.getChange(1)).inverse.args.items[0]).toEqual({ itemId: 20, fields: [{ id: 3, value: 'Todo' }] });
  });
  it('a field that is not in the project is refused before any PATCH, naming it', async () => {
    const w = await makeWorld({ mode: 'production' });
    arrangeBulk(w.gh, 'ok');
    const bad = [{ itemId: 20, fields: [{ id: 3, value: 'x' }] }, { itemId: 21, fields: [{ id: 99, value: 'x' }] }];
    const out = await call(w, 'github_project_set_items', { number: 9, items: bad, confirm: true });
    expect(out.done).toBe(false);
    expect(JSON.stringify(out)).toMatch(/Field 99 \(item 21\)/);
    expect(w.gh.calls.filter((c) => c.method === 'PATCH')).toEqual([]);
  });
  it('stops at the first failure: exactly two PATCH requests, first reported done, third not tried, nothing retried', async () => {
    const w = await makeWorld({ mode: 'production' });
    arrangeBulk(w.gh, 'ok', { failOn: true });
    const out = await call(w, 'github_project_set_items', { number: 9, items: items(3), confirm: true });
    expect(w.gh.calls.filter((c) => c.method === 'PATCH')).toHaveLength(2);
    expect(out.status).toBe('unconfirmed');
    expect(out.result).toMatchObject({ updated: 1, of: 3, done: [20], failed: { itemId: 21 }, not_tried: [22] });
    expect(out.result.note).toMatch(/Updated 1 of 3 items; stopped at item 21/);
    expect(out.result.note).toMatch(/Nothing was retried/);
  });
  it('refuses 41 items and repeated item ids without any request', async () => {
    const w = await makeWorld({ mode: 'production' });
    arrangeBulk(w.gh, 'ok');
    const many = await call(w, 'github_project_set_items', { number: 9, items: items(41), confirm: true });
    expect(many.done).not.toBe(true);
    const dup = await call(w, 'github_project_set_items', { number: 9, items: [items(1)[0], items(1)[0]], confirm: true });
    expect(dup.done).not.toBe(true);
    expect(w.gh.calls).toEqual([]);
  });
});

// ---- 5. Stargazers --------------------------------------------------------------------------------------------------------------------
describe('PAR-1 stargazers', () => {
  const REPO = 'GET /repos/{owner}/{repo}';
  const arrange = (w) => {
    w.gh.when(REPO).reply(200, { id: 1, name: 'hello', private: false, visibility: 'public', stargazers_count: 42 });
    w.gh.when('GET /repos/{owner}/{repo}/stargazers').reply(200, (req) => (/star\+json/.test(req.headers.accept ?? '')
      ? [{ starred_at: '2026-10-01T00:00:00Z', user: { login: 'ann', type: 'User' } }] : [{ login: 'ann', type: 'User' }, { login: 'bo', type: 'User' }]));
  };
  it('returns the total and the people; withDates sends the star header and returns starred_at', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    arrange(w);
    const plain = await call(w, 'github_repo_list_stargazers', { owner: 'someone', repo: 'hello', max: 2 });
    expect(plain).toMatchObject({ total: 42, page: 1, items: [{ login: 'ann' }, { login: 'bo' }] });
    expect(plain.items[0].starred_at).toBeUndefined();
    const dated = await call(w, 'github_repo_list_stargazers', { owner: 'someone', repo: 'hello', withDates: true });
    expect(dated.items).toMatchObject([{ login: 'ann', type: 'User', starred_at: '2026-10-01T00:00:00Z' }]);
    const star = w.gh.calls.filter((c) => c.route === 'GET /repos/{owner}/{repo}/stargazers').at(-1);
    expect(star.headers.accept).toMatch(/star\+json/);
    expect(w.gh.invalid).toEqual([]);
  });
  it('when GitHub refuses the listing of a public repository, says so plainly with the star total instead of "not found"', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    w.gh.when(REPO).reply(200, { id: 1, name: 'hello', private: false, visibility: 'public', stargazers_count: 7 });
    w.gh.when('GET /repos/{owner}/{repo}/stargazers').reply(403, { message: 'nope' });
    const out = await call(w, 'github_repo_list_stargazers', { owner: 'someone', repo: 'hello' });
    expect(JSON.stringify(out)).toMatch(/would not list the people who starred someone\/hello/);
    expect(JSON.stringify(out)).toMatch(/total is 7/);
  });
  it('a private repository gets the one not-found answer', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    w.gh.when(REPO).reply(200, { id: 1, name: 'hello', private: true, visibility: 'private' });
    const out = await call(w, 'github_repo_list_stargazers', { owner: 'someone', repo: 'hello' });
    expect(JSON.stringify(out)).toMatch(/Not found, or not publicly visible/);
    expect(w.gh.calls.some((c) => /stargazers/.test(c.route ?? ''))).toBe(false);
  });
});

// ---- 6. Descriptions ------------------------------------------------------------------------------------------------------------------
describe('PAR-1 descriptions', () => {
  const find = (n) => registry.tools.find((t) => t.name === n);
  it('org search and team members are findable and the descriptions stay within 160 characters', () => {
    expect(find('github_search_github').description).toMatch(/type:org/);
    expect(find('github_team_get').description).toMatch(/members/i);
    for (const name of ['github_search_github', 'github_team_get', 'github_review_request_copilot', 'github_code_quality_list', 'github_code_quality_get', 'github_code_quality_setup', 'github_docs_search', 'github_project_set_items', 'github_repo_list_stargazers'])
      expect(find(name).description.length, name).toBeLessThanOrEqual(160);
  });
});
