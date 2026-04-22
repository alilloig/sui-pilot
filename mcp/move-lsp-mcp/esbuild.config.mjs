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
  banner: {
    js: [
      '#!/usr/bin/env node',
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
