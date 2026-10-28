// Adapted from Robinson-AI-Systems/stripe-mcp scripts/check-writes.mjs @ e2f90e8; completed for B-7.
// Every registered write tool must (1) offer dryRun and confirm, (2) be built with defineWrite and carry its declarations,
// (3) give a price function when it spends money, and (4) match its row in docs/TOOL-CATALOG.md: the catalog's Safety, Cred
// and Profile cells and the tool's own declarations must say the same thing. Every registered tool needs a catalog row.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Reads every tool row of the catalog: `{ name, safety, cred, profile, card }`. */
export function parseCatalog(text) {
  const rows = new Map();
  for (const line of text.split('\n')) {
    if (!line.startsWith('| `github_')) continue;
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    if (cells.length !== 8) continue;
    rows.set(cells[0].replace(/`/g, ''), { name: cells[0].replace(/`/g, ''), safety: cells[2], cred: cells[4], audience: cells[5], profile: cells[6], card: cells[7] });
  }
  return rows;
}

/** The marks in a Safety cell: `{ read, confirmAlways, prod, access, notifies, spend, preview }`. null for "as the tool". */
export function parseSafety(cell) {
  if (cell === 'as the tool') return null;
  if (cell === '—') return { read: true };
  const compact = cell.replace(/\s*\(always\)/, '');
  const parts = compact.split('·').map((p) => p.trim());
  return {
    read: false,
    confirmAlways: parts.includes('C'),
    preview: parts.includes('P'),
    prod: parts.includes('Prod') ? 'always' : parts.includes('Prod*') ? 'when-target' : 'never',
    access: parts.some((p) => p === 'A' || p === 'A*'),
    notifies: parts.some((p) => p === 'M' || p === 'M*'),
    spend: parts.some((p) => p === '$' || p === '$*')
  };
}

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

/** @returns {string[]} failures for the given tool definitions (and, when given, the parsed catalog). */
export function checkWrites(tools, catalog) {
  const failures = [];
  const known=new Map(tools.map(t=>[t.name,t]));
  for (const tool of tools) {
    const row = catalog?.get(tool.name);
    if (catalog && !row) failures.push(`${tool.name}: registered tool has no row in docs/TOOL-CATALOG.md`);
    const safety = row ? parseSafety(row.safety) : null;
    if (!Array.isArray(tool.audience) || !tool.audience.length) failures.push(`${tool.name}: tool without an audience (B, O, Op)`);
    else if (row && !sameSet(tool.audience, row.audience.split(',').map((a) => a.trim()))) failures.push(`${tool.name}: audience is ${tool.audience.join(',')} but the catalog says ${row.audience}`);
    if (!tool.writes) {
      if(tool.name==='github_write_batch'){
        const p=tool.inputSchema?.properties;
        if(!tool.passthrough||!tool.usesRegistry||tool.boundsResult!==true||
          !sameSet(tool.delegatedWrites??[],['*'])||
          !p?.steps||!p?.batchKey||!p?.confirm||!p?.dryRun||
          tool.annotations?.readOnlyHint!==false||
          tool.annotations?.destructiveHint!==true||
          !sameSet(tool.profiles??[],['everyday','full'])||
          row?.safety!=='as the tool'||row?.profile!=='E')
          failures.push(tool.name+': write batch requires durable intent, bounded steps, confirmed dispatched guards and a truthful as-the-tool catalog row.');
        continue;
      }
      if(tool.name==='github_undo_change'&&tool.passthrough===true&&tool.usesRegistry===true){
        // X-1: the opposite is a stored defineWrite tool run through the dispatcher, so the target keeps every guard.
        const p=tool.inputSchema?.properties;
        if(!p?.changeId||!p?.confirm||!p?.dryRun||!p?.requestKey||tool.annotations?.readOnlyHint!==false||
          tool.annotations?.destructiveHint!==true||!sameSet(tool.profiles??[],['everyday','full'])||
          row?.profile!=='E'||!safety?.confirmAlways||safety?.prod!=='never')
          failures.push(tool.name+': undo must stay a dispatched, previewed and confirmed change with its exact catalog safety.');
        continue;
      }
      if(tool.passthrough===true&&tool.usesRegistry===true&&
        ['github_workflow_app_readiness','github_workflow_project_setup'].includes(tool.name)){
        const delegates=tool.delegatedWrites;
        if(!Array.isArray(delegates)||!delegates.length||
          delegates.some(name=>known.get(name)?.writeContract!=='defineWrite-v1'))
          failures.push(tool.name+': composed mutation lacks verified guarded delegates');
        const readiness=tool.name==='github_workflow_app_readiness';
        const schema=tool.inputSchema?.properties;
        if(!(readiness?schema?.fixRow:schema?.id)||
          !schema?.confirm||!schema?.dryRun||
          tool.annotations?.readOnlyHint!==false||
          tool.annotations?.destructiveHint!==true||
          safety?.prod!=='never'||
          !(readiness?safety?.preview:(
            safety?.confirmAlways&&safety.access&&
            row.profile==='F'&&
            tool.profiles?.length===1&&tool.profiles[0]==='full')))
          failures.push(tool.name+': composed tool needs declared guarded delegates, explicit approval fields and matching catalog safety');
        continue;
      }
      if(tool.passthrough===true&&tool.usesRegistry===true&&
        ['github_workflow_rerun_failed_ci','github_workflow_review_threads','github_workflow_open_pr','github_workflow_merge_when_green',
          'github_workflow_merge_stack'].includes(tool.name)){
        const delegates=tool.delegatedWrites;
        const p=tool.inputSchema?.properties;
        const isOpen=tool.name==='github_workflow_open_pr';
        const isReview=tool.name==='github_workflow_review_threads';
        const isRetry=tool.name==='github_workflow_rerun_failed_ci';
        if((isReview&&(!sameSet(delegates??[],['github_review_reply','github_review_resolve_thread'])||!p?.planKey||!p?.expectedHeadSha||tool.boundsResult!==true))||
          (isRetry&&(!sameSet(delegates??[],['github_actions_rerun'])||!p?.expectedHeadSha||tool.boundsResult!==true)))
          failures.push(tool.name+': workflow must retain its exact delegates, pinned head and bounded result contract.');
        if(!Array.isArray(delegates)||!delegates.length||
          delegates.some(name=>known.get(name)?.writeContract!=='defineWrite-v1')||
          !p?.confirm||!p?.dryRun||tool.annotations?.readOnlyHint!==false||
          tool.annotations?.destructiveHint!==true||
          !sameSet(tool.profiles??[],isReview?['read_only','everyday','full']:['everyday','full'])||
          row.profile!=='E'||!((isOpen||isReview)?(safety?.preview&&safety?.notifies&&
            safety?.prod==='never'):((isRetry?safety?.preview:safety?.confirmAlways)&&safety?.prod===(isRetry?'never':'when-target'))))
          failures.push(tool.name+': composed workflow must delegate to guarded writers and match its exact catalog safety.');
        continue;
      }
      if(tool.passthrough===true&&tool.usesRegistry===true&&
        ['github_workflow_release','github_workflow_cleanup_branches'].includes(tool.name)){
        const release=tool.name==='github_workflow_release',p=tool.inputSchema?.properties;
        if(!sameSet(tool.delegatedWrites??[],release?['github_release_create','github_release_update']:['github_branch_delete'])||
          tool.delegatedWrites.some(name=>known.get(name)?.writeContract!=='defineWrite-v1')||
          !p?.confirm||!p?.dryRun||!p?.requestKey||tool.boundsResult!==true||
          tool.annotations?.readOnlyHint!==false||tool.annotations?.destructiveHint!==true||
          !sameSet(tool.profiles??[],release?['full']:['everyday','full'])||
          row.profile!==(release?'F':'E')||!safety?.confirmAlways||safety?.prod!==(release?'always':'never')||
          (release&&!safety?.notifies))failures.push(tool.name+': maintenance workflow must retain guarded delegates, approval and exact catalog safety.');
        continue;
      }
      if(tool.name==='github_workflow_new_repo'&&tool.usesRegistry===true&&tool.passthrough===true){
        const p=tool.inputSchema?.properties;
        const expected=['github_repo_create','github_repo_update_settings','github_ruleset_save','github_label_save','github_env_save','github_security_set_feature','github_branch_create','github_repo_set_default_branch','github_repo_set_vulnerability_alerts','github_actions_set_settings'];
        if(!sameSet(tool.delegatedWrites??[],expected)||tool.delegatedWrites.some(n=>known.get(n)?.writeContract!=='defineWrite-v1')||
          !p?.confirm||!p?.dryRun||!p?.requestKey||tool.boundsResult!==true||tool.annotations?.readOnlyHint!==false||
          !sameSet(tool.profiles??[],['full'])||row.profile!=='F'||!safety?.confirmAlways||!safety?.access||safety.prod!=='never')
          failures.push(tool.name+': new repository composition must preserve exact guarded writers, full profile, bounded results and explicit approval.');
        continue;
      }
      if (safety && !safety.read) failures.push(`${tool.name}: the catalog says it changes things (${row.safety}) but the tool is read-only`);
      continue;
    }
    const p = tool.inputSchema?.properties;
    if (!p?.dryRun || !p?.confirm) failures.push(`${tool.name}: write tool without dryRun/confirm inputs`);
    if (!tool.writeContract) failures.push(`${tool.name}: write tool without a declared write contract (defineWrite)`);
    const d = tool.declarations;
    if (!d || typeof d !== 'object') { failures.push(`${tool.name}: write tool without declarations`); continue; }
    if (d.spend && !tool.priced) failures.push(`${tool.name}: spend tool without a price function`);
    if (!row || !safety) continue;
    if (safety.read) { failures.push(`${tool.name}: the catalog says read-only (—) but the tool is a write tool`); continue; }
    if (d.production !== safety.prod) failures.push(`${tool.name}: production is "${d.production}" but the catalog says "${safety.prod}" (${row.safety})`);
    if (!!d.accessWidening !== safety.access) failures.push(`${tool.name}: accessWidening is ${!!d.accessWidening} but the catalog says ${safety.access} (${row.safety})`);
    if (!!d.notifies !== safety.notifies) failures.push(`${tool.name}: notifies is ${!!d.notifies} but the catalog says ${safety.notifies} (${row.safety})`);
    if (!!d.spend !== safety.spend) failures.push(`${tool.name}: spend is ${!!d.spend} but the catalog says ${safety.spend} (${row.safety})`);
    if ((d.confirm === 'always') !== safety.confirmAlways) failures.push(`${tool.name}: confirm is "${d.confirm}" but the catalog says ${safety.confirmAlways ? 'always needs confirm (C)' : 'preview only (P)'}`);
    if (d.cred !== row.cred) failures.push(`${tool.name}: credential is "${d.cred}" but the catalog says "${row.cred}"`);
    const wanted = row.profile === 'F' ? ['full'] : row.profile === 'E' ? ['everyday', 'full'] : null;
    if (!wanted) failures.push(`${tool.name}: the catalog profile "${row.profile}" is not valid for a write tool (use E or F)`);
    else if (!sameSet(d.profiles ?? [], wanted)) failures.push(`${tool.name}: profiles are ${JSON.stringify(d.profiles)} but the catalog says ${row.profile} (${wanted.join(', ')})`);
  }
  return failures;
}

async function main() {
  const { registry } = await import('../src/tools/index.js');
  if (!registry.tools.length) {
    console.log('Write safety: 0 tools registered — nothing to check');
    return;
  }
  const catalog = parseCatalog(fs.readFileSync(path.join(ROOT, 'docs/TOOL-CATALOG.md'), 'utf8'));
  const failures = checkWrites(registry.tools, catalog);
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  } else console.log(`Write safety: ${registry.tools.length} tools checked against the catalog`);
}
if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) await main();
