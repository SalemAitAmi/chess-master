import * as esbuild from 'esbuild';

const isProduction = process.argv.includes('--prod');

await esbuild.build({
  // Single entry point: the WebSocket/UCI server is the only engine interface.
  entryPoints: ['src/server.js'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outdir: isProduction ? 'dist/prod' : 'dist/dev',

  // Sources read `globalThis.__LOG__`, so the define key must be the full
  // member expression — esbuild matches expressions verbatim.
  //
  //   const __LOG__ = globalThis.__LOG__ ?? true;   // source
  //   const __LOG__ = false ?? true;                // after define
  //   const __LOG__ = false;                        // after minifySyntax
  //   if (false && LOG.x) { ... }                   // after inlining → stripped
  define: {
    'globalThis.__LOG__': isProduction ? 'false' : 'true',
    'globalThis.__DEV__': isProduction ? 'false' : 'true',
  },

  // minifySyntax is what performs the constant fold + dead-branch removal.
  // Enabled in BOTH modes so the dev bundle has the same shape as prod and a
  // DCE failure can't be prod-only. Identifier mangling stays prod-only so
  // dev stack traces remain readable.
  minifySyntax: true,
  minifyIdentifiers: isProduction,
  minifyWhitespace: isProduction,

  treeShaking: true,
  sourcemap: isProduction ? false : 'inline',
  external: ['ws'],

  // NOTE: logger.js and openingBook.js resolve paths via
  // path.join(path.dirname(fileURLToPath(import.meta.url)), '../../<dir>').
  // After bundling, import.meta.url is dist/{dev,prod}/server.js, so '../../'
  // lands on engine/ — the same directory it resolves to from src/<sub>/.
  // That equivalence is load-bearing: if outdir depth ever changes, logs/ and
  // data/baron30.bin will silently resolve elsewhere.
});

console.log(`Built ${isProduction ? 'production (logging stripped)' : 'dev'} bundle`);