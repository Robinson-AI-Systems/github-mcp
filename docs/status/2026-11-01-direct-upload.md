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
