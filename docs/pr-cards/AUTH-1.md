# AUTH-1 — finish the end-user authority audit (no developer-only limit leaks into the product)

**Batch FIN · Design:** `docs/END-USER-AUTHORITY.md` (binding owner decision 2026-10-16), section "Concrete code and
test audit (OPEN work)" items 1–6 · **Prerequisites:** none · **Effort:** medium (spend, production and guards; read
`docs/AI-PR-READ-FIRST.md`) · **Split:** PR A = audit report + spend/unknown-cost items; PR B = guide-only tools turned
into real tools where GitHub has an API.

## Outcome
A short audit report proves, item by item, that the product lets a properly delegated end user do every action GitHub
allows (paid, production, destructive, security) with honest warnings and the user's OWN optional caps — while the
building agents' $0/no-live-change rules stay in the repo process, not in the product. Every remaining gap is fixed or
listed with the exact GitHub reason.

## Drift check A
| Item in END-USER-AUTHORITY.md | How to check on main | Actual | Action |
|---|---|---|---|
| 1 spend-guard default $0 refuses everything | `grep -n "spend_limit\|0" src/tools/spend-guard.js \| head -40`; read the decision on `spend_limit_explicit` | | |
| 2 unknown/metered price refused | `grep -n "spendUnknown" src/core/write.js src/tools/*.js` | | |
| 3 universal paid routes blocked | `grep -n "spend" src/github/spend-classes.js \| head`; run `node -e` to list universal classifications with `refuse` | | |
| 4 Y-9d guided-only tools (hosted runners, agent tasks, Sponsors, Copilot) | `grep -ln "guided\|guide only\|website steps" src/tools/*.js` | | |
| 5 older areas (billing, Codespaces, security, owner admin, readback-only guides) | same grep + `docs/TOOL-CATALOG.md` rows marked "guide" | | |
| 6 tests proving both sides | `grep -ln "END-USER-AUTHORITY\|end user" tests/unit/*.js` | | |
Several items were partly fixed by later PRs (O-4/Y-9d corrections, `docs/pr-cards/END-USER-AUTHORITY-ROUTING.md`).
Record what is already true; only fix what is still wrong.

## PR A — audit report and money paths
1. Write `docs/audits/END-USER-AUTHORITY-2026-xx.md`: one table row per tool that can cost money or is production/
   destructive (filter the registry: `declarations.spend || declarations.production==='always' || cls.destructive`).
   Columns: tool, what GitHub allows, what our product does today (performs / previews only / guide only / refuses),
   reason, fix needed (yes/no). Generate the tool list with a small script under `scripts/` (read-only, prints JSON);
   fill the "today" column by reading each tool's handler and its tests.
2. For every "refuses only because of a developer rule" row: change the product rule to "warn + require confirm +
   respect the user's explicit cap (if set)". The building agents' $0 rule must stay enforced by process (they never set
   `confirm:true` on paid writes against real accounts) and by `docs/OWNER-CHECKLIST.md`, NOT by refusing users.
3. Tests per changed tool: (a) no explicit user cap + unknown price → preview shows "cost unknown, may keep charging"
   and real execution happens only with `confirm:true`; (b) explicit user cap smaller than the known price → refused;
   (c) a pass with `money_limit 0` → refused (user's chosen delegation control stays).

## PR B — guide-only tools that have a real API
For each row marked "guide only" where `node scripts/openapi-find.mjs` shows a real endpoint: implement the write with
`defineGithubWrite` (nine-check contract), keep the guide text as the preview explanation. Where GitHub has no API, keep
the guide and mark the row "provider UI only" in the audit and in `docs/TOOL-CATALOG.md`.

## Done when
- [x] Audit report merged (#354) with every row decided; END-USER-AUTHORITY.md "OPEN work" section updated to "done on
      <date> (PRs …)" item by item.
- [x] No tool needed to change; the three money tests now run over every money-capable tool (`tests/unit/end-user-authority.test.js`).
- [ ] ACC-1 row: one paid-capable tool previewed live on scratch showing the honest cost line (no real purchase).

## Progress
- Built as ONE PR (A and B together; the reason: B's only finding was a stale guide sentence, a sliver on its own). Audit report
  `docs/audits/END-USER-AUTHORITY-2026-10.md`, read-only script `scripts/authority-audit.mjs`, registry-wide test
  `tests/unit/end-user-authority.test.js`, dashboard-map correction (project workflows), catalog note (Marketplace purchase is provider UI only),
  END-USER-AUTHORITY.md OPEN section marked done item by item. No tool needed to change: the product already performed every item.
- The ACC-1 live row (one paid-capable tool previewed on scratch) stays for ACC-1.

## 2026-10-28 remediation — Drift check and current scope

The [authority/parity plan](../designs/AUTHORITY-PARITY-2026-10-28.md) supersedes older owner confirmation/cap/protection acceptance in this card. Reuse existing implementations; complete-read fallback, owner write authority and repository scan guidance are current work. Historical MERGED status does not certify this follow-up or deployed parity. Keep existing completion evidence unchanged; follow-up proof belongs in the dated remediation status.

### Owner setup transition, 2026-10-28

Continuation implements full-owner consent/callback/optional setup, public approval and connection views, authenticated secret entry and legacy connection-mode persistence without obsolete account production/scratch/protected-list vetoes. Explicit read-only/restricted profiles and issued passes remain binding; provider credential/activity, tenant/client binding, CSRF and readback remain. See `docs/status/2026-10-28-owner-setup-transition.md`; full exact-head CI and deployed acceptance remain separate.
