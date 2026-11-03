# 2026-11-03 Keyless doors no longer wake the database (DOOR-DB-1)

- `/api/mcp` answers a keyless request (the sign-in challenge: 401 with `WWW-Authenticate`) before it opens the
  database; the keyless RTC refusals (`/api/whoami`, `/api/tools`, `/api/results/...`) and the two OAuth discovery
  documents are database-free too. Health and refusal probes on a cold instance now issue zero SQL, so they stop waking
  the Neon store (the audit of build 648ba99c put most of the ~$19/month on these wake-ups).
- Responses are byte-identical; signed-in calls keep every store-backed check (token lookup, revocation, tenant route).
- Verified: `tests/unit/door-db-free.test.js` (8 tests), the related MCP/OAuth/RTC suites, `npm run check`, `npm run test:db`.
- Not done: merged source is not released; the cost drop shows only after the next release reaches `live`.
