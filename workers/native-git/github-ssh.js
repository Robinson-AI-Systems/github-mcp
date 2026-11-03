// GIT-SSH-LEG-1: the worker's optional SSH leg to GitHub for pushes through the git remote.
//
// Measured from the owner's PC (2026-11-03, 150 MB): GitHub's HTTPS git front end ran at about 0.34 MB/s, SSH at about
// 8 MB/s (port 22 and ssh.github.com:443 alike). With NATIVE_GIT_GITHUB_TRANSPORT=ssh, each push:
//  1. makes a fresh ed25519 key pair with ssh-keygen in a private temporary folder (tmpfs when the host has one), mode
//     0600; the private key is only ever read by ssh itself, never by this code, and is deleted after the push;
//  2. asks the control plane's broker (signed claim, as every hook call) to add the PUBLIC key as a write deploy key on
//     exactly that repository, titled "GitHub Unleashed push <id> (auto-removed)"; when that is refused the push goes
//     over HTTPS and says why;
//  3. pushes over SSH with GitHub's published host keys pinned below (StrictHostKeyChecking=yes, no other known_hosts);
//  4. asks the broker to delete the key right away, success or failure, and retries; a removal that still fails is
//     written to <storage>/.remote-ssh-cleanup and retried by the worker's minute timer (removeLeftoverKeys).
// Fetches and the ls-remote read-back stay on HTTPS. Unset or any other value: HTTPS exactly as before.
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, chmod, mkdir, readdir, access, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

/**
 * GitHub's SSH host keys, pinned. Source: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints
 * (published SHA256 fingerprints +DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU (Ed25519), p2QAMXNIC1TJYWeIOttrVc98/R1BUFWu3/LiyKgUfQM
 * (ECDSA), uNiVztksCsDhcc0u9e8BujQXVUpKZIDTMczCvj3tD2s (RSA); tests check these keys hash to exactly those). The same
 * keys answer on ssh.github.com port 443 (https://docs.github.com/en/authentication/troubleshooting-ssh/using-ssh-over-the-https-port).
 * If GitHub rotates a key, pushes fall back to HTTPS (saying the host key did not match) until this list is updated.
 */
export const GITHUB_SSH_HOST_KEYS = Object.freeze([
 ['ssh-ed25519', 'AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl'],
 ['ecdsa-sha2-nistp256', 'AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEmKSENjQEezOmxkZMy7opKgwFB9nkt5YRrYMjNuG5N87uRgg6CLrbo5wAdT/y6v0mKV0U2w0WZ2YB/++Tpockg='],
 ['ssh-rsa', 'AAAAB3NzaC1yc2EAAAADAQABAAABgQCj7ndNxQowgcQnjshcLrqPEiiphnt+VTTvDP6mHBL9j1aNUkY4Ue1gvwnGLVlOhGeYrnZaMgRK6+PKCUXaDbC7qtbW8gIkhL7aGCsOr/C56SJMy/BCZfxd1nWzAOxSDPgVsmerOBYfNqltV9/hWCqBywINIR+5dIg6JTJ72pcEpEjcYgXkE2YEFXV1JHnsKgbLWNlhScqb2UmyRkQyytRLtL+38TGxkxCflmO+5Z8CSSNY7GidjMIZ7Q4zMjA2n1nGrlTDkzwDCsw+wqFPGQA179cnfGWOWRVruj16z6XyvxvjJwbz0wQZ75XK5tKSb7FNyeIEs4TT4jk+S4dhPeAUC5y+bDYirYgM4GC7uEnztnZyaVWQ7B381AK4Qdrwt51ZqExKbQpTUNn+EjqoTwvqNj4kqx5QUCI0ThS/YkOxJCXmPUWZbhjpCg56i+2aB6CmK2JGhn57K5mj0MNdBXA4/WnwH6XoPWJzK5Nyu2zB3nAZp+S5hpQs+p1vN1/wsjk=']
]);
const PINNED_HOSTS = 'github.com,ssh.github.com,[ssh.github.com]:443';
/** The only known_hosts the SSH leg uses. */
export const knownHostsText = (hosts = PINNED_HOSTS) => GITHUB_SSH_HOST_KEYS.map(([type, key]) => `${hosts} ${type} ${key}`).join('\n') + '\n';

const TRANSPORTS = ['https', 'ssh'], PORTS = [443, 22], HTTP_VERSIONS = ['HTTP/1.1', 'HTTP/2'];
/**
 * The worker's GitHub transport settings. NATIVE_GIT_GITHUB_TRANSPORT: https (default) | ssh;
 * NATIVE_GIT_GITHUB_SSH_PORT: 443 (default, ssh.github.com) | 22 (github.com); NATIVE_GIT_GITHUB_HTTP_VERSION: HTTP/1.1 |
 * HTTP/2 | unset (git's default). An unrecognised value keeps the safe default and is listed in `problems`.
 */
export function transportSettings(env = process.env) {
 const problems = [];
 const pick = (name, allowed, fallback, parse = v => v) => {
  const raw = String(env[name] ?? '').trim();
  if (!raw) return fallback;
  const value = parse(raw);
  if (allowed.includes(value)) return value;
  problems.push(`${name} must be one of ${allowed.join(', ')}; using ${fallback ?? "git's default"}`);
  return fallback;
 };
 const transport = pick('NATIVE_GIT_GITHUB_TRANSPORT', TRANSPORTS, 'https', v => v.toLowerCase());
 const sshPort = pick('NATIVE_GIT_GITHUB_SSH_PORT', PORTS, 443, Number);
 const httpVersion = pick('NATIVE_GIT_GITHUB_HTTP_VERSION', HTTP_VERSIONS, null, v => v.toUpperCase());
 return Object.freeze({ transport, sshPort, httpVersion, problems: Object.freeze(problems) });
}
/** `-c http.version=…` for the outbound git commands (nothing when unset). */
export const httpVersionArgs = version => HTTP_VERSIONS.includes(version) ? ['-c', `http.version=${version}`] : [];
/** GitHub's SSH address for one repository: ssh.github.com:443 by default, github.com:22 as the option. */
export const githubSshRemote = (owner, repo, port = 443) => port === 22 ? `ssh://git@github.com/${owner}/${repo}.git` : `ssh://git@ssh.github.com:443/${owner}/${repo}.git`;

/** Deploy key titles this worker makes; the broker only ever removes keys whose title matches exactly. */
export const PUSH_KEY_TITLE = /^GitHub Unleashed push [a-f0-9]{12} \(auto-removed\)$/;
export const pushKeyTitle = id => `GitHub Unleashed push ${id} (auto-removed)`;

const SAFE_PATH = /^\/[A-Za-z0-9._/-]+$/;
/** The ssh command git runs for the SSH leg (GIT_SSH_COMMAND). Never StrictHostKeyChecking=no. */
export function sshCommand({ keyFile, knownHostsFile, binary = 'ssh' }) {
 for (const p of [keyFile, knownHostsFile]) if (!SAFE_PATH.test(p)) throw new TypeError('Unexpected temporary path for the SSH leg.');
 if (binary !== 'ssh' && !SAFE_PATH.test(binary)) throw new TypeError('Unexpected ssh program path.');
 return [binary, '-F', '/dev/null', '-i', keyFile, '-o', 'IdentitiesOnly=yes', '-o', 'IdentityAgent=none', '-o', 'BatchMode=yes',
  '-o', 'PasswordAuthentication=no', '-o', 'KbdInteractiveAuthentication=no', '-o', 'StrictHostKeyChecking=yes',
  '-o', `UserKnownHostsFile=${knownHostsFile}`, '-o', 'GlobalKnownHostsFile=/dev/null', '-o', 'UpdateHostKeys=no', '-o', 'CheckHostIP=no',
  '-o', 'ConnectTimeout=20', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4', '-o', 'LogLevel=ERROR'].map(a => /^[A-Za-z0-9._/=:@+,-]+$/.test(a) ? a : `'${a}'`).join(' ');
}

async function writableDir(dir) { try { await access(dir, constants.W_OK); return (await realpath(dir)) === dir; } catch { return false; } }
const run = (cmd, args, timeout = 30000) => new Promise(resolve => execFile(cmd, args, { timeout, env: { PATH: process.env.PATH, LANG: 'C' } }, (error, stdout, stderr) => resolve({ ok: !error, stdout: String(stdout), stderr: String(stderr) })));

/**
 * A fresh key pair for one push, in a private folder (tmpfs at /dev/shm when available). Returns the public key, the
 * key's short id, the git environment additions and `dispose()`, which deletes the folder. The private key stays in the
 * file ssh reads; this code never reads it.
 */
export async function ephemeralKey({ binary = 'ssh', base = null } = {}) {
 const parent = base ?? (await writableDir('/dev/shm') ? '/dev/shm' : tmpdir());
 const dir = await mkdtemp(join(parent, 'robinson-ssh-'));
 const dispose = () => rm(dir, { recursive: true, force: true }).catch(() => {});
 try {
  await chmod(dir, 0o700);
  const keyFile = join(dir, 'id'), knownHostsFile = join(dir, 'known_hosts');
  const id = randomBytes(6).toString('hex');
  const made = await run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', pushKeyTitle(id).replace(/\s+/g, '-'), '-f', keyFile]);
  if (!made.ok) throw new Error('ssh-keygen did not make a key');
  await chmod(keyFile, 0o600);
  const publicKey = (await readFile(keyFile + '.pub', 'utf8')).trim().split(/\s+/).slice(0, 2).join(' ');
  if (!/^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5[A-Za-z0-9+/]{43,}={0,2}$/.test(publicKey)) throw new Error('unexpected public key');
  await writeFile(knownHostsFile, knownHostsText(), { mode: 0o600 });
  return { id, publicKey, title: pushKeyTitle(id), env: { GIT_SSH_COMMAND: sshCommand({ keyFile, knownHostsFile, binary }), GIT_SSH_VARIANT: 'ssh' }, dispose };
 } catch (error) { await dispose(); throw error; }
}
/** git's own options for an SSH push (the worker's prefix forbids every protocol it does not name). */
export const sshGitArgs = () => ['-c', 'protocol.ssh.allow=always'];

/** Why an SSH push did not get through, from ssh's own words (never repository text). */
export function sshProblem(stderr) {
 const text = String(stderr ?? '');
 if (/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED|No (ED25519|ECDSA|RSA)? ?host key is known/i.test(text)) return "GitHub's SSH host key did not match the pinned keys";
 if (/Permission denied \(publickey\)/i.test(text)) return 'GitHub did not accept the temporary deploy key';
 if (/Connection (timed out|refused)|Could not resolve hostname|Network is unreachable|Connection closed|kex_exchange_identification/i.test(text)) return 'GitHub could not be reached over SSH from this host';
 return 'the SSH push did not answer';
}

// ---- leftover removals ---------------------------------------------------------------------------------------------
const CLEANUP_DIR = '.remote-ssh-cleanup';
const CLEANUP_KEEP_MS = 24 * 3600000;
export const MAX_KEY_CALLS = 50;
/** Records a deploy key whose removal did not finish (claim, broker address, key id; no key material). */
export async function rememberLeftover(root, record) {
 const dir = join(root, CLEANUP_DIR);
 await mkdir(dir, { recursive: true, mode: 0o700 });
 await writeFile(join(dir, `${Number(record.keyId)}.json`), JSON.stringify(record), { mode: 0o600 });
}
/**
 * The worker's minute timer: asks the broker again to remove each recorded leftover key (and to sweep that repository
 * for marked keys older than 15 minutes). A record goes when the key is gone, after 24 hours (the claim's report grace;
 * the next push's sweep takes over) or after MAX_KEY_CALLS broker calls.
 */
export async function removeLeftoverKeys(root, { callBroker, now = Date.now() } = {}) {
 const dir = join(root, CLEANUP_DIR); let removed = 0, kept = 0;
 for (const name of await readdir(dir).catch(() => [])) {
  if (!/^\d{1,20}\.json$/.test(name)) continue;
  const file = join(dir, name);
  let record; try { record = JSON.parse(await readFile(file, 'utf8')); } catch { await rm(file, { force: true }); continue; }
  if (!record || now - Number(record.at) > CLEANUP_KEEP_MS || !(record.n < MAX_KEY_CALLS)) { await rm(file, { force: true }); continue; }
  const answer = await callBroker(record.broker, record.claim, { action: 'remove', journal: record.journal, key_id: record.keyId, actedAs: record.actedAs, n: record.n, sweep: true }).catch(() => null);
  if (answer?.removed === true) { await rm(file, { force: true }); removed++; continue; }
  await writeFile(file, JSON.stringify({ ...record, n: record.n + 1 }), { mode: 0o600 }); kept++;
 }
 return { removed, kept };
}
