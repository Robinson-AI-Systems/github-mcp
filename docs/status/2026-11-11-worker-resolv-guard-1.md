# WORKER-RESOLV-GUARD-1 — the PC worker's resolver is now a checked health signal (2026-11-11)

**What changed.** The PC native Git worker no longer gets to call itself healthy while its
resolver is broken. Inside the worker, a timed probe (github.com + api.github.com, 2500 ms
each, every 30 s) runs against the worker's own captured resolv.conf; the verdict is reported
in the worker's signed capabilities and flips its /health to 503 while down.
github_server_status now flips the worker leg to down on the worker's own verdict (an
unknown verdict and older workers that report none are never failed on it). On the PC, a new
guard in deploy/pc probes the worker's resolver from inside the container every 2 minutes
and heals a poisoned capture at a job boundary — admission closed with the kit's marked
owner-pause, drained on the auto-updater's exact rule, healed by restart then one recreate,
at most 3 attempts per poisoning, receipts in /srv/robinson-git/resolv-guard/.

**Why.** On 2026-11-11 the worker twice booted with an empty resolv.conf capture (dockerd
beat WSL's resolver file), breaking every clone while loopback health said fine. The worker
is host-networked, so a compose dns pin cannot govern its resolver; the capture itself has
to be detected and replaced. The guard deliberately defers while the host resolver is still
empty — that is the boot race itself, and restarting then would capture the same empty file.

**What needs you.** Nothing. The guard installs with the kit and via this change directly;
the in-worker probe and the status flip ride the normal release path (server release, then
the worker auto-updater swaps the worker between jobs).
