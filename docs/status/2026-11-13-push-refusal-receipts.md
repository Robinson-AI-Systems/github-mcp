# Push exceptions for refused files (2026-11-13)

- **Gap:** an owner push exception couldn't be granted for a file that had never reached GitHub, because the push guard refused the very blob that verification needed to read.
- **Change:**
  - The push guard records value-free refusal receipts: path, blob, rule, line and value fingerprint.
  - `check` and the `push`-door verification in `configure` work from those receipts for a refused blob.
  - The refusal message now prints the blob SHA and value fingerprints.
- **Unchanged:** the next push is still re-scanned byte for byte. Built-in rules are never disabled. Other doors still need the blob on GitHub.
