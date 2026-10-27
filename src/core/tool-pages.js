// Bounded standard MCP tools/list pagination. Catalog means ALL visible tools across pages,
// never silently discarding a capability to fit the session's context budget.
import { createHash } from 'node:crypto';
import { listedTool, toolsForListing } from './registry.js';

export const TOOLS_PER_PAGE = 40;

function fingerprint(tools) {
  return createHash('sha256').update(tools.map(t => t.name).join('\n')).digest('hex').slice(0, 20);
}
function decodeCursor(cursor, profile, listing, total, fingerprintValue) {
  if (cursor === undefined || cursor === null) return 0;
  if (typeof cursor !== 'string' || cursor.length > 320 || !/^[A-Za-z0-9_-]+$/.test(cursor))
    throw new TypeError('Invalid or stale tools/list cursor; restart from the first page.');
  let data;
  try { data = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); }
  catch { throw new TypeError('Invalid or stale tools/list cursor; restart from the first page.'); }
  if (!Array.isArray(data) || data.length !== 6 ||
      data[0] !== 1 || data[1] !== profile || data[2] !== listing ||
      data[4] !== total || data[5] !== fingerprintValue ||
      !Number.isSafeInteger(data[3]) || data[3] < 1 || data[3] >= total ||
      data[3] % TOOLS_PER_PAGE !== 0)
    throw new TypeError('Invalid or stale tools/list cursor; restart from the first page.');
  return data[3];
}

/** Each page is a truthful slice of the selected profile/listing, with an MCP nextCursor. */
export function pageToolsForListing(registry, profile, listing, cursor) {
  const available = toolsForListing(registry, profile, listing);
  const digest = fingerprint(available);
  const offset = decodeCursor(cursor, profile, listing, available.length, digest);
  const tools = available.slice(offset, offset + TOOLS_PER_PAGE).map(tool => listedTool(tool, { compact: listing === 'compact' }));
  const nextOffset = offset + tools.length;
  return {
    tools,
    ...(nextOffset < available.length ? { nextCursor: Buffer.from(JSON.stringify([1, profile, listing, nextOffset, available.length, digest])).toString('base64url') } : {})
  };
}

/** Enumerate all pages for deterministic offline budget and coverage tests, never provider calls. */
export function* toolListingPages(registry, profile, listing) {
  let cursor;
  do {
    const page = pageToolsForListing(registry, profile, listing, cursor);
    yield page;
    cursor = page.nextCursor;
  } while (cursor);
}
