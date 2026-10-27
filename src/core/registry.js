// Copied from Robinson-AI-Systems/stripe-mcp src/core/registry.js @ e2f90e8.
/** Contract-generic registry: no service-specific imports. */
export function mergeNamespaces(modules) {
  const tools = [];
  const handlers = Object.create(null);
  const seen = new Set();
  for (const mod of modules) {
    for (const tool of mod.tools) {
      if (!tool?.name || seen.has(tool.name) || Object.hasOwn(handlers, tool.name)) {
        throw new Error(`Duplicate or invalid tool name registered: ${tool?.name}`);
      }
      if (typeof mod.handlers?.[tool.name] !== 'function') {
        throw new Error(`Missing handler for registered tool: ${tool.name}`);
      }
      seen.add(tool.name);
      tools.push(tool);
      handlers[tool.name] = mod.handlers[tool.name];
    }
  }
  return { tools, handlers };
}

/** Write tools are available only to the profiles they list; read-only tools to every profile. */
export const isToolVisible = (tool, profile) => {
  // Composed registry runners with explicit profiles are changes, even though
  // their mutation is performed by an underlying audited writer.
  if (tool.writes === true || (tool.passthrough === true && tool.usesRegistry === true && Array.isArray(tool.profiles)))
    return Array.isArray(tool.profiles) && tool.profiles.includes(profile);
  return true;
};

/** The tools a connection with this profile may see and call. */
export const toolsForProfile = (registry, profile) => registry.tools.filter((tool) => isToolVisible(tool, profile));

export const LISTINGS = Object.freeze(['catalog', 'compact']);

/** The one-line description shown in tools/list: dangerous tools say so first (C1). */
export function listedDescription(tool) {
  const d = tool.declarations;
  const flags = [];
  if (tool.writes && d?.production === 'always') flags.push('PRODUCTION');
  if (tool.writes && d?.spend) flags.push('SPENDS MONEY');
  const prefix = flags.length ? `${flags.join(', ')}: ` : '';
  return !prefix || tool.description.startsWith(prefix) ? tool.description : `${prefix}${tool.description}`;
}

/** A compact listing saves context, not capability. Full schema guidance remains in describe_tool. */
export const listedTool = (tool, { compact = false } = {}) => {
  let inputSchema = tool.inputSchema;
  if (compact && tool.writes !== true && inputSchema?.properties) {
    inputSchema = { ...inputSchema, properties: Object.fromEntries(Object.entries(inputSchema.properties)
      .map(([name, value]) => [name, typeof value.description === 'string' && value.description.length > 36
        ? { ...value, description: value.description.slice(0, 33).trimEnd() + '…' } : value])) };
  }
  return { name: tool.name, description: listedDescription(tool), inputSchema,
    ...(tool.annotations ? { annotations: tool.annotations } : {}) };
};

/**
 * The tools a connection is shown. `catalog`: every tool its profile may see. `compact`: only tools marked `compact` (the meta-tools,
 * whoami, the workflows) - everything else is still reachable through the meta-tools. Hiding a tool from the list never makes it callable.
 */
export const toolsForListing = (registry, profile, listing) => {
  const visible = toolsForProfile(registry, profile);
  return listing === 'compact' ? visible.filter((tool) => tool.compact === true) : visible;
};

/** How many tools each profile sees, for the home page. */
export function profileCounts(registry, profiles = ['read_only', 'everyday', 'full']) {
  return Object.fromEntries(profiles.map((profile) => [profile, toolsForProfile(registry, profile).length]));
}
