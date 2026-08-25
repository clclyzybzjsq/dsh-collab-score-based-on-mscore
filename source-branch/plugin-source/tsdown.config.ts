/**
 * Browser-half build: bundle `lib/client/index.js` into `lib/client.js` as a
 * closure-factory artifact the shell's module loader materializes —
 * `window.__ModuleLoader__.load({ id, factory })` — with the injected `require`
 * resolving baseline externals (react, react/jsx-runtime) from the module
 * table. Mirrors the in-repo `clientBundle` preset shape for out-of-tree
 * bundles (packages/client/tsdown.client.ts).
 */
const EXTERNAL = new Set(['react', 'react/jsx-runtime'])

export default {
  name: '@local/dsh-collab-score/client',
  entry: { client: 'lib/client/index.js' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  clean: false,
  sourcemap: true,
  deps: {
    neverBundle: (specifier) => EXTERNAL.has(specifier),
    alwaysBundle: (specifier) => !EXTERNAL.has(specifier),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "@local/dsh-collab-score", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}