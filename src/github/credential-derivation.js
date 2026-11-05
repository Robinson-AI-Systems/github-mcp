// INV-1: credential decisions derived, one operation at a time, from two official sources and nothing else:
//   1. GitHub's own published lists of which operations each token type can call (vendored, see vendor/github-app-permissions/SOURCE.md);
//   2. the operation's own text in the pinned REST description ("OAuth app tokens and personal access tokens (classic) need the `x` scope",
//      "You must use a JWT").
// Rules (never infer one credential from another; an honest unknown beats a wrong decision):
//   - Listed for a token type -> supported (with the listed permissions). The list is per operation and newer than the description's
//     `enabledForGitHubApps` flag, so where the flag says "not for Apps" but the list includes the operation, the list wins and both are noted.
//   - Not listed AND the description flag says not for Apps -> unsupported (two sources agree).
//   - Not listed but the description enables Apps -> unknown (sources disagree; recorded, decided only by live evidence).
//   - Classic token / OAuth app: supported only when the operation's own text names them; the matched sentence and scopes are kept.
//   - App JWT: only for /app and /app-manifests operations whose text says a JWT is required (every other token is then unsupported).
// Nothing here says a credential WORKS for a given person; it records what GitHub documents.
import { readFileSync } from 'node:fs';

const DATA = JSON.parse(readFileSync(new URL('../../vendor/github-app-permissions/fpt-2026-03-10.json', import.meta.url), 'utf8'));
export const PERMISSION_DATA_SOURCE = Object.freeze(DATA.source);
export const DERIVED_REVIEWED = '2026-10-24';
export const NO_EVIDENCE = 'no endpoint-specific authentication evidence';
const [I_URL, U_URL, F_URL] = DATA.source.officialPages;
const LISTS = Object.freeze([['i', 'app_installation', I_URL], ['u', 'app_user', U_URL], ['f', 'fine_grained_pat', F_URL]]);

const CLASSIC_SENTENCE = /[^.\n]*personal access tokens? \(classic\)[^.]*\./i;
const SCOPE_TOKEN = /`([a-z_:]+(?::[a-z_]+)?)`/g;

export function listedFor(route) { return Object.hasOwn(DATA.ops, route) ? DATA.ops[route] : {}; }
/** Every operation in the vendored lists ("METHOD /path/{param}"). PUB-9 matches a sent request against these. */
export function listedRoutes() { return Object.keys(DATA.ops); }
const unknown = (reason) => ({ disposition: 'unknown', evidence: null, permissions: null, scopes: null, reason });

/** @returns {{decisions: Record<string, object>, conflicts: object[]}} only the kinds it can decide; the rest keep their defaults */
export function deriveRestCredentials(op) {
  const text = String(op.operation?.description ?? '');
  const flag = op.operation?.['x-github']?.enabledForGitHubApps;
  const listed = listedFor(op.route);
  const decisions = {}, conflicts = [];
  const kindsDisagree = [], kindsKeptUnknown = [];

  const jwtOnly = /^\/app(-manifests)?(\/|$)/.test(op.path) && /\bJWT\b/.test(text);
  if (jwtOnly) {
    const sentence = /[^.\n]*\bJWT\b[^.\n]*\./.exec(text)?.[0]?.trim() ?? 'Requires a GitHub App JWT.';
    const base = { permissions: null, scopes: null, checked: DERIVED_REVIEWED, derived: true, basis: 'pinned-openapi-text', note: sentence };
    decisions.app_jwt = { ...base, disposition: 'supported', evidence: op.operation.externalDocs?.url ?? DATA.source.officialPages[0] };
    for (const kind of ['app_installation', 'app_user', 'fine_grained_pat', 'classic_pat', 'oauth_app'])
      decisions[kind] = { ...base, disposition: 'unsupported', evidence: decisions.app_jwt.evidence };
    return { decisions, conflicts };
  }

  for (const [key, kind, url] of LISTS) {
    if (listed[key]) {
      decisions[kind] = { disposition: 'supported', evidence: url, permissions: listed[key], scopes: null, checked: DERIVED_REVIEWED, derived: true,
        basis: 'github-docs-endpoint-list', note: 'Listed by GitHub for this token type' + (flag === false && key !== 'f' ? '; the pinned description flag says not enabled for GitHub Apps, the per-operation list is newer and wins' : '') };
      if (flag === false && key !== 'f') kindsDisagree.push(kind);
    } else if (key === 'f') {
      // The description flag is about GitHub Apps, not personal tokens, so the list alone decides for fine-grained tokens.
      decisions[kind] = { disposition: 'unsupported', evidence: url, permissions: null, scopes: null, checked: DERIVED_REVIEWED, derived: true,
        basis: 'github-docs-endpoint-list', note: 'Not in GitHub\'s list of operations available to fine-grained personal access tokens' };
    } else if (flag === false) {
      decisions[kind] = { disposition: 'unsupported', evidence: url, permissions: null, scopes: null, checked: DERIVED_REVIEWED, derived: true,
        basis: 'github-docs-endpoint-list+pinned-flag', note: 'Not in GitHub\'s list for this token type and the pinned description says the operation is not enabled for GitHub Apps' };
    } else {
      decisions[kind] = unknown('sources disagree: the pinned description enables GitHub Apps but GitHub\'s endpoint list for this token type omits the operation');
      kindsKeptUnknown.push(kind);
    }
  }

  const match = CLASSIC_SENTENCE.exec(text);
  if (match) {
    const sentence = match[0].trim();
    const scopes = [...sentence.matchAll(SCOPE_TOKEN)].map((m) => m[1]);
    const common = { disposition: 'supported', evidence: op.operation.externalDocs?.url ?? 'https://docs.github.com/en/rest', permissions: null,
      scopes: scopes.length ? scopes : null, checked: DERIVED_REVIEWED, derived: true, basis: 'pinned-openapi-text', note: sentence };
    decisions.classic_pat = { ...common };
    if (/\bOAuth\b/i.test(sentence)) decisions.oauth_app = { ...common };
  }
  if (kindsDisagree.length) conflicts.push({ id: 'description-flag-vs-endpoint-list', status: 'resolved', credentialKinds: kindsDisagree, officialUrl: I_URL,
    explanation: 'The pinned description marks this operation as not enabled for GitHub Apps, but GitHub\'s published endpoint list includes it.',
    resolution: 'The per-operation endpoint list (GitHub docs data, ' + DATA.source.committed.slice(0, 10) + ') is more specific and newer than the description flag, so the operation is recorded as supported for the listed token types. Both statements are kept here.' });
  if (kindsKeptUnknown.length) conflicts.push({ id: 'description-enables-apps-list-omits', status: 'resolved', credentialKinds: kindsKeptUnknown, officialUrl: I_URL,
    explanation: 'The pinned description enables GitHub Apps for this operation, but GitHub\'s published endpoint lists omit it (possibly newer than the lists).',
    resolution: 'Neither source is stronger, so the credential is kept unknown with the reason recorded. Only a live call can decide it.' });
  return { decisions, conflicts };
}

// M4 TRANCHE (CAP-7 follow-on, 2026-11-04): one credential kind decided end-to-end from GitHub's
// authentication contract. An SSH key authenticates Git transport only (clone/fetch/push over
// SSH); neither API admits it — the REST API's authentication reference accepts token credentials
// (Bearer, or Basic with a token), and GraphQL calls carry a token in the Authorization header.
// That is a transport-level fact about the credential kind itself, not an inference from one
// operation to another (the rule this module otherwise forbids), so it is recorded once here and
// applied to every REST and GraphQL row. It decides NOTHING for the census's Git-transport rows,
// where an SSH key is the credential in question, and nothing about any other kind.
const API_AUTH_PAGES = Object.freeze({
  rest: 'https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api',
  graphql: 'https://docs.github.com/en/graphql/guides/forming-calls'
});
export function transportCredentialDecisions(interfaceName) {
  const evidence = API_AUTH_PAGES[interfaceName];
  if (!evidence) return {};
  return { git_ssh: { disposition: 'unsupported', evidence, permissions: null, scopes: null,
    checked: '2026-11-04', derived: true, basis: 'github-authentication-contract',
    note: 'SSH keys authenticate Git transport only; this API\'s documented authentication accepts token credentials, and no operation in it accepts an SSH key.' } };
}
