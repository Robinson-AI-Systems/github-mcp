# Push exceptions for deliberate fake values (2026-11-13)

- **Owner report:** the secret scanner's settings could not unblock a push. The push guard ignored suppressions, so every edit to PenPal's acceptance test, which plants fake credentials on purpose, was refused.
- **Change:**
  - Owners can add a suppression with `pushException: true` and the finding's `valueFingerprint`, which `github_content_protection_check` now reports as a hash, never the value.
  - The push and upload guard then allows exactly that value in exactly that file, and keeps allowing it after other edits to the file.
  - Configuring one needs a pinned verification through the new `push` door.
  - The push refusal tells agents these steps.
- **Unchanged:** built-in rules are never disabled. Any other value, file or rule is still refused.
- **Next:** release github-mcp, then add the PenPal exceptions (three planted values in `test/acceptance.test.mjs`).
