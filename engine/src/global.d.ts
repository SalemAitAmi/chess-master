// Ambient declarations only — this file is NEVER bundled or imported.
// The real values are injected by esbuild's `define` in build.mjs.
// When running from source (npm run dev / vitest) these are `undefined`,
// and every read site uses `?? true` so logging defaults to ON.
declare global {
  // eslint-disable-next-line no-var
  var __LOG__: boolean | undefined;
  // eslint-disable-next-line no-var
  var __DEV__: boolean | undefined;
}

export {};