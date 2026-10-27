import { createMcpHandler } from '../src/core/mcp-server.js';
import { registry } from '../src/tools/index.js';
import { createGithubPolicy } from '../src/oauth/policy.js';
import { createDispatch } from '../src/tools/dispatch.js';
import { createGates } from '../src/tools/gates.js';
import { getSecretsRuntime } from '../src/runtime.js';
import { isPrivateTenantBearer, resolvePrivateTenantMcpBearer, requestScopedVerifiedAccess } from '../src/tenancy/mcp-route.js';
import { serverInfo } from '../src/brand/brand.js';
import { publicOrigin } from '../src/core/http.js';
import { loadZone, withTimeZone } from '../src/core/time-zone.js';
import { admitTenantMcp, TenantCapacityError, recordTenantMetric } from '../src/tenancy/runtime-limits.js';
import { neon } from '@neondatabase/serverless';
import { isPublicClientId } from '../src/tenancy/public-code.js';
import { createPublicUsage, publicUsageLimits } from '../src/tenancy/public-usage.js';

const safeOrigin = () => { try { return publicOrigin(); } catch { return null; } };

export const config = { api: { bodyParser: true } };

export async function handleMcp(req, res, { marketplaceAccountId = null } = {}) {
  const began = Date.now();
  let tenantSql = null;
  let providerMetrics = null;
  let eventOutcome = 'error';
  let usage = null, usageHook = null, publicTenantId = null, countedCall = false;
  try {
    // Tenant-marked access tokens are NEVER retried against the owner database.
    // When the closed pilot is disabled or its grant is revoked, return 401.
    const tenantRoute = isPrivateTenantBearer(req.headers?.authorization);
    const context = tenantRoute
      ? await resolvePrivateTenantMcpBearer({ authorization: req.headers.authorization })
      : await getSecretsRuntime();
    if (!context || (context.marketplaceAccountId ?? null) !== marketplaceAccountId) {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
      return res.status(401).json({ error: 'invalid_token' });
    }
    const credentials = context.credentials;
    // The private route already verified the SAME bearer row; avoid repeating
    // its SQL SELECT/last-used UPDATE when the MCP core parses this request.
    const db = tenantRoute
      ? requestScopedVerifiedAccess(context.db, context.verifiedAccess.token, context.verifiedAccess.record)
      : context.db;
    if (tenantRoute) {
      tenantSql = context.sql;
      providerMetrics = context.providerMetrics ?? null;
      // All active tenant clients share one DB-backed budget; each connection
      // has a smaller independent burst limit. Original owner unchanged.
      await admitTenantMcp(tenantSql, context.clientId);
      // PUB-5 B: free fair use for PUBLIC people. Only `tools/call` counts (initialize, tools/list and notifications are free);
      // real changes are counted one by one inside dispatch. Numbers only, kept at the shared level.
      if (isPublicClientId(context.clientId) && process.env.DATABASE_URL) {
        publicTenantId = String(context.tenant.tenantId);
        usage = createPublicUsage(neon(process.env.DATABASE_URL), publicUsageLimits(process.env));
        const items = Array.isArray(req.body) ? req.body : [req.body];
        const calls = items.filter((m) => m?.method === 'tools/call').length;
        if (calls > 0) {
          // A counting problem never takes the service down: the call just goes uncounted.
          let exempt = false, claim = null;
          try {
            exempt = await usage.isExempt(String(context.tenant.identityId));
            claim = await usage.claimCalls(publicTenantId, { n: calls, exempt });
          } catch { claim = null; }
          if (claim && !claim.ok) {
            eventOutcome = 'throttled';
            res.setHeader('Cache-Control', 'no-store');
            res.setHeader('Retry-After', String(claim.retryAfterSeconds));
            const detail = { error: 'rate_limited', retry_after_seconds: claim.retryAfterSeconds };
            // A single call gets an ordinary tool answer the assistant can read; a batch is refused as a whole.
            if (!Array.isArray(req.body)) return res.status(200).json({ jsonrpc: '2.0', id: req.body.id ?? null,
              result: { isError: true, content: [{ type: 'text', text: claim.message }], structuredContent: detail } });
            return res.status(429).json({ ...detail, error_description: claim.message });
          }
          countedCall = claim !== null;
          usageHook = usage.dispatchHook(publicTenantId, { exempt });
        }
      }
    }
    const policy = createGithubPolicy();
    const zone = await loadZone(db);
    const answer = await withTimeZone(zone, () => createMcpHandler({
      ...(tenantRoute?{toolSecuritySchemes:tool=>[{type:'oauth2',
        scopes:tool.name==='github_notify_list'?['github.notifications.read']:[]}]}:{}),
      db, registry, toConnection: policy.toConnection, dispatch: createDispatch({ credentials, gates: createGates({ db }), ...(usageHook ? { usage: usageHook } : {}) }), serverInfo: serverInfo(safeOrigin())
    })(req, res));
    eventOutcome = 'ok';
    return answer;
  } catch (error) {
    if (!res.headersSent && error instanceof TenantCapacityError) {
      eventOutcome = 'throttled';
      res.setHeader('Cache-Control','no-store');
      res.setHeader('Retry-After', String(error.retryAfterSeconds));
      return res.status(429).json({ error:'rate_limited',
        error_description:'This private connection is temporarily busy. Retry later.',
        retry_after_seconds:error.retryAfterSeconds });
    }
    if (!res.headersSent) {
      return res.status(503).json({ error: 'temporarily_unavailable', error_description: 'GitHub MCP is not configured or its database is unavailable' });
    }
  } finally {
    if (tenantSql) {
      const metric = {event:'mcp',outcome:eventOutcome,durationMs:Math.max(0,Date.now()-began)};
      if (providerMetrics) {
        // GitHub fetches already recorded their outcomes in this request's
        // bounded buffer. Await one final per-tenant SQL upsert so no
        // fire-and-forget metric is lost when a serverless worker finishes.
        try {
          providerMetrics.record(metric);
          await providerMetrics.flush();
        } catch { /* telemetry failure never changes the MCP result */ }
      } else {
        await recordTenantMetric(tenantSql,metric).catch(()=>{});
      }
    }
    if (countedCall && eventOutcome === 'error') await usage.recordError(publicTenantId).catch(() => {});
  }
}

export default (req, res) => handleMcp(req, res);
