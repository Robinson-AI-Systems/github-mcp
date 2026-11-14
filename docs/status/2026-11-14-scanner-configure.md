# Scanner configure says why it refused (2026-11-14)

Found while adding push exceptions for four false positives in development-rack's `backups.py`:

- **The real reason was hidden.** A configure whose suppression reason showed a postgres URL shape was correctly refused by the settings check ("never credential values"), but the write layer answered "The current state could not be read, so nothing was sent. Try again in a moment." Retrying could never work. Now, when the read step refuses the request itself (this server's own refusal, see `src/core/error-origin.js`), the answer is that message, `refusedBy: request`, `reason_code: invalid_request`, `retryable: false`, whatever the connection's mode; a dry run shows it as its warning. Real read failures (network, a bug in this server, GitHub errors) still say the state could not be read.
- **Which field.** The credential refusal now names the field path (for example `addSuppressions[0].reason`), never the text, and says to reword it.
- **One name for one value.** A verification case now accepts `valueFingerprint` (the name a push exception uses) as well as `fingerprint`; two different values are refused.
