# HOST-DELEGATION-1 — Delegated Playground host approval under the owner's own connection

## Owner approval 2026-11-11

Chris, in the main chat (2026-11-11 05:11 MST), directed that PLAY-3 step 6 be handled on his
behalf the same day — his machines enrolled as Playground hosts under his own GitHub Unleashed
account while he is away from his computer — rather than waiting for him to click the pairing
approval on My connection. This card is the server amendment that direction required.

## The problem in the built code

Pairing approval (`createEnrolledHostStore.approve`) had exactly one caller: the My connection
page action behind the one-use GitHub-authenticated manage flow. No tool or API route could
reach it. The device side can only prove its key (`claim`); PLAY-2's rule — an agent must never
approve its own pairing — exists so the thing being granted access cannot manufacture the
owner's consent.

## Outcome and acceptance

The owner's own Full MCP connection gains the same begin / approve / revoke / list operations
the page has, for the calling connection's own hosts only:

- Scope is the caller's verified tenant + identity (the tenant database's `playgroundScope`)
  and the caller's own client, which must be a Full connection — the same derivation and filter
  the page flow uses. Another tenant's, client's or profile's devices are invisible and
  unapprovable through this route.
- Every approval records provenance on the host record: the page writes `{via:'my-connection'}`;
  this route writes `{via:'owner-delegated-agent', clientId, at, note}` where `note` names the
  owner instruction the approval rests on. The record itself attributes the act; nothing
  simulates the owner's click.
- The device still cannot approve anything: it holds no MCP credential, and approval still
  requires the device to have proved its key first (`pending_confirm`).

Accepted when (tests, `tests/unit/play3-delegated-approval.test.js`): the full begin → claim →
approve cycle under a Full connection records the delegated provenance; approval before claim
is refused; non-Full and foreign-client callers are refused; a foreign tenant scope sees no
devices and cannot approve; the page path's provenance is unchanged; delegated revoke works.

## Drift check

Keeps PLAY-2's fences exactly: enrollment remains per-connection, owner-approved, and
device-key-proved; the approval's *route* widens to the owner's delegated agent connection,
which is the same authority the owner already lends that connection for every other Full
operation. No new tool family beyond the two `github_playground_*` host tools; the agent
surface (`github_playground_execute` / `read` / `cancel`) is unchanged.
