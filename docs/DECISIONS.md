# DECISIONS — current decisions

One line per decision that still governs work. Full reasoning, superseded decisions and the original dated entries (63 of them,
2026-10-12 to 2026-10-28) are in [archive/DECISIONS-2026-10-30-history.md](archive/DECISIONS-2026-10-30-history.md), unchanged.
Add a new decision as a row here with a link to its status note or card; put long reasoning in the note, not here.
Where the archive disagrees with this table or [OWNER-DECISION-2026-10-27.md](OWNER-DECISION-2026-10-27.md), the table and that document win.

| Decision | Date | Reason (one line) | Detail |
|---|---|---|---|
| Backups and restore are optional future work, not a production gate | 2026-10-30 | Owner deferred them; data-preservation and cleanup safeguards stay binding | [note](status/2026-10-30-playground-provider-identity.md) |
| Playground may run in protected best-effort resource mode without verified quotas | 2026-10-30 | Owner allows production use before resource monitoring exists; allocation/identity/grant/attachment checks and network readback still required | [note](status/2026-10-30-playground-best-effort.md) |
| Execution fails closed on unverified converted Compose networks; public ingress goes through a separate gateway | 2026-10-30 | Provider adds shared networks to the executor; intended plan alone is not proof | [note](status/2026-10-30-playground-network-readback.md) |
| Provider-assigned names are read back, persisted and required for every mutation; lost creates recover by exact-name inventory | 2026-10-30 | Dokploy appends suffixes to appName | [note](status/2026-10-30-playground-provider-identity.md) |
| Coding workspaces target 8 vCPU / 8 GiB / 150 GB in isolated per-workspace environments (PAR-2 / PLAY-1) | 2026-10-29 | Owner-approved full coding workspace expansion | [PLAY-1](pr-cards/PLAY-1.md), [record](status/2026-10-29-coding-workspace-expansion.md) |
| No daily job quotas; native capacity is admitted by measured memory, storage and responsiveness | 2026-10-29 | Fixed counts were arbitrary limits | [note](status/2026-10-29-native-resource-admission.md) |
| Full owner writes disclose, execute, journal and verify in one call; only explicit delegated restrictions apply | 2026-10-28 | Product-user authority; no product-made approval or permission ceilings | [OWNER-DECISION](OWNER-DECISION-2026-10-27.md), [plan](designs/AUTHORITY-PARITY-2026-10-28.md) |
| Sequential write batching (`github_write_batch`) is composition, not new authority | 2026-10-27 | Delegates to ordinary guarded writers; read-only `github_batch` unchanged | archive: C-16 entries |
| Large JSON fields are carried once and never silently dropped; compact responses are defaults, not capability vetoes | 2026-10-27 | Agents need complete data | archive: 2026-10-27 entries |
| CI: 30-second soft target; passing slow tests never fail the run | 2026-10-27 | Fast feedback without false failures | [CI-FAST-1](pr-cards/CI-FAST-1.md) |
| Speed is built into the MCP (fast first view, whole-workflow critical path, one guarded writer) | 2026-10-26 | Do not depend on each agent's sophistication | [C-6](pr-cards/C-6.md) |
| Explicit, confirmed rule overrides are decided by GitHub, not refused by us; first-time fork CI approval belongs to the authorized owner | 2026-10-26 | Best-effort rule discovery is explanatory only | archive: 2026-10-26 entries |
| Outside contributor PRs are maintainer-owned; signed download redirect URLs are never model-visible | 2026-10-26 | Bearer-leak and adoption policy | archive: 2026-10-26 entries |
| Public free launch from Chris's website; no directory listing, no people cap | 2026-10-24 | Free for now; monetize later | [ROADMAP](ROADMAP.md) |
| God mode: one optional master token; "act as me"; owners/admins may override branch rules on purpose (`overrideRules` + reason) | 2026-10-24 | Owner design | archive: 2026-10-23/24 entries, [GOD-5](pr-cards/GOD-5.md) |
| The product does not control what users spend; honest cost notice and confirmation remain | 2026-10-24 | Users own their spend | archive: 2026-10-24 entries |
| Checks that need a paid upgrade are recorded unverified/dropped, never blockers | 2026-10-24 | Owner will not buy plans for tests | archive: 2026-10-24 entries |
| Public sign-in: changes on by default (read-only optional); per-person time zone (UTC default); people can delete their own data | 2026-10-23 | Owner decisions | archive: 2026-10-23 entries, [PUB-6](pr-cards/PUB-6.md) |
| Sign-in is GitHub once, one Approve page, no cookies, "My connection" page | 2026-10-23 | Prior flow broke repeatedly | archive: sign-in rebuild entry |
| The Hub owns discovery/connection to this product; Hub routes are not this product's completion gate | 2026-10-23 | Standalone completion | archive: 2026-10-19 entry |
| Real-device checks live in OWNER-CHECKLIST and never block development or merges | 2026-10-22 | Owner request | [OWNER-CHECKLIST](OWNER-CHECKLIST.md) |
| Instructions stay short (AGENTS.md simplified); per-PR status goes in `docs/status/` notes | 2026-10-22 | Long ledger caused merge conflicts and drag | [status README](status/README.md) |
| Maximum legitimate GitHub authority plan (CAP-1..CAP-5) approved | 2026-10-21 | Owner-requested capability expansion | [MAXIMUM-AUTHORITY](designs/MAXIMUM-AUTHORITY.md) |
| End-user authority supersedes developer-restriction readings; paid features are priced/confirmed, not refused | 2026-10-16 | Product user's agent must be able to act | [END-USER-AUTHORITY](END-USER-AUTHORITY.md) |
