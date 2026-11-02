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
