import * as esbuild from 'esbuild';

const isProduction = process.argv.includes('--prod');

await esbuild.build({
  entryPoints: ['src/engine.js', 'src/server.js'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outdir: isProduction ? 'dist/prod' : 'dist/dev',

  // ── CRITICAL FIX ──
  // Source code reads `globalThis.__LOG__`, not bare `__LOG__`.
  // esbuild's define matches exact expressions — the previous key
  // `'__LOG__'` matched nothing, so DCE never fired and every
  // `if (__LOG__ && ...)` block survived into the prod bundle.
  //
  // After substitution: `const __LOG__ = false ?? true` → `false`,
  // then `if (false && LOG.search)` → dead code → stripped.
  define: {
    'globalThis.__LOG__': isProduction ? 'false' : 'true',
    'globalThis.__DEV__': isProduction ? 'false' : 'true',
  },

  minify: isProduction,        // Required for DCE to actually fire
  treeShaking: true,
  external: ['ws'],
});

console.log(`Built ${isProduction ? 'production (logging stripped)' : 'dev'} bundle`);