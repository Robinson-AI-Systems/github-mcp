// Contract-generic MCP bearer authentication (A-3b). Adapted from Robinson-AI-Systems/stripe-mcp src/core/mcp-auth.js @ 90a49c0.
// Never forwards the bearer to any provider. What a stored token row means for this service is decided by the injected
// `toConnection(record, env)`: it returns { connection } (a frozen object handed to tools) or { refuse: { status, body } }.
import { publicOrigin, send } from './http.js';

const BEARER = /^[Bb][Ee][Aa][Rr][Ee][Rr][ \t]+([A-Za-z0-9_-]{30,256})$/;
const challengeFor = (env) => `Bearer resource_metadata="${publicOrigin(env)}/.well-known/oauth-protected-resource"`;

/** True when the request carries something shaped like an access token. Pure: no store, no I/O (DOOR-DB-1). */
export const presentsMcpBearer = (req) => BEARER.test(String(req.headers?.authorization || ''));

/** The sign-in challenge for a request with no usable bearer. Needs no store, so an entry point can answer a keyless
 *  knock before it opens one (DOOR-DB-1); requireMcpToken sends exactly this refusal for the same requests. */
export function refuseMissingMcpBearer(res, env = process.env) {
  const challenge = challengeFor(env);
  res.setHeader('WWW-Authenticate', challenge);
  send(res, 401, { error: 'unauthorized', error_description: 'A valid connection is required' });
  return null;
}

export async function requireMcpToken(req, res, db, env = process.env, { toConnection } = {}) {
  if (typeof toConnection !== 'function') throw new TypeError('requireMcpToken needs a toConnection function.');
  const challenge = challengeFor(env);
  const match = BEARER.exec(String(req.headers?.authorization || ''));
  if (!match) return refuseMissingMcpBearer(res, env);
  const record = await db.getAccessToken(match[1]);
  const decision = record ? toConnection(record, env) : null;
  if (!decision) {
    res.setHeader('WWW-Authenticate', challenge + ', error="invalid_token"');
    send(res, 401, { error: 'invalid_token' });
    return null;
  }
  if (decision.refuse) {
    send(res, decision.refuse.status, decision.refuse.body);
    return null;
  }
  return decision.connection;
}
