// PUB-7: the owner's public-launch readiness report as a read tool. Owner only: a public person's (pcl_) or private tenant's (tcl_)
// connection, and any pass, is refused. It reads repository evidence and this server's switch names; it writes nothing, calls
// nothing on GitHub and never changes GITHUB_PUBLIC_CONNECT or any setting. The same report: `npm run launch:readiness`.
import { evaluateLaunchReadiness, gatherLaunchFacts } from '../launch/readiness.js';

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

/** The server owner's own connection: not a pass, not a public person or private tenant, not tenant-scoped credentials. */
export function isServerOwner(ctx) {
  const c = ctx?.connection;
  if (!c || c.pass === true || c.kind === 'pass' || c.pass_id != null) return false;
  const id = String(c.client_id ?? '');
  if (!id || id.startsWith('pcl_') || id.startsWith('tcl_')) return false;
  return typeof ctx.credentials?.operationAuthority !== 'function';
}

async function launchReadiness(args, ctx) {
  if (!isServerOwner(ctx)) throw new TypeError('Only the server owner\'s own connection can read the launch readiness report.');
  const names = (await import('./index.js')).registry.tools.map((t) => t.name);
  const report = evaluateLaunchReadiness(await gatherLaunchFacts({ env: ctx.env ?? process.env, now: (ctx.now ?? Date.now)(), registryNames: names }));
  if (args.detail === 'full') return report;
  return { verdict: report.verdict, summary: report.summary, never_changes: report.never_changes,
    conditions: report.conditions.map((c) => ({ id: c.id, title: c.title, state: c.state, next: c.next.slice(0, 3) })),
    more: 'Ask again with detail "full" for the evidence behind each condition and the switch states.' };
}

export const tools = [{
  name: 'github_launch_readiness',
  area: 'server', audience: ['O'],
  description: 'Owner only: check each public-launch condition against real evidence (met, not met, needs Chris). Read-only; never opens sign-up.',
  inputSchema: { type: 'object', properties: { detail: { type: 'string', enum: ['brief', 'full'], description: 'brief (default) or full evidence' } }, additionalProperties: false },
  annotations: readOnly
}];
export const handlers = { github_launch_readiness: launchReadiness };
