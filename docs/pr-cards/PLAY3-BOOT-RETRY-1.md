# PLAY3-BOOT-RETRY-1 — The Playground host agent retries after a dependency-failed boot start

## What happened (live, 2026-11-11)

The PLAY-3 continuity-proof reboot (09:37 MST) returned everything
unattended except the host agent. Boot journal, PlaygroundWorker distro on
the PC: docker.service's first start (09:37:41) failed — "Error
initializing network controller: error creating default bridge network:
failed to add default-drop rule (iptables: No chain/target/match by that
name)" — docker.service restarted itself and was up at 09:37:44, but
`ras-playground-agent.service`'s start job had already failed at 09:37:42
with result `dependency`, and nothing retried it. The agent stayed down
until started by hand at 09:41:10. Root cause, in the unit definition
(`tools/playground-device/service/ras-playground-agent.service`): the unit
`Requires=docker.service`, so Docker's failed start cancelled the agent's
start job outright — `Restart=always` never engages for a job that never
ran. A second, latent wedge sits beside it: `StartLimitBurst=5` per
`StartLimitIntervalSec=600` with `RestartSec=5s` means any dependency
outage longer than ~30 s at boot (agent starting while the socket is not
yet accepting, five quick exits) ends in start-limit-hit — failed
permanently, again waiting for a human.

## Outcome and acceptance

Outcome: the agent's service definitions gain a real boot-retry path, and
the provisioning convergence route carries it to installs already in the
field.

- The system unit orders after `docker.service` as before but **wants**
  it instead of requiring it: a failed Docker start can no longer fail
  the agent's start job. The agent tolerates the engine being absent (it
  reports Docker as not running and keeps leasing), so starting without
  it is safe; it picks the engine up when the engine arrives.
- Both systemd units drop the start-limit wedge:
  `StartLimitIntervalSec=0`. With `Restart=always` + `RestartSec=5s` the
  retry cadence stays bounded below; no boot transient can convert into a
  permanent failure.
- `apply-provisioning.sh` converges installs whose base unit predates the
  fix: it writes the drop-in
  `ras-playground-agent.service.d/10-boot-retry.conf` (an empty
  `Requires=` resets the dependency list, `Wants=docker.service`,
  `StartLimitIntervalSec=0`) and reloads systemd, whenever the base unit
  is present. The drop-in only ever restates what the base unit now
  carries.
- `service/README.md` records the contract, including the fleet container
  form's equivalent: a device container runs with Docker restart policy
  `always`, never `unless-stopped`.

Unchanged: the agent payload, the launcher shim and its crash-loop
rollback, the pairing/update contracts, the installer's payload placement
(Setup.psm1 already copies the current unit file, so fresh installs are
born fixed), and every server-side Playground behaviour.

Accepted when: the new contract tests
(`tests/unit/play3-agent-boot-retry.test.js`) pass alongside the existing
PLAY-3 suites; CI is green at the exact head (`ci` + `release-policy`);
and both live devices are converged and proven — device #1 (PC,
f2c61d1b58753af59317adeea75b3522) by unit-property read-back plus an
agent-unit restart returning to ready and re-leasing, device #2
(Workshop, ee04f432ae947d5e3b1b923b2102c278, container form) by restart
policy `always` plus a container restart returning to ready and
re-leasing. The full boot-order proof stays owed to the next
owner-blessed reboot and is not claimed here.

## Fences

No Docker daemon restart on either host, no reboot, no rack production
container stopped or recreated, the third device (potato) untouched. No
server release: provisioning and device state only.

## Drift check

Confined to the Playground device service definitions
(`tools/playground-device/service/`), the provisioning convergence script
(`tools/playground-device/provision/apply-provisioning.sh`), and their
contract tests. No agent payload, launcher-shim, pairing/update, or
server-side change; no provider, schema, or authority change. The
convergence drop-in restates exactly the settings the base unit carries —
it widens no privilege (the agent still runs as the unprivileged
ras-playground account with NoNewPrivileges) and weakens no fence: the
only dependency change is that Docker's failure stops being fatal to the
agent's start job, which is the defect being fixed. Live application
touches the two enrolled devices' agent supervision only — no Docker
daemon restart, no reboot, no production container stopped or recreated,
and the offline third device is not touched.
