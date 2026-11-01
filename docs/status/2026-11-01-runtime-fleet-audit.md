# 2026-11-01 — Native Git / Playground documentation audit, runtime sizing, fleet design

**Owner request:** audit the documentation against the code for the native Git system, workspaces and the Playground
runtime; improve the design so it can use more hosts (Dokploy, Chris's PC, tailnet devices) and give small projects small,
fast runtimes.

**Audit method:** three read-only reviews compared every concrete claim in NATIVE-GIT-OPERATIONS, the backup runbook,
RENDER.md, CODING-WORKSPACES, PLAYGROUND-OPERATIONS, TOOL-CATALOG, ARCHITECTURE, PLAY-2 and the device README with
`src/native-git`, `src/playground`, `src/tools`, `workers/*` and `tools/playground-device` (file:line evidence).

**Main corrections:**
- Native Git: no fixed request count exists (`max_concurrent:null`, resource-aware admission); "eight/four request"
  settings removed; Render docs said protocol 2 (now 3); Everyday profile cannot clone; reads also serialize per workspace;
  added limits table and a settings table (MCP vs worker); dated rollout history moved verbatim to
  [native Git history](2026-11-01-native-git-history.md).
- Playground: CODING-WORKSPACES said provisioning/attachment/preview/cleanup were incomplete — they are merged source
  (live acceptance still open); one volume → four; `best_effort` mode added; the runtime's "no dependency-download egress"
  message was wrong for `dedicated-ingress-v2` and is fixed in code; added settings table (admission thresholds, telemetry
  turning best-effort off, `PUBLIC_BASE_URL` fallback), lifecycle phases, 30 s manager sweep, heartbeat behaviour; fixed
  dozens of missing spaces ("The150GB"). Old page kept in [playground docs history](2026-11-01-playground-docs-history.md).
- PLAY-2 / device README: button label, both forwarded paths, generation always 1, five-minute ordering, pilot-only
  enrollment endpoint, Tailscale guidance.
- Catalog/architecture: playground read operations, provisioning wording, `/api/playground/enroll` route.

**Built (FLEET-1, source):** size classes small/medium/large and `runtime: none` Git-only workspaces; see
[card](../pr-cards/FLEET-1.md). Default behaviour unchanged until the operator sets `PLAYGROUND_DEFAULT_SIZE`.

**Designed, not built:** [RUNTIME-FLEET](../designs/RUNTIME-FLEET-2026-11-01.md) FLEET-2…6 (warm slim runtimes,
dial-out host agent for PC/tailnet, multi-pool scheduler, caches, several Git workers). Recorded in `docs/ROADMAP.md`;
decisions in `docs/OWNER-CHECKLIST.md`.

**Found, scheduled:** heartbeat stops a runtime on transient errors; 45 s clone watchdog; PLAY-2 enrollment index
overflow after 32 pairing attempts (fix in its own PR).

**Not claimed:** no release, deployment or live acceptance; PLAY-1 live acceptance still open.
- STATUS.md's 'PLAY-1 (the only IN_PROGRESS card' line is stale: PLAY-2 and now FLEET-1 are also IN_PROGRESS (left unedited per the rule not to rewrite the top of STATUS.md).
