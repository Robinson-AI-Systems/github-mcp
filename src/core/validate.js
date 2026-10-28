// Argument checking for tool calls against the small JSON Schema subset the tools use (B-1). Contract-generic.
// Supported: object (properties, required, additionalProperties), string (enum, minLength, maxLength, pattern),
// integer / number (minimum, maximum), boolean, array (items, maxItems, minItems). Anything else is refused, not guessed.
// Returns a plain sentence for the first problem, or null when the arguments are acceptable.
const MAX_DEPTH = 6;
const SCHEMA_TYPES = new Set(['object','string','integer','number','boolean','array','null']);

function check(spec, value, path, depth) {
  if (depth > MAX_DEPTH) return `${path} is nested too deeply.`;
  const type = spec?.type;
  const label = path || 'The arguments';
  if (Array.isArray(type)) {
    if (!type.length || new Set(type).size !== type.length || type.some(t => !SCHEMA_TYPES.has(t))) return `${label} has an unsupported type.`;
    const failures = type.map(t => check({ ...spec, type: t }, value, path, depth));
    return failures.includes(null) ? null : `${label} must be one of: ${type.join(' or ')}.`;
  }
  switch (type) {
    case 'null': return value === null ? null : `${label} must be null.`;
    case 'string':
      if (typeof value !== 'string') return `${label} must be text.`;
      if (spec.enum && !spec.enum.includes(value)) return `${label} must be one of: ${spec.enum.join(', ')}.`;
      if (spec.minLength !== undefined && value.length < spec.minLength) return `${label} is too short.`;
      if (value.length > (spec.maxLength ?? 100_000)) return `${label} is too long.`;
      if (spec.pattern && !new RegExp(spec.pattern).test(value)) return `${label} is not in the expected form.`;
      return null;
    case 'integer':
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value) || (type === 'integer' && !Number.isSafeInteger(value))) return `${label} must be a ${type === 'integer' ? 'whole ' : ''}number.`;
      if (spec.minimum !== undefined && value < spec.minimum) return `${label} must be at least ${spec.minimum}.`;
      if (spec.maximum !== undefined && value > spec.maximum) return `${label} must be at most ${spec.maximum}.`;
      return null;
    case 'boolean':
      return typeof value === 'boolean' ? null : `${label} must be true or false.`;
    case 'array': {
      if (!Array.isArray(value)) return `${label} must be a list.`;
      if (value.length > (spec.maxItems ?? 1000)) return `${label} has too many items.`;
      if (spec.minItems !== undefined && value.length < spec.minItems) return `${label} needs at least ${spec.minItems} item(s).`;
      for (let i = 0; i < value.length; i += 1) {
        const problem = check(spec.items ?? {}, value[i], `${path}[${i}]`, depth + 1);
        if (problem) return problem;
      }
      return null;
    }
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return `${label} must be an object.`;
      const props = spec.properties ?? {};
      if (spec.maxProperties !== undefined && Object.keys(value).length > spec.maxProperties)
        return `${label} has too many properties.`;
      for (const key of spec.required ?? []) if (!(key in value)) return `${key} is required.`;
      for (const [key, item] of Object.entries(value)) {
        if (!Object.hasOwn(props, key)) {
          if (spec.additionalProperties === true) continue;
          if (spec.additionalProperties && typeof spec.additionalProperties === 'object') {
            const problem = check(spec.additionalProperties, item, path ? `${path}.${key}` : key, depth + 1);
            if (problem) return problem;
            continue;
          }
          // Do not expose a credential prefix by truncating an untrusted property name before redaction.
          return key.length > 40 ? 'Unknown argument (long name omitted).' : `Unknown argument: ${key}.`;
        }
        const problem = check(props[key], item, path ? `${path}.${key}` : key, depth + 1);
        if (problem) return problem;
      }
      return null;
    }
    default:
      return `${label} has an unsupported type.`;
  }
}

export function validateArgs(schema, args) {
  const value = args === undefined || args === null ? {} : args;
  return check({ ...schema, type: schema?.type ?? 'object' }, value, '', 0);
}
