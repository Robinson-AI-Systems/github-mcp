// GitHub MCP composition boundary for the setup page and the GitHub redirects (A-5b). One serverless function serves all of
// them (Vercel's Hobby plan caps the number of functions), selected by the first path segment.
import { createSetupHandlers } from './setup-page.js';
import { createWebhookHandler } from './webhook.js';
import { getSecretsRuntime } from '../runtime.js';
import privateTenantCallback from '../../api/tenant/oauth/callback.js';
import { publicCallback, publicInstallReturn } from '../tenancy/public-http.js';
import { createPublicCleanup } from '../tenancy/public-cleanup.js';
import { publicConnectEnabled } from '../tenancy/public-connect.js';
import { neon } from '@neondatabase/serverless';
import { marketplaceEnabled } from '../marketplace/lifecycle.js';
import { marketplaceSetup } from '../marketplace/setup.js';

const ROUTES = { 'setup': 'setup', 'manifest-callback': 'manifestCallback', 'user-callback': 'userCallback' };

/** Runs one setup handler. Any failure answers 503 with no detail (never SQL, tokens, passphrases or stack text). */
export async function handleGithub(action, req, res, { runtime, env = process.env, fetch = globalThis.fetch } = {}) {
  const name = Object.hasOwn(ROUTES, String(action)) ? ROUTES[action] : null;
  if (!name) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(404).json({ error: 'not_found' });
  }
  try {
    // A dot cannot occur in owner base64url states. Route every marked state,
    // including malformed ones, privately; never retry it through owner auth.
    if(action==='user-callback' && String(req.query?.state||'').startsWith('pt.'))
      return privateTenantCallback(req,res);
    // PUB-6 (dark): the simple public connect flow's own marked states; never retried through owner auth.
    if(action==='user-callback' && String(req.query?.state||'').startsWith('pc.'))
      return await publicCallback(req,res,{env});
    if(action==='setup' && String(req.query?.state||'').startsWith('pc.'))
      return await publicInstallReturn(req,res,{env});
    const { db, credentials, oneTimeStore } = runtime ?? await getSecretsRuntime({ env, fetch });
    if (action==='setup' && !req.query?.state && req.query?.installation_id && marketplaceEnabled(env))
      return await marketplaceSetup(req,res,{sql:neon(env.DATABASE_URL),credentials,env,fetchImpl:fetch});
    const handlers = createSetupHandlers({ db, credentials, oneTimeStore, env, fetch });
    res.setHeader('Cache-Control', 'no-store');
    return await handlers[name](req, res);
  } catch {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ error: 'temporarily_unavailable', description: 'GitHub Unleashed is not configured or its database is unavailable' });
  }
}

/** The App webhook. Same rule: any failure before the signature is checked answers 503 with no detail. */
export async function handleWebhook(req, res, { runtime, env = process.env, fetch = globalThis.fetch, publicCleanup } = {}) {
  try {
    const { db, credentials } = runtime ?? await getSecretsRuntime({ env, fetch });
    // LAUNCH-1: public people's own stores are tidied too when the public sign-in is on.
    const cleanup = publicCleanup ?? (publicConnectEnabled(env) && env.DATABASE_URL
      ? createPublicCleanup({ rootSql: neon(env.DATABASE_URL), connectionString: env.DATABASE_URL }) : null);
    return await createWebhookHandler({ db, credentials, publicCleanup: cleanup })(req, res);
  } catch {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ error: 'temporarily_unavailable' });
  }
}
