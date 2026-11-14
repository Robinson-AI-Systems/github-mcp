import { getSecretsRuntime } from '../../src/runtime.js';
import { storeFactory } from '../../src/db-transport.js';
import { cronAuthorized, sweepMarketplace } from '../../src/marketplace/lifecycle.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control','no-store');
  if (req.method !== 'GET') { res.setHeader('Allow','GET'); return res.status(405).json({error:'method_not_allowed'}); }
  if (!cronAuthorized(req.headers?.authorization,process.env)) return res.status(401).json({error:'unauthorized'});
  try {
    const {db} = await getSecretsRuntime();
    const result = await sweepMarketplace({sql:storeFactory(process.env.DATABASE_URL),rootDb:db,env:process.env});
    return res.status(result.failed ? 503 : 200).json(result);
  } catch { return res.status(503).json({error:'temporarily_unavailable'}); }
}
