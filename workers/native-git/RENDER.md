# Render deployment: native Git worker only

This adds one HTTP Docker service and persistent disk. Existing MCP hosting remains on Vercel, tenant/workspace records remain on Neon, and Dokploy data is retained until the new host is accepted. The approved initial configuration is about $7.25/month: $7 compute plus a 1 GB provisioned disk, before taxes, usage overages or any existing workspace fees. The disk is for a small-repository trial, not fleet capacity. Do not enlarge resources or add databases/cache/workspace subscriptions implicitly.

## Apply the reviewed Blueprint

1. Use the owner-confirmed Render workspace. Create a Blueprint from `https://github.com/Robinson-AI-Systems/github-mcp`, Blueprint branch `main`, Blueprint Path `workers/native-git/render.yaml`. The service definition itself builds the checked `live` branch, with automatic application deploys off. Use the default onrender.com HTTPS hostname; no DNS change is required.
2. Review exactly one web service, `robinson-github-native-git`, Virginia, compute `0.5c-512mb`, one instance, and a 1 GB disk at `/data`. No other service or paid workspace upgrade should be included. Apply only the approved configuration. Render must accept the Blueprint/platform validation before a successful deployment is claimed.
3. The public verification key in the Blueprint was fetched from `https://github.robinsonaisystems.com/api/native-git-key`. Recheck it before applying if the MCP encryption/signing root was rotated. Never copy the MCP private key, encryption root, Neon URL or a standing GitHub token into Render.
4. Wait for the exact deploy to become live and inspect its Git commit and logs. Verify `/health` returns service `robinson-native-git`, protocol `2`; unsigned calls to `/v1/workspace` must fail. Confirm the disk is attached at `/data` and writable by the image's non-root user. A healthy HTTP endpoint alone does not prove storage persistence or Git operation acceptance.

## Connect and accept

After the public endpoint and exact source are verified, change only Vercel Production `NATIVE_GIT_WORKER_URL` to the Render HTTPS origin and use the repository's owner-authorized checked configuration release. Do not manually deploy another application branch or send credentials to an unverified origin. Require signed capabilities `ready=true`, then follow the disposable clone/edit/commit/push, provider readback, replay/denial/recovery and close tests in `docs/NATIVE-GIT-OPERATIONS.md`. Include a controlled service redeploy with a retained harmless workspace to verify disk persistence. Do not perform the persistence check during an active Git mutation.

Single-instance disk services have deployment interruptions and cannot share this disk across replicas. Keep manual deploys, one process owning the volume and one concurrent workspace for this small compute plan. Inspect resource metrics before considering an increase. On uncertainty, inspect state rather than blindly retry a push or operation. Keep the Dokploy volume until the new host and any migrated state are verified; changing the URL does not migrate files. The existing encrypted snapshot/volume procedures remain the migration path.

## Access and current status

The Render MCP connection can list services, create Docker services, inspect deploys/logs/metrics and set environment variables. It does not expose disk attachment or Blueprint creation. Dashboard setup is therefore required for this configuration unless an independently authorized API route becomes available. The current secure browser sign-in was declined; no browser authentication, service deployment, charge or MCP cutover is claimed. YAML syntax, documented field semantics and the current official Render JSON Schema have passed local validation. Render CLI/API platform validation and live acceptance remain pending.
