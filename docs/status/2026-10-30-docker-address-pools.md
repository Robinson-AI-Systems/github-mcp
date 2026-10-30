# Docker network address pools on the Dokploy server (2026-10-30)

**Problem:** a new Playground workspace failed with "all predefined address pools have been fully subnetted". Docker's default private-address pool is small; each workspace uses three networks.

**Fix (needs shell access to the server, not the project's Dokploy key):**
1. Back up the file: `sudo cp /etc/docker/daemon.json /etc/docker/daemon.json.bak` (if it exists).
2. Add this setting without removing existing ones:
   `"default-address-pools": [{"base": "10.64.0.0/12", "size": 24}]`
3. Restart Docker: `sudo systemctl restart docker`. This briefly restarts everything on that server (Dokploy, the Git worker, workspaces) for about a minute.
4. Check: `docker network create probe-test && docker network rm probe-test` should succeed; re-create the failed workspace allocation.

Only networks created after the change use the new pool. Do not delete existing workspaces without Chris's say-so.
Evidence: failed deployment of `ras-pg-88af4607...`, Dokploy log 2026-10-30 19:26 UTC.
