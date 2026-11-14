// Wiki access (Y-8d). GitHub has no REST API for wikis: a wiki is the git repository <repo>.wiki.git. This is the ONLY place that speaks git.
// Rules: only https://github.com/<owner>/<repo>.wiki.git is reachable, redirects are refused, the installation token is sent only as the
// HTTP password and never appears in a URL, result or error, and everything lives in memory (nothing is written to disk).
import { createHash } from 'node:crypto';
import git from 'isomorphic-git';
import { memfs } from 'memfs';

export const WIKI_LIMITS = Object.freeze({ pages: 200, totalBytes: 5 * 1024 * 1024, transferBytes: 20 * 1024 * 1024, pageBytes: 1024 * 1024 });
export const WIKI_AUTHOR = Object.freeze({ name: 'GitHub Unleashed', email: 'noreply@users.noreply.github.com' });
const SEGMENT = /^[A-Za-z0-9._-]{1,100}$/;
const PAGE = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,99}$/;
const WIKI_PATH = /^\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\.wiki\.git\//;

const wikiError = (message) => new TypeError(message);

export function wikiUrl(owner, repo) {
  if (!SEGMENT.test(owner) || !SEGMENT.test(repo)) throw wikiError('The owner or repository name is not valid.');
  return `https://github.com/${owner}/${repo}.wiki.git`;
}
export function pageFile(page) {
  if (typeof page !== 'string' || !PAGE.test(page) || page.includes('..') || /\.md$/i.test(page)) throw wikiError('A wiki page name is letters, digits, spaces, dots, dashes and underscores (no folders, no ".md" ending).');
  return `${page}.md`;
}
export const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** isomorphic-git's http plugin, over the injected fetch, limited to the wiki git paths and a transfer cap. */
export function wikiHttp(fetchImpl) {
  return {
    async request({ url, method = 'GET', headers = {}, body }) {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com' || !WIKI_PATH.test(parsed.pathname)) throw wikiError('Only the repository wiki on github.com can be reached.');
      let payload;
      if (body) { const chunks = []; for await (const c of body) chunks.push(Buffer.from(c)); payload = Buffer.concat(chunks); }
      const res = await fetchImpl(url, { method, headers, ...(payload && payload.length ? { body: payload } : {}), redirect: 'error' });
      const received = []; let total = 0;
      for await (const c of res.body ?? []) {
        total += c.length;
        if (total > WIKI_LIMITS.transferBytes) throw wikiError('The wiki is larger than the 20 MB this server will transfer.');
        received.push(new Uint8Array(c));
      }
      return { url, method, statusCode: res.status, statusMessage: res.statusText, headers: Object.fromEntries(res.headers.entries()), body: received };
    }
  };
}

const auth = (token) => () => ({ username: 'x-access-token', password: token });
const explain = (error) => {
  if (error instanceof TypeError) return error;
  const code = error?.data?.statusCode ?? error?.code;
  if (code === 404 || error?.code === 'NotFoundError') return wikiError('This repository has no wiki yet. Turn the wiki on, then create its first page in the browser (GitHub only creates the wiki repository then).');
  if (code === 401 || code === 403) return wikiError('GitHub refused access to the wiki. The App needs repository Contents permission, and the wiki must be enabled.');
  return wikiError('The wiki could not be read or updated right now. Nothing was changed.');
};

/** A shallow in-memory copy of the wiki. */
export async function openWiki({ owner, repo, token, fetch }) {
  const { fs } = memfs();
  const http = wikiHttp(fetch);
  const url = wikiUrl(owner, repo);
  try {
    await git.clone({ fs, http, dir: '/', url, depth: 1, singleBranch: true, noTags: true, onAuth: auth(token) });
  } catch (error) { throw explain(error); }
  const branch = await git.currentBranch({ fs, dir: '/' });
  const files = (await git.listFiles({ fs, dir: '/', ref: 'HEAD' })).filter((f) => f.endsWith('.md') && !f.includes('/'));
  return { fs, http, url, token, branch, files };
}

export async function readPage(wiki, page) {
  const file = pageFile(page);
  if (!wiki.files.includes(file)) return null;
  const buffer = await wiki.fs.promises.readFile(`/${file}`);
  if (buffer.length > WIKI_LIMITS.pageBytes) throw wikiError('That page is larger than 1 MB.');
  return Buffer.from(buffer).toString('utf8');
}

export async function totalBytes(wiki) {
  let total = 0;
  for (const f of wiki.files) total += (await wiki.fs.promises.stat(`/${f}`)).size;
  return total;
}

/** Writes one page, makes one commit and pushes it. */
export async function commitPage(wiki, page, body, message) {
  const file = pageFile(page);
  if (Buffer.byteLength(body) > WIKI_LIMITS.pageBytes) throw wikiError('A page can be at most 1 MB.');
  if (!wiki.files.includes(file) && wiki.files.length >= WIKI_LIMITS.pages) throw wikiError(`A wiki can hold at most ${WIKI_LIMITS.pages} pages here.`);
  const growth = (await totalBytes(wiki)) + Buffer.byteLength(body);
  if (growth > WIKI_LIMITS.totalBytes) throw wikiError('The wiki would be larger than 5 MB.');
  await wiki.fs.promises.writeFile(`/${file}`, body);
  await git.add({ fs: wiki.fs, dir: '/', filepath: file });
  await git.commit({ fs: wiki.fs, dir: '/', message, author: { ...WIKI_AUTHOR }, committer: { ...WIKI_AUTHOR } });
  try {
    await git.push({ fs: wiki.fs, http: wiki.http, dir: '/', url: wiki.url, ref: wiki.branch, onAuth: auth(wiki.token) });
  } catch (error) { throw explain(error); }
}
