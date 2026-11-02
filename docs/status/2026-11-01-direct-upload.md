# 2026-11-01 — Direct uploads into native workspaces (GIT-UPLOAD-1)

**Problem (live):** an outside agent moved ~8 MB of images into a native workspace through `write_file`, ~1 MB per call.
Bytes went through Vercel (≈4.5 MB body cap) inside JSON.

**Built (branch `ai/claude/direct-upload`):** `github_git_workspace_upload` — `begin` returns a one-time, ten-minute URL
on the native worker that accepts one `git push` (into a separate quarantine repository) or one `curl --upload-file`
archive (.tar.gz/.tar/.zip); `apply` fast-forwards or extracts after safety, size and content-protection checks and
bumps the generation. The URL carries a signed, purpose-separated, single-use capability — never a GitHub credential —
and is returned once. Worker: `workers/native-git/upload.js`, `archive.js`; protocol `verifyUploadCapability`; signer
`signNativeUploadClaim`. Card: [GIT-UPLOAD-1](../pr-cards/GIT-UPLOAD-1.md); how-to:
[native operations](../NATIVE-GIT-OPERATIONS.md#direct-uploads).

**Verified:** real `git push` and `curl` against a local signed worker (happy paths, replay 410, expiry, tampering, wrong
workspace/mode, oversize, quarantine isolation, `.git` hook tree refused by fsck, non-fast-forward, secret in a deleted
intermediate commit, tar/zip traversal/absolute/symlink/hardlink/device/`.git`/bomb/lie/duplicate/clash/too-many
refusals, workspace symlink target, cleanup on sweep and close); nine write-contract checks for begin and apply through
handler, dispatch and `github_call`; no credential-shaped text in any result.

**Not done / next:** merged source ≠ deployed. The worker image must be rebuilt and redeployed on Dokploy (capabilities
then report `direct_upload: "quarantine-v1"`), and the MCP released, before live use; then a real acceptance (begin →
push/curl → apply → commit → push with GitHub readback) belongs in `docs/developer-evidence.json`. Traefik's entrypoint
read timeout (60 s default in v3) bounds one upload's duration; raise only if slow links need it.

## Release and first live check (2026-11-01, release 26643443)

Released and the native worker redeployed. First live `begin` (archive) on workspace `job_200b5ca76b02cdfc` returned
`applied` but a compact client dropped `result` (which holds the one-time command). Follow-up PR adds an always-visible
`progress` with the command and the apply summary, and marks GIT-UPLOAD-1 MERGED (#531) in the work index.

## Live acceptance passed (2026-11-02 ~05:20 UTC, release d887faaa)

Sender: a GitHub Actions runner in the private scratch repo `robinson-ai-scratch/upload-probe` (an outside machine;
the agent workspace and Playground runtimes cannot reach the worker origin by design). Target: Git-only workspace
`job_200b5ca76b02cdfc` on Robinson-AI-Systems/github-mcp (closed afterwards; nothing pushed to GitHub).

| Leg | Result | requestKey / run |
|---|---|---|
| begin archive | one-time `curl` command shown in `progress` | `upload-live-archive-begin-3` |
| upload ~8.2 MB tar.gz (10 × 800 KB files) | HTTP success | run 41393043347 |
| apply archive into `probe/` | `files_added: 10`, generation 0 → 1 | `upload-live-archive-apply-1` |
| reuse the same link | refused (curl exit 22) | run 41393261665 |
| begin git | one-time `git push` command shown | `upload-live-git-begin-1` |
| `git push` of a commit with 5 × 800 KB images | success | run 41393279757 |
| apply git | fast-forward to `8a1c2f9…`, `files_added: 5`, generation 1 → 2 | `upload-live-git-apply-1` |
| close workspace | `disposed: true` | `upload-live-target-close-1` |

Not yet live-tested: uploads over slow links near the Traefik 60 s read timeout; a zip archive; an empty-repo (unborn
HEAD) git upload.
