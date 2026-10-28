# Repository scanner profiles and agent tuning

Implementation checkpoint: source under validation; do not assume a new tool is live until the dated release evidence records it.

## One compact front door

`github_secret_scanner` appears directly in the compact MCP tool list. It accepts `action` and `args`. Detailed schemas load only when requested, preserving the compact context budget. The assembled list measures **4,825/5,000 tokens**; no catalog page or global budget was enlarged.

| Action | What it does | Detailed schema |
| --- | --- | --- |
| `settings` | Read this repository's effective policy, revision, history and receipts | `github_security_scanner_get_settings` |
| `scan` | Scan selected committed files using that policy | `github_security_scan_files` |
| `preview` | Try candidate settings without saving; result identifies preview policy | `github_security_scan_files`, with `previewSettings` |
| `configure` | Save tested changes with an expected revision and reason | `github_security_scanner_configure` |
| `rollback` | Restore a retained revision with a fresh verification receipt | `github_security_scanner_configure`, with `rollbackRevision` |
| `offer` | Propose portable additional rules for another repository, without applying them | `github_security_scanner_get_settings`, with `targetRepo` |

Use `github_describe_tool` for a detailed schema, then call the direct gateway. The gateway also works through `github_call` for compatible existing clients. Every action re-enters the normal dispatcher; a read-only connection or restricted pass cannot use it to obtain owner configuration authority.

## Scope and defaults

A policy is keyed by tenant database, GitHub account **and repository**. `org/project-a` cannot alter `org/project-b`, another account, or another tenant. Ordinary nested/concurrent requests receive their own active project rules. The settings/control plane remains readable and correctable even if a custom rule is noisy.

Defaults include existing GitHub, RTC and private-key patterns; database connection URI passwords, semicolon/structured connection-string Password/Pwd fields and explicit database-password assignments; cloud secret assignments; 26 reviewed provider rules from the pinned MIT Gitleaks corpus; and a narrowed high-entropy credential-key assignment heuristic. See `vendor/gitleaks/SOURCE.md`. A match indicates a format, not a valid/live credential. Zero matches never certifies a repository clean. The Gitleaks CLI/history workflow and GitHub's provider engine remain separate alternatives.

Typed custom rules support a literal prefix, alphabet and length bounds, or a set of literal assignment-key names and a minimum literal length. Up to eight additional rules may be configured per repository. There is no arbitrary JavaScript or executable user-supplied regex. Do not paste a secret or raw finding into tool arguments, reasons or rule labels.

Project rules are used by committed-file reads, diagnostics and scanner results, and protect other explicitly repository-bound tool output. The signed native-worker protocol carries the current policy for native file reads, diagnostics and command output. Whole archives/snapshots and already-clipped excerpts remain conservative; an exact-file exception is not a global exemption for every occurrence of a value.

## Tighten freely; loosen with a receipt

The full ordinary connection owner can tune policy through the tool in one authorized call. Every mutation requires:

- `owner` (optional connected default), exact `repo`, and `expectedRevision` from `settings`;
- `changes` or `rollbackRevision`, exclusively;
- a reason, recorded with who/when in the policy and immutable change journal;
- `verification`: one or more pinned committed-file cases, described by path, blob SHA, rule, scan/file-read door and expected before/after detection. No source text or matched value is accepted.

Each changed custom rule needs a case proving its detection changed. Every added/removed suppression needs a case for that exact path/blob/rule. File-read exceptions also require that door and its fingerprint. All supplied cases run before activation, and again after reading the persisted revision. A failed expectation or irrelevant test does not activate the candidate. A post-write readback failure remains unconfirmed, never claimed as success. Stored receipts contain only file identity, rule, timing and observed booleans; no matching values or source snippets.

Use an existing pinned example or a harmless synthetic fixture. Never commit a real credential merely to make a test. Verification uses UTF-8 blobs up to 100 KB for scan cases and 1 MB for file-read cases. Diagnostics support rule filtering and findingOffset/maxFindings pagination; a fingerprint can select one file-read finding even in a file with many other matches. Use an isolated example when a file exceeds the relevant read limit.

Updates use atomic revision compare-and-set. A stale agent cannot overwrite another agent's settings. Retrying the same completed write replays its journal; it does not save again. The last ten prior settings revisions are retained for rollback, and revision zero always means built-in defaults. Rollback is itself journaled and re-tested; it does not silently restore obsolete authorization or another repository's policy.

## False-positive handling

First call `github_content_protection_check` for the exact file. It returns value-free rule/location fingerprints and the immutable blob identity. Inspect the location locally; a format match is not credential validity proof.

A reporting suppression requires an exact rule, literal relative path, immutable blob SHA and reason. No glob, repository-wide allowlist or built-in rule-class disable is supported. Suppressed findings remain counted in scanner metadata, and repository_clean remains null. Disabling is available only for a custom rule, with the same retest/receipt discipline.

If the owner determines that a specific finding is harmless, a suppression may additionally specify `fileReadException: true` and the diagnostic's exact `fingerprint`. This is a deliberate policy decision, not proof supplied by the detector. The server verifies the complete blob bytes before applying it. Full/byte reads become exact only when all remaining findings are either absent or explicitly excepted. One exception cannot conceal another finding; changed bytes, another path/repository, a wrong fingerprint or a reporting-only suppression do not obtain a byte-read bypass. There are at most 20 narrow suppressions per repository.

Use `fingerprint` in the corresponding file-read verification case so one false alarm can be tested independently of another finding in the file. Fingerprints hash only the blob identity and finding metadata, not the credential value. Exact-file allowances are request-local and only flow into verified contiguous views; ordinary previews/retained fragments may remain conservatively masked. Reassemble exact bytes using explicit full text or immutable byte windows when allowed.

## Profiles compound without contaminating projects

`offer` takes the source owner/repo and a destination `targetOwner`/`targetRepo`. It returns portable additional rules and a destination revision-bound proposal. It does not write anything. It does not copy file suppressions or output exceptions. Conflicting rule IDs stop the offer for explicit review.

The destination owner adopts the proposal only with a new reason and destination verification cases. Source behavior is evidence, not an automatic exemption or grant for the next project. The profile includes its source revision and fingerprint; the destination keeps independent revision history and receipts.

## Operational boundaries

Built-in output protections are not disabled by scanner reporting settings. Exact-file exceptions are the narrow explicit mechanism above. Real credentials still belong in protected setup, not agent context. No existing GitHub security setting, workflow, alert, credential or paid feature is changed by local scanner tuning. The native worker requires the scanner release's protocol-2 image; older workers fail closed rather than silently ignoring policy. Its separately recorded public-ingress problem is unchanged by this feature.
