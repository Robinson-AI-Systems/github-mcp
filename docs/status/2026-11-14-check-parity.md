# 2026-11-14: local check matches CI; refused previews say so

- `npm run check` now applies the docs rule locally the way CI does: compared with where the branch left main,
  including uncommitted and new files. Before this, it skipped the rule or looked only at commits (CHECK-PARITY-1).
- A preview refused on purpose by its own read step now says so and carries that refusal's code, instead of "its
  current state could not be read" (PREVIEW-REASON-1).
