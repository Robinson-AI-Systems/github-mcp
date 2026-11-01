// Right-sized Playground allocations. A size class only ever LOWERS the protected
// operator ceilings (PLAYGROUND_CPU_CPUS / PLAYGROUND_MEMORY_BYTES) and fresh host
// headroom; it can never raise them, reserve capacity or buy anything.
// The class totals cover the whole allocation (broker, gateway and command runtime).
const GIB = 1024 ** 3;
export const SIZE_CLASSES = Object.freeze({
  small: Object.freeze({ cpuCpus: 2, memoryBytes: 2 * GIB, fits: 'lint, type checks and unit tests of small projects; no browser tests' }),
  medium: Object.freeze({ cpuCpus: 4, memoryBytes: 4 * GIB, fits: 'typical installs, builds and test suites, including a test database' }),
  large: Object.freeze({ cpuCpus: 8, memoryBytes: 8 * GIB, fits: 'monorepos, Playwright/Chromium browser tests and heavy builds' })
});
export const RUNTIME_CHOICES = Object.freeze(['auto', 'none', 'small', 'medium', 'large']);
const fail = message => Object.assign(new TypeError(message), { safeMessage: true, safeCode: 'playground_size_invalid' });

// The protected default for `auto`. Unset keeps the original full-size behaviour.
export function defaultSizeClass(env = {}) {
  const value = env.PLAYGROUND_DEFAULT_SIZE ?? 'medium';
  if (!Object.hasOwn(SIZE_CLASSES, value)) throw fail('Protected PLAYGROUND_DEFAULT_SIZE must be small, medium or large.');
  return value;
}

// Resolve what the caller asked for into a stored class name, or null for `none`.
export function resolveSizeClass(requested, env = {}) {
  if (requested === undefined || requested === null || requested === 'auto') return defaultSizeClass(env);
  if (requested === 'none') return null;
  if (!Object.hasOwn(SIZE_CLASSES, requested)) throw fail('Runtime size must be auto, none, small, medium or large.');
  return requested;
}

// Apply a stored class to an already protected config. Missing class = unchanged
// (rows created before sizing existed keep their original plan and hash).
export function sizedConfig(config, size) {
  if (size === undefined || size === null) return config;
  const cls = SIZE_CLASSES[size];
  if (!cls) throw fail('Stored allocation size class is unknown; no allocation was changed.');
  return {
    ...config,
    cpuCpus: Math.min(config.cpuCpus ?? 8, cls.cpuCpus),
    memoryBytes: Math.min(config.memoryBytes ?? 8 * GIB, cls.memoryBytes)
  };
}

export function describeSize(size) {
  if (!size || !SIZE_CLASSES[size]) return null;
  const { cpuCpus, memoryBytes, fits } = SIZE_CLASSES[size];
  return { size_class: size, ceiling: { cpuCpus, memoryBytes }, fits };
}

// FLEET-2: a command the kernel killed for memory gets a plain hint naming the next size.
const NEXT_SIZE = Object.freeze({ small: 'medium', medium: 'large' });
export function upsizeHint(execution, size) {
  if (execution?.reason !== 'out_of_memory') return null;
  if (size === 'large') return { next_size: null, hint: 'The command ran out of memory on the largest size (large). Split the job into smaller commands (for example run test files in groups).' };
  const next = NEXT_SIZE[size];
  if (!next) return { next_size: 'large', hint: 'The command ran out of memory. Run it again on a larger runtime size (medium or large).' };
  return { next_size: next, hint: `The command ran out of memory on size ${size}. Run it again on size ${next} (open a new workspace with runtime "${next}", or use github_playground_run with size "${next}").` };
}
export function withUpsizeHint(execution, size) {
  const hint = upsizeHint(execution, size);
  return hint ? { ...execution, upsize: hint } : execution;
}
