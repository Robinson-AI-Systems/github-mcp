# Historical authority record — superseded, not active instructions

# Product-user capability versus implementation-agent authority

> **Current governing owner decision (2026-10-27), implementation authorized 2026-10-28:**
> See [owner decision](OWNER-DECISION-2026-10-27.md). It supersedes conflicting product gates below, including spend/production/notification/protected-resource restrictions on the owner's own connection. Builder operating restrictions remain builder-only; explicit delegated restrictions remain binding. Historical designs and evidence do not override this decision.
> Active remediation: [plan](designs/AUTHORITY-PARITY-2026-10-28.md).

**Binding owner clarification — October 16, 2026.** Apply to all GitHub MCP implementation, architecture, tooling and final acceptance. This clarification supersedes earlier readings of IN-09, B-4, Y3 and money-related owner decisions *when they turned developer operating restrictions into product prohibitions*. Preserve historical records but use this current decision for the product.

## The two agent roles must never be conflated

- **Our developer/coding agents:** Build, test, review, merge and release GitHub MCP under the repository's existing developer rules. No independent paid GitHub actions, no unapproved production activation, no real-account destructive tests, $0 autonomous development spending, required reviews/CI/acceptance and release cadence. The owner's clarification does **not** authorize spending or live writes by the developer.
- **An end user's coding agent:** Acts as the actual end user under valid account credentials and delegated authorization. The MCP product is intended to expose **every feasible GitHub action** the authenticated user is permitted to perform, including purchases/Sponsors, paid hosted runners, Copilot seats and cloud-agent tasks, financial configuration, production changes, permissions, security, administration, deletion and other destructive actions. The user's authority comes from their own account permissions and chosen delegation policy, **not** from the developer's sandbox restrictions. A warning does not turn an available action into a permanent denial.
- **Real limits:** Respect GitHub-supported API/GraphQL capabilities, account plans, verified tenant/owner/organization/repository ownership, granted GitHub App permissions, U/I token restrictions, revocation, provider policy, legal constraints and user-configured spending/approval limits. Neither a valid user nor an AI agent receives permissions they do not have; never expose secrets or bypass isolation.

## Sensitive actions: warn, authorize, execute and verify

- Supply an actionable preview whenever practical: exact actor and scope; current state; reversible/irreversible effect; change to access, security or production; who may be notified; whether GitHub bills for it; a sourced price when known.
- **Unknown/metred future cost is a disclosure, not a categorical prohibition.** Say plainly that an enforceable maximum cannot be guaranteed and what the financial exposure could entail. Support real execution with appropriately scoped *user-granted* authorization or user-chosen confirmation; do not invent a price, fake $0, silently bypass an explicit user cap or call a guided instruction “completed.” An end user's standing delegation can authorize an operation when the user's policy and GitHub allow it; interactive confirmation remains available or mandatory where user/provider policy calls for it.
- Support legitimate optional end-user budgets, deny lists, approval levels and restricted agent passes. These are the **user's chosen** delegation controls, not defaults inherited from developer spending or scratch-account policy.
- Dispatch through the guarded write lifecycle: scoped credential, exact target, immutable request key, safe once-only effect, original before-state, journaled result, independent provider readback and honest uncertain outcomes. Existing history and safety cannot be skipped simply because the customer has full permissions.
- Where GitHub exposes the API, implement the action. A non-mutating website guide is acceptable as a *documented missing capability* or a genuinely unavoidable provider UI step, never a false completed substitute for an implementable tool.
- Hub integration is optional; native GitHub MCP remains fully usable directly and must not rely on another service to grant authority.

## Concrete code and test audit (done on 2026-10-24, AUTH-1; see `docs/audits/END-USER-AUTHORITY-2026-10.md`)

Item-by-item result: 1 done (explicit user limit only), 2 done (unknown price is its own confirmed state), 3 done (unreviewed routes are unknown cost, not banned), 4 done (Sponsors, hosted runners, Copilot seats and agent tasks are real writes), 5 done (13 provider-UI-only settings confirmed against GitHub's API descriptions; project-workflow guide text corrected), 6 done (`tests/unit/end-user-authority.test.js` runs the spend checks over every money-capable tool). The original items follow for reference.

1. `src/tools/spend-guard.js` currently treats a database default $0 limit as a product-wide refusal. Separate developer sandbox caps from **explicit end-user spending preferences**. Do not silently discard a historical user's intentionally configured budget; provide a clear transition/onboarding path.
2. `src/core/write.js` currently rejects every paid change with a non-computable price. Design an explicit unknown/metered-spend exposure and authorization state, distinct from both $0 cost and a verified numerical price, with dedicated journal/confirmation tests.
3. `src/github/spend-classes.js` and the universal API classifications currently block many paid routes. Preserve conservative classification but make their authorized capability reachable via the specialized tool or a reviewed universal path.
4. Finish Batch Y-9d as actual user-authorized **execution** for Sponsors, hosted/larger runners, Copilot organization policies, team seats and agent tasks. Draft PR #233 currently presents hosted-runner creation and cloud-agent starting as guided-only and refuses some paid expansions; that is **unacceptable as final product behavior**. Verify the real pinned GitHub REST/GraphQL shapes before submitting, including public-preview endpoints and correct U/I credential permissions. Extend App permission discovery and onboarding checklist as needed.
5. Audit older tool areas (billing, Codespaces, security, production, owner administration, special protected resources, readback-only guides) for the same mistake. Do not weaken credential isolation, true provider refusal, intentional user policy, revocation, or the developer's no-spend/no-live-test rules.
6. Extend tests to independently prove (a) developers cannot spend/live-mutate without separate authorization; (b) the end user's **properly delegated agent** can actually complete paid, destructive and security-sensitive API operations with honest warnings and user-chosen authorization; (c) explicit user deny/cap policies remain enforced; (d) ambiguous network failures do not double-charge; (e) provider state is verified after dispatch.

**Status:** This records the owner decision and starts the remediation requirement. It does **not** constitute a code fix, independent review, real-account acceptance, permission approval, production activation or permission to merge unfinished Y-9 work.

## Billing and Copilot follow-up: October 17, 2026

Additional audit found that earlier product code could only save an enforced organization budget, and could not assign Copilot seats when a valid provider plan lacked a price in the local reference table. The new O-4 and Y-9d corrective branch enables those provider operations for a genuinely delegated full-profile user. Unknown future billing is explicitly disclosed, while a deliberately configured finite spend cap or RTC pass still refuses unbounded exposure. Developer spending, live-state and test-fixture rules are unchanged. The rest of this cross-product capability audit remains open; green source CI is not live financial acceptance.

## October 17, 2026 — full repository security administration corrective work

The H-4/Y-7 source audit identified omitted, provider-supported repo security flags and a false Dependabot update route. The corrective branch exposes direct GitHub settings operations for AI secret detection, non-provider secret patterns, delegated alert dismissal and delegated bypass, plus the separately documented Dependabot security-updates GET/PUT/DELETE. The product still verifies connected owner, exact provider readback, paid private security disclosure, user-selected caps and gated access widening for bypass authority. The developing agent cannot enable these features on real accounts or spend money. A green source PR is not proof of deployed paid feature execution; original live acceptance stays open.

## Large-organization security configuration remediation (October 17, 2026)

The official GitHub code-security API accepts cursor pagination even when more than 100 configurations or associated repositories exist. Valid end-user scope was previously artificially limited by a one-page developer safeguard; the corrected provider contract fetches complete bounded pages, rejects unclear/duplicate/foreign results, retains paid/private disclosure and denies any destructive deletion lacking full exact associated-repository evidence. It also verifies nested setting options and enforcement rather than calling a write successful merely because GitHub returned 2xx. Original Y-7/H-4 implementation and real deployment acceptance remain tracked separately.


## October 17 — privilege versus subscription diagnostic correction

The H-4 dependency-review read and Y-9 organization network-configuration read/write paths previously labeled provider HTTP 403/404 as paid-plan ineligibility without proof, masking missing GitHub App permissions or inaccessible exact resources. The focused correction keeps GitHub's original refusal and accepted-permission data through the existing sanitized translator, while preserving PREVIEW/production/confirmation guards, source-verified completeness across paginated network inventories, and changed-network-ID readback. Original H-4/Y-9 implementation was merged earlier, and this maintenance does not re-credit those subsections. No real paid acceptance, credential upgrade, production write or deployed-source acceptance is claimed. See `docs/pr-cards/END-USER-AUTHORITY-REFUSAL-TRUTH-OCT17.md`.

## Maximum authorization expansion — owner 2026-10-21

[MAXIMUM-AUTHORITY](designs/MAXIMUM-AUTHORITY.md) governs CAP-1..CAP-5. Standard includes optional Full App/user authorization; God Mode is guided enrollment of genuinely additional credentials, not exclusive tools or a guard bypass. The 411-tool credential classification does not establish GitHub functional coverage. Robinson AI Systems developer/operator and product-customer contexts must be explicit and separately authorized. This approved plan does not itself implement or accept the new capabilities.

## Organizational identity and explicit authority contexts — owner 2026-10-21

Robinson AI Systems can act as developer/operator, explicitly scoped product administrator,
or ordinary production customer. Every operation must bind environment, authenticated principal,
tenant/workspace membership, active role, owned provider connection and operation. Company
email/domain or organization membership alone creates neither global administration nor a
permanent developer-only product profile. Secure context switching must reauthorize each role;
operator credentials never substitute for another user's missing provider grant. Preserve valid
existing accounts and credentials through a reviewed migration and scoped refresh/revocation.

Existing maximum-authority/identity units retain this requirement. Source tests and incremental
protocol fixes do not certify complete multi-user business onboarding, role switching, tenant
isolation or supported live-client/provider acceptance. Builder safety, CI and release policies,
provider grants, explicit user policies and genuine transaction protections remain independently
enforced. Robinson's own production tenant has normal delegated authority and no cross-tenant access.
