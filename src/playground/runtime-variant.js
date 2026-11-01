// FLEET-2 gate: which runtime image a NEW allocation uses, decided from measured facts
// and explained in plain words. The slim image (no Chromium/Playwright browsers, no
// PostgreSQL) is used only when the size class is `small` AND the repository's own files
// show no browser or database signals. Anything unreadable counts as a signal (full
// image), so the gate can only ever pick the image that has everything when unsure.
// Missing slim image -> full image -> source build (the existing fallback).
import {callNativeWorker} from '../native-git/client.js';
import {resolvePrebuiltImage} from './prebuilt-image.js';

const BROWSER_PACKAGES = ['playwright', '@playwright/test', 'puppeteer', 'puppeteer-core', 'cypress', 'selenium-webdriver'];
const DATABASE_PACKAGES = ['pg', 'postgres', 'pg-promise', 'prisma', '@prisma/client', 'typeorm', 'sequelize', 'knex', '@databases/pg', 'slonik'];
const PYTHON_SIGNALS = [[/\bpsycopg(2|_binary|\[|\b)/i, 'database', 'psycopg'], [/\basyncpg\b/i, 'database', 'asyncpg'], [/\bsqlalchemy\b/i, 'database', 'sqlalchemy'], [/\bselenium\b/i, 'browser', 'selenium'], [/\bplaywright\b/i, 'browser', 'playwright'], [/\bpyppeteer\b/i, 'browser', 'pyppeteer']];
const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];
export const SIGNAL_FILES = Object.freeze(['package.json', 'requirements.txt', 'pyproject.toml', ...COMPOSE_FILES]);
const MAX_WINDOWS = 4, WINDOW = 32768; // at most 128 KiB per file; a larger file is "unknown"

/** Signals from already-read file text. `files` maps path -> string (present), null (absent) or undefined (unreadable). */
export function signalsFromFiles(files = {}) {
  const signals = [];
  const add = (kind, name, file) => { if (!signals.some(s => s.kind === kind && s.name === name)) signals.push({kind, name, file}); };
  for (const path of SIGNAL_FILES) {
    const text = files[path];
    if (text === null) continue; // the file does not exist
    if (typeof text !== 'string') { add('unknown', 'unreadable', path); continue; }
    if (path === 'package.json') {
      let pkg; try { pkg = JSON.parse(text); } catch { add('unknown', 'invalid_json', path); continue; }
      const deps = {...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}), ...(pkg?.optionalDependencies ?? {})};
      for (const name of BROWSER_PACKAGES) if (Object.hasOwn(deps, name)) add('browser', name, path);
      for (const name of DATABASE_PACKAGES) if (Object.hasOwn(deps, name)) add('database', name, path);
    } else if (COMPOSE_FILES.includes(path)) {
      if (/postgres/i.test(text)) add('database', 'postgres service', path);
    } else {
      for (const [pattern, kind, name] of PYTHON_SIGNALS) if (pattern.test(text)) add(kind, name, path);
    }
  }
  return signals;
}

/** Read the signal files from the workspace through the native Git worker (only for a NEW allocation, which an agent asked for). */
export async function repositorySignals(ctx, record, {call = callNativeWorker} = {}) {
  const read = async path => {
    let text = '', offset = 0, hash;
    for (let i = 0; i < MAX_WINDOWS; i++) {
      let r;
      try { r = await call(ctx, {binding: record.binding, job: record.job, workspace_id: record.worker, action: 'read', operation: 'read_file', options: {path, byteOffset: offset, byteLength: WINDOW, ...(hash ? {expectedFileHash: hash} : {})}}); }
      catch (error) { return error?.status === 404 ? null : undefined; }
      if (typeof r?.content_base64 !== 'string') return undefined;
      text += Buffer.from(r.content_base64, 'base64').toString('utf8'); hash = r.file_hash;
      if (r.complete) return text;
      offset = r.next_byte_offset;
    }
    return undefined; // too large to read fully: unknown
  };
  // One at a time: the worker holds one lease per workspace and answers "busy" to overlapping calls.
  const files = {};
  for (const path of SIGNAL_FILES) files[path] = await read(path);
  return signalsFromFiles(files);
}

const describeSignals = signals => signals.map(s => s.kind === 'unknown' ? `${s.file} could not be read` : `${s.name} in ${s.file}`).join(', ');

/** The gate itself (pure): slim only for size small with no browser/database/unknown signals. */
export function slimDecision({size, signals}) {
  if (size !== 'small') return {useSlim: false, reason: `Size ${size ?? 'default'} uses the full image; the slim image is only for small jobs.`};
  if (!Array.isArray(signals)) return {useSlim: false, reason: 'The repository files were not checked, so the full image is used.'};
  if (signals.length) return {useSlim: false, reason: `The repository needs a browser or database (${describeSignals(signals).slice(0, 300)}), so the full image is used.`};
  return {useSlim: true, reason: 'Small job and the repository shows no browser or database, so the slim image (no Chromium, no PostgreSQL) is used.'};
}

/** Smallest size that fits the signals, for `auto` one-off runs: browsers need large, a database medium. */
export function autoSizeFor(signals) {
  if (!Array.isArray(signals)) return {size: 'medium', reason: 'The repository files could not be checked, so medium was chosen.'};
  if (signals.some(s => s.kind === 'browser')) return {size: 'large', reason: `Browser tests need large (${describeSignals(signals.filter(s => s.kind === 'browser')).slice(0, 200)}).`};
  if (signals.some(s => s.kind === 'database' || s.kind === 'unknown')) return {size: 'medium', reason: `A test database (or an unreadable file) needs medium (${describeSignals(signals).slice(0, 200)}).`};
  return {size: 'small', reason: 'No browser or database in the repository, so small was chosen.'};
}

/**
 * Which image a new allocation of `size` uses. Returns `{image, record}`: `image` is a pinned
 * `repo@digest` or null (source build / operator pin), `record` is what the allocation plan
 * stores and `github_playground_read allocation` shows.
 */
export async function chooseRuntimeImage(ctx, record, size, {pinned = false, signals, detect = repositorySignals, resolve = resolvePrebuiltImage} = {}) {
  const env = ctx.env ?? {}, fetch = ctx.fetch ?? globalThis.fetch;
  if (env.PLAYGROUND_IMAGE || pinned) return {image: null, record: {variant: 'operator_pinned', reason: 'The operator pinned a runtime image; it is used as-is.'}};
  let checked = signals;
  if (size === 'small' && !Array.isArray(checked)) { try { checked = await detect(ctx, record); } catch { checked = undefined; } }
  const gate = slimDecision({size, signals: checked});
  const facts = Array.isArray(checked) ? {signals: checked.slice(0, 20)} : {};
  if (gate.useSlim) {
    const slim = await resolve(env, {fetch, variant: 'slim'});
    if (slim) return {image: slim, record: {variant: 'slim', reason: gate.reason, ...facts}};
    const full = await resolve(env, {fetch});
    if (full) return {image: full, record: {variant: 'full', reason: gate.reason + ' No slim image is published for this server version yet, so the full image is used.', ...facts}};
    return {image: null, record: {variant: 'source_build', reason: gate.reason + ' No published image exists for this server version, so the runtime is built from source.', ...facts}};
  }
  const full = await resolve(env, {fetch});
  if (full) return {image: full, record: {variant: 'full', reason: gate.reason, ...facts}};
  return {image: null, record: {variant: 'source_build', reason: gate.reason + ' No published image exists for this server version, so the runtime is built from source.', ...facts}};
}
