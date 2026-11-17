# 2026-11-17: problems found while retiring Dokploy, fixed (AGENT-FB-1117)

These came up while removing Dokploy. Each was a real dead end for an agent.

- **Archived repository error.** Editing an archived repository said the credential lacked access or SAML blocked it. It now says the repository is archived and read-only, and how to unarchive it (ARCHIVED-ERR-1).
- **Stale replay.** In the case archive, unarchive, then archive again within 10 minutes, the last call replayed the first one's old result while the repository was actually unarchived. A repeat is now sent as a new change only when all of these hold:
  - the same tool changed the same target in between;
  - the earlier change finished;
  - the current state no longer matches what that change left.
  Every other repeat still replays, so a retried create never becomes a duplicate (REPLAY-STALE-1).
- **Repository download.** It ended "unconfirmed" with no address when it found an older workspace for the same repository that had expired. It now clones a fresh copy, and a clone that really fails says why (DOWNLOAD-REUSE-1).
- **Code search.** A search that found nothing, scoped to one repository, now gives the exact way to search its real files (download, then grep), because GitHub's index can miss files (SEARCH-EXACT-1).
- **Push scanner.** A refused push now names every refused file, so one round of fixes clears them all (SCAN-ALL-FILES-1).
- **No shared Git machine.** With Dokploy gone, every Git machine is the owner's. A non-owner now gets a plain answer that says so and names the API tools that still work, instead of "busy, try again in a minute" (NO-SHARED-HOST-1). Opening Git machines to other people again is an owner decision, recorded in `docs/OWNER-CHECKLIST.md`.
