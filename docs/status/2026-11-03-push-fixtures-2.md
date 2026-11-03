# 2026-11-03 Push and write gates accept evident placeholder words (PUSH-FIXTURE-2)

- Pushing or writing a test file that assigns obvious placeholder words (such as wrong or fixture words joined by
  hyphens) to a secret-named key is no longer refused by the push and write gates. Random-looking values on those keys
  are still refused, and text returned to AIs still hides the placeholders. Owner-approved in chat 2026-11-03.
- Unblocks BRAND-UNLEASHED-1, which edits two test files with such fixtures.
- Verified: `tests/unit/push-fixture-placeholders.test.js`, the PUSH-FIXTURE-1 suite and every unit suite touching
  content protection, `npm run check`; every changed file and doc was also scanned with main's gate.
- Not done: merged source is not released; the fix reaches agents after the next daily release to `live`.
