import { bareOctokit } from '../github/client.js';
import { escapeHtml, send } from '../core/http.js';
import { BRAND_CSS, brandHeader, brandFooter } from '../brand/brand.js';
import { marketplaceAccount, marketplaceResource } from './resource.js';
import { marketplaceEnabled } from './lifecycle.js';
import { createMarketplaceStore } from './store.js';

/** Installation IDs are selectors, never authority. GitHub resolves the account using this App's own JWT;
 * connecting still requires the subscriber's separate OAuth consent, purchase readback and administrator proof. */
export async function marketplaceSetup(req, res, { sql, credentials, env, fetchImpl = fetch }) {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
  res.setHeader('Referrer-Policy','no-referrer');
  if (!marketplaceEnabled(env)) return res.status(404).json({error:'not_found'});
  if (req.method !== 'GET') { res.setHeader('Allow','GET'); return res.status(405).json({error:'method_not_allowed'}); }
  const installationId = marketplaceAccount(req.query?.installation_id);
  if (!installationId) return res.status(400).json({error:'invalid_request'});
  try {
    const api = bareOctokit({token:await credentials.appJwt(Number(env.GITHUB_PILOT_APP_ID)),fetch:fetchImpl});
    const {data} = await api.request('GET /app/installations/{installation_id}', {installation_id:installationId,request:{timeout:10000}});
    const account = marketplaceAccount(data.account?.id);
    if (!account || data.suspended_at || data.app_id !== Number(env.GITHUB_PILOT_APP_ID)) throw new Error('Invalid installation');
    const subscription = await createMarketplaceStore(sql).subscription(account);
    const body = subscription?.status === 'active'
      ? `<p>Add a custom MCP connector in your assistant and paste this address:</p><p><code style="overflow-wrap:anywhere">${escapeHtml(marketplaceResource(account,env))}</code></p><p>Choose Connect, sign in with GitHub, and approve access for this Marketplace account. We check your active subscription and account permissions.</p><p><a href="/connection?marketplace_account=${account}">Manage this Marketplace connection</a></p>`
      : '<p>Your GitHub App installation is ready. If you just subscribed through Marketplace, wait a moment and reload this page while GitHub delivers the purchase.</p><p><a href="https://www.robinsonaisystems.com/tools/github">Open the direct connection guide</a></p>';
    return send(res,200,`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect GitHub Unleashed</title><style>${BRAND_CSS}</style></head><body><main>${brandHeader()}<h1>Connect GitHub Unleashed by Robinson AI Systems</h1>${body}${brandFooter()}</main></body></html>`,'text/html; charset=utf-8');
  } catch { return res.status(503).json({error:'temporarily_unavailable'}); }
}
