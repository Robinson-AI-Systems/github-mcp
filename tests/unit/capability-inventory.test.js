import {describe, expect, it} from 'vitest';
import {registry} from '../../src/tools/index.js';
import {buildCapabilityInventory, sourceKeys, summarizeCapabilityInventory,
  validateCapabilityInventory, CREDENTIAL_KINDS, NON_SCHEMA_WORKFLOWS} from '../../src/github/capability-inventory.js';
import {reviewedRestEvidence} from '../../src/github/capability-evidence.js';
import {restOperations} from '../../src/github/openapi-index.js';
import {githubGraphqlSchema} from '../../src/github/graphql-schema.js';
import {printSummary} from '../../scripts/capability-inventory.mjs';

const fakeSchema = {
  getQueryType: () => ({getFields: () => ({viewer: {
    name: 'viewer', type: 'User!', args: [], deprecationReason: null
  }})}),
  getMutationType: () => ({getFields: () => ({changeThing: {
    name: 'changeThing', type: 'ChangeThingPayload', args: [
      {name: 'input', type: 'ChangeThingInput!'}], deprecationReason: null
  }})})
};
const fakeRest = [{
  route: 'GET /user', method: 'GET', path: '/user', operationId: 'users-get-authenticated',
  category: 'users', summary: 'Get the authenticated user', deprecated: false, notifies: false
}, {
  route: 'GET /app', method: 'GET', path: '/app', operationId: 'apps-get-authenticated',
  category: 'apps', summary: 'Get the authenticated app', deprecated: false, notifies: false
}];
function fixture() {
  const options = {rest: fakeRest, schema: fakeSchema,
    workflows: NON_SCHEMA_WORKFLOWS.slice(0, 2), registryTools: registry.tools};
  return {options, result: buildCapabilityInventory(options)};
}
const get = (rows, prefix) => rows.find(x => x.key.startsWith(prefix));

describe('CAP-1 source inventory: no fabricated functional coverage', () => {
  it('enumerates each unique pinned REST method/path, GraphQL root field and independent transport workflow', () => {
    const inventory = buildCapabilityInventory({registryTools: registry.tools});
    const expected = sourceKeys({rest: restOperations(), schema: githubGraphqlSchema()});
    expect(restOperations()).toHaveLength(1232);
    expect(inventory.operations).toHaveLength(expected.length);
    expect(new Set(expected).size).toBe(expected.length);
    expect(new Set(inventory.operations.map(x => x.key)).size).toBe(expected.length);
    expect(validateCapabilityInventory(inventory).totalOperations).toBe(expected.length);
    expect(inventory.summary.coverageRatio).toBeNull();
    expect(inventory.summary.verifiedOperations).toBe(0);
  });

  it('does not convert universal finder visibility or unreviewed credentials into capability', () => {
    const {result} = fixture();
    const whoami = get(result.operations, 'rest:github.com@2026-03-10:GET /user');
    const app = get(result.operations, 'rest:github.com@2026-03-10:GET /app');
    const gql = get(result.operations, 'graphql:github.com@');
    expect(whoami.implementation.route).toBe('universal-candidate');
    expect(whoami.state).toBe('unresolved');
    expect(app.implementation.universalCandidate).toBe(false);
    expect(app.state).toBe('unresolved');
    expect(whoami.credentialSupport.app_user.disposition).toBe('supported');
    expect(CREDENTIAL_KINDS).toHaveLength(8);
    expect(whoami.credentialSupport.app_installation.disposition).toBe('unsupported');
    expect(whoami.credentialSupport.workflow_token.disposition).toBe('unknown');
    expect(result.operations.filter(x => x.interface === 'graphql')).toHaveLength(2);
    expect(gql.credentialSupport.app_jwt.disposition).toBe('unsupported');
    expect(gql.credentialSupport.app_jwt.evidence).toContain('github.com');
  });

  it('does not infer GHE.com or GHES host parity from a GitHub.com schema', () => {
    const {result} = fixture();
    for (const row of result.operations) {
      expect(row.hostApplicability.map(x => x.host)).toEqual(['github.com','ghe.com','ghes','ghes']);
      expect(row.hostApplicability[0].disposition).toBe(row.interface === 'rest' || row.interface === 'graphql' ? 'source-pinned' : 'official-reference-only');
      expect(row.hostApplicability.slice(1).map(x => x.disposition)).toEqual(['unknown','unknown','unknown']);
      expect(new Set(row.hostApplicability.map(x => x.key)).size).toBe(4);
    }
  });

  it('rejects an orphan annotation, duplicate source operation and an unsupported fake credential', () => {
    const {options} = fixture();
    expect(() => buildCapabilityInventory({...options,
      annotations: [{key:'rest:github.com@2026-03-10:GET /absent',
        credential:'app_user', disposition:'supported', evidence:'https://docs.github.com'}]
    })).toThrow(/Orphan/);
    expect(() => buildCapabilityInventory({...options, rest: [...fakeRest, fakeRest[0]]}))
      .toThrow(/Duplicate/);
    expect(() => buildCapabilityInventory({...options, annotations: [{
      key: 'rest:github.com@2026-03-10:GET /user', credential: 'magic',
      disposition:'supported', evidence:'https://docs.github.com'}]
    })).toThrow(/Unknown credential/);
  });

  it('refuses duplicate, missing and fabricated verified rows and family summary tampering', () => {
    const {options,result} = fixture();
    const mutate = (cb) => {
      const c = structuredClone(result); cb(c);
      return () => validateCapabilityInventory(c, options);
    };
    expect(mutate(c => c.operations.push(structuredClone(c.operations[0])))).toThrow(/Duplicate/);
    expect(mutate(c => c.operations.pop())).toThrow(/Missing source/);
    expect(mutate(c => c.operations[0].state = 'verified')).toThrow(/False verified/);
    expect(mutate(c => c.operations[0].credentialSupport.app_jwt = null)).toThrow(/Incomplete credential/);
    expect(mutate(c => c.operations[0].hostApplicability.pop())).toThrow(/Incomplete host/);
    expect(mutate(c => c.summary.totalOperations += 1)).toThrow(/summary/);
  });

  it('keeps the unresolved enterprise-audit conflict visible and records the Packages conflict as resolved by the per-operation lists', () => {
    const rest = [
      {route: 'GET /enterprises/{enterprise}/audit-log', method: 'GET',
        path: '/enterprises/{enterprise}/audit-log', category: 'enterprise-admin',
        operationId: 'enterprise-admin-get-audit-log'},
      {route: 'GET /orgs/{org}/packages', method: 'GET',
        path: '/orgs/{org}/packages', category: 'packages',
        operationId: 'packages-list-packages-for-organization'}
    ];
    const options = {...fixture().options, rest};
    const inventory = buildCapabilityInventory(options);
    const audit = get(inventory.operations, 'rest:github.com@2026-03-10:GET /enterprises/');
    const packages = get(inventory.operations, 'rest:github.com@2026-03-10:GET /orgs/');
    expect(audit.evidence.conflicts[0].id).toBe('enterprise-audit-token-contradiction');
    expect(packages.evidence.conflicts[0].id).toBe('packages-rest-token-contradiction');
    expect(packages.evidence.conflicts[0].status).toBe('resolved');
    expect(packages.evidence.conflicts[0].resolution).toContain('per-operation statements win');
    expect(inventory.summary.unresolvedConflictRows).toBe(1);
    expect(audit.credentialSupport.app_user.disposition).toBe('unknown');
    expect(packages.credentialSupport.app_installation.disposition).toBe('supported');
    expect(validateCapabilityInventory(inventory, options).unresolvedConflictRows).toBe(1);
    const amended = structuredClone(inventory);
    get(amended.operations, 'rest:github.com@2026-03-10:GET /orgs/').evidence.conflicts = [];
    expect(() => validateCapabilityInventory(amended, options)).toThrow(/Missing official credential conflict/);
    const promoted = structuredClone(inventory);
    get(promoted.operations, 'rest:github.com@2026-03-10:GET /enterprises/').credentialSupport.app_user = {
      disposition: 'supported', evidence: 'https://docs.github.com/en/rest/enterprise-admin/audit-log',
      permissions: ['enterprise_administration:read'], scopes: null
    };
    expect(() => validateCapabilityInventory(promoted, options)).toThrow(/conflict cannot prove support/);
    expect(() => buildCapabilityInventory({...options, annotations: [{
      key: audit.key, credential: 'app_user', disposition: 'supported',
      evidence: 'https://docs.github.com/en/rest/enterprise-admin/audit-log'
    }]})).toThrow(/Unresolved credential conflict/);
    expect(printSummary(inventory)).toContain('Operations with unresolved official-source conflicts: 1');
  });

  it('records operation-specific official credential rights without suggesting a live connection has them', () => {
    const rest = [
      {route:'GET /user', method:'GET', path:'/user', category:'users'},
      {route:'PATCH /user', method:'PATCH', path:'/user', category:'users'},
      {route:'GET /app', method:'GET', path:'/app', category:'apps'},
      {route:'GET /repos/{owner}/{repo}', method:'GET',
        path:'/repos/{owner}/{repo}', category:'repos'}
    ];
    const options = {...fixture().options, rest};
    const inv = buildCapabilityInventory(options);
    expect(validateCapabilityInventory(inv, options).reviewedCredentialDecisions).toBe(15);
    expect(get(inv.operations,'rest:github.com@2026-03-10:GET /app')
      .credentialSupport.app_jwt.disposition).toBe('supported');
    expect(get(inv.operations,'rest:github.com@2026-03-10:GET /repos/')
      .credentialSupport.app_installation.permissions).toEqual(['repository:metadata:read']);
    expect(get(inv.operations,'rest:github.com@2026-03-10:PATCH /user')
      .credentialSupport.app_installation.disposition).toBe('unsupported');
    expect(get(inv.operations,'rest:github.com@2026-03-10:GET /user')
      .credentialSupport.oauth_app.scopes).toEqual(['read:user','user']);
    expect(reviewedRestEvidence('GET /other')).toBeNull();
    const altered = structuredClone(inv);
    get(altered.operations,'rest:github.com@2026-03-10:GET /app')
      .credentialSupport.app_jwt.disposition = 'unknown';
    expect(() => validateCapabilityInventory(altered, options))
      .toThrow(/altered reviewed credential/);
    expect(() => buildCapabilityInventory({...options, annotations:[{
      key:'rest:github.com@2026-03-10:GET /app', credential:'app_jwt',
      disposition:'unsupported', evidence:'https://docs.github.com/en/rest/apps/apps'
    }]})).toThrow(/cannot be overridden/);
    expect(inv.summary.verifiedOperations).toBe(0);
    expect(printSummary(inv)).toContain('Officially reviewed operation/credential decisions: 15');
  });

  it('reports exact family sums and credential unknowns without a misleading percentage', () => {
    const {result} = fixture();
    const summary = summarizeCapabilityInventory(result.operations);
    expect(Object.values(summary.families).reduce((n,f)=>n+f.total,0)).toBe(summary.totalOperations);
    expect(summary.unknownCredentialDecisions).toBeGreaterThan(0);
    expect(printSummary(result)).toContain('Functional coverage percentage: NOT COMPUTED');
    expect(printSummary(result)).toContain('git-transport |');
    expect(printSummary(result)).not.toMatch(/\d+(?:\.\d+)?%/);
  });

  it('records a reviewed credential disposition but never expands an actual user grant', () => {
    const {options} = fixture();
    const key = 'rest:github.com@2026-03-10:GET /user';
    const inventory = buildCapabilityInventory({...options, annotations: [{
      key, credential:'app_user', disposition:'supported',
      evidence:'https://docs.github.com/en/rest/users/users#get-the-authenticated-user',
      permissions: [], scopes: null
    }]});
    expect(get(inventory.operations, key).credentialSupport.app_user.disposition).toBe('supported');
    expect(get(inventory.operations, key).state).toBe('unresolved');
    expect(validateCapabilityInventory(inventory, options).verifiedOperations).toBe(0);
  });
});

describe('CAP-5 capability report', () => {
  it('states every figure with its denominator and never a bare percentage', async () => {
    const {printReport} = await import('../../scripts/capability-inventory.mjs');
    const {registry} = await import('../../src/tools/index.js');
    const {buildCapabilityInventory} = await import('../../src/github/capability-inventory.js');
    const inv = buildCapabilityInventory({registryTools: registry.tools});
    const text = printReport(inv);
    expect(text).toContain('Denominator: ' + inv.summary.totalOperations + ' operations');
    expect(text).toContain('Verified against a real account: ' + inv.summary.verifiedOperations + ' of ' + inv.summary.totalOperations);
    expect(text).not.toMatch(/\d\s?%/);
    const noDedicated = inv.operations.filter((o) => o.implementation.universalCandidate && o.state !== 'implemented-unverified').length;
    expect(text).toContain('universal tool where its policy allows: ' + noDedicated + ' of');
    expect(inv.operations.some((o) => o.implementation.universalCandidate && o.state === 'implemented-unverified')).toBe(true);
    const changed = structuredClone(inv);
    changed.summary.verifiedOperations = 7;
    expect(printReport(changed)).toContain('Verified against a real account: 7 of');
  });
});

it('legacy unsupported mutation inventory exposes engineering recovery rather than permanent owner-policy refusal', async () => {
  const inventory = buildCapabilityInventory({ registryTools: registry.tools });
  const pending = inventory.operations.filter(row => row.state === 'refused-by-design');
  expect(pending.length).toBeGreaterThan(0);
  for (const row of pending) {
    expect(row.implementation.reason).toContain('Missing verified ownership/readback contract');
    expect(row.delivery.nextAction).toContain('github_api_describe');
    expect(row.delivery.nextAction).not.toContain('None:');
  }
  const { printReport } = await import('../../scripts/capability-inventory.mjs');
  expect(printReport(inventory)).toContain('engineering backlog, not owner policy');
  expect(printReport(inventory)).not.toContain('Refused on purpose');
});
