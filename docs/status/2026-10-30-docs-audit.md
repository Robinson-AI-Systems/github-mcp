# 2026-10-30 — Documentation audit and streamlining

**Merged:** nothing yet (PR open from `ai/claude/docs-audit-20261030`).

**What changed:** every top-level doc was checked against the code (498 tools, 44 sections, per `scripts/count-catalog.py`).
Stale or duplicated text was removed; the full old text of the big pages is in `docs/archive/*-2026-10-30-*.md`.
Start-to-merge directions were shortened (`AGENTS.md`, `docs/SESSION-START.md`, `docs/PLAYBOOK.md`) without removing any rule.

**Needs Chris (not blocking):**
- `src/oauth/policy.js` still refuses Production mode, which conflicts with the 2026-10-27 owner decision.
- `src/brand/home-page.js` line 30 makes a phone-add claim to confirm.
- `docs/APP-NEEDS-APPLIANCE-DESK.md` points to a missing `docs/runbooks/SANDBOX-PUBLISH.md`.
- `GITHUB_PUBLIC_CONNECT` in production is unverified.

**Next:** merge once `ci` and `release-policy` are green at the exact head.
