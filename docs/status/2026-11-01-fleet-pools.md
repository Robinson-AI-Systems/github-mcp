# 2026-11-01 — FLEET-4 several shared pools (source)

`PLAYGROUND_POOLS` lets the operator list several Dokploy instances/projects/servers; new shared-pool runtimes spread by
weight, existing ones stay put, and people who use only their own machines no longer need any shared pool to provision.
Also the manager sweep now cleans up device allocations through their own machine. See [FLEET-4](../pr-cards/FLEET-4.md).
FLEET-6 (lean attachment) merged as #507. No second pool is configured yet (owner checklist).
