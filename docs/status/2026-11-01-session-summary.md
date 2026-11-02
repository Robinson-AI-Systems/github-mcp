# 2026-11-01 — Session summary (runtime fleet, gated expansion, live hardening)

**Merged and released (live at the newest manual release):** #501–#533 except docs-only follow-ups noted below. Highlights:
size classes and medium default; dial-out host agent; pools; caches; lean attachment; public runtime image published
per release and pinned automatically; gated expansion (slim image, run-at-commit, upsize hint, warm runtimes,
launch readiness, identity removal, fine-grained tokens, feature-gated runner/merge-queue/Copilot tools); key
rotation without downtime; direct upload (git push / archive) into native workspaces; many reliability fixes found by
live acceptance (attach, cleanup sweep, OOM isolation, replay state, run-tool resume, close readback).

**Live-verified today:** open/attach/execute/cancel/replay; PostgreSQL and browser suites in a runtime; OOM kill of a
command with the runtime surviving and an upsize hint; idle-expiry cleanup; stuck Oct 30–31 allocations cleared by
the fixed sweep; three parallel runtimes; run-at-commit end to end; direct upload (archive ~8 MB and git push) from an
outside machine with single-use refusal; an outside coding agent completed real work on neon-mcp.

**Not yet verified live (no blocker):** the last hop of the browser preview (cookie on the runtime host) — being run
from an outside runner; sustained load over a longer period and recovery after a deliberate worker restart (kept
gentle on the shared host); zip archive upload; runtimes on a person's own computer (needs Chris's PC join, owner
checklist); real-account checks for fine-grained tokens, paid feature tools and identity removal (owner checklist).

**Owner items (see OWNER-CHECKLIST):** lawyer review of legal pages; App settings check; real-phone check; optional PC
join; optional real-account checks. Nothing blocks development.
