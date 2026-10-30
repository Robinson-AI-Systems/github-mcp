# 2026-10-30 — Documentation audit and streamlining

**Merged:** this PR (#488) once `ci` and `release-policy` are green.

**What changed:** every top-level doc was checked against the code (498 tools, 44 sections, per `scripts/count-catalog.py`).
Stale or duplicated text was removed; the full old text of the big pages is in `docs/archive/*-2026-10-30-*.md`.
Start-to-merge directions were shortened (`AGENTS.md`, `docs/SESSION-START.md`, `docs/PLAYBOOK.md`) without removing any rule.

**Needs Chris (not blocking):**
- Done in this PR (Chris, 2026-10-30): Production is now the default sign-in mode on the production deployment and the per-account production switch no longer vetoes normal sign-in connections (`src/oauth/policy.js`, `src/tenancy/*`, `src/tools/production-guard.js`). Delegated passes keep their issuer's restriction.
- Done: home page now says Claude can add a connector from the phone app, and ChatGPT must be added in the phone's browser first (Chris, 2026-10-30).
- Resolved: the runbook lives in the Appliance Desk repository, not this one; the reference now says so.
- Checked: `GITHUB_PUBLIC_CONNECT=enabled`, `LEGAL_APPROVED=yes` and `PUBLIC_SUPPORT_EMAIL` are set in Vercel production (names and non-secret values only).

**Next:** merge once `ci` and `release-policy` are green at the exact head.
