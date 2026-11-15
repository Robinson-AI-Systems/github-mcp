# 2026-11-14: content scan on every write route (CONTENT-SCAN-1)

Chris approved two follow-ups from the 2026-11-03 content-protection list:

- The three contents-API writers (put_file, push_files, edit_files) now scan like a git push, at preview time.
- `scripts/self-scan.mjs` runs in `npm run check`, so this repository's own source must pass its own push gate.
  It found 29 values. Seven were scanner false positives on code that passes a password along. CODE-REF-1 fixes
  that in the scanner itself, and DOC-PLACEHOLDER-1 does the same for `user:pass@` in samples. The rest are
  recorded as fingerprints with reasons in `docs/scanner-self-exceptions.json`: CI's throwaway Postgres password
  and the scanner's own test samples.

The live gate still runs the old rule until this release, so the three new test lines that show the code-reference
pattern were allowed with `github_secret_scanner allow` (scanner settings revision 3).

Follow-up the same evening (verified live after release 57): a preview of a credential-shaped value was blocked, but it
said "its current state could not be read". The write core shows a read-step refusal only when it is 300 characters or
shorter. The refusal is now kept within that and carries `reason_code: content_protection`, so agents see the real
reason on previews and on confirmed calls. Three end-to-end write-core tests pin this.
