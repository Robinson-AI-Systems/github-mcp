// Adapted from Robinson-AI-Systems/stripe-mcp scripts/check-docs-updated.mjs @ e2f90e8.
// DRIFT-PROTOCOL checklist B, minimum enforced by CI: a PR that changes api/, src/ or packages/ must also change
// docs/STATUS.md (or a docs/status/ note) and a PR card or work-index.json, and docs/TOOL-CATALOG.md when src/tools/ changes — unless the PR
// body says "Docs-update: not needed — <reason>". Runs only when BASE_SHA is set (CI pull_request runs).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const EXCEPTION = /Docs-update: not needed — .{8,}/;

/** @returns {string[]} the docs a change set is missing (empty when it passes). */
export function missingDocs(changed, prBody = '') {
  const has = (p) => changed.includes(p);
  const code = changed.some((p) => /^(src|api|packages)\//.test(p));
  const tools = changed.some((p) => p.startsWith('src/tools/'));
  if (!code || EXCEPTION.test(prBody || '')) return [];
  const missing = [];
  if (!has('docs/STATUS.md') && !changed.some((p) => /^docs\/status\/(?!README\.md$).+\.md$/.test(p))) missing.push('docs/STATUS.md or a docs/status/ note');
  if (!changed.some((p) => /^docs\/pr-cards\/(?!README\.md$|validate-index\.py$)/.test(p))) missing.push('a PR card or docs/pr-cards/work-index.json');
  if (tools && !has('docs/TOOL-CATALOG.md')) missing.push('docs/TOOL-CATALOG.md');
  return missing;
}

/** AGENT-AUTO-RELEASE-1: the control plane advertises tools/playground-device/version.json, so a change to the agent's
 * payload that leaves the version alone would never reach a machine. Exempt with "Agent-release: not needed — <reason>". */
export const AGENT_EXCEPTION = /Agent-release: not needed — .{8,}/;
const AGENT_PAYLOAD = /^tools\/playground-device\/(agent|pair|update|run)\.mjs$/;
export function missingAgentBump(changed, prBody = '') {
  if (!changed.some((p) => AGENT_PAYLOAD.test(p)) || AGENT_EXCEPTION.test(prBody || '')) return [];
  return changed.includes('tools/playground-device/version.json') ? [] : ['a tools/playground-device/version.json bump (machines only take a newer version)'];
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

/** CHECK-PARITY-1 (2026-11-14): a local run used to skip this rule (no BASE_SHA) or, with BASE_SHA set, compare only
 * committed work, so `npm run check` passed changes CI then failed (twice that day). Locally the base defaults to
 * where this branch left origin/main, and the comparison includes uncommitted and new files; CI (a clean checkout,
 * GITHUB_ACTIONS set) is unchanged. */
export function localBase() {
  for (const ref of ['origin/main', 'main']) {
    try { const sha = git('merge-base', 'HEAD', ref).trim(); if (/^[a-f0-9]{40}$/.test(sha)) return sha; } catch { /* next */ }
  }
  return null;
}

export function changedSince(base, { includeWorkingTree }) {
  const lines = (text) => text.split('\n').filter(Boolean);
  if (!includeWorkingTree) return lines(git('diff', '--name-only', base, 'HEAD', '--'));
  return [...new Set([...lines(git('diff', '--name-only', base, '--')), ...lines(git('ls-files', '--others', '--exclude-standard'))])];
}

function main() {
  const inCi = process.env.GITHUB_ACTIONS === 'true';
  const base = process.env.BASE_SHA || (inCi ? null : localBase());
  if (!base) {
    console.log('Docs check: no PR base (not a pull_request run); diff rule skipped.');
    return;
  }
  if (!/^[a-f0-9]{40}$/.test(base)) throw new Error('Invalid BASE_SHA');
  const changed = changedSince(base, { includeWorkingTree: !inCi });
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const event = eventPath && fs.existsSync(eventPath) ? JSON.parse(fs.readFileSync(eventPath, 'utf8')) : null;
  const missing = [...missingDocs(changed, event?.pull_request?.body || ''), ...missingAgentBump(changed, event?.pull_request?.body || '')];
  if (missing.length) {
    console.error(`Docs check failed: this PR changes code but not ${missing.join(', ')} (DRIFT-PROTOCOL checklist B).`);
    process.exitCode = 1;
  } else console.log(`Docs reconciliation check passed (${changed.length} changed files${inCi ? '' : ', compared with ' + base.slice(0, 12) + ' including uncommitted work'})`);
}
if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) main();
