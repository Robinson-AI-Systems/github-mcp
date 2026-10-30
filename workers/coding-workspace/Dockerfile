# Dedicated single-workspace execution image; never replaces the shared native-git image.
FROM node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c AS runtime
RUN rm -f /etc/apt/sources.list.d/debian.sources \
 && printf 'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/20261028T000000Z/ bookworm main\ndeb [check-valid-until=no] http://snapshot.debian.org/archive/debian-security/20261028T000000Z/ bookworm-security main\n' > /etc/apt/sources.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates python3 build-essential postgresql-15 postgresql-client-15 \
 && mkdir -p /app /workspace /opt/playwright
WORKDIR /app
COPY workers/coding-workspace/package*.json ./
RUN npm ci --ignore-scripts \
 && PLAYWRIGHT_BROWSERS_PATH=/opt/playwright npx playwright install --with-deps chromium \
 && chmod -R a+rX /opt/playwright \
 && rm -rf /var/lib/apt/lists/* /root/.npm
COPY src/github/content-protection.js src/github/open-secret-rules.js src/github/secret-literals.js src/github/custom-secret-rules.js src/github/scanner-policy.js src/github/file-protection.js ./src/github/
COPY vendor/gitleaks/ ./vendor/gitleaks/
COPY workers/native-git/ ./workers/native-git/
COPY src/native-git/commands.js src/native-git/protocol.js ./src/native-git/
COPY workers/coding-workspace/runtime.js workers/coding-workspace/server.js workers/coding-workspace/capacity.js workers/coding-workspace/preview.js workers/coding-workspace/initialize.js workers/coding-workspace/authority.js workers/coding-workspace/browser-preview.js workers/coding-workspace/manager.js workers/coding-workspace/ingress.js workers/coding-workspace/egress.js workers/coding-workspace/test-database ./workers/coding-workspace/
# Only supervisor is root. Every command runs UID/GID1000 with a clean environment.
USER 0:0
ENV PORT=3000 CODING_STORAGE_ROOT=/workspace
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","workers/coding-workspace/server.js"]

FROM runtime AS runtime-smoke
COPY workers/coding-workspace/smoke.test.js ./workers/coding-workspace/

# CI-only stage: exercise real public connector doors against the isolated runtime.
FROM runtime AS connector-test
WORKDIR /connector
ENV HOME=/tmp/playground-supervisor XDG_DATA_HOME=/tmp/playground-supervisor/data
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY src/ ./src/
COPY vendor/ ./vendor/
COPY test/helpers/ ./test/helpers/
COPY workers/native-git/ ./workers/native-git/
COPY workers/coding-workspace/ ./workers/coding-workspace/
CMD ["node_modules/.bin/vitest","run","--config","workers/coding-workspace/vitest.connector.config.js","--configLoader","native"]

# Default/production build must not include CI-only dependencies or fixture code.
FROM runtime AS production
