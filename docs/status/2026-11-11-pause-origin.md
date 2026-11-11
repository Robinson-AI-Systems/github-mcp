# 2026-11-11 — PAUSE-ORIGIN-1: a worker pause says who holds it

**What happened.** At 14:45 MST the PC worker's self-updater tried to move to the gen-25 build (f604349). The new
build failed verification and the rollback failed it too, so the updater left admission closed for operator repair.
That is the designed safe behaviour. But every new-workspace refusal told agents "This worker is paused by its owner
(the computer is in use)", and the owner asked why his machines were not being used while nobody was at the PC.

**Change.** The worker reads the marker the updater and the name-lookup guard already write into the shared pause
file, and every refusal says who holds the pause (owner, self-updater, name-lookup guard). Only the owner's own pause
says "the computer is in use". The reason code, placement and failover are unchanged.

**Still open (deployment, not code).** The worker pool has one host, so a closed PC worker has nowhere to spill to.
The owner has decided to add the Dokploy worker, the Workshop machine and, when it is awake, Caleb's PC (lowest
priority). That is a `NATIVE_GIT_WORKER_POOL` settings change once each host is proven. The repair of the failed
update is in progress separately.
