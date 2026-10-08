import * as esbuild from 'esbuild';
const isProduction = process.argv.includes('--prod');
await esbuild.build({
  // Two entry points, ONE output directory:
  //   dist/<mode>/server.js     the WebSocket/UCI server
  //   dist/<mode>/smpWorker.js  the Lazy SMP helper thread
  // lazySMP.js resolves the worker as `dirname(import.meta.url)/smpWorker.js`.
  // From source that is src/search/smpWorker.js; bundled it is the sibling of
  // server.js. The object form of entryPoints pins both names flat in outdir.
  entryPoints: { server: 'src/server.js', smpWorker: 'src/search/smpWorker.js' },
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outdir: isProduction ? 'dist/prod' : 'dist/dev',
  define: {
    'globalThis.__LOG__': isProduction ? 'false' : 'true',
    'globalThis.__DEV__': isProduction ? 'false' : 'true',
  },
  minifySyntax: true,
  minifyIdentifiers: isProduction,
  minifyWhitespace: isProduction,
  treeShaking: true,
  sourcemap: isProduction ? false : 'inline',
  external: ['ws'],
  // profiles.json is an ES import (import attributes) and is inlined into the
  // bundle. Only logger.js and openingBook.js still resolve '../../<dir>' from
  // import.meta.url; both bundles sit at dist/<mode>/, so that still lands on engine/.
});
console.log(`Built ${isProduction ? 'production (logging stripped)' : 'dev'} bundle`);