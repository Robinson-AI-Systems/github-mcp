// GitHub's flavour of the write layer (B-1): the request key, the plain handling of the client's own errors, and the
// rule that a write is attempted only through `githubFor` (the pinned, spaced, rate-aware client).
import { defineWrite } from '../core/write.js';
import { requestKey } from '../github/client.js';
import { GithubClientError } from '../github/errors.js';
import { explainGithubError } from './errors.js';

export { explainGithubError };

/** GitHub answered "no" (a 4xx other than a timeout): the change definitely was not made. Transport errors and 5xx are uncertain. */
export function classifyGithubError(error) {
  if (error instanceof GithubClientError) return 'rejected'; // raised before any request was sent
  const status = error?.status;
  return Number.isInteger(status) && status >= 400 && status < 500 && status !== 408 ? 'rejected' : 'uncertain';
}

/** @param {Parameters<typeof defineWrite>[0]} spec same as `defineWrite`; the request key, error handling default to GitHub's. */
export function defineGithubWrite(spec) {
  const definition = defineWrite({
    classifyError: classifyGithubError,
    explain: explainGithubError,
    requestKey: (ctx, args) => requestKey(ctx, spec.name, args),
    ...spec
  });
  // Provider naming compatibility belongs here, outside the generic transaction layer.
  if (!spec.name.startsWith('github_pr_') || !spec.properties?.number || spec.properties.pull_number)
    return definition;
  const { tool, handler } = definition;
  return Object.freeze({
    tool: Object.freeze({ ...tool,
      aliases: Object.freeze({ number: Object.freeze(['pull_number']) }),
      canonicalRequired: Object.freeze([...(spec.required ?? [])]),
      inputSchema: { ...tool.inputSchema,
        properties: { ...tool.inputSchema.properties, pull_number: { ...spec.properties.number, description: 'Alias for number.' } },
        ...(tool.inputSchema.required ? { required: tool.inputSchema.required.filter(key => key !== 'number') } : {}) }
    }),
    handler: (args, ctx) => {
      if (!args || typeof args !== 'object' || Array.isArray(args)) return handler(args, ctx);
      if (args.pull_number !== undefined && args.number !== undefined && args.number !== args.pull_number)
        throw new TypeError('Conflicting number and pull_number; provide one value.');
      const normalized = { ...args, ...(args.number === undefined && args.pull_number !== undefined ? { number: args.pull_number } : {}) };
      delete normalized.pull_number;
      if (spec.required?.includes('number') && normalized.number === undefined)
        throw new TypeError('number is required (or pull_number).');
      return handler(normalized, ctx);
    }
  });
}

