# 2026-11-01 — Key rotation without downtime, rehearsed (PUB-7 follow-up)

**What changed:** every key the public service depends on now has a written, step-by-step replacement in
[KEY-ROTATION](../KEY-ROTATION.md) and a rehearsal test, so the launch readiness condition "Key and secret safety with
rehearsed replacement" is met from repository evidence.

- App private key, client secret, webhook secret: replaced one at a time on the protected setup page. GitHub checks a
  typed key or secret before it is saved; the webhook secret is made by the server and shown once. The old value is kept
  sealed for 24 hours (Undo; old webhook signatures still believed), "Finish now" ends that at once. No downtime.
- Tenant routing key: optional `GITHUB_TENANT_ROUTING_KEY_PREVIOUS` + `GITHUB_TENANT_ROUTING_KEY_PREVIOUS_UNTIL` (UTC, at
  most 30 days ahead) let old connection tags still check while new ones use the new key. No downtime for people who use
  their connection during the window; without the two settings it is still the sign-everyone-out emergency lever.
- Encryption key: unchanged (already had an overlap and a rehearsal); its record now points at the same runbook.

**How verified:** `tests/unit/key-rotation-rehearsal.test.js` (fake GitHub that really checks signatures and client
secrets; old works → both → only new; wrong values refused), the credential-store contract on the fake and on throwaway
Postgres (`npm run test:db`), `tests/unit/launch-readiness.test.js` (key safety is "met" on this repository). Source only:
not released, not deployed, not tried on the real App.

**Owner:** nothing required. Optional rows in `docs/OWNER-CHECKLIST.md`: "Only if a key is ever exposed" and a
real-account rehearsal of the webhook secret.

**State:** branch `ai/claude/key-rotation-rehearsal`; PR, head and CI in the PR itself. Next: the remaining readiness
conditions are owner rows or live acceptance (see `npm run launch:readiness`).
