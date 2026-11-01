# 2026-11-01 — Publish the Playground runtime image (owner-approved)

New workflow `.github/workflows/publish-runtime-image.yml` builds the production runtime image on each release to `live`
(or on demand), smoke-tests it as UID 1000 with no network, pushes `ghcr.io/robinson-ai-systems/github-mcp-runtime:<sha>`
with the built-in `GITHUB_TOKEN` only, and prints the digest to pin as `PLAYGROUND_IMAGE`. One owner click is needed once to
make the package public (owner checklist); until then runtimes keep building from source. Nothing is published by this PR
itself; the first run happens on the next release or a manual run.

**Update:** the first run built and smoke-tested the image but GitHub refused to create the organization package
("denied") because the image was not linked to the repository. The workflow now adds the
`org.opencontainers.image.source` label; a run from the fix branch then published
`ghcr.io/robinson-ai-systems/github-mcp-runtime` successfully (run 41311109459). The package is not yet public, so
`PLAYGROUND_IMAGE` is intentionally **not** set yet — setting it before the package is public would stop runtimes from
starting. After Chris makes it public (owner checklist), pin the digest printed by the next release's run.
