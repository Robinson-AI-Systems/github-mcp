// Small helpers shared by the tools that change things on GitHub (D-1, D-2): the client for an account, a 404 as "not there", a
// plain refusal that the write layer reports as `rejected`, and the owner/repo slug.
import { githubFor } from '../github/client.js';

// GOD-6: a change the person asked to send as themselves, skipping a branch's rules on purpose, uses the wrapper below: every
// request it makes carries `robinsonAs: 'me'`, which the client honours only for a connection acting as the person.
const asMe = (octokit) => ({
  request: (route, params = {}) => octokit.request(route, { ...params, request: { ...params.request, robinsonAs: 'me' } }),
  graphql: (query, variables = {}) => octokit.graphql(query, { ...variables, request: { robinsonAs: 'me' } })
});
export const octo = async (ctx, owner, cred = 'I') => {
  const octokit = await githubFor(ctx, { owner, cred });
  return ctx.forceMe === true ? asMe(octokit) : octokit;
};
export const slug = (owner, repo) => `${owner}/${repo}`;
export const ownerOf = (args, ctx) => String(args.owner ?? ctx.connection.default_account);
/** An error GitHub-style (status 4xx), so the write layer treats it as "definitely not done". */
// `safeMessage` marks wording written by this service, so a failed preflight read may show it to the person instead of a generic line.
export const refusal = (message, status = 422) => Object.assign(new Error(message), { status, safeMessage: true });
/** Runs a read; a 404 answers `null` instead of throwing. */
export const missing = async (fn) => { try { return await fn(); } catch (error) { if (error?.status === 404) return null; throw error; } };
