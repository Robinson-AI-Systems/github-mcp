# Complete diagnostic reads

Use search/describe/call as before. No new front-door catalog or required Hub connection is introduced. The additions below need the matching corrective release; source tests are not live proof.

| Existing tool | Complete retrieval or diagnostic contract |
| --- | --- |
| github_actions_get_job_log | Default summary is unchanged. fullText=true returns up to 4000 characters from textOffset, next_text_offset, complete and log_hash. Continue with expectedLogHash. Returned offsets are JavaScript string offsets; use them verbatim. |
| github_actions_get_run_logs_summary | Failed-job archive diagnosis falls back to the exact job log when names, error extraction or archive availability are insufficient. jobs_complete and logs_source/logs_readable prevent an empty partial read being mistaken for no failure. Each job includes full-log call guidance. |
| github_artifact_read | With an exact entry path, byteOffset/byteLength return up to 32768 raw bytes as content_base64. Continue with expectedFileHash from file_hash. The full extracted entry is checked before any window is returned. |
| github_content_read_archive | The same entry byte-window contract applies to a repository ZIP. Use a pinned ref and file_hash. This reads entries, not uninspected compressed ZIP bytes. |
| github_content_get_tree | offset plus expectedTreeSha continues beyond the 500-entry per-page maximum. Reuse returned sha as ref and expectedTreeSha, plus next_offset. Blob SHA and mode are included. A provider-truncated tree is incomplete, even on its final local page. |
| github_content_get | Existing fullText=true avoids the 4 KB preview limit. Existing blob-pinned byte windows remain available. Large results retain the documented same-connection handle, never an unmarked successful truncation. |
| github_pr_get / github_workflow_pr_status | merge_diagnostics reports actual strict-current-base policy, sources, current base SHA, whether the head contains it, and a named base-update blocker. Head CI green and mergeability are separate observations. |

Job-log windows are complete **redacted text**, with credential patterns and long encoded runs removed. They are not original log bytes. Hash changes stop continuation; restart from zero after a new attempt or changed redaction. Archives are scanned over the whole extracted entry before exact byte retrieval, so small safe-looking windows cannot reconstruct protected credentials. Binary entries remain metadata-only unless a byte window is explicitly requested. Existing ZIP limits and provider authorization apply.

A workflow run is not itself a required check result. Required checks are matched at the exact commit and required app; another app's same-name check explains a missing result rather than satisfying it. Incomplete bounded check inventories remain unknown. A newer queued check with no started_at cannot inherit an old green run. Strict current-base diagnostics do not add a server veto to ordinary owner merges: GitHub decides permission. Requested merge-when-green automation keeps its requested conditions.

## Alias compatibility

Where both names are not separately declared, the same normalization applies through direct tools and github_call:

| Canonical argument | Accepted aliases |
| --- | --- |
| runId | run_id |
| jobId | job_id |
| artifactId | artifact_id |
| max | limit |
| limit | max |
| PR number | pull_number, pr, issue_number |
| issue_number | number |
| github_branch_create from | fromRef |

Existing tool-specific aliases remain. Different values for any two names of one argument refuse before provider writes. Targets and immutable request keys use canonical arguments, so equivalent alias retries cannot send another write. Distinct declared arguments remain distinct; this does not guess unrelated CLI flags or convert a local snapshot base-ref into a remote PR base.

## Refusal and retry fields

Write guards include reason_code, retryable and no_change_sent. A preflight failure explicitly means this invocation sent no change. Known invalid input and delegated restrictions are not fixed by retrying unchanged arguments. Native busy responses name their reason and advise waiting, inspecting state and reusing the same intent. A post-send uncertain result has write_outcome_uncertain and retryable=false: inspect the journal, workspace and remote state before another intent. No client should interpret a warning-only unconfirmed receipt as success or silently issue a new write.
