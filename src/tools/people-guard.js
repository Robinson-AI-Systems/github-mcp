import { redact } from './util.js';
import { isOwnerConnection } from '../core/authority.js';
// The people guard (B4): who a change can reach and whose access it widens. Tools call these helpers from `classify`; the numbers
// and names come from GitHub and the owner's settings, never from the arguments' say-so.
//   - Messages (`M`): GitHub notifies people when issues, comments, reviews, assignments, releases and invitations are created. A change
//     that can reach only "your own people" (members of your connected accounts, github-actions[bot], this server's own App bots, plus
//     anyone you add on the setup page) needs no confirmation. Anyone else, a repository of an account that is not connected, and every
//     invitation does, and the preview names who would be notified.
//   - Access (`A`): anything that gives a person, key or app more access, or makes something public, always asks first, and the preview
//     says who gets what and what they have today. `accessChange` and `invitation` build that classification.
import { githubFor, listAll } from '../github/client.js';
import { isValidLogin } from '../github/app-manifest.js';

export const GITHUB_ACTIONS_BOT = 'github-actions[bot]';
export const OWN_PEOPLE_KEY = 'own_people';
const MEMBERS_TTL_MS = 10 * 60 * 1000;
const MAX_EXTRA = 50;
const memberCache = new WeakMap();

/** Cleans the extra own-people list typed on the setup page. Returns `{ logins }` or `{ error }`. */
export function cleanLogins(input) {
  const raw = Array.isArray(input) ? input : String(input ?? '').split(/[,\s]+/);
  const logins = [...new Set(raw.map((n) => String(n).trim().replace(/^@/, '')).filter(Boolean))];
  if (logins.length > MAX_EXTRA) return { error: `At most ${MAX_EXTRA} names.` };
  const bad = logins.find((n) => !isValidLogin(n.replace(/\[bot\]$/i, '')));
  if (bad) return { error: `"${redact(bad).slice(0, 40)}" is not a valid GitHub name.` };
  return { logins };
}

export async function extraOwnPeople(db) {
  const stored = await db.getSetting(OWN_PEOPLE_KEY).catch(() => null);
  return Array.isArray(stored?.logins) ? stored.logins.filter((n) => typeof n === 'string').slice(0, MAX_EXTRA) : [];
}

/** Members of one connected organization, cached for ten minutes. A failed lookup is `null` (the caller then treats members as outsiders). */
async function membersOf(ctx, org) {
  const cache = memberCache.get(ctx.db) ?? new Map();
  memberCache.set(ctx.db, cache);
  const now = (ctx.now ?? Date.now)();
  const hit = cache.get(org.toLowerCase());
  if (hit && now - hit.at < MEMBERS_TTL_MS) return hit.logins;
  try {
    const octokit = await githubFor(ctx, { owner: org });
    const { items } = await listAll(octokit, 'GET /orgs/{org}/members', { org }, { max: 1000 });
    const logins = items.map((m) => String(m.login).toLowerCase());
    cache.set(org.toLowerCase(), { at: now, logins });
    return logins;
  } catch { return null; }
}

/** The set of lowercase logins counted as "your own people" for this server, and whether every connected organization's member list was read. */
export async function ownPeople(ctx) {
  const people = new Set([GITHUB_ACTIONS_BOT]);
  let complete = true;
  for (const account of await ctx.db.listAccounts()) {
    people.add(account.login.toLowerCase());
    if (account.app_id != null) {
      const app = await ctx.db.getApp(account.app_id).catch(() => null);
      if (app?.slug) people.add(`${app.slug}[bot]`.toLowerCase());
    }
    if (account.account_type === 'Organization') {
      const members = await membersOf(ctx, account.login);
      if (members) members.forEach((m) => people.add(m)); else complete = false;
    }
  }
  for (const login of await extraOwnPeople(ctx.db)) people.add(login.toLowerCase());
  return { people, complete };
}

/** Logins mentioned in text (`@name`); `@org/team` counts as the team's organization. */
export function mentionsIn(text) {
  const found = new Set();
  for (const m of String(text ?? '').matchAll(/(?:^|[^A-Za-z0-9_`])@([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?(?:\[bot\])?)(\/[A-Za-z0-9_-]+)?/g)) {
    found.add(m[2] ? `${m[1]}${m[2]}` : m[1]);
  }
  return [...found];
}

/**
 * Who a change could notify outside your own people. Pass the people named by the arguments (assignees, reviewers, invitees) in
 * `logins`, any text that may contain mentions in `text`, and the repository owner. Returns `{ notifies }` for `classify` to merge.
 */
export async function notifyOutsiders(ctx, { logins = [], text = '', repoOwner }) {
  const { people } = await ownPeople(ctx);
  const accounts = new Set((await ctx.db.listAccounts()).map((a) => a.login.toLowerCase()));
  const named = [...new Set([...logins, ...mentionsIn(text)].map(String))];
  const outsiders = named.filter((n) => {
    const lower = n.toLowerCase();
    if (lower.includes('/')) return !accounts.has(lower.split('/')[0]); // a team of one of your own organizations is your own people
    return !people.has(lower);
  });
  if (repoOwner && !accounts.has(String(repoOwner).toLowerCase())) outsiders.push(`everyone watching ${repoOwner}`);
  return { notifies: outsiders.slice(0, 25) };
}

/** A person, key or app gaining access. `before` says what they have today ("none" when nothing). */
export function accessChange({ who, access, where, before = 'none' }) {
  return { accessWidening: `${who} gets ${access} access to ${where}; today: ${before}` };
}

/** An invitation: widens access and always notifies the invitee, whoever they are. */
export function invitation({ who, access, where, before = 'none' }) {
  return { ...accessChange({ who, access, where, before }), notifies: [who] };
}

/** Anything becoming public, or a setting that widens who can reach something. */
export function becomesPublic({ what }) {
  return { accessWidening: `${what} becomes visible to everyone` };
}

/** Keeps a tool honest: one declared as widening access always asks, even if its classification came back empty. */
export function peopleGate() {
  return async ({ classification, declarations, ctx }) => {
    if (isOwnerConnection(ctx?.connection)) return null;
    if (declarations?.accessWidening && !classification.accessWidening) return { confirm: 'This tool widens access, so it always asks first.' };
    return null;
  };
}
