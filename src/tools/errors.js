// Plain-English errors (B5). GitHub's error answers are terse and sometimes misleading (a private repository you cannot see answers
// "404"). Every explanation has the same four parts: what happened, the likely cause, what to do next, and one technical line
// with GitHub's request id for anyone who needs to look further. Nothing here ever includes a credential, a request body or a
// stack trace. Unknown errors fall back to the plain status line unchanged.
import { GithubClientError, formatDenver } from '../github/errors.js';
import { redactExcerpt as redact } from './util.js';

const clip = (text, n = 300) => redact(String(text ?? '').replace(/\s+/g, ' ').trim()).slice(0, n);
const headerOf = (error, name) => error?.response?.headers?.[name] ?? error?.headers?.[name];

/** Declared accepted grants, not proof of a missing grant, from `x-accepted-github-permissions` ("pull_requests=write; issues=read"). */
export function acceptedPermissions(header) {
  if (!header) return [];
  const raw = String(header);
  // Boolean endpoint metadata is not a selectable App permission or a missing grant.
  if (/(?:^|[;,])\s*allows_permissionless_access\s*=\s*true\s*(?=$|[;,])/.test(raw)) return [];
  const names = [];
  for (const alternative of raw.split(';')) {
    for (const part of alternative.split(',')) {
      const match = /^([a-z_]+)\s*=\s*(read|write|admin)$/.exec(part.trim());
      // organization_packages is schema-only on GitHub.com, not an available setting.
      if (match && !['allows_permissionless_access', 'organization_packages'].includes(match[1]))
        names.push({ permission: match[1], level: match[2] });
    }
  }
  const seen = new Set();
  return names.filter((n) => (seen.has(n.permission) ? false : seen.add(n.permission)));
}

const words = (permission) => permission.replaceAll('_', ' ');

/** The violated rules from a "Repository rule violations found" answer: one plain line each, with the ruleset's name when GitHub gave it. */
export function ruleViolations(data) {
  const violations = [];
  const metadata = data?.metadata?.rule_violations ?? data?.rule_violations;
  if (Array.isArray(metadata)) {
    for (const v of metadata) violations.push(clip(`${v.message ?? v.rule_type ?? 'a rule'}${v.ruleset_name ? ` (ruleset "${v.ruleset_name}")` : ''}`, 200));
  }
  if (!violations.length) {
    for (const line of String(data?.message ?? '').split('\n')) {
      const m = /^\s*[-*]\s+(.+)$/.exec(line);
      if (m) violations.push(clip(m[1], 200));
    }
  }
  return violations.slice(0, 8);
}

/**
 * @returns {{ kind: string, what: string, cause: string, todo: string, technical: string, retryable?: boolean }}
 */
export function describeGithubError(error, { account = null } = {}) {
  if (error instanceof GithubClientError) {
    const todo = { outside_scope: 'Use one of the accounts this connection may use.', no_credentials: 'Set the account up on the setup page.', rate_limited: error.details?.reset_display ? `Try again after ${error.details.reset_display}.` : 'Wait a little and try again.' }[error.code] ?? 'Check the message and try again.';
    return { kind: error.code, what: error.message, cause: 'The server stopped the request before it reached GitHub.', todo, technical: `client:${error.code}`, retryable: error.code === 'rate_limited' };
  }
  const status = Number.isInteger(error?.status) ? error.status : null;
  const data = error?.response?.data;
  const message = clip(data?.message ?? error?.message ?? '');
  const requestId = headerOf(error, 'x-github-request-id');
  const technical = `HTTP ${status ?? 'none'}${message ? ` — ${clip(message, 160)}` : ''}${requestId ? ` — request id ${requestId}` : ''}`;
  const out = (kind, what, cause, todo, extra = {}) => ({ kind, what, cause, todo, technical, ...extra });
  if (status === null) return out('network', 'GitHub could not be reached, so the change may not have been made.', 'A network problem or a timeout.', 'Check the current state, then try again.', { retryable: true });

  if (status === 401) {
    return out('bad_credentials', 'GitHub did not accept this server\'s credential.', 'The token expired or was revoked. Installation tokens are renewed automatically once; this one still failed.', 'Open the setup page and re-authorize this account (or paste a new token).');
  }
  if (status === 451) return out('unavailable_legal', 'GitHub says this is unavailable for legal reasons.', 'A trade-control or legal restriction applies to the account or content.', 'Nothing can be done from here; contact GitHub support if you think this is a mistake.');

  if (status === 403 || status === 429) {
    const remaining = headerOf(error, 'x-ratelimit-remaining');
    const reset = Number(headerOf(error, 'x-ratelimit-reset'));
    const retryAfter = Number(headerOf(error, 'retry-after'));
    const when = Number.isFinite(reset) && reset > 0 ? formatDenver(new Date(reset * 1000)) : null;
    if (/secondary rate limit|abuse detection/i.test(message)) {
      return out('secondary_rate_limit', 'GitHub is slowing this account down (a secondary rate limit).', 'Too many requests, or too many writes, in a short time.', `Wait ${Number.isFinite(retryAfter) && retryAfter > 0 ? `${retryAfter} seconds` : 'a minute or two'} and try again; do not repeat it immediately.`, { retryable: true });
    }
    if (status === 429 || remaining === '0' || /rate limit exceeded/i.test(message)) {
      return out('primary_rate_limit', 'This account has used its GitHub request budget for now.', 'The hourly request allowance is spent.', when ? `Try again after ${when}.` : 'Try again in a while.', { retryable: true });
    }
    const accepted = acceptedPermissions(headerOf(error, 'x-accepted-github-permissions'));
    if (/resource not accessible by integration/i.test(message) || accepted.length) {
      if (!accepted.length) return out('forbidden',
        'GitHub refused this integration credential for this operation.',
        'The response does not establish a missing selectable App permission. The credential type, target access, or organization policy may block this request.',
        'Check the endpoint’s supported credential type and actual target access. Use setup to compare real App grants before requesting a change.');
      const named = accepted.map((p) => `${words(p.permission)} (${p.level})`).join(', ');
      return out('forbidden', `GitHub refused this credential. The endpoint reports these accepted App permission entries: ${named}.`,
        'These entries describe the endpoint, not a proven missing grant. Credential support, target access and organization policy can also cause this refusal.',
        `Compare the App's actual grants and repository selection with ${named}. Add a listed permission only if it is missing; otherwise verify the supported credential type and the provider's detailed refusal.`);
    }
    if (/repository rule violations/i.test(message)) { /* some rule failures arrive as 403; handled below */ } else {
      return out('forbidden', 'GitHub says this account is not allowed to do that.', 'The credential lacks access, or an organization policy (such as SAML single sign-on or an IP allow list) blocks it.', 'Check the account\'s access on GitHub; if the organization uses SAML, authorize the App for it.');
    }
  }

  if (status === 404) {
    return out('not_found', `GitHub says this was not found${account ? ` (using the ${account} account)` : ''}.`, 'Either it does not exist, or this credential cannot see it: GitHub answers 404 for private things you have no access to.', 'Check the spelling of the owner, repository and number, and that the App is installed on that repository.');
  }
  if ((status === 409 || status === 422) && /(base|head) branch was modified/i.test(message)) {
    return out('branch_moved', `The ${/head/i.test(message) ? 'head' : 'base'} branch changed while this was being done.`, 'Someone pushed (or another merge landed) in the meantime.', 'Read the pull request again and retry with the new head commit.', { retryable: true });
  }
  if (status === 409) {
    if (/git repository is empty/i.test(message)) return out('empty_repository', 'This repository has no commits yet.', 'GitHub cannot create branches or read files from an empty repository.', 'Create the first commit (for example a README) through the file tools, then try again.');
    if (/merge conflict|conflict/i.test(message)) return out('conflict', 'The change conflicts with what is already there.', 'The same lines were changed on both sides.', 'Update the branch from the base branch, resolve the conflict, and try again.');
    if (/does not match|sha/i.test(message)) return out('sha_mismatch', 'The item changed since it was read, so GitHub refused the update.', 'The version this change was based on is no longer the latest.', 'Read it again and repeat the change with the new version.', { retryable: true });
    return out('conflict', 'GitHub reports a conflict with the current state.', 'Something changed between reading and writing.', 'Read the current state and try again.');
  }
  if (status === 422 || status === 403) {
    if (/repository rule violations/i.test(message)) {
      const violations = ruleViolations(data);
      return out('rule_violation', `The repository's rules refused this change${violations.length ? `: ${violations.join('; ')}` : '.'}`,
        'A ruleset or branch protection on the repository forbids it (for example changes must go through a pull request, or checks must pass).', 'Make the change through a pull request that satisfies the rules; this server never bypasses rules.');
    }
    const check = /required status check\s+["“']?([^"”'\n]+?)["”']?\s+is\s+(expected|failing|pending|queued)/i.exec(message);
    if (check) {
      const state = { expected: 'has not reported yet', failing: 'is failing', pending: 'is still running', queued: 'is still queued' }[check[2].toLowerCase()];
      return out('required_check', `The required check "${check[1].trim()}" ${state} on this commit.`, 'The branch requires that check to pass before merging.', state === 'is failing' ? 'Fix the failure, push, and wait for the check to pass at the new head.' : 'Wait for the check to finish on this exact commit, then try again.', { retryable: state !== 'is failing' });
    }
    const problems = Array.isArray(data?.errors) ? data.errors.slice(0, 6).map((e) => (typeof e === 'string' ? clip(e, 120) : clip([e.resource, e.field, e.code, e.message].filter(Boolean).join(' '), 160))).filter(Boolean) : [];
    if (status === 422) {
      return out('validation', `GitHub rejected the request as invalid${problems.length ? `: ${problems.join('; ')}` : message ? ` (${clip(message, 120)})` : ''}.`, 'A value is missing, wrong, or already exists.', 'Fix the value named above and try again.');
    }
  }
  if (status >= 500) return out('github_down', `GitHub had a problem (HTTP ${status}).`, 'A temporary fault on GitHub\'s side.', 'The change may not have been made. Check the current state before trying again.', { retryable: true });
  return out('unknown', `GitHub refused the change (HTTP ${status}).`, message ? clip(message, 160) : 'No reason was given.', 'Check the details and try again.');
}

/** One paragraph of plain text for a failed change. */
export function explainGithubError(error, input = {}) {
  const d = describeGithubError(error, { account: input?.target?.owner ?? null });
  return `${d.what} Why: ${d.cause} Next: ${d.todo} (${d.technical})`;
}

/**
 * GraphQL answers `errors[]` with a `type`; some come with partial `data`. Returns `{ partial, problems }` in plain words.
 * @param {Array<{ type?: string, message?: string, path?: any[] }>} errors
 */
export function describeGraphqlErrors(errors, data = null) {
  const kinds = { NOT_FOUND: 'was not found (or this credential cannot see it)', FORBIDDEN: 'is not allowed for this credential', RATE_LIMITED: 'hit the rate limit; wait and try again', INSUFFICIENT_SCOPES: 'needs a permission the credential does not have' };
  const problems = (Array.isArray(errors) ? errors : []).slice(0, 8).map((e) => {
    const where = Array.isArray(e.path) && e.path.length ? e.path.join('.') : 'the request';
    return `${where} ${kinds[e.type] ?? `failed${e.message ? ` (${clip(e.message, 120)})` : ''}`}`;
  });
  const partial = !!data && typeof data === 'object' && Object.values(data).some((v) => v !== null && v !== undefined);
  return { partial, problems, summary: `${partial ? 'Partly succeeded. ' : ''}${problems.join('; ')}` };
}
