# PLAY-2 — Enrolled runtime hosts for Robinson's Playground

## Owner authorization 2026-10-31

Owner commissions enrolled runtime hosts: any user may enroll their own computer or server as a Playground execution host under their own connection; the owner's PC (desktop-ol64acp, tailnet device name) is instance #1. Each user brings their own compute, as each user brings their own credentials today; no user ever receives the owner's credentials, keys or machines. Commissioned into the builder brief the same date (the RTC 2 builder brief carries this card in full, with the alignment review's ten questions attached). Build after or alongside PLAY-1's live acceptance; PLAY-1 remains the repo's stated next step and is not blocked by this card.

## Commissioned outcome

1. **Enrolled allocations.** Generalize the allocation registry from operator settings to per-tenant records — {workspace_id, binding, origin} plus enforcement observations, in the PUB-1 tenant pattern — written by an enrollment flow instead of by the operator. Origin is never a tool argument: an enrolled origin becomes trusted by registration and pinning, exactly as worker origins are pinned today. The agent surface does not change (`github_playground_execute` / `read` / `cancel`); backend placement is expressed as allocation placement plus availability, not a new tool family.
2. **Device setup and pairing.** An install/pairing flow the user runs on their own machine: the worker installs the existing coding-workspace image and supervisor unchanged, pins the control plane's public key, and proves readiness with an enrollment canary execution before any real work is offered. A worker update channel is part of this card. Reachability from NAT'd home networks is via an owned outbound tunnel (the shape PLAYGROUND-OPERATIONS already names for worker hosting); the control plane accepts no caller runtime URL.
3. **Host continuity for enrolled machines.** Reuse the native-git host-continuity machinery — origin pins (current plus previous), cutover timestamps, capabilities/readiness checks before use, drain-don't-kill semantics, unknown pins refuse before credentials or requests. A user's machine going offline, sleeping, or being replaced is the tenant-scale version of the git worker's host moves. Enrolled hosts report in the existing availability vocabulary (ready / constrained / recovery / git_only).
4. **Recovery and journal, reused wholesale.** requestKey idempotent intents, uncertain-never-rerun receipts, result_store 24-hour connection-scoped handles, hash-pinned log windows, and revocation that terminates running workloads. Revoking an enrollment terminates its running work.

## Hosted fallback — open question, not decided

Users without a machine of their own need a hosted path. The owner's candidate (Vercel Sandbox) conflicts with the recorded split ("Keep Vercel for MCP, Neon for metadata and Dokploy for execution") and with HOSTING-COST-POLICY free-tier economics. The builder answers in this card's design phase: who pays for fallback compute and under whose account and quota it runs; session and time limits of the candidate sandbox against a four-hour execution; and whether the fallback is an operator Dokploy pool, a paid-tier feature, or the owner's candidate made to fit the policy. No fallback is built until that answer is recorded here.

## Known friction to evaluate in design

The sealed broker transfer is bounded at 100 MiB with no symlinks; attaching appliance-desk to an enrolled device may exceed it. Evaluate direct clone by the image's embedded native-git engine on the device against raising the broker bound; appliance-desk is the test case. Device attachment is not promised until this is answered.

## Fences

Tenant isolation is absolute: one tenant's allocation, origin and results are never visible or usable by another. Enrollment is the user's own act under their own connection; no owner credential or owner machine is ever enrolled on another user's behalf. Charging and economics follow HOSTING-COST-POLICY. Backups inherit the established posture (the git worker's encrypted snapshot export pattern; activation optional, not a production gate). Repository CI at the exact head remains the merge gate; Playground verification never replaces it.

## Acceptance

A non-operator machine enrolled by its owner — the owner's PC, instance #1 — runs a real appliance-desk verification through the existing execution surface, with results recovered by handle; the enrollment canary precedes real work; revocation mid-execution terminates the workload; a second tenant cannot see or use the first tenant's allocation. Live acceptance is claimed only from that pass, never from source tests or unit checks.

## Drift check

This card extends PLAY-1's host model; it does not amend PLAY-1's scope, the recorded hosting split (except the fallback question it explicitly opens above), the RTC 2 contract, or any shipped dialect. Where this card and PLAY-1's live corrections conflict, PLAY-1's operational record governs the operator host and this card governs enrolled hosts.
