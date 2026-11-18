# Rules

Standing rules for work in this repository. Rules that live elsewhere
(`AGENTS.md`, `.github/RELEASE-POLICY.md`,
`docs/OWNER-DECISION-2026-10-27.md`) keep their own homes; this file
holds the relational-map rule adopted 2026-11-18.

<!-- relational-map-rule: begin -->
## Relational map rule

Every feature built or changed refreshes `docs/relational-map/` in the
same change; a feature is not landed until the diagram matches the code.

- If a change adds, removes, renames or rewires a part — a route, a
  tool area, a store, a worker, a wire between parts — update the
  affected map file(s) in the same pull request.
- If a change genuinely touches no connection the map shows, no map
  edit is needed; the pull request description should be able to say
  why in one line.
- `docs/MAP.md` is the pointer; `docs/relational-map/` is the map.
  Keep it readable: diagrams and node-and-wire lists naming parts and
  their connections (calls, reads/writes, publishes, depends-on),
  describing the real system as surveyed from the code — no stubs, no
  planned parts presented as built.
<!-- relational-map-rule: end -->
