// The tool dispatcher (A-5c, extended in B-1). Default-deny: it runs only tools it can vouch for, checks arguments against the
// tool's own schema, shapes every result (hidden secrets, Denver times, dollars, untrusted marks, production banner) and withholds any
// result that still looks like it holds a credential.
//  - read-only tools (`readOnlyHint`) run with the connection and database;
//  - write tools (`defineWrite-v1`) run with, in addition, the credentials and the ordered guard gates; the write layer itself
//    refuses a profile that may not change anything, an account outside the connection, and a missing change log or gate list.
// Anything else answers "unknown tool", and so does a write tool the connection's profile does not include (B-6: hidden by name, not just unlisted).
import { randomBytes } from 'node:crypto';
import { validateArgs } from '../core/validate.js';
import {RetainedResultNotFound} from '../core/result-errors.js';
import { capText, describeBody, fitToBudget, projectFields } from '../core/result-rules.js';
import { deduplicateLargeEnvelope } from '../core/result-envelope.js';
import { summarize } from './summaries.js';
import { isToolVisible } from '../core/registry.js';
import { passRefusal } from '../rtc/pass-scope.js';
import { shapeResult, redact, containsCredential } from './util.js';
import {optionalConsentChallenge,OptionalConsentRequired} from '../tenancy/optional-challenge.js';
import { actingAsFor, createActorLog } from '../github/act-as.js';

const fail = (text) => ({ isError: true, content: [{ type: 'text', text: redact(text) }] });
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Summary form (unless `detail: 'full'`) of a tool's raw result: a list, `{ ..., items: [...] }` or one object. */
function summarized(tool, args, raw) {
  let value = Array.isArray(raw) ? { count: raw.length, items: raw } : raw;
  const type = tool.results?.summaryType;
  if (type && args?.detail !== 'full') value = isObject(value) && Array.isArray(value.items) ? { ...value, items: summarize(type, value.items) } : summarize(type, value);
  return value;
}

/** Applies `fields` to the items of a list result, or to the object itself. Safety marks and companion times stay. */
function projected(value, fields) {
  const keep = { alsoKeep: ['untrusted'], twins: ['_local', '_display'] };
  if (isObject(value) && Array.isArray(value.items)) {
    const { value: items, unknown } = projectFields(value.items, fields, keep);
    return { value: { ...value, items }, unknown };
  }
  return projectFields(value, fields, keep);
}

/**
 * The reply for a read tool (C-1): summary/fields, shaping, then the text caps and the size budget. Anything cut or left out is kept
 * whole behind a handle (24 hours, this connection only) that `github_get_result` pages through.
 */
async function readReply({ tool, args, raw, connection, db, mode }) {
  const shaped = shapeResult(summarized(tool, args, raw), { mode });
  const { value, unknown } = tool.results ? projected(shaped, args?.fields) : { value: shaped, unknown: [] };
  if (containsCredential(JSON.stringify(value))) return fail('The result was withheld because it looked like it contained a credential.');
  if (tool.keepsResult === false) return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value };
  // Only an explicitly requested byte window may exceed the normal 8 KiB
  // preview. The read tool validates a hard 32 KiB raw-byte ceiling first.
  const byteWindow = tool.byteWindow === true &&
    (args?.byteOffset !== undefined || args?.byteLength !== undefined) &&
    value?.encoding === 'base64' && typeof value?.content_base64 === 'string' &&
    value?.byte_length <= 32768;
  const capped = capText(value, byteWindow ? { textLimit: 48000 } : {});
  const fit = fitToBudget(capped.value, byteWindow ? 48000 : undefined);
  const notes = {};
  if (unknown.length) notes.unknown_fields = unknown.slice(0, 10);
  if (capped.cut.length || fit.fitted) {
    const owner = connection?.client_id ?? connection?.pass_id;
    const handle = `res_${randomBytes(16).toString('base64url')}`;
    let kept = false;
    if (owner && typeof db?.putResult === 'function') {
      try { await db.putResult({ handle, connection: String(owner), summary: describeBody(value), body: value }); kept = true; } catch { kept = false; }
    }
    notes.kept_result = kept
      ? { handle, what: describeBody(value), ...(fit.fitted && fit.of !== null ? { shown: fit.shown, of: fit.of, ...(fit.shown > 0 ? { next: { page: 2, pageSize: fit.shown } } : {}) } : {}), ...(capped.cut.length ? { text_cut: capped.cut.slice(0, 10) } : {}),
        how: 'Call github_get_result with this handle to read the rest (page, fields, offset). It is kept for 24 hours.' }
      : { note: 'This result was cut and could not be kept. Ask for less (fields, a smaller page) or a narrower search.', ...(capped.cut.length ? { text_cut: capped.cut.slice(0, 10) } : {}) };
  }
  const body = Array.isArray(fit.value) ? { items: fit.value, ...notes } : isObject(fit.value) ? { ...fit.value, ...notes } : fit.value;
  return { content: [{ type: 'text', text: JSON.stringify(body) }], structuredContent: body };
}

// PUB-5 B: a real change is one that was applied, or whose result is not certain (unconfirmed, uncertain). Previews and refusals are not.
const COUNTED_STATUSES = new Set(['applied', 'unconfirmed', 'uncertain']);

/** `usage` is optional: `{ beforeWrite(): Promise<null|{message, retryAfterSeconds}> (reserves a slot), afterWrite(): Promise<void> (confirms it), release?(): Promise<void> (hands it back) }`. Absent = no limits
 *  (every existing caller and the owner path behave exactly as before). It is asked before each real change and told after it. */
export function createDispatch({ env = process.env, now = Date.now, fetch = globalThis.fetch, credentials = null, gates = null, sleep = undefined, usage = null } = {}) {
  // PUB-5 B: a change slot is reserved before the change runs (so parallel calls cannot slip past the limit) and handed back
  // unless the change was counted. `box` remembers that for this one call.
  const dispatch = async (input) => {
    const box = { reserved: false, counted: false };
    try { return await run(input, box); }
    finally { if (box.reserved && !box.counted) { try { await usage.release?.(); } catch { /* best effort */ } } }
  };
  async function run({ registry, name, args, connection, db, actor = null, actAsCache = null }, box) {
    // GOD-6: one log of "who acted" per top-level call; a workflow's nested calls share it, so its result covers them.
    const topLevel = actor === null;
    const actorLog = actor ?? createActorLog();
    const cache = actAsCache ?? {};
    const tool = registry.tools.find((t) => t.name === name);
    const handler = tool && Object.hasOwn(registry.handlers, name) ? registry.handlers[name] : null;
    const isWrite = tool?.writes === true && tool.writeContract === 'defineWrite-v1';
    const isRead = tool?.annotations?.readOnlyHint === true && tool.writes !== true && tool.passthrough !== true;
    // A runner (github_call) hands another tool's call back to this same function, so that tool's own checks run; it is neither read nor write itself.
    const isRunner = tool?.passthrough === true && tool.usesRegistry === true && tool.writes !== true;
    if (!handler || (!isWrite && !isRead && !isRunner) || !isToolVisible(tool, connection?.profile)) return fail(`Unknown or unavailable tool: ${String(name).slice(0, 80)}`);
    const problem = validateArgs(tool.inputSchema, args);
    if (problem) return fail(problem);
    // A service pass is narrower than its profile. This is the one place every call passes, so a workflow's nested calls are held to it too.
    const outside = passRefusal({ tool, args: args ?? {}, connection });
    if (outside) return fail(outside);
    // PUB-5 B: the free fair-use limit on real changes. A preview (dryRun) is never limited and never counted; reads are never limited.
    const limited = usage && isWrite && args?.dryRun !== true;
    if (limited) {
      let stop = null;
      try { stop = await usage.beforeWrite(); box.reserved = !stop; } catch { stop = null; /* a counting problem never blocks work */ }
      if (stop) return { ...fail(stop.message), structuredContent: { error: 'rate_limited', retry_after_seconds: stop.retryAfterSeconds } };
    }
    let result;
    try {
      const challenge=await optionalConsentChallenge({
        name,args:args??{},connection,credentials,env});
      if(challenge)return challenge;
      const callTool = (innerName, innerArgs) => dispatch({ registry, name: innerName, args: innerArgs, connection, db, actor: actorLog, actAsCache: cache });
      result = await handler(args ?? {}, { connection, db, env, now, fetch, credentials, actor: actorLog, actAsCache: cache, ...(sleep ? { sleep } : {}), ...(isWrite ? { gates } : {}), ...(tool.usesRegistry ? { registry, callTool } : {}) });
    } catch (error) {
      if(error instanceof OptionalConsentRequired)return error.reply;
      const response=fail(error instanceof TypeError ? error.message : 'That tool could not complete right now. Nothing was changed.');
      // Only the trusted canonical result handler may distinguish absent/foreign
      // handles. Keep the existing MCP-readable message, never parse its text.
      return name==='github_get_result' && error instanceof RetainedResultNotFound
        ? {...response,failureCode:'retained_result_not_found'} : response;
    }
    const mode = connection?.mode;
    let shaped;
    if (isRunner) {
      // Composite workflows can produce a new aggregate; cap/redact/retain it just like a read.
      // Simple passthrough meta tools retain their delegate's already bounded envelope.
      shaped = tool.boundsResult === true && result?.structuredContent
        ? { ...(await readReply({ tool, args, raw: result.structuredContent, connection, db, mode })),
          ...(result.isError ? { isError: true } : {}) }
        : result;
    } else if (isWrite) {
      const body = result?.structuredContent ?? null;
      if (limited && COUNTED_STATUSES.has(body?.status)) { box.counted = true; try { await usage.afterWrite(); } catch { /* counting is best effort */ } }
      const clean = body ? shapeResult(body, { mode }) : null;
      shaped = clean ? { ...result, structuredContent: clean, content: [{ type: 'text', text: JSON.stringify(clean) }] } : result;
    } else {
      shaped = await readReply({ tool, args, raw: result, connection, db, mode });
      if (shaped.isError) return shaped;
    }
    if (topLevel && !shaped.isError && isObject(shaped.structuredContent) && actorLog.summary()) {
      const said = await actingAsFor({ connection, db, env, now, fetch, credentials, actAsCache: cache }, actorLog.summary());
      const body = { ...shaped.structuredContent, ...said };
      shaped = { ...shaped, structuredContent: body, content: [{ type: 'text', text: JSON.stringify(body) }] };
    }
    if (containsCredential(JSON.stringify(shaped))) return fail('The result was withheld because it looked like it contained a credential.');
    // Only public/top-level replies get compact metadata. Keep full JSON for
    // nested tool calls and output-schema declarations required by clients.
    // Workflows with delegated mutations also use RTC writeReply, which has
    // no companion text field. Their full structured status must survive.
    return topLevel && !isWrite && !tool.delegatedWrites?.length && !tool.outputSchema
      ? deduplicateLargeEnvelope(shaped) : shaped;
  }
  return dispatch;
}
