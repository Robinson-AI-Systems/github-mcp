# Product authority specification

Current owner-approved requirements, incorporated 2026-10-28. This engineering specification supersedes conflicting older product restrictions. Original supplied review materials are not reproduced in the public repository.

## Scope and precedence

1. A user's current explicit instruction takes precedence over that same user's standing defaults.
2. A delegate remains subject to the restrictions its issuer deliberately selected. A delegate cannot claim its issuer's unrestricted authority.
3. GitHub determines the permissions and account/repository policies applicable to the actual provider credential. The server faithfully relays provider refusals and rate signals.
4. Builder operating rules govern implementation agents, never shipped product behavior. Developer no-spend/no-live-test and release discipline remain builder instructions.

## Product execution contract

Disclose the exact effect and known or unknown costs, execute under existing user authorization, journal with immutable replay protection, and independently verify the result. A preview may accompany execution in the same call; classification alone must not manufacture an additional confirmation or refusal on a full owner connection. Explicit dry runs remain available.

Remove duplicate owner policy for production enablement, server spending caps, notification audiences, protected resource lists, project-managed refs, default-branch deletion, mandatory green-check merges, rule-bypass prohibitions and fixed write pacing. GitHub's own repository/account settings remain effective. Optional requested automations such as merge-when-green retain their requested conditions. Caller-supplied expected SHA checks remain accuracy controls.

Keep credential secrecy/binding, tenant isolation, revoked/expired grant rejection, explicit chosen read-only connections, owner-issued pass restrictions, journaling, replay protection, independent readback and truthful uncertain outcomes. A user can change their own standing settings through an authorized tool; a setting cannot lock its owner out of changing it.

Implementation and acceptance sequence: [authority and parity plan](designs/AUTHORITY-PARITY-2026-10-28.md).


## Daily job creation — owner clarification, 2026-10-29

There must be no daily job-creation quota, for any connection or tenant. Remove both per-connection and aggregate per-tenant daily job admission, rather than raising a number or exempting only one owner. Old saved32/128/200 job allowances must not restrict upgraded connections. Active resource admission, measured native worker resource headroom, idle workspace cleanup, actual provider rate signals and genuinely selected delegated restrictions remain distinct. This authorizes no paid resource purchase or widening of a capability grant.

## 2026-10-29 — global native Git resource admission

For every user, simultaneous independent Git requests are limited only by actual worker resource pressure, with no fixed request-count or native workspace-count allowance. Keep four-hour inactivity expiry renewed by authorized activity, one operation per workspace, authentic delegated restrictions and tenant/connection isolation. No additional spending is authorized.

## 2026-10-29 — full coding workspaces

The owner requests a complete coding environment, beyond typed Git: dependency installation, application builds/tests, browser tests, development servers and disposable PostgreSQL. Desired per-workspace ceilings are eight virtual CPUs, eight GiB RAM and150GB persistent storage, subject to actual host capacity and enforceable isolation. No benchmark superiority, dedicated physical cores, disk quota or running capacity is implied by these requested values. Preserve all-user no-daily-job-quota/resource-based admission/four-hour inactivity behavior and existing data; no new spending or host-wide administration is authorized.

## 2026-10-29 — Robinson's Playground name and integration

Name the sandbox/runtime Robinson's Playground, published by Robinson AI Systems. The owner clarified GitHub coding workspace first, rather than Google Workspace. The target is one integrated workspace for edit/Git/install/build/run/test/preview, with8CPU equivalents,8GiB RAM and up to150GB persistent disk shared by all its components. Keep the150GB ceiling and allocate actual storage as used, with no implied purchase or unverified reservation.

## 2026-10-29 — graceful Playground degradation

Owner requests finishing the software with graceful fallback when resources are unavailable or enforcement cannot be established. Continue safe Git/GitHub operations under existing grants; allow smaller observed/enforced runtime ceilings without promising reserved capacity. Resource-pressure commands may remain durably deferred and retry under the same intent after fresh authorization. Never weaken isolation, run arbitrary commands in the shared Git worker, silently start deferred work after revocation, move providers, spend, discard edits or claim unsafe/unavailable compute still executed successfully.
