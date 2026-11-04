<!-- Current repair also records no-change daily receipts: backups cannot publish later same-day development after a successful no-op. -->
## October 14 owner-requested daily release recovery repair — current

Owner request on October 14: investigate and repair missed daily releases across the MCP repositories and Appliance Desk, including the quoted owner-run checked recovery. This supersedes the prior scheduled-only/no-new-trigger restriction for missed-event recovery only. Primary 00:01 Denver remains; retries are 00:17, 01:17 and 05:37 Denver plus 12:43 UTC. Explicit recovery defaults OFF and requires both the original actor and the triggering actor to be christcr2012, main, true recovery input and elapsed midnight. Every path retains successful exact-main CI, ancestry, atomic once-per-Denver-day receipt and independent readback. No production-provider activation, spending, force push or preview build is authorized.

Local release safety tests pass. Merge requires exact-head application CI and review resolution. Source repair is separate from observed schedule execution and Vercel READY/alias proof; inspect actual daily run and receipt, do not equate main/live drift after a release with failure. These infrastructure PRs do not replace the existing substantive implementation batch.

# Owner midnight release schedule

Owner instruction 2026-10-13: schedule these six MCP repositories at 00:01 Denver, then manually release their checked revisions after setup work.

Use one daily cron with native America/Denver timezone; preserve green-CI, atomic Denver-day marker, fast-forward-only release and independent provider/production/spending gates. No new trigger, force update or preview build. Verify actual workflow schedule and existing promotion safety tests; required local/remote checks and review before merge. After explicit manual release, separately verify exact source and READY public alias. The midnight schedule next becomes eligible on the next Denver calendar day; delay/dropped schedule is not a passed release.

Reference: https://github.blog/changelog/2026-03-19-github-actions-late-march-2026-updates/

## October 14 missing scheduled event and same-day recovery

- Verified no GitHub Actions `event=schedule` runs for this repository, although default branch is `main` and the existing 00:01 Denver timezone-aware cron is valid; the incident is upstream of promotion script execution. `live` and Vercel production still track historical `5414978c`.
- PR #179 adds scheduled **backup** attempts at 00:19, 01:19 and 05:37 America/Denver while preserving the 00:01 preferred attempt; no workflow_dispatch and no on-push promotion.
- All backup attempts run the same existing promote script, whose atomic `live-promotion/YYYY-MM-DD` tag, exact-main `ci`/`release-policy`, ancestor/fast-forward requirement, branch movement checks and independent GitHub remote SHA readback prevent duplicate or unsafe releases. Regression tests pin every schedule and verify the unchanged owner-only promotion gate. No extra live/Vercel build unless a checked promotion actually succeeds.
- **Acceptance still open:** After merge, independently observe a real `event=schedule` job, its `scheduled-live-promotion` result, matching live/tag, and Vercel production READY at that SHA. If no schedule event occurs, check workflow enabled state/actor and GitHub support; do not state recovered based on green CI alone.

## Release authority

Release authority: this project gets ONE automatic release per day (the nightly promotion). Every additional release requires the owner's authority — granted in advance with conditions, in the moment, or by any other scheme the owner specifies. Release machinery must encode the owner's permission scheme; no machinery may impose its own numeric cap on owner-ordered releases. Checks (exact-head green, ancestry, receipts) govern HOW an authorized release runs, never WHETHER the owner may order one. The once-per-Denver-day receipt described in this card belongs to the automatic route; an owner-authorized release runs the same checked promotion and carries its own receipt.
