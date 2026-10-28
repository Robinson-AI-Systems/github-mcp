import { isOwnerConnection } from './authority.js';
// Contract-generic write lifecycle (B-1). Imports nothing service-specific: the service supplies how to name the target,
// read its current state, classify the change, send it, read it back and explain a failure.
//
// Every write binds the connection/target, reads state, discloses consequences,
// journals an immutable intent, sends once, and independently verifies the result.
// Full ordinary owners execute in one call; explicit dryRun (or confirm:false)
// requests a preview. Restricted profiles/passes retain their chosen mode and
// confirmation checks. No path skips credentials, tenant scope or the journal.

const NAME = /^[a-z][a-z0-9_]{1,62}$/;
const PRODUCTION = ['always', 'when-target', 'never'];
const CONFIRM = ['always', 'when-needed'];
const WRITE_PROFILES = ['everyday', 'full'];

const reply = (value, isError = false) => ({ ...(isError ? { isError: true } : {}), content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value });
const dollars = (cents) => `$${(cents / 100).toFixed(2)}`;
const sameLogin = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

/** Turns whatever `classify` returned into one fixed shape. Reasons are plain sentences; null means "no". */
export function normalizeClassification(raw = {}, { readFailed = false, declarations } = {}) {
  const reason = (value, fallback) => (value ? (typeof value === 'string' ? value : fallback) : null);
  let production = reason(raw.production, 'this change affects production');
  if (readFailed && !production) production = 'its current state could not be read, so it is treated as production';
  if (declarations.production === 'always' && !production) production = 'this tool always changes production';
  return {
    production,
    accessWidening: reason(raw.accessWidening, 'this widens someone\'s access'),
    notifies: Array.isArray(raw.notifies) ? raw.notifies.map(String).slice(0, 25) : [],
    spendCents: Number.isSafeInteger(raw.spendCents) && raw.spendCents > 0 ? raw.spendCents : 0,
    spendUnknown: raw.spendUnknown === true
  };
}

export function marksOf(c) {
  const marks = [];
  if (c.production) marks.push('PRODUCTION');
  if (c.accessWidening) marks.push('ACCESS CHANGE');
  if (c.notifies.length) marks.push(`NOTIFIES ${c.notifies.slice(0, 5).join(', ')}${c.notifies.length > 5 ? ` and ${c.notifies.length - 5} more` : ''}`);
  if (c.spendCents) marks.push(`COSTS ${dollars(c.spendCents)}`);
  if (c.spendUnknown) marks.push('COST UNKNOWN — metered charges can continue without a guaranteed maximum');
  return marks;
}

/**
 * @param {object} spec
 * @param {string} spec.name tool name
 * @param {string} spec.description at most 160 characters (the catalog budget)
 * @param {object} [spec.properties] extra input properties (the layer adds dryRun, confirm, requestKey)
 * @param {string[]} [spec.required]
 * @param {{ production: 'always'|'when-target'|'never', accessWidening?: boolean, notifies?: boolean, spend?: boolean, confirm?: 'always'|'when-needed', cred?: string, profiles?: string[] }} spec.declarations
 * @param {(args, ctx) => { owner: string, repo?: string, ref?: string, environment?: string, scope: string }} spec.target
 * @param {(args, ctx, target) => Promise<any>} spec.read current state; may throw (a failed read counts as production)
 * @param {(input) => number|null|Promise<number|null>} [spec.price] cents from provider pricing, or explicit null when metered cost cannot be bounded (required when declarations.spend)
 * @param {(input) => object} spec.classify `{ production, accessWidening, notifies, spendCents }`, computed by the guard helpers
 * @param {(input) => string} spec.summarize one plain-English sentence naming the target
 * @param {(input) => Promise<any>} spec.apply sends the change; called at most once per request key
 * @param {(input) => Promise<any>} spec.readAfter
 * @param {(input) => boolean|Promise<boolean>} spec.verify compares `before` and `after` with the intent
 * @param {(input) => object|null} [spec.inverse] `{ tool, args }` that undoes it cleanly, else null
 * @param {(input) => object} [spec.present] shapes `after` for the caller
 * @param {(error, input) => string} [spec.explain] plain-language text for a failed change
 * @param {(error) => 'rejected'|'uncertain'} [spec.classifyError] `rejected` = GitHub definitively did not do it
 * @param {(ctx, args) => string} spec.requestKey stable key for this intent (10-minute bucket included)
 */
export function defineWrite(spec) {
  const { name, description, area, audience, compact, guidance, properties = {}, required = [], declarations, target, read, classify, price, summarize, apply, readAfter, verify,
    inverse = () => null, present = ({ after }) => after, explain = () => 'The change was not completed.', classifyError = () => 'uncertain', requestKey } = spec;
  if (!NAME.test(name ?? '')) throw new TypeError('A valid tool name is required.');
  if (typeof description !== 'string' || !description) throw new TypeError(`${name}: a description is required.`);
  for (const [label, fn] of Object.entries({ target, read, classify, summarize, apply, readAfter, verify, inverse, present, explain, classifyError, requestKey })) {
    if (typeof fn !== 'function') throw new TypeError(`${name}: ${label} must be a function.`);
  }
  if (!declarations || !PRODUCTION.includes(declarations.production)) throw new TypeError(`${name}: declarations.production must be one of ${PRODUCTION.join(', ')}.`);
  if (declarations.spend && typeof price !== 'function') throw new TypeError(`${name}: a spend tool must give a price function (the cost is never taken from the arguments).`);
  if (price !== undefined && typeof price !== 'function') throw new TypeError(`${name}: price must be a function.`);
  if (declarations.confirm !== undefined && !CONFIRM.includes(declarations.confirm)) throw new TypeError(`${name}: declarations.confirm must be one of ${CONFIRM.join(', ')}.`);
  const profiles = declarations.profiles ?? WRITE_PROFILES;
  if (!profiles.length || profiles.some((p) => !WRITE_PROFILES.includes(p))) throw new TypeError(`${name}: a write tool is available only in the everyday and full profiles.`);
  for (const key of ['dryRun', 'confirm', 'requestKey']) if (key in properties) throw new TypeError(`${name}: "${key}" is added by the write layer.`);
  const decl = Object.freeze({ production: declarations.production, accessWidening: !!declarations.accessWidening, notifies: !!declarations.notifies,
    spend: !!declarations.spend, confirm: declarations.confirm ?? 'when-needed', cred: declarations.cred ?? 'I', profiles: Object.freeze([...profiles]) });

  const tool = Object.freeze({
    name, description, ...(area ? { area } : {}), ...(audience ? { audience: Object.freeze([...audience]) } : {}), ...(compact ? { compact: true } : {}), ...(guidance ? { guidance } : {}),
    writes: true, writeContract: 'defineWrite-v1', priced: typeof price === 'function', declarations: decl, profiles: decl.profiles,
    inputSchema: {
      type: 'object',
      properties: { ...properties, dryRun: { type: 'boolean', description: 'Preview; no write.' }, confirm: { type: 'boolean', description: 'Confirm preview.' },
        requestKey: { type: 'string', maxLength: 128, description: 'Stable retry key.' } },
      ...(required.length ? { required } : {}),
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: decl.production !== 'never', idempotentHint: false, openWorldHint: true }
  });

  async function handler(args, ctx) {
    const connection = ctx?.connection;
    const ownerDirected = isOwnerConnection(connection);
    const banner = connection?.mode === 'production' ? { mode: 'PRODUCTION' } : { mode: 'PREVIEW' };
    const out = (value, isError = false) => reply({ ...banner, ...value }, isError);
    const refuseOutright = (error) => out({ done: false, status: 'refused', error }, true);

    if (!connection || !Array.isArray(connection.accounts) || !connection.accounts.length) return refuseOutright('This connection is not allowed to change GitHub.');
    if (!decl.profiles.includes(connection.profile)) return refuseOutright(`The ${connection.profile} profile cannot use ${name}. Connect with a profile that allows changes.`);
    if (!ctx.db || typeof ctx.db.recordChange !== 'function' || typeof ctx.db.claimChange !== 'function') return refuseOutright('The change log is unavailable, so this change was refused.');
    if (!Array.isArray(ctx.gates)) return refuseOutright('The safety checks are unavailable, so this change was refused.');
    if (!args || typeof args !== 'object' || Array.isArray(args) || (args.dryRun !== undefined && typeof args.dryRun !== 'boolean') || (args.confirm !== undefined && typeof args.confirm !== 'boolean')) {
      return refuseOutright('The arguments are invalid: dryRun and confirm must be true or false.');
    }
    let tgt;
    try { tgt = await target(args, ctx); } catch (error) { return refuseOutright(error instanceof TypeError ? error.message : 'The target could not be worked out from the arguments.'); }
    if (!tgt?.owner || !tgt.scope) return refuseOutright('The target could not be worked out from the arguments.');
    if (!connection.accounts.some((login) => sameLogin(login, tgt.owner))) {
      return refuseOutright(`"${tgt.owner}" is not one of the GitHub accounts this connection may use (${connection.accounts.join(', ')}).`);
    }
    const slug = tgt.repo ? `${tgt.owner}/${tgt.repo}` : tgt.owner;
    const log = (row) => ctx.db.recordChange({ account: tgt.owner, repo: tgt.repo ? slug : null, mode: connection.mode, connection: connection.client_id ?? null, tool: name, target: slug, ...row });

    let before = null;
    let readFailed = false;
    let readError = null;
    try { before = await read(args, ctx, tgt); } catch (error) { readFailed = true; readError = error; }
    let classification;
    try {
      classification = normalizeClassification(await classify({ args, ctx, target: tgt, before, readFailed }), { readFailed, declarations: decl });
    } catch {
      classification = normalizeClassification({ production: 'it could not be classified, so it is treated as production' }, { readFailed: true, declarations: decl });
    }
    let priceFailed = false;
    if (typeof price === 'function') {
      try {
        const cents = await price({ args, ctx, target: tgt, before, readFailed });
        if (cents === null) classification = { ...classification, spendUnknown: true };
        else if (!Number.isSafeInteger(cents) || cents < 0) priceFailed = true;
        else classification = { ...classification, spendCents: cents };
      } catch { priceFailed = true; }
    }
    const recordFields = () => ({ production: !!classification.production, accessWidening: !!classification.accessWidening, notifies: classification.notifies, spendCents: classification.spendCents || null });
    const refuse = async (by, reason) => {
      const text = `REFUSED (${by}): ${reason}`;
      try { await log({ summary: text, dryRun: true, confirmed: false, ...recordFields() }); } catch { /* the refusal still stands */ }
      return out({ done: false, status: 'refused_by_guard', refusedBy: by, error: reason, ...(classification.production ? { production: classification.production } : {}) }, true);
    };

    if (priceFailed) {
      if (!ownerDirected) return refuse('spend', 'The cost of this change could not be worked out, so it was refused.');
      classification = { ...classification, spendCents: 0, spendUnknown: true };
    }

    // 1. Explicitly restricted connections retain their production-mode boundary.
    if (!ownerDirected && classification.production && connection.mode !== 'production') {
      return refuse('mode', `This is a production change because ${classification.production}, and this connection is in preview mode. To make it, connect again without "Read-only" ticked on the sign-in page (the owner can also turn production on for the account on the setup page).`);
    }

    // 2. The guard gates, in order. A gate that throws refuses: the layer fails closed.
    let forcedConfirm = null;
    for (const gate of ctx.gates) {
      let verdict;
      try { verdict = await gate({ tool, name, args, ctx, target: tgt, before, readFailed, classification, declarations: decl }); } catch { verdict = { refuse: 'a safety check could not be completed', by: 'guard' }; }
      if (verdict?.refuse) return refuse(verdict.by ?? 'guard', verdict.refuse);
      if (verdict?.confirm) forcedConfirm = forcedConfirm ?? verdict.confirm;
    }

    // 3. The preview.
    let summary;
    try { summary = readFailed ? null : summarize({ args, ctx, target: tgt, before, classification }); } catch { summary = null; }
    if (!summary) summary = `${name} on ${slug}${readFailed ? ' (its current state could not be read)' : ''}`;
    if (typeof summary !== 'string' || summary.length > 1024) return refuseOutright('A safe preview could not be produced, so this change was refused.');
    const marks = marksOf(classification);
    const line = marks.length ? `${summary} ${marks.map((m) => `${m}.`).join(' ')}` : summary;
    const needsConfirm = !ownerDirected && (decl.confirm === 'always' || decl.spend || classification.spendUnknown || !!classification.production || !!classification.accessWidening
      || classification.notifies.length > 0 || classification.spendCents > 0 || forcedConfirm !== null);
    const preview = { done: false, preview: line, needsConfirmation: needsConfirm && args.confirm !== true, ...(forcedConfirm ? { because: forcedConfirm } : {}) };

    if (args.dryRun === true || (ownerDirected && args.confirm === false)) {
      const previewId = await log({ summary: line, dryRun: true, ...recordFields() });
      return out({ ...preview, status: 'preview', ...(Number.isSafeInteger(previewId) ? { logged: { id: previewId } } : {}) });
    }
    if (readFailed) {
      // A denied provider preflight is a confirmed non-write, not an unknown
      // network outcome. Use the same service-supplied sanitized translator
      // as failed applies so missing permission is not mistaken for plan cost.
      let detail = null;
      if (readError?.status === 403 || readError?.status === 404) {
        try { detail = explain(readError, { args, ctx, target: tgt }); } catch { /* generic refusal below */ }
      }
      if (readError?.safeMessage === true && typeof readError.message === 'string' && readError.message.length > 0 && readError.message.length <= 300)
        return refuse('read', `No change was sent. ${readError.message}`);
      const reason = typeof detail === 'string' && detail.length > 0 && detail.length <= 1024
        ? `The current state could not be read; no change was sent. ${detail}`
        : 'The current state could not be read, so nothing was sent. Try again in a moment.';
      return refuse('read', reason);
    }
    if (needsConfirm && args.confirm !== true) return out({ ...preview, status: 'needs_confirmation', prompt: 'Read the preview, then call again with confirm: true.' });

    // 4. One request key per intent. A repeat is a replay, never a second change.
    let key;
    try { key = requestKey(ctx, args); } catch { key = null; }
    if (typeof key !== 'string' || !key.startsWith('rmcp_')) return refuseOutright('A stable request key could not be made, so this change was refused.');
    let claim;
    try {
      claim = await ctx.db.claimChange({ account: tgt.owner, repo: tgt.repo ? slug : null, mode: connection.mode, connection: connection.client_id ?? null, tool: name,
        target: slug, summary: `PENDING: ${line}`, before, requestKey: key, ...recordFields() });
    } catch { return refuseOutright('The change could not be recorded, so nothing was sent.'); }
    if (!claim.claimed) {
      const prior = claim.existing;
      return out({ done: prior?.confirmed === true, status: 'replayed', replayed: true, requestKey: key, summary: prior?.summary ?? line,
        ...(prior?.confirmed === true ? { confirmed: true, result: prior.after } : {
          warning: prior?.confirmed === false ? 'The same request was already tried and could not be confirmed. Check the current state before sending it again in a new request.'
            : 'The same request was already sent and its outcome is not recorded yet. Nothing was sent again; check the current state before trying again.' }) });
    }

    // 5. Send exactly once, read back, compare.
    let response; let sent = false; let failure = null;
    try { response = await apply({ args, ctx, target: tgt, before, requestKey: key, classification }); sent = true; } catch (error) { failure = error; }
    if (!sent) {
      const rejected = classifyError(failure) === 'rejected';
      let text;
      try { text = explain(failure, { args, ctx, target: tgt }); } catch { text = 'The change was not completed.'; }
      await ctx.db.finishChange(claim.id, { summary: `${rejected ? 'REJECTED' : 'UNCERTAIN'}: ${line}`, confirmed: false, releaseKey: rejected, actedAs: ctx.actor?.summary?.()?.as ?? null }).catch(() => {});
      return out({ done: false, status: rejected ? 'rejected' : 'uncertain', requestKey: key, error: text,
        ...(rejected ? {} : { warning: 'GitHub may or may not have applied this. Check the current state before trying again.' }) }, true);
    }
    let after = null; let confirmed = false; let note = null;
    try {
      after = await readAfter({ args, ctx, target: tgt, before, response });
      confirmed = (await verify({ args, ctx, target: tgt, before, after, response })) === true;
      if (!confirmed) note = 'GitHub accepted the request, but reading it back did not show the expected result.';
    } catch { note = 'GitHub accepted the request, but the result could not be read back to confirm it.'; }
    let inv = null;
    try { inv = confirmed ? inverse({ args, ctx, target: tgt, before, after, response }) : null; } catch { inv = null; }
    const githubRequestId = response?.headers?.['x-github-request-id'] ?? null;
    await ctx.db.finishChange(claim.id, { summary: confirmed ? line : `UNCONFIRMED: ${line}`, after, confirmed, githubRequestId, inverse: inv, actedAs: ctx.actor?.summary?.()?.as ?? null }).catch(() => {});
    let shaped;
    try { shaped = present({ args, ctx, target: tgt, before, after, response }); } catch { shaped = null; }
    return out({ done: confirmed, status: confirmed ? 'applied' : 'unconfirmed', confirmed, requestKey: key, logged: { id: claim.id }, summary: line, ...(shaped !== null && shaped !== undefined ? { result: shaped } : {}),
      ...(note ? { warning: note } : {}) });
  }

  return Object.freeze({ tool, handler });
}
