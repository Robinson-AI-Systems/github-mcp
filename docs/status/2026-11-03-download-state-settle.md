# 2026-11-03 Download test waits for the final state (main CI repair)

`main` at eaf7cd39 went red once in `unit (1/6)`: `tests/unit/native-git-download.test.js` "lets a session that started
before expiry finish" read the download status as `serving` right after `git clone` exited. Cause: the worker records the
final `downloaded` state just after the response that carried the pack ends (`workers/native-git/download.js`), so a
client that already exited can briefly see the previous state. The tests now wait, bounded at 5 s, for the state to leave
`serving` and then assert it exactly; nothing else changed and no assertion was removed.

Verified: the file passes three runs in a row locally; `npm run check`.
