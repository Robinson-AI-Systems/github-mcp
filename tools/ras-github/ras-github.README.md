# ras-github 2.1 — verified content uploads and native synchronization

This is the corrected single-file Python CLI for the existing Robinson GitHub MCP connector. It uses the existing connector helper and saved sign-in. It never calls the official GitHub CLI or asks for a credential. Install after the atomic Git-data server release; version 2 refuses uploads against the older contract before sending files.

## Install on the fleet machine

The canonical files are now versioned at `tools/ras-github/` in Robinson-AI-Systems/github-mcp. Use a reviewed checkout and record its exact commit. The installer changes only the selected CLI file, checks installed bytes, and keeps a private rollback copy. It does not replace your connector client or saved sign-in. Python 3 and Git are the only requirements.

From the checked repository root:

```bash
python3 tools/ras-github/install.py --target /home/hatch/workspace/tools/ras-github
python3 /home/hatch/workspace/tools/ras-github --version
python3 /home/hatch/workspace/tools/ras-github doctor
python3 /home/hatch/workspace/tools/ras-github doctor --live
```

The historical connector client defaults to `~/workspace/custom-connectors/custom.github-mcp/bin/client.py`. If your agent environment keeps it elsewhere, set `RAS_GITHUB_CONNECTOR_HELPER` to that existing file before running the CLI. Never paste or copy its tokens. `doctor` checks local prerequisites without network calls; `doctor --live` performs read-only identity, upload-contract and native-worker capability calls through the saved connector. Native readiness is reported separately because API-only file publishing does not need a native worker. Ordinary commands retain the personal account default `christcr2012`; use explicit `--owner` for another account.

The installer prints the exact backup path if it replaces an older file. To restore that file, run the following with the printed path; rollback also preserves the current version:

```bash
python3 tools/ras-github/install.py --target /home/hatch/workspace/tools/ras-github --rollback PRINTED_BACKUP_PATH
```

Run `python3 -m unittest discover -s tools/ras-github -p 'test_*.py'` from the repository root. The suite uses disposable local repositories and fake connector processes. It verifies failed-batch exits, complete trees, copy preservation, conflict recovery, exact installation, rollback and saved-login preservation. The original external machine's installation and authenticated transport are separate acceptance, even after these tests pass.

## Uploads: complete delivery, honest history

Existing `push-branch --owner OWNER --repo REPO --branch TOPIC --source-dir DIR --base-ref origin/main --message MESSAGE` flags remain. This command publishes a **content snapshot**, not local commit history. It cannot preserve a local merge's parents or make local and remote commit SHAs equal. Its final output includes both SHAs and a full tree hash; a matching tree proves tracked paths, bytes and modes match, not commit-history equivalence.

The corrected server creates an absent remote branch from the explicit exact source commit resolved from `--base-ref`. Existing branches retain their own parent. Each request carries its independent file count. The helper negotiates the server's batch limit (at most 50 files), also respects the 1.5 MB per-file and 2 MB per-request byte limits, and discloses multiple commits before upload. Every batch must return confirmed file counts, a complete manifest and the independently observed new branch head. A later failed/unconfirmed batch exits nonzero immediately and identifies the partial progress. There is no rollback, blind retry or false all-files-success message. A final independent Git commit/tree read must equal the local full tree before success is printed.

If an upload stops, inspect the reported branch/intent and confirmed batches. Do not blindly repeat the command or claim success from exit output of an earlier version. Content-snapshot retries may be no-ops or need a reconciled remaining manifest. Unknown or missing readback stays a failure. Symlinks and submodules are refused rather than silently uploaded as ordinary files. Copies preserve their sources; only renames delete the old path.

## Synchronize with real merge ancestry

```bash
/home/hatch/workspace/tools/ras-github sync-branch \
  --owner OWNER --repo REPO --branch TOPIC --base main
```

This opens a fresh connection-bound native workspace on the remote topic, fetches, merges `origin/main` with real Git, and pushes under the original exact remote-head lease. An independent remote head must match before the owned workspace is closed. Conflicts/failures stop with a nonzero exit and retain the reported workspace ID for inspection and manual conflict recovery. No unresolved workspace is automatically discarded. This does not import unpublished local commits; use your own trusted authenticated Git transport for exact local graph transfer, or perform edits/commits in the native workspace.

Each agent gets its own native workspace. For all users, new workspaces use Dokploy with measured resource admission, no fixed request/workspace count and no daily job quota. One operation per workspace remains; the four-hour default inactivity window renews with authorized activity. Existing real repository permissions and branch rules remain effective.

## Ordinary commands and output

All prior commands remain, including search-tools, describe, call, whoami, repo-get, pr-list/get/status/create/merge, auto-merge, threads, ci, workflows, runs, dispatch, job-log, get-file, commit-list and branch-list. Run `--help` for flags. Only the stable gateways are called directly; other tools use github_call, so a growing catalog does not require a second per-tool allowlist.

Authorized owner writes execute in one call. An incomplete/failed preview, unconfirmed receipt, rejection or restricted-grant confirmation requirement never counts as success. `pr-merge` deliberately remains preview-only until `--confirm`; `--head` requires the full 40-character SHA. get-file requests fullText rather than the 4 KB preview; a retained-result handle remains explicit for large output, and `call github_get_result --args '{...}'` reads the remaining pages/windows.

CI depends on actual GitHub events, workflow subscriptions/filters and credential behavior. push-branch never silently dispatches a workflow or claims a push event occurred. `dispatch` remains an explicit operation. job-log defaults to a summary. After the matching complete-read server release, `job-log --job ID --full` starts a redacted character window; continue with `--offset NEXT_TEXT_OFFSET --hash LOG_HASH` until complete. A moving log refuses stale continuation. This is redacted text, not original byte-for-byte log export. Artifact entry byte windows are available through `call github_artifact_read` with artifactId/path/byteOffset/byteLength and expectedFileHash for continuation. Artifact reads retain their existing interface.

## Fixed and still needing live proof

Reproduced in the original wrapper: one 12-file batch delivered, subsequent unconfirmed batches ignored, exit 0 falsely claiming all 29 files; failed previews confirmed; copy source incorrectly deleted. The included regressions reject each behavior. Original helper-only direct-tool lists, duplicate preview writes and absent-branch pre-read have also been removed from the upload path.

Local/fake tests do not establish the actual fleet installation, client helper transport, live server rollout, 29-file provider delivery or push-event CI behavior. Keep those acceptance steps separate. Preserve existing sign-in, restricted grants, disk and worker settings.


## External agent acceptance procedure

Use only an exact disposable repository you create for this run under an authorized scratch account, and record its unique marker. Run the installed `doctor --live` first. Do not alter another agent's checkout or reconnect a working account. If the connector path or saved authorization is unavailable, report that exact prerequisite.

1. In a disposable local Git repository, create29 harmless tracked files, including a binary file and an executable. Commit them. Publish with explicit `--owner`, `--repo`, `--branch` and `--base-ref`; choose a destination branch that does not already exist. Success requires29 confirmed files and an equal complete remote tree, not just exit0 or matching a subset.
2. Make a separate harmless change on remote main, then run `sync-branch` on the run-owned topic. Independently verify the resulting remote head/parents and tree. Keep a conflict workspace for recovery; do not discard it or open a successor PR to hide a failure. Native sync preserves remote merge ancestry; snapshot publishing does not import unpublished local commits.
3. Inspect the repository's actual workflow event subscriptions and filters and runs at the exact pushed SHA. If the disposable repository has no workflows, record that fact rather than asserting CI failed or secretly dispatching one. An explicit `dispatch` remains separate and requires its own intended workflow.
4. Close only run-owned workspaces after verifying their pushed work. Read the repository's exact marker, delete that disposable repository, and independently confirm absence. Record installed version/source hash, commands without secrets, complete receipts, remote tree/head/parents and cleanup.

An offline/fake connector process test or another environment's custom-MCP test cannot certify installation on the external fleet machine.
