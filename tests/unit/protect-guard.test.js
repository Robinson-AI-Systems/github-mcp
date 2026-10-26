import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AGENT_OPERATION, MERGE_TOOLS, OUTSIDE_PROJECT, PROTECTED_SEED, PR_ONLY_TOOLS, matchingEntries, ownershipVerdict, protectedList, protectedResourceGate, protectionVerdict } from '../../src/tools/protect-guard.js';
import { createGates } from '../../src/tools/gates.js';
import { handlers } from '../../src/tools/server.js';
import { makeWorld } from '../../test/helpers/write-contract.js';

const SHA = 'a'.repeat(40);
const entries = PROTECTED_SEED.map((e) => ({ ...e }));
const repo = (name) => ({ owner: 'Robinson-AI-Systems', repo: name, scope: 'repo' });
const verdict = (name, target, extra = {}) => protectionVerdict({ entries, name, target, args: {}, classification: {}, ...extra });

describe('the starting list (IN-08)', () => {
  it('has this server and five others pr-only, the relay and old toolkit locked, and every own App installation locked', () => {
    const level = (t) => PROTECTED_SEED.find((e) => e.target === t)?.level;
    for (const n of ['github-mcp', 'stripe-mcp', 'google-workspace-mcp', 'robinsons-toolkit-hub', 'vercel-mcp', 'neon-mcp']) expect(level(`robinson-ai-systems/${n}`)).toBe('pr-only');
    for (const n of ['robinsons-toolkit-relay', 'robinsons-toolkit-mcp']) expect(level(`robinson-ai-systems/${n}`)).toBe('locked');
    expect(PROTECTED_SEED.find((e) => e.kind === 'installation')).toMatchObject({ target: '*', level: 'locked' });
    expect(PROTECTED_SEED).toHaveLength(9);
  });
  it('seeds once from the database helper, and the owner\'s later removal sticks', async () => {
    const w = await makeWorld();
    expect((await protectedList(w.db))).toHaveLength(9);
    await w.db.removeProtectedResource('repo', 'robinson-ai-systems/neon-mcp');
    expect((await protectedList(w.db))).toHaveLength(8);
  });
  it('every name in the allow-lists is a real tool in the catalog (no typos)', () => {
    const catalog = readFileSync(new URL('../../docs/TOOL-CATALOG.md', import.meta.url), 'utf8');
    for (const name of [...PR_ONLY_TOOLS, ...MERGE_TOOLS, ...Object.keys(AGENT_OPERATION)]) expect(catalog).toContain(`\`${name}\``);
  });
  it('allows no settings, access, release, tag or secret tool on pr-only repositories', () => {
    for (const name of ['github_repo_update_settings', 'github_repo_set_visibility', 'github_repo_delete', 'github_repo_transfer', 'github_tag_create', 'github_protection_set', 'github_pr_set_auto_merge', 'github_issue_transfer', 'github_actions_set_settings']) {
      expect(PR_ONLY_TOOLS.has(name) || MERGE_TOOLS.has(name)).toBe(false);
    }
  });
});

describe('pr-only', () => {
  const server = repo('github-mcp');
  it('allows the pull-request routine away from production', () => {
    for (const name of ['github_branch_create', 'github_content_put_file', 'github_pr_create', 'github_review_create', 'github_issue_comment', 'github_check_create_run', 'github_actions_rerun', 'github_actions_approve_fork_run']) {
      expect(verdict(name, server)).toBeNull();
    }
  });
  it('refuses the same tools when the change touches production (default or protected branch, force move)', () => {
    const v = verdict('github_git_update_ref', server, { classification: { production: 'it moves the default branch' } });
    expect(v.refuse).toContain('touches production');
    expect(v.by).toBe('protected resource');
  });
  it('refuses settings, releases, secrets, webhooks, access and everything not on the list, naming the repo', () => {
    for (const name of ['github_repo_update_settings', 'github_tag_create', 'github_protection_set', 'github_repo_delete', 'github_secret_set', 'github_collaborator_add', 'github_made_up_tool']) {
      const v = verdict(name, server);
      expect(v.refuse).toContain('robinson-ai-systems/github-mcp');
      expect(v.refuse).toContain('pr-only');
    }
  });
  it('allows a merge only with an exact 40-character head', () => {
    for (const name of MERGE_TOOLS) {
      expect(verdict(name, server, { args: { expectedHeadSha: SHA }, classification: { production: 'default branch' } })).toBeNull();
      expect(verdict(name, server, { args: {} }).refuse).toContain('expectedHeadSha');
      expect(verdict(name, server, { args: { expectedHeadSha: 'abc123' } }).refuse).toContain('expectedHeadSha');
    }
  });
  it('matches names regardless of case and leaves other repositories alone', () => {
    expect(verdict('github_repo_delete', { owner: 'ROBINSON-ai-systems', repo: 'GITHUB-MCP', scope: 'repo' })).not.toBeNull();
    expect(verdict('github_repo_delete', repo('appliance-desk'))).toBeNull();
    expect(verdict('github_repo_delete', { owner: 'someone-else', repo: 'github-mcp', scope: 'repo' })).toBeNull();
    expect(verdict('github_org_set_settings', { owner: 'Robinson-AI-Systems', scope: 'org' })).toBeNull();
  });
});

describe('locked', () => {
  it('refuses every write on a locked repository, even a merge with a good head', () => {
    for (const name of ['github_pr_create', 'github_pr_merge', 'github_issue_comment', 'github_branch_create']) {
      const v = verdict(name, repo('robinsons-toolkit-mcp'), { args: { expectedHeadSha: SHA } });
      expect(v.refuse).toContain('locked');
    }
  });
  it('locks this server\'s own App installations, by number, and leaves other installations alone', () => {
    const target = { owner: 'Robinson-AI-Systems', scope: 'org', installation: 777 };
    expect(protectionVerdict({ entries, ownInstallationIds: [777], name: 'github_app_set_installation_repos', target, args: {}, classification: {} }).refuse).toContain('locked');
    expect(protectionVerdict({ entries, ownInstallationIds: [111], name: 'github_app_set_installation_repos', target, args: {}, classification: {} })).toBeNull();
    const direct = [{ kind: 'installation', target: '888', level: 'locked', reason: 'test' }];
    expect(matchingEntries(direct, { installation: '888' })).toHaveLength(1);
  });
  it('locked beats pr-only when both apply', () => {
    const both = [{ kind: 'repo', target: 'o/r', level: 'pr-only', reason: 'a' }, { kind: 'repo', target: 'o/r', level: 'locked', reason: 'b' }];
    expect(protectionVerdict({ entries: both, name: 'github_pr_create', target: { owner: 'o', repo: 'r' }, args: {}, classification: {} }).refuse).toContain('locked');
  });
});

describe('project ownership', () => {
  const profile = { ownedRefs: [
    { pattern: 'live', managedBy: 'release.yml', note: 'moved only by the release workflow' },
    { pattern: 'transfer/**', managedBy: 'sandbox-publish.yml', agentMay: ['create-from-default', 'commit-files'] }
  ] };
  const t = (ref) => ({ owner: 'o', repo: 'r', ref, scope: 'repo' });
  it('refuses a write to an owned ref naming the workflow', () => {
    const v = ownershipVerdict({ profile, name: 'github_git_update_ref', target: t('live') });
    expect(v.refuse).toContain('release.yml');
    expect(v.by).toBe('project ownership');
  });
  it('outsideProject turns the refusal into a confirmation', () => {
    const v = ownershipVerdict({ profile, name: 'github_git_update_ref', args: { outsideProject: true }, target: t('live') });
    expect(v.refuse).toBeUndefined();
    expect(v.confirm).toContain('release.yml');
  });
  it('agentMay lets the project\'s own agent steps through, and nothing else on that ref', () => {
    expect(ownershipVerdict({ profile, name: 'github_branch_create', target: t('transfer/2026-10'),
      before: {from:'main',sha:SHA,defaultBranch:'main',defaultBranchSha:SHA} })).toBeNull();
    expect(ownershipVerdict({ profile, name: 'github_branch_create', target: t('transfer/2026-10'),
      before: {from:'feature',sha:SHA,defaultBranch:'main',defaultBranchSha:SHA} }).refuse)
      .toContain('sandbox-publish.yml');
    expect(ownershipVerdict({ profile, name: 'github_content_push_files', target: t('transfer/2026-10') })).toBeNull();
    for (const name of ['github_git_update_ref', 'github_branch_delete', 'github_branch_rename', 'github_pr_merge']) {
      expect(ownershipVerdict({ profile, name, target: t('transfer/2026-10') }).refuse).toContain('sandbox-publish.yml');
    }
  });
  it('does nothing without a profile, without a ref, or for a ref no entry owns', () => {
    expect(ownershipVerdict({ profile: null, name: 'x', target: t('live') })).toBeNull();
    expect(ownershipVerdict({ profile, name: 'x', target: { owner: 'o', repo: 'r' } })).toBeNull();
    expect(ownershipVerdict({ profile, name: 'x', target: t('feature/x') })).toBeNull();
    expect(ownershipVerdict({ profile: {}, name: 'x', target: t('live') })).toBeNull();
  });
  it('exports the argument tools add', () => {
    expect(OUTSIDE_PROJECT.outsideProject.type).toBe('boolean');
  });
});

describe('the gate in the write layer', () => {
  it('is part of the real gate list and refuses with the protected-resource reason', async () => {
    expect(createGates().length).toBeGreaterThanOrEqual(2);
    const w = await makeWorld();
    const gate = protectedResourceGate();
    const refused = await gate({ name: 'github_repo_delete', args: {}, ctx: w.ctx, target: repo('github-mcp'), classification: {} });
    expect(refused.by).toBe('protected resource');
    expect(await gate({ name: 'github_repo_delete', args: {}, ctx: w.ctx, target: repo('other-repo'), classification: {} })).toBeNull();
  });
  it('finds this server\'s own installations from the accounts and locks them', async () => {
    const w = await makeWorld();
    await w.db.upsertAccount({ login: 'app-org', accountId: 5, accountType: 'Organization', label: 'x', credentialKind: 'app', appId: 9 });
    await w.db.setInstallation('app-org', { installationId: 4242, repositorySelection: 'all', permissions: {}, status: 'active' });
    const gate = protectedResourceGate();
    const input = (installation) => ({ name: 'github_app_set_installation_repos', args: {}, ctx: w.ctx, target: { owner: 'app-org', scope: 'org', installation }, classification: {} });
    expect((await gate(input(4242))).refuse).toContain('locked');
    expect(await gate(input(1))).toBeNull();
  });
  it('asks a profile lookup when the connection offers one, and asks for confirmation on outsideProject', async () => {
    const w = await makeWorld();
    w.ctx.profileFor = async (owner, name) => (name === 'appliance-desk' ? { ownedRefs: [{ pattern: 'live', managedBy: 'release.yml' }] } : null);
    const gate = protectedResourceGate();
    const target = { owner: 'christcr2012', repo: 'appliance-desk', ref: 'live', scope: 'repo' };
    expect((await gate({ name: 'github_git_update_ref', args: {}, ctx: w.ctx, target, classification: {} })).by).toBe('project ownership');
    expect((await gate({ name: 'github_git_update_ref', args: { outsideProject: true }, ctx: w.ctx, target, classification: {} })).confirm).toContain('release.yml');
    expect(await gate({ name: 'github_git_update_ref', args: {}, ctx: w.ctx, target: { ...target, repo: 'other' }, classification: {} })).toBeNull();
  });
  it('fails closed when the list cannot be read', async () => {
    const w = await makeWorld();
    w.ctx.db = { seedProtectedResources: async () => { throw new Error('database down'); } };
    await expect(protectedResourceGate()({ name: 'x', args: {}, ctx: w.ctx, target: repo('anything'), classification: {} })).rejects.toThrow();
  });
});

describe('github_list_protected_resources', () => {
  it('lists the starting list in plain words with no way to edit it from here', async () => {
    const w = await makeWorld();
    const res = await handlers.github_list_protected_resources({}, w.ctx);
    expect(res.count).toBe(9);
    expect(res.editable).toContain('setup page');
    expect(res.protected.find((e) => e.target === 'robinson-ai-systems/github-mcp').level).toBe('pr-only');
    expect(res.protected.find((e) => e.kind === 'installation').target).toContain('own GitHub App');
    const slim = await handlers.github_list_protected_resources({ fields: ['level'] }, w.ctx);
    expect(Object.keys(slim.protected[0])).toEqual(['level']);
  });
});
