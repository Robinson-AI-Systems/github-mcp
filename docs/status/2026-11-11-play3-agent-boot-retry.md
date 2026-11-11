# PLAY3-BOOT-RETRY-1 — agent boot-retry path (2026-11-11)

State: source fix + contract tests in this PR; live application follows
the merge and is reported the same day. The full boot-order proof stays
owed to the next owner-blessed reboot — not claimed here.

## Before (both live devices read first-hand, 2026-11-11 ~12:24 MST)

- Device #1 (Chris's PC, PlaygroundWorker distro, device
  f2c61d1b58753af59317adeea75b3522): systemd system unit, byte-identical
  to the repo source — `Requires=docker.service`,
  `StartLimitIntervalSec=600`, `StartLimitBurst=5`, `Restart=always`,
  `RestartSec=5s`. Unit active and enabled; this is the unit whose start
  job failed with result 'dependency' at the 09:37 boot.
- Device #2 (Workshop, device ee04f432ae947d5e3b1b923b2102c278): the
  fenced container form — no systemd unit; container
  `ras-playground-agent` (host networking, `~/playground-host` image)
  supervised by Docker with restart policy `unless-stopped`. Docker's
  restart machinery covers crashes and daemon restarts, but a stopped
  container stays down across a daemon restart under `unless-stopped`;
  the systemd form's `Restart=always` contract is `always`.

## Change

Repo: `tools/playground-device/service/ras-playground-agent.service`
(Requires→Wants on docker.service, StartLimitIntervalSec=0),
`ras-playground-agent.user.service` (start-limit mirror),
`provision/apply-provisioning.sh` (boot-retry drop-in convergence),
`service/README.md` (the contract, incl. the container-form rule),
`tests/unit/play3-agent-boot-retry.test.js` (the pins).

Live application, per device: device #1 receives the new base unit and
the new convergence script, runs the script (drop-in written,
daemon-reload), then the agent unit alone is restarted and read back;
device #2's container restart policy is updated to `always` in place
(`docker update`, no recreation) and the agent container alone is
restarted and read back. Evidence for both: property read-backs plus the
server's hosts read showing the device ready with a fresh lease.
