// GOD-6: "is this request one only an App may make?" The list itself is generated (app-only-routes.js); this is the matcher.
import { APP_ONLY, APP_ONLY_GRAPHQL, APP_ONLY_PREFIXES } from './app-only-routes.js';

const compiled = APP_ONLY.map((route) => {
  const [method, template] = route.split(' ');
  const source = template.split('/').map((seg) => seg.replace(/\{[^}]+\}/g, '[^/]+')).join('/');
  return { method, regex: new RegExp(`^${source}$`) };
});

/**
 * `url` may be a template-expanded path, an absolute URL with a query (pagination's next pages) or a plain path; `query`
 * is the GraphQL document for `POST /graphql`. An unreadable URL counts as app-only: the safe side is the app.
 */
export function isAppOnly(method, url, query) {
  let pathname;
  try { pathname = new URL(url, 'https://api.github.com').pathname; } catch { return true; }
  if (pathname.startsWith('/graphql')) {
    const doc = String(query ?? '');
    return APP_ONLY_GRAPHQL.some((name) => new RegExp(`\\b${name}\\b`).test(doc));
  }
  if (APP_ONLY_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  const m = String(method || 'GET').toUpperCase();
  return compiled.some((c) => c.method === m && c.regex.test(pathname));
}
