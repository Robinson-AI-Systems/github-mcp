// Finding and describing tools (C-2). Service-agnostic: works on the registry's tool objects.
const WORDS = (text) => String(text ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);

/** The area of a tool: its declared `area`, else the second word of its name (`github_pr_merge` -> `pr`). */
export const areaOf = (tool) => tool.area ?? tool.name.split('_')[1] ?? '';
export const AUDIENCES = Object.freeze({ B: 'builder', O: 'owner', Op: 'operator' });

/** Plain safety marks for a tool, from what it declares. */
export function marksOf(tool) {
  if (!tool.writes) return tool.passthrough ? ['runs another tool (that tool\'s own marks apply)'] : ['read-only'];
  const d = tool.declarations ?? {};
  const marks = [];
  if (d.production === 'always') marks.push('PRODUCTION');
  else if (d.production === 'when-target') marks.push('production when the target is');
  if (d.accessWidening) marks.push('changes who has access');
  if (d.notifies) marks.push('may notify people');
  if (d.spend) marks.push('SPENDS MONEY');
  marks.push(d.confirm === 'always' ? 'always asks first' : 'safe writes run once; dryRun optional');
  return marks;
}

export const kindOf = (tool) => (tool.writes ? 'change' : tool.passthrough ? 'runner' : 'read');

/** Tools matching plain words, best first. `tools` are the ones the caller may see. */
export function searchTools(tools, { query, area, audience, limit = 10 } = {}) {
  const words = WORDS(query);
  const scored = [];
  for (const tool of tools) {
    if (area && areaOf(tool) !== area) continue;
    if (audience && !(tool.audience ?? ['B', 'O', 'Op']).includes(audience)) continue;
    let score = 0;
    if (words.length) {
      const name = WORDS(tool.name);
      const description = WORDS(tool.description);
      const areaWords = WORDS(areaOf(tool));
      for (const w of words) {
        if (name.includes(w)) score += 4;
        else if (name.some((n) => n.startsWith(w) || w.startsWith(n))) score += 2;
        if (areaWords.includes(w)) score += 2;
        if (description.includes(w)) score += 1;
      }
      if (!score) continue;
    }
    scored.push({ tool, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name)).slice(0, Math.min(Math.max(limit, 1), 25)).map((x) => x.tool);
}

/** Everything an agent needs to call one tool correctly. */
export function describeTool(tool) {
  return {
    name: tool.name, kind: kindOf(tool), area: areaOf(tool), audience: (tool.audience ?? ['B', 'O', 'Op']).map((a) => AUDIENCES[a] ?? a), description: tool.description,
    ...(tool.guidance ? { guidance: tool.guidance } : {}), safety: marksOf(tool),
    ...(tool.writes ? { profiles: tool.profiles, how_to_change: 'For an already-authorized routine change, call once without dryRun or confirm. Use dryRun: true only for an optional preview. If the server returns needs_confirmation, review its preview and obtain the required approval before retrying with confirm: true.' } : {}),
    arguments: tool.aliases ? { ...tool.inputSchema,
      properties: Object.fromEntries(Object.entries(tool.inputSchema.properties).filter(([k]) =>
        !Object.values(tool.aliases).some(names => names.includes(k)))),
      ...(tool.canonicalRequired?.length ? { required: tool.canonicalRequired } : {}) } : tool.inputSchema,
    ...(tool.aliases ? { accepted_aliases: tool.aliases } : {})
  };
}
