# Second Shift hardening batch — 2026-11-12

State: IN PROGRESS — branch `ai/vivienne/second-shift-hardening`, PR pending at
note time; head and CI recorded in the PR.

Three verified-REAL findings from the 2026-11-12 Second Shift report, one batch
because all three are the same defect family (a failure silently reported as
success) in the Playground/PC-worker kit:

- **#610** `tools/playground-device/provision/apply-provisioning.sh`: a failed
  `systemctl daemon-reload` after writing the agent boot-retry drop-in was
  swallowed (`|| true`) and the script still wrote its converged marker. It now
  exits non-zero with a clear message and writes no marker; the next provision
  run retries.
- **#611** `deploy/pc/install.sh`: the resolver-guard `ok` line printed
  unconditionally after the atomic copy. The success message now prints only
  when the install actually landed; failure prints a `note` with the manual
  remedy, matching the file's own timer handling.
- **#599** `tools/playground-device/agent.mjs`: startup reconcile treated a
  thrown Docker probe as proven absence and called `down()` — which issues
  `docker compose down -v` before its own absence check, so a transient probe
  failure could tear down a live allocation, volumes included. A probe error
  is now indeterminate: logged, skipped this cycle, retried next cycle. New
  unit test pins that no `down` is issued on a throwing probe.

Proof: targeted unit suites on the bench via the fleet ledger before push;
`ci` + `release-policy` at the exact head gate the merge. No release is
performed by this pass.
