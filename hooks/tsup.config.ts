import { defineConfig } from "tsup";
import { readdirSync } from "node:fs";

// Build each .mts source file as a separate .mjs output (no bundling between hooks).
// Plugins cannot install deps at runtime, so all npm deps are inlined per output;
// sibling hook imports stay external so we don't duplicate side-effecting
// isMainModule() guards.
const discoveredEntries = readdirSync("src")
  .filter((f) => f.endsWith(".mts"))
  .map((f) => `src/${f}`);
const entries = Array.from(new Set(discoveredEntries)).sort();

const hookExternalSet = new Set(
  entries.map((e) => `./${e.replace("src/", "").replace(".mts", ".mjs")}`),
);

export default defineConfig({
  entry: entries,
  format: ["esm"],
  outDir: ".",
  outExtension: () => ({ js: ".mjs" }),
  bundle: true,
  splitting: false,
  noExternal: [/.*/],
  sourcemap: false,
  dts: false,
  clean: false,
  target: "node20",
  esbuildPlugins: [
    {
      name: "externalize-sibling-hooks",
      setup(build) {
        build.onResolve({ filter: /^\.\/.*\.mjs$/ }, (args) => {
          if (hookExternalSet.has(args.path)) {
            return { path: args.path, external: true };
          }
          return undefined;
        });
      },
    },
  ],
});
