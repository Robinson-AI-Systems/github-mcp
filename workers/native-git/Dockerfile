# Official Node multi-platform manifest, recorded from docker-library/repo-info 2026-10-28.
FROM node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c
# Freeze Git and its dependencies against signed Debian snapshots; no unauthenticated packages.
RUN rm -f /etc/apt/sources.list.d/debian.sources \
 && printf 'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/20261028T000000Z/ bookworm main\ndeb [check-valid-until=no] http://snapshot.debian.org/archive/debian-security/20261028T000000Z/ bookworm-security main\n' > /etc/apt/sources.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && git --version \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /data /app \
 && chown node:node /data
WORKDIR /app
COPY package.json ./package.json
COPY src/github/content-protection.js src/github/open-secret-rules.js src/github/secret-literals.js src/github/custom-secret-rules.js src/github/scanner-policy.js src/github/file-protection.js ./src/github/
COPY vendor/gitleaks/ ./vendor/gitleaks/
COPY src/native-git/commands.js src/native-git/protocol.js ./src/native-git/
COPY workers/native-git/ ./workers/native-git/
USER node
ENV NODE_ENV=production PORT=3000 NATIVE_GIT_STORAGE_ROOT=/data
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "workers/native-git/server.js"]
