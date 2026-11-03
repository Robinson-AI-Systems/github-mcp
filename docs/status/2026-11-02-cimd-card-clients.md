# 2026-11-02 — PUB-10: CIMD card clients (Claude, ChatGPT)

- **What changed:** the public sign-in now reads client ID cards (CIMD). An app whose
  client_id is the https address of its own metadata document (Claude, ChatGPT) gets the
  document fetched and checked at connect time (self-name, exact redirect list, PenPal's
  plural auth-method intersection), is mirrored as a public client, and then uses the
  ordinary public-connect consent, code, token and refresh machinery. The authorization
  server now advertises `client_id_metadata_document_supported` when public connect is on.
- **Verified:** resolver unit tests 10/10 (real live-document shapes as fixtures, mocked
  fetch); new DB suite 4/4 in real PostgreSQL (authorize admission for both cards,
  unlisted-redirect refusals, Claude end-to-end through token + refresh with no secret);
  negative control — resolver block disabled: 3 of 4 DB tests fail, restored: 4/4;
  regression — PUB-6 + Muse DB suites 57 passed, OAuth unit suites 53 passed.
  Not verified: the live doors — re-probe after the daily release carries this to
  production; source merged is not live acceptance.
- **Branch/PR:** `ai/vivienne/cimd-client-resolution` (see the PR for head SHA and CI).
- **Next:** after release, replay both real knocks against production and record the
  result here; Chris's own final proof is re-adding the connector in Claude/ChatGPT.
