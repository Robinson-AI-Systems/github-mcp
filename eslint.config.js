// Copied from Robinson-AI-Systems/stripe-mcp eslint.config.js @ e2f90e8 (vendor/ excluded: vendored descriptions are data).
// Deliberately lightweight Node/ESM lint; correctness is exercised by tests.
const NODE_GLOBALS = {process:'readonly',Buffer:'readonly',console:'readonly',setTimeout:'readonly',clearTimeout:'readonly',setInterval:'readonly',clearInterval:'readonly',setImmediate:'readonly',clearImmediate:'readonly',URL:'readonly',URLSearchParams:'readonly',fetch:'readonly',Response:'readonly',Request:'readonly',Headers:'readonly',AbortController:'readonly',AbortSignal:'readonly',TextEncoder:'readonly',TextDecoder:'readonly',crypto:'readonly',structuredClone:'readonly',queueMicrotask:'readonly',globalThis:'readonly',atob:'readonly',btoa:'readonly',Blob:'readonly',FormData:'readonly',ReadableStream:'readonly',WritableStream:'readonly',TransformStream:'readonly',performance:'readonly',WebSocket:'readonly',EventTarget:'readonly',Event:'readonly',DOMException:'readonly',File:'readonly',BroadcastChannel:'readonly',MessageChannel:'readonly',CompressionStream:'readonly',DecompressionStream:'readonly',Intl:'readonly',WebAssembly:'readonly'};
export default [{
  files: ['**/*.{js,mjs}'],
  ignores: ['node_modules/**', 'coverage/**', 'vendor/**', '.cache/**'],
  rules: {
    'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-constant-condition': 'error',
    'no-unreachable': 'error',
    'no-unsafe-finally': 'error',
    'no-dupe-keys': 'error',
    'no-self-assign': 'error'
  }
},
// SECOND-SHIFT-663 (2026-11-19): a deleted import left a call to an undefined function in shipped code
// (github_playground_workspace capabilities threw a ReferenceError). no-undef catches that class in source.
{
  files: ['src/**/*.{js,mjs}', 'api/**/*.js', 'workers/**/*.{js,mjs}', 'scripts/**/*.{js,mjs}', 'tools/**/*.{js,mjs}', '*.mjs', 'middleware.js'],
  ignores: ['node_modules/**', 'coverage/**', 'vendor/**', '.cache/**'],
  languageOptions: { globals: NODE_GLOBALS },
  rules: { 'no-undef': 'error' }
}];
