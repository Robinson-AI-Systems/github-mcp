# PUSH-FIXTURE-2 — push and write gates accept evident placeholder words on secret-named keys

## Owner approval 2026-11-03

Chris answered in chat on 2026-11-03, "Fix the checker then ship full": the push/write gate may accept pushed files
whose secret-named keys hold plainly placeholder words, while real-looking secrets stay refused. It extends
PUSH-FIXTURE-1 to one more fixture class. It unblocks BRAND-UNLEASHED-1 (the product rename to "GitHub Unleashed by
Robinson AI Systems"), which must edit two test files whose fixtures the gate refused (a database test for public
connect and the setup page unit test, both assigning placeholder words to a client secret key).

## Outcome and acceptance

Outcome: under the existing opt-in `{fixtures: 'allow'}` (push/write gates on file content only), a
`generic-credential-assignment` match is skipped when its whole literal is an evident placeholder; every other match,
argument check, redaction and scanner report is unchanged. Accepted when `tests/unit/push-fixture-placeholders.test.js`
shows both cited fixture values pass only with the opt-in, a random 40-character value and the word test followed by
32 random base62 characters are still refused, redaction still hides the placeholders, `contentProtectionReport` and
the `github_secret_scanner` scan (`detectCredentialPatterns`) still report them, and the push door (`findingFor`)
passes the fixtures and refuses a random value.

## Rule

An evident placeholder literal is either:

- (a) lowercase words (letters and digits) joined by `-` or `_`, at least one word exactly one of fake, fixture,
  example, dummy, placeholder, wrong, test, sample, changeme, redacted; no word longer than 20 characters; no run of
  more than 4 digits; or
- (b) a literal starting with `FAKE` or `fake` that holds none of PUSH-FIXTURE-1's credential prefixes.

The 20-character word cap is one step more conservative than the approved design: it stops a stop word followed by a
long random lowercase word.

## What changed

- `src/github/content-protection.js`: `isEvidentPlaceholder` and a check in the generic assignment loop, only when
  `fixtures === 'allow'`. No new caller passes the option; the doors are the ones PUSH-FIXTURE-1 lists.
- New `tests/unit/push-fixture-placeholders.test.js` (key names and random values built at runtime, so it passes the
  gate live on `main`). No existing test file changed.

## Known limits

- A real secret written as lowercase words containing a stop word, or as a real value with FAKE or fake put in front,
  passes in pushed files. Real generated secrets are mixed-case random text, which never qualifies under (a).
  Redaction never passes the option, so such a value is still hidden in every output returned to AIs.
- Token shapes, private keys, database passwords, cloud keys and repository custom rules are judged by their own
  rules and are unaffected.

## Drift check

Before building on this card, confirm `isEvidentPlaceholder` is only reached when `fixtures === 'allow'` and that
`redact`, `contentProtectionReport` and argument checks never pass the option.
