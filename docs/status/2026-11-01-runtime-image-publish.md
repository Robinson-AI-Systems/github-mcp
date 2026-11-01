# 2026-11-01 — Publish the Playground runtime image (owner-approved)

New workflow `.github/workflows/publish-runtime-image.yml` builds the production runtime image on each release to `live`
(or on demand), smoke-tests it as UID 1000 with no network, pushes `ghcr.io/robinson-ai-systems/github-mcp-runtime:<sha>`
with the built-in `GITHUB_TOKEN` only, and prints the digest to pin as `PLAYGROUND_IMAGE`. One owner click is needed once to
make the package public (owner checklist); until then runtimes keep building from source. Nothing is published by this PR
itself; the first run happens on the next release or a manual run.
