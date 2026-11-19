# MACHINES-1: built-in machine management (add, remove, switch off/on), and no revocation pending forever

## Owner request 2026-11-19

Chris: "we also need a simple way built in for adding and removing machines, because obviously we found out we may not
always have access to the same machine. And at some point, I do plan to make other machines available." Also: improve
the Workshop pairing that would show "revocation pending" forever.

## Outcome and acceptance

- **`github_machines`** (owner only): every Git machine (from the deployment settings or added here; on/off, state,
  priority, audience, address host) and every Playground computer of the owner, from **all** of their connections
  (status, last check-in, CPUs, which connection paired it, cleanup label).
- **`github_machine_change`** (owner only):
  - `add_git_machine` {name, origin, priority?, max_workspaces?, audience? (owner by default)}: the address must answer
    `/health` as a native Git worker first, or nothing is added. New work can go there at once.
  - `remove_git_machine` {name}: gone for good (workspaces open there stop working). Works for configured machines too.
  - `git_machine_off` / `git_machine_on` {name}: keep it but send no new work (repairs). The primary can't be removed or switched off.
  - `pair_computer`: starts a Playground pairing (one-time code); approve with `github_playground_host_pairing`.
  - `remove_computer` {device_id, gone?}: unpairs from any of the owner's connections; `gone: true` closes it at once.
- **Security kept**: added Git machines live in setting `native_git.machines`, signed with a key derived from
  `TOKEN_ENCRYPTION_KEY`; an unsigned or altered list is ignored, so a database write alone still cannot add a machine
  that would receive leases and GitHub credentials. The verified list is applied in-process and reloaded at most every
  15 s (rack entrypoint, `poolHosts`) and at once on the instance that made the change.
- **No revocation pending forever**: an unpaired computer that has not checked in for 7 days (since its last check-in or the
  unpairing, whichever is later) is closed as `revoked` with `cleanup: unconfirmed` (`computer_offline_7_days`) when the
  machines are listed or it is removed again; `gone: true` does it at once (`machine_gone`).
- Tests: `machines-1.test.js` (signature, overlay add/remove/off/on/primary, tool operations, probe refusal, owner-only,
  computers across connections, stale and gone revocations).

## Drift check

Two tools added (`github_machines`, `github_machine_change`); counts updated. `github_playground_hosts` and
`github_playground_host_pairing` unchanged.
