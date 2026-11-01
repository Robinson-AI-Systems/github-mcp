# PUB-7 — Public-launch readiness report and draft trust pages (launch stays an owner decision)

## Owner approval 2026-11-01

Chris approved items 1–9 on 2026-11-01 with self-aware gates. Design and gates: [GATED-EXPANSION](../designs/GATED-EXPANSION-2026-11-01.md).

## Outcome and acceptance

Outcome: an owner readiness report evaluates each public-launch condition from evidence and says plainly what is missing; draft terms/privacy/security pages exist, labelled drafts for Chris and a lawyer. Never flips the public switch.

Accepted when the gate is implemented as code with tests for both the on and off decision, the feature works through every door it is offered on, and docs/TOOL-CATALOG.md describes it.

## Drift check

No gate raises spend, widens access or opens public sign-up by itself. Secrets never pass through a tool.

## Built 2026-11-01 (branch `ai/claude/pub-7-launch-readiness`)

- **Readiness report (the gate):** `github_launch_readiness` (owner only; public people, private tenants and passes are refused)
  and `npm run launch:readiness` (`-- --json`) share `src/launch/readiness.js`. Each of the eight rollout-plan conditions
  (docs/ROADMAP.md, 2026-10-23) is **met**, **not met** (agent work) or **needs owner** (only Chris), with the evidence used
  and the next step. Evidence: real code probes (sign-in, delete, limits, uninstall clean-up, cost estimate, a fake-secret
  webhook signature check), the acceptance block in `docs/STATUS.md`, `docs/developer-evidence.json`, the served trust pages
  and their `vercel.json` routes, `docs/launch/load-test-result.json`, `docs/launch/key-rotation.json` (each procedure file and
  rehearsal test name is checked to exist), the PUB-8 catalog rows plus registry, three owner checklist boxes and the switch
  names (fixed words, never values). Verdict "ready to propose opening" only when all eight are met. It never changes
  `GITHUB_PUBLIC_CONNECT` or any setting.
- **Trust pages:** the four existing pages (owner-approved 2026-10-25, `LEGAL_APPROVED=yes` in production) keep their text;
  when not approved they now say "DRAFT — not yet reviewed by a lawyer; not in effect." and hide their "Effective" line. New
  `/status` page (`docs/legal/STATUS-DRAFT.md` plus a "Right now" block from switch names) with its own approval
  `STATUS_PAGE_APPROVED=yes`; not linked from any page.
- **Load test:** `tests/load/public-load-run.js` shared by `npm run test:load` (writes `docs/launch/load-test-result.json`,
  numbers only) and a small smoke run in `tests/browser/launch-pages.test.js`. Local fake only; refuses any other origin.
- **Drift found:** the card says "draft legal pages"; on `main` they were already approved by Chris and live. They were not
  relabelled as not in effect in production (that would withdraw a live, approved privacy notice); the lawyer review became
  an owner row instead.

## Key rotation rehearsed 2026-11-01 (branch `ai/claude/key-rotation-rehearsal`)

- **Why:** the readiness report's "Key and secret safety" condition was not met: no rehearsed replacement for the tenant
  routing key or the App private key, client secret and webhook secret, and no written procedure for the three App ones.
- **Runbook:** [KEY-ROTATION](../KEY-ROTATION.md), one section per secret (what Chris does on GitHub or Vercel, what the
  server does, how to check, how to roll back, downtime). `docs/launch/key-rotation.json` now points every secret at it.
- **No-downtime code:** App secrets are replaced one at a time on the protected setup page (`replace-app-secret`, `undo-app-secret`,
  `finish-app-secret`). A typed private key is proved with GitHub (`GET /app` signed with it) and a typed client secret with
  an OAuth exchange of a made-up code before anything is saved; the webhook secret is server-generated and shown once. The
  replaced value is kept sealed for 24 hours in the new table `gh_app_previous_secrets` (Undo; webhook deliveries signed with
  it are still believed); Finish now ends that at once. The routing key accepts `GITHUB_TENANT_ROUTING_KEY_PREVIOUS` for
  checking only, until `GITHUB_TENANT_ROUTING_KEY_PREVIOUS_UNTIL` (at most 30 days ahead; anything doubtful means strict).
- **Rehearsals:** `tests/unit/key-rotation-rehearsal.test.js` (old works, both during the change, only new after; wrong values
  refused with nothing changed) against a fake GitHub that really checks RS256 signatures and client secrets; the store
  contract (fake and real Postgres) covers the new table. `readiness.js` only gained the two new evidence file paths.
- **Not agent work:** a real rotation on Chris's App is an optional owner checklist row.
