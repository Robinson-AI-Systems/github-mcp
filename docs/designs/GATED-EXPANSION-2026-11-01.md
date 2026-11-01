# Gated expansion (owner-approved 2026-11-01)

Chris, 2026-11-01 10:03 MDT: approved items 1–9 from the "remaining unapproved work" list: "I want everything built
that makes sense to build into the project but would like the system to be self aware on when to actually use the
things that are built", gated by the same reasons that held them back.

Rule for every piece: **built, tested and merged now; used only when its own gate says so.** A gate is code, not a
note: it reads measured facts (demand, host headroom, account features, readiness evidence), decides, and explains its
decision in plain words in the tool result or readiness report. No gate ever raises spend, widens access or opens the
service to the public by itself; those stay owner decisions, surfaced when the gate is met.

| Item | Card | Gate (when it is used) |
|---|---|---|
| 1 Slim runtime for small jobs | FLEET-2 | Size `small` **and** the repository shows no browser/database signals (Playwright/Puppeteer/Cypress, `pg`/Prisma/Postgres services, etc.). Otherwise the full image. Falls back to a source build when no slim image is published. |
| 2 Run-at-commit mode | FLEET-2 | Agent asks for a one-off command at a ref/SHA. Opens Git-only at that commit, provisions the smallest fitting size, runs, returns status/logs, disposes everything. |
| 3 Upsize hint | FLEET-2 | A command ends `SIGKILL` from the kernel OOM killer (not a cancel/timeout) → `reason: out_of_memory` + the next size up. |
| 4 Warm runtimes | FLEET-7 | Off unless measured demand (new allocations/hour over the last 24 h) and fresh host headroom both exceed stored, plainly explained thresholds; sized from demand; drains when demand drops. Never pre-binds a workspace's credentials. |
| 5 Single-container runtime | — | **Not built** (removes the isolation between executed code and the Git broker; no demand level justifies it). Owner may ask for an owner-only option later. |
| 6 Public-launch readiness | PUB-7 | A readiness report evaluates every launch condition (PLAY acceptance, legal/trust pages, load test, removal tools, key rotation rehearsal) from evidence; it never flips `GITHUB_PUBLIC_CONNECT`. Draft legal pages are labelled drafts for Chris + a lawyer. |
| 7 Remove a stranger's account/data by identity | PUB-8 | Owner-only; previewed, confirmed, journaled; available always. |
| 8 Fine-grained token tenants | PUB-9 | Offered only when a person enrolls a fine-grained token; tools unlocked are read from the token's actual permissions. |
| 9 Runners, merge queue, Copilot tools | CAP-6 | Listed only for accounts where the feature is present (discovered via the API); anything that spends is classified spend, shows the price and needs confirmation. |
