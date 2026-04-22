import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  outfile: 'dist/index.js',
  sourcemap: true,
  minify: true,
  // Shim CJS-style require / __filename / __dirname inside an ESM bundle.
  // The `__esbuild` prefix avoids collisions with any symbol the bundler
  // inlines from user code. Invoked via `node <path>` in plugin.json, so no
  // shebang is needed.
  banner: {
    js: [
      "import { createRequire as __esbuildCreateRequire } from 'module';",
      "import { fileURLToPath as __esbuildFileURLToPath } from 'url';",
      "import { dirname as __esbuildDirname } from 'path';",
      'const require = __esbuildCreateRequire(import.meta.url);',
      'const __filename = __esbuildFileURLToPath(import.meta.url);',
      'const __dirname = __esbuildDirname(__filename);',
    ].join('\n'),
  },
  logLevel: 'info',
});
