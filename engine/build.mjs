import * as esbuild from 'esbuild';

const isProduction = process.argv.includes('--prod');

await esbuild.build({
  entryPoints: ['src/engine.js', 'src/server.js'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outdir: isProduction ? 'dist/prod' : 'dist/dev',

  // ── This is the "preprocessor" ──
  // esbuild replaces __LOG__ with the literal `false` at parse time,
  // then eliminates `if (false) { ... }` blocks entirely.
  define: {
    '__LOG__': isProduction ? 'false' : 'true',
    '__DEV__': isProduction ? 'false' : 'true',
  },

  minify: isProduction,        // Required for DCE to actually fire
  treeShaking: true,
  external: ['ws'],            // Don't bundle native deps
});

console.log(`Built ${isProduction ? 'production (logging stripped)' : 'dev'} bundle`);