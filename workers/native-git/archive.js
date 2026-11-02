// GIT-UPLOAD-1: bounded, non-following readers for a one-time folder upload (.tar.gz, .tar, .zip).
// They only list entries and read bytes; nothing here writes into a workspace. Every name is
// checked before use: absolute paths, "..", ".git", backslashes, drive letters and control
// characters are refused, as are links, devices, FIFOs, encrypted or unknown entries, too many
// entries, oversize files and archives that expand far beyond their own size (zip bombs).
import { open, rm, stat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as zlib from 'node:zlib';

const MiB = 1024 * 1024;
export const ARCHIVE_LIMITS = Object.freeze({ entries: 10000, fileBytes: 100 * MiB, totalBytes: 256 * MiB, ratio: 100, ratioFloorBytes: 16 * MiB });
const refuse = message => Object.assign(new TypeError(`Archive refused: ${message}`), { refusal: true });
const shown = name => JSON.stringify(String(name).replace(/[\x00-\x1f\x7f]/g, '?').slice(0, 120));

/** A safe relative path (no leading "./", no trailing "/"), or a TypeError. */
export function entryPath(raw) {
  if (typeof raw !== 'string' || !raw.length || raw.length > 4096) throw refuse('an entry name is empty or too long');
  if (/[\x00-\x1f\x7f]/.test(raw) || raw.includes('\\') || raw.includes(':') || raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) throw refuse(`unsafe entry name ${shown(raw)}`);
  let name = raw;
  while (name.startsWith('./')) name = name.slice(2);
  if (name.endsWith('/')) name = name.slice(0, -1);
  if (!name.length) return '';
  const parts = name.split('/');
  if (parts.some(p => !p || p === '.' || p === '..' || p.toLowerCase() === '.git')) throw refuse(`unsafe entry name ${shown(raw)}`);
  return name;
}

async function readAt(handle, position, length) {
  const buffer = Buffer.alloc(length); let done = 0;
  while (done < length) { const { bytesRead } = await handle.read(buffer, done, length - done, position + done); if (!bytesRead) break; done += bytesRead; }
  return done === length ? buffer : buffer.subarray(0, done);
}

export async function detectFormat(file) {
  const handle = await open(file, 'r');
  try {
    const head = await readAt(handle, 0, 512);
    if (head.length >= 2 && head[0] === 0x1f && head[1] === 0x8b) return 'tar.gz';
    if (head.length >= 4 && head.readUInt32LE(0) === 0x04034b50) return 'zip';
    if (head.length === 512 && head.toString('latin1', 257, 262) === 'ustar') return 'tar';
    throw refuse('the upload is not a .tar.gz, .tar or .zip archive');
  } finally { await handle.close(); }
}

async function gunzipBounded(source, target, limit) {
  let total = 0;
  const counter = new Transform({ transform(chunk, _encoding, done) { total += chunk.length; if (total > limit) done(refuse(`it would expand beyond ${Math.round(limit / MiB)} MiB`)); else done(null, chunk); } });
  // Only a decompression error means damaged data; a storage error (full disk, an existing file) is
  // reported as what it is, never as "damaged" (CHUNK-UPLOAD-1: a stale expansion was once misread so).
  try { await pipeline(createReadStream(source), zlib.createGunzip(), counter, createWriteStream(target, { flags: 'wx', mode: 0o600 })); }
  catch (error) { await rm(target, { force: true }).catch(() => {}); if (error instanceof TypeError) throw error; if (/^Z_/.test(error?.code ?? '')) throw refuse('the gzip data is damaged'); throw new Error('The archive could not be expanded on the worker (storage); nothing was applied. Retry the apply.'); }
  return total;
}

const octal = (buffer, start, length) => {
  const field = buffer.subarray(start, start + length);
  if (field[0] & 0x80) throw refuse('base-256 sizes are not supported');
  const text = field.toString('latin1').replace(/\0.*$/s, '').trim();
  if (!text) return 0;
  if (!/^[0-7]+$/.test(text)) throw refuse('a tar header is damaged');
  return parseInt(text, 8);
};
const cstring = (buffer, start, length) => buffer.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '');

async function tarEntries(handle, size, limits) {
  const entries = []; let offset = 0, pax = {}, longName = null, headers = 0;
  while (offset + 512 <= size) {
    const header = await readAt(handle, offset, 512);
    if (header.every(b => b === 0)) break;
    if (++headers > limits.entries * 3) throw refuse(`more than ${limits.entries} entries`);
    let sum = 0; for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : header[i];
    if (octal(header, 148, 8) !== sum) throw refuse('a tar header checksum is wrong');
    const type = String.fromCharCode(header[156] || 48);
    const length = octal(header, 124, 12);
    const data = offset + 512; offset = data + Math.ceil(length / 512) * 512;
    if (offset > size + 512) throw refuse('the tar data is cut short');
    if (type === 'x' || type === 'g' || type === 'L') {
      if (length > MiB) throw refuse('a tar metadata record is too large');
      const meta = await readAt(handle, data, length);
      if (type === 'L') { longName = meta.toString('utf8').replace(/\0.*$/s, ''); continue; }
      if (type === 'g') continue;
      pax = {}; let at = 0;
      while (at < meta.length) {
        const space = meta.indexOf(0x20, at); if (space < 0) break;
        const recordLength = Number(meta.toString('latin1', at, space));
        if (!Number.isSafeInteger(recordLength) || recordLength <= 0 || at + recordLength > meta.length) throw refuse('a tar metadata record is damaged');
        const record = meta.toString('utf8', space + 1, at + recordLength - 1); const eq = record.indexOf('=');
        if (eq > 0) pax[record.slice(0, eq)] = record.slice(eq + 1);
        at += recordLength;
      }
      continue;
    }
    const prefix = header.toString('latin1', 257, 262) === 'ustar' ? cstring(header, 345, 155) : '';
    const raw = pax.path ?? longName ?? (prefix ? prefix + '/' : '') + cstring(header, 0, 100);
    const declared = pax.size !== undefined ? Number(pax.size) : length;
    pax = {}; longName = null;
    if (type === '1' || type === '2') throw refuse(`${shown(raw)} is a ${type === '1' ? 'hard link' : 'symbolic link'}`);
    if (['3', '4', '6'].includes(type)) throw refuse(`${shown(raw)} is a device or FIFO`);
    if (!['0', '7', '5'].includes(type)) throw refuse(`${shown(raw)} has an unsupported entry type`);
    if (!Number.isSafeInteger(declared) || declared < 0) throw refuse('a tar entry size is damaged');
    if (declared !== length) offset = data + Math.ceil(declared / 512) * 512;
    const at = data;
    entries.push({ raw, type: type === '5' ? 'dir' : 'file', size: type === '5' ? 0 : declared, read: async () => {
      const bytes = await readAt(handle, at, declared);
      if (bytes.length !== declared) throw refuse(`${shown(raw)} is cut short`);
      return bytes;
    } });
  }
  return entries;
}

async function zipEntries(handle, size, limits) {
  const tail = Math.min(size, 22 + 65535); const end = await readAt(handle, size - tail, tail);
  let at = -1; for (let i = end.length - 22; i >= 0; i--) if (end.readUInt32LE(i) === 0x06054b50) { at = i; break; }
  if (at < 0) throw refuse('the zip directory is missing');
  if (end.readUInt16LE(at + 4) !== 0 || end.readUInt16LE(at + 6) !== 0) throw refuse('multi-part zip archives are not supported');
  const count = end.readUInt16LE(at + 10), dirSize = end.readUInt32LE(at + 12), dirOffset = end.readUInt32LE(at + 16);
  if (count === 0xffff || dirSize === 0xffffffff || dirOffset === 0xffffffff) throw refuse('zip64 archives are not supported');
  if (count > limits.entries) throw refuse(`more than ${limits.entries} entries`);
  if (dirOffset + dirSize > size || dirSize > 64 * MiB) throw refuse('the zip directory is damaged');
  const dir = await readAt(handle, dirOffset, dirSize); const entries = []; let offset = 0;
  for (let n = 0; n < count; n++) {
    if (offset + 46 > dir.length || dir.readUInt32LE(offset) !== 0x02014b50) throw refuse('the zip directory is damaged');
    const madeBy = dir.readUInt16LE(offset + 4), flags = dir.readUInt16LE(offset + 8), method = dir.readUInt16LE(offset + 10);
    const crc = dir.readUInt32LE(offset + 16), csize = dir.readUInt32LE(offset + 20), usize = dir.readUInt32LE(offset + 24);
    const nameLength = dir.readUInt16LE(offset + 28), extraLength = dir.readUInt16LE(offset + 30), commentLength = dir.readUInt16LE(offset + 32);
    const external = dir.readUInt32LE(offset + 38), local = dir.readUInt32LE(offset + 42);
    const raw = dir.toString(flags & 0x800 ? 'utf8' : 'latin1', offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;
    if (flags & 1) throw refuse(`${shown(raw)} is encrypted`);
    if (csize === 0xffffffff || usize === 0xffffffff || local === 0xffffffff) throw refuse('zip64 archives are not supported');
    // Unix file-type bits are honoured whatever host wrote the archive (some tools omit the host byte).
    const unixType = (external >>> 16) & 0o170000; void madeBy;
    const directory = raw.endsWith('/') || unixType === 0o040000 || (!unixType && (external & 0x10) !== 0);
    if (unixType === 0o120000) throw refuse(`${shown(raw)} is a symbolic link`);
    if (unixType && ![0o100000, 0o040000].includes(unixType)) throw refuse(`${shown(raw)} is a device, FIFO or other special file`);
    if (!directory && ![0, 8].includes(method)) throw refuse(`${shown(raw)} uses unsupported compression`);
    if (!directory && usize > MiB && usize > limits.ratio * Math.max(csize, 1)) throw refuse(`${shown(raw)} expands more than ${limits.ratio} times (zip bomb)`);
    entries.push({ raw, type: directory ? 'dir' : 'file', size: directory ? 0 : usize, read: async () => {
      const header = await readAt(handle, local, 30);
      if (header.length !== 30 || header.readUInt32LE(0) !== 0x04034b50) throw refuse(`${shown(raw)} has a damaged file header`);
      const start = local + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
      const compressed = await readAt(handle, start, csize);
      if (compressed.length !== csize) throw refuse(`${shown(raw)} is cut short`);
      let bytes;
      if (method === 0) bytes = compressed;
      else { try { bytes = zlib.inflateRawSync(compressed, { maxOutputLength: Math.max(usize, 1) }); } catch { throw refuse(`${shown(raw)} does not unpack to its stated size`); } }
      if (bytes.length !== usize) throw refuse(`${shown(raw)} does not match its stated size`);
      if (typeof zlib.crc32 === 'function' && (zlib.crc32(bytes) >>> 0) !== crc) throw refuse(`${shown(raw)} failed its checksum`);
      return bytes;
    } });
  }
  return entries;
}

/**
 * Opens a quarantined archive and validates every entry before any byte is used.
 * Returns { format, files: [{ path, size, read }], directories, close }.
 */
export async function openArchive(file, workDir, limits = ARCHIVE_LIMITS) {
  const format = await detectFormat(file);
  const compressedBytes = (await stat(file)).size;
  let path = file, scratch = null;
  // CHUNK-UPLOAD-1: each open expands into its own scratch file, removed on close or failure, so a
  // refused apply leaves the quarantined upload exactly as received and a corrected apply still works.
  const drop = async () => { if (scratch) await rm(scratch, { force: true }).catch(() => {}); };
  if (format === 'tar.gz') {
    path = scratch = `${workDir}/expanded-${randomBytes(8).toString('hex')}.tar`;
    const expanded = await gunzipBounded(file, path, limits.totalBytes + (limits.entries + 2) * 1536);
    if (expanded > limits.ratioFloorBytes && expanded > limits.ratio * compressedBytes) { await drop(); throw refuse(`it expands more than ${limits.ratio} times (zip bomb)`); }
  }
  let handle; try { handle = await open(path, 'r'); } catch (error) { await drop(); throw error; }
  try {
    const size = (await handle.stat()).size;
    const raw = format === 'zip' ? await zipEntries(handle, size, limits) : await tarEntries(handle, size, limits);
    if (raw.length > limits.entries) throw refuse(`more than ${limits.entries} entries`);
    const files = [], seen = new Map(); let total = 0;
    for (const entry of raw) {
      const name = entryPath(entry.raw);
      if (!name) { if (entry.type === 'dir') continue; throw refuse('a file has no name'); }
      if (seen.has(name)) throw refuse(`${shown(name)} appears more than once`);
      seen.set(name, entry.type);
      if (entry.type === 'dir') continue;
      if (entry.size > limits.fileBytes) throw refuse(`${shown(name)} is larger than ${Math.round(limits.fileBytes / MiB)} MiB`);
      total += entry.size;
      if (total > limits.totalBytes) throw refuse(`it would expand beyond ${Math.round(limits.totalBytes / MiB)} MiB`);
      files.push({ path: name, size: entry.size, read: entry.read });
    }
    if (format === 'zip' && total > limits.ratioFloorBytes && total > limits.ratio * compressedBytes) throw refuse(`it expands more than ${limits.ratio} times (zip bomb)`);
    for (const f of files) {
      const parts = f.path.split('/');
      for (let i = 1; i < parts.length; i++) if (seen.get(parts.slice(0, i).join('/')) === 'file') throw refuse(`${shown(f.path)} is inside a path that is also a file`);
    }
    let closed = false;
    return { format, files, directories: [...seen.values()].filter(t => t === 'dir').length, close: async () => { if (closed) return; closed = true; await handle.close(); await drop(); } };
  } catch (error) { await handle.close(); await drop(); throw error; }
}
