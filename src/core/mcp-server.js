// Contract-generic MCP endpoint (A-3b). Authenticates the bearer, then serves tools/list from the registry and sends
// tools/call to an injected `dispatch`. The default dispatch answers every call with "unknown tool", so a registered
// tool can never run until the safety layer (Batch B) supplies a dispatcher that enforces it: default deny.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpToken } from './mcp-auth.js';
import { LISTINGS } from './registry.js';
import { pageToolsForListing } from './tool-pages.js';

const unknownTool = (name) => ({ isError: true, content: [{ type: 'text', text: `Unknown or unavailable tool: ${String(name).slice(0, 80)}` }] });
export const denyAll = async ({ name }) => unknownTool(name);
/** A client may ask for the other listing with `?listing=catalog` or `?listing=compact` on the endpoint. */
function listingFor(req, connection) {
  try {
    const asked = new URL(req.url ?? '/', 'http://localhost').searchParams.get('listing');
    if (LISTINGS.includes(asked)) return asked;
  } catch { /* the connection's own listing applies */ }
  return LISTINGS.includes(connection.listing) ? connection.listing : 'catalog';
}

/** `offered(registry, connection, listing)` (optional, async) narrows what tools/list shows, e.g. to features an account
 *  really has. It only hides: calls still go to `dispatch`, which applies its own checks. A failure lists the registry. */
export function createMcpHandler({ db, registry, env = process.env, toConnection, toolSecuritySchemes, offered = null, dispatch = denyAll, serverInfo = { name: 'robinson-mcp', version: '0.1.0' } }) {
  return async function mcp(req, res) {
    const connection = await requireMcpToken(req, res, db, env, { toConnection });
    if (!connection) return;
    const server = new Server(serverInfo, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async (request) => {
      const listing = listingFor(req, connection);
      let shown = registry;
      if (typeof offered === 'function') { try { shown = (await offered(registry, connection, listing)) ?? registry; } catch { shown = registry; } }
      const page=pageToolsForListing(shown, connection.profile, listing, request.params?.cursor, connection);
      if(toolSecuritySchemes)
        page.tools=page.tools.map(tool=>({...tool,securitySchemes:toolSecuritySchemes(tool,connection)}));
      return page;
    });
    server.setRequestHandler(CallToolRequestSchema, async (request) =>
      dispatch({ registry, name: request.params?.name, args: request.params?.arguments, connection, db }));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on?.('close', () => { transport.close(); server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) res.status(500).json({ error: 'internal_error' });
    }
  };
}
