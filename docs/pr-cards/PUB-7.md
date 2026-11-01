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
