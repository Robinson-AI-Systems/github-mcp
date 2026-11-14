# To-do sweep (2026-11-14)

Chris asked for the open actions and to-dos across the rack, Rack Control and GitHub Unleashed to be checked and worked through.

- **Issue #630 (push refusals for values already on GitHub):** done; see `docs/pr-cards/ISSUE-630.md`.
- **BRAND-UNLEASHED-1 follow-up:** the wiki commit author is now "GitHub Unleashed". The scanner false positive that kept `src/github/wiki-git.js` unchanged no longer blocks it. Exact-value push exceptions now exist, but this change did not need one.
- **Work index corrected:** 35 cards were still marked `IN_PROGRESS` although their code is on main and production runs main (all fleet projects show live = main). They are now `MERGED`. PLAY-1 (live acceptance) and PLAY-2 (transfer sizing not yet measured) stay open.
- **Open PR #584** (Vivienne's fleet-route bench reroute, open since 2026-11-05): asked her whether to refresh and merge it or close it.
- **Still open in `docs/ROADMAP.md`, needing Chris's say-so:** the worker-pool follow-ups (queue instead of "try again", Wake-on-LAN, enrolling other people's machines, an owner control for the pool setting, per-host direct origins, owner passes on the PC), content protection for `github_content_push_files`, a CI self-scan of the repository's own source, and protocol v2 for upload-pack.
