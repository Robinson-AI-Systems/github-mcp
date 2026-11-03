# 2026-11-03 — workspace ready report and Git access inside Playground (AGENT-FB-3)

Chris's agents asked for one operation that gets a runtime ready and says so, and for a safe Git fetch inside Playground.

- **Ready report:** `github_playground_workspace` `setup` now ends with `ready` once attached: whether commands can run
  (from the runtime's own signed check), the active branch, limits and what the runtime can do. It does not run a
  command and says so.
- **Git access inside Playground:** new operation `git_access` gives the runtime a read-only key for this one repository
  (1 to 4 hours, default 2). It is stored only for the command user, never shown, and cancelled if the runtime refuses it.
  It needs the updated runtime image; until it is deployed the call says the runtime did not accept the key.
- **Git operations:** `github_git_workspace_read` `capabilities` lists every operation's options at once and states that
  native Git is the preferred path. The REST commit tools and the REST Git fallback stay.
- Unverified: both new behaviors on a live runtime (needs the new release and runtime image).
