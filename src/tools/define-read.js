// How a read tool is defined (C-1). The tool gives its arguments and a handler that returns GitHub's object (or a list of them);
// the dispatcher applies the result rules: `detail` (summary by default) and `fields`, then the text caps and the size budget.
import { SUMMARY_TYPES } from './summaries.js';

const NAME = /^github_[a-z][a-z0-9_]*$/;
export const DETAIL_PROPERTY = { type: 'string', enum: ['summary', 'full'], description: 'summary (default) or the whole object' };
export const FIELDS_PROPERTY = { type: 'array', items: { type: 'string', maxLength: 64 }, maxItems: 20 };

/**
 * @param {object} spec
 * @param {string} spec.name
 * @param {string} spec.description at most 160 characters, starting with the action
 * @param {object} [spec.properties] JSON-schema properties of the arguments
 * @param {string[]} [spec.required]
 * @param {string} [spec.summaryType] one of SUMMARY_TYPES; omit for a result with no summary form (the text caps and size budget still apply)
 * @param {string} [spec.area] catalog area (default: the second word of the name)
 * @param {string[]} [spec.audience] B builder, O owner, Op operator
 * @param {boolean} [spec.compact] listed in the compact listing
 * @param {string} [spec.guidance] longer instructions, shown by github_describe_tool
 * @param {(args: object, ctx: object) => any} spec.handler returns the raw object, or a list of them
 */
export function defineRead({ name, description, area, audience, compact, guidance, byteWindow = false, aliases = {}, properties = {}, required = [], summaryType, handler }) {
  if (!NAME.test(name ?? '')) throw new TypeError('A valid tool name is required.');
  if (typeof description !== 'string' || !description) throw new TypeError(`${name}: a description is required.`);
  if (typeof handler !== 'function') throw new TypeError(`${name}: handler must be a function.`);
  if (summaryType !== undefined && !SUMMARY_TYPES.includes(summaryType)) throw new TypeError(`${name}: unknown summary type "${summaryType}".`);
  for (const key of ['detail', 'fields']) if (key in properties) throw new TypeError(`${name}: "${key}" is added by the read layer.`);
  const aliasEntries = Object.entries(aliases).flatMap(([canonical, names]) => {
    if (!Object.hasOwn(properties, canonical) || !Array.isArray(names) || !names.length)
      throw new TypeError(`${name}: aliases need a declared canonical argument.`);
    return names.map(alias => {
      if (alias in properties || alias === 'detail' || alias === 'fields')
        throw new TypeError(`${name}: duplicate alias ${alias}.`);
      return [canonical, alias];
    });
  });
  const aliasProperties = Object.fromEntries(aliasEntries.map(([canonical, alias]) =>
    [alias, { ...properties[canonical], description: `Alias for ${canonical}. Prefer ${canonical}.` }]));
  const normalizedHandler = (args = {}, ctx) => {
    const chosen = { ...args };
    for (const [canonical, alias] of aliasEntries) {
      if (!Object.hasOwn(args, alias)) continue;
      if (Object.hasOwn(args, canonical) && args[canonical] !== args[alias])
        throw new TypeError(`Conflicting ${canonical} and ${alias}; provide one value.`);
      chosen[canonical] = args[alias];
      delete chosen[alias];
    }
    for (const canonical of Object.keys(aliases))
      if (!Object.hasOwn(chosen, canonical)) throw new TypeError(`${canonical} is required (or an accepted alias).`);
    return handler(chosen, ctx);
  };
  const tool = Object.freeze({
    name, description, ...(area ? { area } : {}), ...(audience ? { audience: Object.freeze([...audience]) } : {}), ...(compact ? { compact: true } : {}), ...(guidance ? { guidance } : {}),
    readContract: 'defineRead-v1', results: Object.freeze({ summaryType: summaryType ?? null }),
    ...(byteWindow ? { byteWindow: true } : {}),
    ...(aliasEntries.length ? { aliases: Object.freeze(Object.fromEntries(Object.entries(aliases).map(([k, v]) => [k, Object.freeze([...v])]))) } : {}),
    inputSchema: {
      type: 'object',
      properties: { ...properties, ...aliasProperties, ...(summaryType ? { detail: DETAIL_PROPERTY } : {}), fields: FIELDS_PROPERTY },
      ...((required.filter(key => !Object.hasOwn(aliases, key))).length ? { required: required.filter(key => !Object.hasOwn(aliases, key)) } : {}),
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  });
  return { tool, handler: aliasEntries.length ? normalizedHandler : handler };
}
