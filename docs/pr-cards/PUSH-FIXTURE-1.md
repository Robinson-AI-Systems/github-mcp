# PUSH-FIXTURE-1 — push and write gates accept the documented FAKE test tokens

## Owner approval 2026-11-03

Chris approved this fix in chat on 2026-11-03 after an agent's push was refused: AGENTS.md tells builders to use fake
test credentials written as the GitHub token prefixes followed by the word FAKE, but the push gate refused exactly those
values, so a test file that followed the rules could not be pushed through this server. He also approved two follow-up
rewordings (comments in `src/github/content-protection.js`, key names in the new test file) so the change itself passes
the gate that is live on `main`.

## Outcome and acceptance

Outcome: file content pushed or written through this server's doors may carry FAKE-prefixed GitHub tokens (classic,
OAuth, user, server, refresh and fine-grained shapes whose payload starts with the case-sensitive word FAKE and holds no
other credential prefix); every other credential shape is still refused, and redaction of text returned to AIs is
unchanged. Accepted when `tests/unit/push-fixture-tokens.test.js` shows the fixtures pass only with the opt-in, real and
smuggled values are still refused (with the same refusal text), private keys, database passwords, generic assignments
and repository custom rules are unchanged, redaction still hides fakes, and an end-to-end `git push` through the git
remote stores a fixture file on the fake GitHub while a smuggled real token is refused before GitHub.

## What changed

- `src/github/content-protection.js`: `containsCredential`, `activeProtectionReport` and `credentialLocations` take an
  opt-in `{fixtures: 'allow'}`. With it, a GitHub token match whose payload starts with FAKE and contains no other
  credential prefix (GitHub token prefixes, pass, relay or tunnel prefixes) is skipped, and the same exact range is not
  re-flagged by the generic key/value rule. Without the option nothing changes. `redact` never passes it.
- The option is passed only where file content is checked before it is pushed or written:
  `workers/native-git/upload.js` `findingFor` (workspace upload apply, the git remote push hook in `remote-hook.mjs`,
  the direct git host), `src/tools/repo-change.js` file content, and workspace `write_file` content in
  `src/native-git/commands.js` and `workers/native-git/engine.js`. Paths, other arguments and results are still
  checked without it.
- Three existing test files (`git-direct`, `git-remote`, `repo-change`) now build their token values at runtime; their
  leak tests use a real-shaped runtime value instead of a FAKE one, so they still prove a refusal.

## Not changed

- `github_content_push_files` has no content scan today; that inconsistency is a ROADMAP entry, not part of this card.
- No scanner exception, setting, migration, tool, credential or GitHub request shape is added.

## Known limits

- A FAKE prefix followed by a real token payload with its own prefix removed passes: the gate cannot tell such a
  payload from random test text. Real tokens are only ever pasted whole, with their prefix.
- A fixture whose payload happens to contain one of the other prefixes (for example a user-token fixture whose suffix
  includes the letters t, a, c followed by an underscore) is refused; rename the fixture.

## Drift check

Before building on this card, confirm `credentialMatches` still only skips fixture ranges when `fixtures === 'allow'`
and that `redact` and argument checks never pass the option.
