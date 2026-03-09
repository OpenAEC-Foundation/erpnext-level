/**
 * Build script: bundles electron/main.ts + server/ into a single JS file
 * using esbuild. External: electron, native Node modules.
 */

import { build } from "esbuild";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

await build({
  entryPoints: [resolve(root, "electron/main.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: resolve(root, "dist-electron/electron/main.js"),
  external: ["electron"],
  // No need for define; main.ts sets ELECTRON at runtime
  sourcemap: true,
  minify: false,
  treeShaking: true,
});

console.log("[build-electron] Done → dist-electron/electron/main.js");
