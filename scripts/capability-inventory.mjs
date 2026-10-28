// CAP-1: deterministic read-only CLI; never contacts a provider or changes state.
import {registry} from '../src/tools/index.js';
import {buildCapabilityInventory, validateCapabilityInventory} from '../src/github/capability-inventory.js';

export function printSummary(catalog, {maxFamilies = 80} = {}) {
  const s = catalog.summary;
  const lines = [
    'GitHub source-pinned capability inventory (NOT provider/live acceptance)',
    'Pinned REST 2026-03-10; GraphQL schema 2026-10-09; host and credential support remain per-operation.',
    'Operation keys: ' + s.totalOperations,
    'Implementation: ' + Object.entries(s.byState).map(([k,v]) => k + '=' + v).join(', '),
    'Unresolved credential decisions: ' + s.unknownCredentialDecisions,
    'Officially reviewed operation/credential decisions: ' + s.reviewedCredentialDecisions + ' (hand-reviewed); derived from official lists: ' + s.derivedCredentialDecisions,
    'Host/version applicability requiring verification: ' + s.unverifiedHostApplicability,
    'Operations with unresolved official-source conflicts: ' + s.unresolvedConflictRows,
    'Functional coverage percentage: NOT COMPUTED (no proven denominator/numerator).',
    'Family | operations | missing | implemented-unverified | verified | unresolved | retired | UI-only | universal-candidates | unknown-credentials | conflict-rows'
  ];
  for (const [family, f] of Object.entries(s.families).slice(0, maxFamilies))
    lines.push([family, f.total, f.byState.missing, f.byState['implemented-unverified'],
      f.byState.verified, f.byState.unresolved, f.byState['provider-retired'],
      f.byState['provider-UI-only'], f.universalCandidates, f.credentialUnknowns,
      f.unresolvedConflicts].join(' | '));
  return lines.join('\n') + '\n';
}

/** CAP-5: plain-English report. Every figure is "X of N" with its denominator; no bare percentage is ever printed. */
export function printReport(catalog) {
  const s = catalog.summary;
  const n = s.totalOperations;
  // Only rows WITHOUT a dedicated tool: a universal candidate that is also curated is counted as dedicated.
  const universal = catalog.operations.filter((o) => o.implementation.universalCandidate && o.state !== 'implemented-unverified').length;
  const of = (x) => x + ' of ' + n;
  return [
    'GitHub MCP capability report (source-pinned; NOT live acceptance)',
    'Denominator: ' + n + ' operations in the pinned GitHub REST 2026-03-10 and GraphQL schema 2026-10-09 sources.',
    '- Verified against a real account: ' + of(s.verifiedOperations),
    '- Dedicated tool exists, not yet verified live: ' + of(s.byState['implemented-unverified']),
    '- No dedicated tool; may be reachable through a universal tool where its policy allows: ' + of(universal) + ' (candidates, not proof)',
    '- GraphQL mutations with no write specification (not covered): ' + of(s.byState.missing),
    '- Not yet classified: ' + of(s.byState.unresolved),
    '- Provider-retired: ' + of(s.byState['provider-retired']) + '; provider-UI-only: ' + of(s.byState['provider-UI-only']),
    '- Legacy unsupported contracts (refused-by-design key retained; engineering backlog, not owner policy): ' + of(s.byState['refused-by-design']),
    '- Rows with unresolved official-source conflicts: ' + of(s.unresolvedConflictRows) + '; rows whose conflict has a written resolution: ' + of(s.resolvedConflictRows),
    '- Operations with at least one credential type decided from official evidence: ' + of(s.operationsWithADecision) + ' (what GitHub documents, not what a connection can do); individual credential decisions left unknown, each with its reason: ' + s.unknownCredentialDecisions,
    'Categories overlap (a row can be unclassified and a universal candidate), so they do not sum to the denominator.',
    'Coverage percentage: not stated; no proven numerator exists until live verification records rows as verified.'
  ].join('\n') + '\n';
}

function main(args) {
  if (args.length !== 1 || !['--summary','--validate','--json','--report'].includes(args[0])) {
    console.error('Usage: node scripts/capability-inventory.mjs --summary|--validate|--json|--report');
    process.exitCode = 2;
    return;
  }
  const inventory = buildCapabilityInventory({registryTools: registry.tools});
  const result = validateCapabilityInventory(inventory);
  if (args[0] === '--json') {
    process.stdout.write(JSON.stringify(inventory) + '\n');
  } else if (args[0] === '--report') {
    process.stdout.write(printReport(inventory));
  } else if (args[0] === '--summary') {
    process.stdout.write(printSummary(inventory));
  } else {
    process.stdout.write('CAP-1 inventory valid: ' + result.totalOperations +
      ' source operations reconciled; no provider or live operation was invoked.\n');
  }
}
if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href)
  main(process.argv.slice(2));
