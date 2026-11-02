# 2026-11-01 — Direct downloads from native workspaces (GIT-DOWNLOAD-1)

**Problem (live feedback):** an outside agent had no bulk way to get code out of a native workspace and pulled 100+
files one at a time (`github_content_get_archive_link` withholds GitHub's token-bearing link; `read_file` is 32 KiB per
call).

**Built (PR #536, branch `ai/claude/direct-download`):** `github_git_workspace_download` — one call returns a one-time command in
`progress`: `git clone "<url>" repo` (local branches and tags, or one `ref`; `git fetch` works too) or
`curl -fsSL "<url>" -o repo.tar.gz && mkdir -p repo && tar -xzf repo.tar.gz -C repo` (a ref via `git archive`, or
`ref:"worktree"` for uncommitted files, never `.git`). The URL carries a signed `robinson-native-download/v1` capability
(never a GitHub credential), works for one session within 10 minutes and is returned once. Worker:
`workers/native-git/download.js`; protocol `verifyDownloadCapability`; signer `signNativeDownloadClaim`. Card:
[GIT-DOWNLOAD-1](../pr-cards/GIT-DOWNLOAD-1.md); how-to: [native operations](../NATIVE-GIT-OPERATIONS.md#direct-downloads).

**Verified (local, real Git):** real `git clone` returns the exact HEAD, branches and tags (fsck clean); one-ref clone
cannot reach unadvertised objects; `git fetch` into an existing clone; shallow workspace clone; second session 410;
expired/tampered/wrong-workspace/wrong-binding/upload-purpose/request-lease addresses refused both ways; push to a
download address refused; session grace window; over-cap clone and archive fail; archive equals `git archive` for HEAD,
a tag and a branch; worktree tar has uncommitted, untracked, long-name and in-tree-link entries but no `.git` or ignored
files; absolute, relative and `.git` link escapes and linked folders refused; outstanding cap, replay, sweep and close
cleanup; nine write-contract checks for both modes through handler, dispatch and `github_call`; command in `progress`;
no credential-shaped text in any result.

**Not done / next:** merged source ≠ deployed. The worker image must be rebuilt and redeployed on Dokploy (capabilities
then report `direct_download: "one-time-v1"`) and the MCP released before live use; then a live acceptance from an
outside machine (download → `git clone` / `curl` → compare HEAD) belongs in `docs/developer-evidence.json`.

**Live acceptance (2026-11-02 06:21 UTC, release `7f57eaf6`, worker redeployed):** from a GitHub-hosted runner in the
private scratch repository (outside this network), against a fresh `runtime: "none"` workspace of
`robinson-ai-scratch/upload-probe` at `92d4a1f`:
- archive mode: `curl … | tar` in 0.39 s, 4 files, no `.git`; the same URL a second time answered 410;
- git mode: `git clone` in 0.86 s, cloned HEAD `92d4a1f` exactly; a later request to the URL answered 403.
Untested: a workspace attached to a Playground runtime (refused by design; the message now names the `runtime: "none"`
route) and multi-hundred-megabyte repositories.

**Follow-up (ARCHIVE-ROUTE, same day):** `github_content_get_archive_link` still withholds GitHub's private-repo link
(it carries a temporary key). When it does, the result now includes `instead.steps`: open with `runtime: "none"`, then
`github_git_workspace_download` mode archive at the same ref.
