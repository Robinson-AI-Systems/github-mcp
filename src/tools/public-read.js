import { redact } from './util.js';
// Y-3 shared primitives for reading OTHER accounts' public data (Batch Y decision Y5): only GET, only the allowlisted
// path roots below, the actor credential chosen for the connected account (the user sign-in when it exists, else the
// installation), free text marked untrusted and capped, and a missing or private repository always answering the same
// "not found or no access" sentence so a caller can never tell which it was.
import { githubFor } from '../github/client.js';
import { GithubClientError } from '../github/errors.js';
import { explainGithubError } from './errors.js';

export const LOGIN = { type: 'string', minLength: 1, maxLength: 39, pattern: '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$' };
export const REPO_NAME = { type: 'string', minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9._-]{1,100}$' };
export const MAX = { type: 'integer', minimum: 1, maximum: 100, description: 'How many to list (default 30)' };
export const NOT_FOUND = 'Not found, or not publicly visible to this connection.';

// Every route a public read may use. Anything else is refused before a request is made.
const ALLOWED = [
  /^GET \/users\/\{username\}$/,
  /^GET \/users\/\{username\}\/(repos|social_accounts|followers|following)$/,
  /^GET \/repos\/\{owner\}\/\{repo\}$/,
  /^GET \/repos\/\{owner\}\/\{repo\}\/(readme|releases|issues|pulls)$/,
  /^GET \/repos\/\{owner\}\/\{repo\}\/stargazers(\/count)?$/,
  /^GET \/repos\/\{owner\}\/\{repo\}\/contents(\/\{path\})?$/
];
export const isAllowedPublicRoute = (route) => typeof route === 'string' && ALLOWED.some((pattern) => pattern.test(route));

export const cap = (text, n = 600) => { const safe = typeof text === 'string' ? redact(text) : text; return typeof safe === 'string' ? (safe.length > n ? `${safe.slice(0, n)}…` : safe) : safe ?? null; };

/** The connected account that acts: the named `as`, or the default. Never a foreign account. */
export function actorOf(args, ctx) {
  const named = args.as ?? ctx.connection?.default_account;
  const found = ctx.connection?.accounts?.find((login) => String(login).toLowerCase() === String(named).toLowerCase());
  if (!found) throw new TypeError(`"${named}" is not one of the GitHub accounts this connection may use.`);
  return found;
}

/** An Octokit for reading: the user sign-in when this account has one, otherwise the installation credential. */
export async function readerClient(ctx, actor) {
  let last;
  for (const cred of ['U', 'I']) {
    try { return await githubFor(ctx, { owner: actor, cred }); } catch (error) {
      if (!(error instanceof GithubClientError)) throw error;
      last = error;
    }
  }
  throw new TypeError(explainGithubError(last));
}

/** One allowlisted GET. 404/403/451 become the single not-found sentence; other failures are explained plainly. */
export async function publicGet(client, route, params = {}) {
  if (!isAllowedPublicRoute(route)) throw new TypeError('That route is not available through the public read tools.');
  try { return (await client.request(route, params)).data; } catch (error) {
    if ([403, 404, 451].includes(error?.status)) throw new TypeError(NOT_FOUND);
    throw new TypeError(explainGithubError(error));
  }
}

/** Person or organization, free text capped and marked untrusted. */
export function shapeAccount(u) {
  return {
    login: u.login, id: u.id, type: u.type, name: u.name ?? null, company: cap(u.company, 120), blog: cap(u.blog, 200), location: cap(u.location, 120),
    bio: cap(u.bio, 400), twitter_username: u.twitter_username ?? null, public_repos: u.public_repos, followers: u.followers, following: u.following,
    created_at: u.created_at, html_url: u.html_url, untrusted: true
  };
}

export function shapeRepo(r) {
  return {
    full_name: r.full_name, description: cap(r.description, 300), homepage: cap(r.homepage, 200), fork: r.fork, archived: r.archived, language: r.language,
    stargazers_count: r.stargazers_count, forks_count: r.forks_count, open_issues_count: r.open_issues_count, default_branch: r.default_branch,
    topics: Array.isArray(r.topics) ? r.topics.slice(0, 20) : [], license: r.license?.spdx_id ?? null, pushed_at: r.pushed_at, html_url: r.html_url, untrusted: true
  };
}
