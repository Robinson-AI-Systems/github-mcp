import {contentProtectionReport} from '../github/content-protection.js';
import {SCANNER_SETTINGS_SCHEMA,defaultScannerSettings,scannerSettings,loadScannerPolicy,customScannerFindings,filterScannerFindings} from '../github/scanner-policy.js';
// PAR-2: bounded, on-demand review of ALREADY HOSTED GitHub files.
// No raw source code, secret value, snippet or token enters tool arguments or results.
// Not GitHub's proprietary remote-MCP run_secret_scanning: that has no public REST equivalent.
import { isUtf8 } from 'node:buffer';
import { defineRead } from './define-read.js';
import { readerFor, plain } from './github-read.js';
import { looksBinary } from './code-read.js';

const REPO = { type: 'string', minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9._-]+$' };
const OWNER = { type: 'string', minLength: 1, maxLength: 39 };
const REF = { type: 'string', minLength: 1, maxLength: 250 };
const MAX_FILES = 12;
const FILE_BYTES = 100_000;
const TOTAL_BYTES = 400_000;
const MAX_FINDINGS = 30;

// Intentionally narrow signatures. This is not a general-purpose secret detection engine.
// Do not add a rule that returns, captures or logs matched text.
const RULES = Object.freeze([
  { id: 'github_personal_access_token', label: 'GitHub personal access token',
    pattern: /(?:^|[^A-Za-z0-9_])(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{35,})/ },
  { id: 'github_oauth_or_app_token', label: 'GitHub OAuth, refresh or App token',
    pattern: /(?:^|[^A-Za-z0-9._-])gh[ousr]_[A-Za-z0-9._-]{36,}/ },
  { id: 'slack_api_token', label: 'Slack token',
    pattern: /(?:^|[^A-Za-z0-9_-])xox[baprs]-[A-Za-z0-9-]{20,}/ },
  { id: 'private_key', label: 'Private key block',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/ },
  { id: 'aws_access_key_id', label: 'AWS access-key identifier (check whether a secret is also exposed)',
    pattern: /(?:^|[^A-Z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?:$|[^A-Z0-9])/ },
  { id: 'aws_secret_key_assignment', label: 'Assigned AWS secret access key',
    pattern: /(?:AWS_SECRET_ACCESS_KEY|aws_secret_access_key)\s*[:=]\s*['"]?[A-Za-z0-9/+]{40}(?:['"]|\s|$)/ }
]);

export const SCAN_LIMITS = Object.freeze({ maxFiles: MAX_FILES, maxFileBytes: FILE_BYTES,
  maxTotalBytes: TOTAL_BYTES, maxFindings: MAX_FINDINGS });

/** Returns positions and generic remediation only — never matching bytes or neighboring text. */
export function detectCredentialPatterns(source, path, limit = MAX_FINDINGS, settings = defaultScannerSettings()) {
  if (typeof source !== 'string' || typeof path !== 'string')
    throw new TypeError('Scan requires text and an existing repository path.');
  const findings = [];
  const lines = source.split('\n');
  for (let line = 0; line < lines.length; line += 1) {
    for (const rule of RULES) {
      if (!rule.pattern.test(lines[line])) continue;
      findings.push({ path, line: line + 1, rule: rule.id, kind: rule.label,
        action: 'Remove the credential from the file and rotate or revoke it at its provider.' });
      if (findings.length >= limit) return { findings, capped: true };
    }
  }
  const shared=contentProtectionReport(source,{maxFindings:limit});
  for(const f of shared.findings){
    let id=f.rule;
    if(f.rule==='github-fine-grained-token')id='github_personal_access_token';
    if(f.rule==='github-token'){const at=Buffer.from(source).subarray(f.byte_offset,f.byte_offset+4).toString();id=at==='ghp_'?'github_personal_access_token':'github_oauth_or_app_token';}
    if(f.rule==='private-key')id='private_key';
    if(f.rule.startsWith('slack-'))id='slack_api_token';
    if(f.rule==='aws-access-token')id='aws_access_key_id';
    if(f.rule==='cloud-secret-assignment'&&/AWS_SECRET_ACCESS_KEY[\s"']*[:=][\s"']*$/.test(Buffer.from(source).subarray(Math.max(0,f.byte_offset-100),f.byte_offset).toString()))id='aws_secret_key_assignment';
    const prior=findings.find(x=>x.line===f.line&&x.rule===id);
    if(prior){prior.detector_rules=[...new Set([...(prior.detector_rules??[]),f.rule])];continue;}
    findings.push({path,line:f.line,rule:id,detector_rules:[f.rule],kind:f.description,byte_offset:f.byte_offset,byte_length:f.byte_length,action:'Review locally; remove and rotate or revoke exposed credentials.'});
  }
  findings.push(...customScannerFindings(source,path,settings));
  findings.sort((a,b)=>a.line-b.line);
  return {findings:findings.slice(0,limit),capped:shared.findings_truncated||findings.length>limit};
}

export function validScanPath(path) {
  return typeof path === 'string' && path.length > 0 && path.length <= 255 &&
    !path.startsWith('/') && !path.endsWith('/') && !/[\\\x00-\x1f\x7f?#%]/.test(path) &&
    path.split('/').every(x => x.length && x !== '.' && x !== '..');
}

export const securityScanFiles = defineRead({
  name: 'github_security_scan_files', area: 'security', audience: ['B', 'O', 'Op'],
  description: 'Scan selected committed GitHub files for common credential patterns; findings omit secrets. Not GitHub Secret Protection.',
  guidance: 'Supply 1-12 existing file paths in a connected repository, optionally at a ref. Scans only GitHub-hosted file versions, not uncommitted local edits. Uses bounded signatures, not the official run_secret_scanning engine; zero matches is NOT proof that a file has no secrets. No raw source or secret is returned or stored.',
  properties: {
    owner: OWNER, repo: REPO,
    paths: { type: 'array', minItems: 1, maxItems: MAX_FILES,
      items: { type: 'string', minLength: 1, maxLength: 255 } },
    ref: REF,
    previewSettings: SCANNER_SETTINGS_SCHEMA
  },
  required: ['repo', 'paths'],
  handler: (args, ctx) => plain(async () => {
    if (!Array.isArray(args.paths) || !args.paths.length || args.paths.length > MAX_FILES ||
        !args.paths.every(validScanPath) || new Set(args.paths).size !== args.paths.length)
      throw new TypeError('Use 1-12 distinct relative file paths with no traversal, URL or query syntax.');
    const { owner, octokit: gh } = await readerFor(args, ctx);
    const policy=await loadScannerPolicy(ctx.db,owner,args.repo);
    const settings=args.previewSettings===undefined?policy.settings:scannerSettings(args.previewSettings,policy.settings);
    let disabled=0,suppressed=0;
    const reviewed = [], skipped = [], findings = [];
    let totalBytes = 0, incomplete = false;
    for (const path of args.paths) {
      if (findings.length >= MAX_FINDINGS || totalBytes >= TOTAL_BYTES) {
        incomplete = true; skipped.push({ path, reason: 'scan_limit' }); continue;
      }
      let data;
      try {
        data = (await gh.request('GET /repos/{owner}/{repo}/contents/{path}',
          { owner, repo: args.repo, path, ...(args.ref ? { ref: args.ref } : {}) })).data;
      } catch (error) {
        if (error?.status === 404) {
          incomplete = true; skipped.push({ path, reason: 'missing_or_not_accessible' }); continue;
        }
        throw error; // credential or repository-level 403/401 fails the scan closed
      }
      if (!data || Array.isArray(data) || data.type !== 'file' ||
          data.encoding !== 'base64' || typeof data.content !== 'string' ||
          !Number.isSafeInteger(data.size) || data.size < 0) {
        incomplete = true; skipped.push({ path, reason: 'not_a_readable_file' }); continue;
      }
      if (data.size > FILE_BYTES || totalBytes + data.size > TOTAL_BYTES) {
        incomplete = true; skipped.push({ path, reason: 'size_limit' }); continue;
      }
      if (!/^[A-Za-z0-9+/=\s]*$/.test(data.content)) {
        incomplete = true; skipped.push({ path, reason: 'invalid_encoding' }); continue;
      }
      const bytes = Buffer.from(data.content, 'base64');
      if (bytes.length !== data.size || bytes.length > FILE_BYTES || totalBytes + bytes.length > TOTAL_BYTES ||
          looksBinary(bytes) || !isUtf8(bytes)) {
        incomplete = true; skipped.push({ path, reason: 'binary_or_invalid_text' }); continue;
      }
      totalBytes += bytes.length;
      const matched = detectCredentialPatterns(bytes.toString('utf8'), path,
        MAX_FINDINGS - findings.length,settings);
      reviewed.push({ path, bytes: bytes.length });
      const visible=filterScannerFindings(matched.findings,settings,path,data.sha);
      disabled+=visible.disabled;suppressed+=visible.suppressed;
      findings.push(...visible.findings);
      if (matched.capped) incomplete = true;
    }
    return {
      owner, repo: args.repo, ref: args.ref ?? 'default_branch',
      scanned_files: reviewed.length, scanned_bytes: totalBytes, reviewed,
      skipped, findings, finding_count: findings.length,
      complete: !incomplete && skipped.length === 0,
      setup_guidance: { tool: 'github_security_scan_guidance', arguments: { owner, repo: args.repo } },
      scanner_policy:{revision:policy.revision,source:args.previewSettings===undefined?'stored':'preview',disabled_rules:settings.disabledRules,custom_rule_ids:settings.additionalRules.map(r=>r.id),suppressed_findings:suppressed,disabled_findings:disabled,file_output_protection:'unchanged; always enforced'},
      engine: 'bounded_common_credential_patterns', provider_engine: false, repository_clean: null,
      provider_alerts: { tool: 'github_security_list_alerts', arguments: { owner, repo: args.repo, kind: 'secret' },
        note: 'Existing GitHub alerts are provider-backed; they are not a fresh scan of supplied content.' },
      note: 'Only selected GitHub-hosted files and a limited set of patterns were checked. No matches never guarantees safety. This is not GitHub\'s remote MCP secret scan or push protection. Findings do not create GitHub alerts.'
    };
  })
});


// The Robinson fallback is a repository-owned scan, with real provider settings
// and a concrete, inspectable workflow. It never pretends to be GitHub's
// proprietary fresh-content engine or to have installed anything.
export const securityScanGuidance = defineRead({
  name: 'github_security_scan_guidance', area: 'security', audience: ['B', 'O', 'Op'],
  description: 'Inspect secret protection settings and prepare repository scanning setup when fresh GitHub MCP engine parity is unavailable.',
  properties: { owner: OWNER, repo: REPO }, required: ['repo'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const { data } = await octokit.request('GET /repos/{owner}/{repo}', { owner, repo: args.repo });
    if (data.full_name?.toLowerCase() !== `${owner}/${args.repo}`.toLowerCase())
      throw new TypeError('GitHub did not return the requested repository identity.');
    const settings = data.security_and_analysis ?? {};
    return {
      owner, repo: args.repo, provider_engine_available_here: false,
      parity: 'repository_alternative', installed: false, repository_clean: null,
      observed: Object.fromEntries(['secret_scanning', 'secret_scanning_push_protection'].map(name =>
        [name, settings[name]?.status ?? 'not_returned_by_provider'])),
      native_setup: ['secret_scanning', 'secret_scanning_push_protection'].map(feature => ({
        tool: 'github_security_set_feature', arguments: { owner, repo: args.repo, feature, enabled: true }
      })),
      provider_alerts: { tool: 'github_security_list_alerts', arguments: { owner, repo: args.repo, kind: 'secret' } },
      official_engine: {
        url: 'https://api.githubcopilot.com/mcp/',
        headers: { 'X-MCP-Toolsets': 'secret_protection', 'X-MCP-Tools': 'run_secret_scanning' },
        steps: ['Connect GitHub remote MCP using your own GitHub authorization.',
          'Enable Secret Protection for the repository where required by GitHub.',
          'Ask run_secret_scanning to scan local files or staged changes before pushing.'],
        documentation: 'https://docs.github.com/en/code-security/how-tos/use-ghas-with-ai-coding-agents/scan-for-secrets-with-github-mcp-server'
      },
      robinson_alternative: {
        name: 'Robinson repository secret scan', engine: 'Gitleaks CLI',
        file: '.github/workflows/robinson-secret-scan.yml',
        workflow: repositoryScanWorkflow(),
        next: 'Review this workflow, commit it through the normal PR tools, run it, then require the robinson-secret-scan check in GitHub rulesets if desired.',
        local_commands: ['gitleaks dir . --redact=100 --exit-code=1', 'gitleaks git . --redact=100 --exit-code=1'],
        setup: 'Install the upstream open-source Gitleaks CLI for local commands. This CLI workflow does not use the separately licensed gitleaks-action.',
        coverage: 'CI scans fetched Git history; local dir scans working files, including uncommitted content. Rule-based detection is not GitHub engine equivalence or proof of absence.',
        source: 'https://github.com/gitleaks/gitleaks/tree/5f6ec56cfa6f8c67648d863582c7ae2f206d5c1c',
        cost: 'The scanner is open source. GitHub Actions runner minutes or GitHub Secret Protection may incur provider charges under your account plan.'
      },
      remediation: 'Rotate or revoke any exposed credential at its provider. Removing it from the current file does not remove it from Git history.',
      note: 'Guidance and generated configuration only; no setting, workflow or scan was changed or run.'
    };
  })
});

export function repositoryScanWorkflow() {
  return `name: Robinson secret scan
on:
  push:
  pull_request:
  workflow_dispatch:
permissions:
  contents: read
jobs:
  robinson-secret-scan:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@f548e57e544e1ff5a4c46bf1e1b8685f8e4a348a
        with:
          fetch-depth: 0
          persist-credentials: false
      - uses: actions/setup-go@90ad2b35f69faf97585ad74d28fa006d2739b7af
        with:
          go-version: '1.24.11'
          cache: false
      - name: Install pinned open-source scanner
        run: go install github.com/zricethezav/gitleaks/v8@5f6ec56cfa6f8c67648d863582c7ae2f206d5c1c
      - name: Scan history without printing secret values
        run: gitleaks git . --redact=100 --exit-code=1 --no-banner
`;
}

export const tools = [securityScanFiles.tool, securityScanGuidance.tool];
export const handlers = Object.fromEntries([securityScanFiles, securityScanGuidance].map(d => [d.tool.name, d.handler]));
