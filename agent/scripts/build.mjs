import { build, context } from "esbuild";

const isWatch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "dist/agent.mjs",
  external: ["better-sqlite3", "@xenova/transformers", "onnxruntime-node", "sharp"],
  banner: {
    js: [
      '// ESM ↔ CJS bridge for native modules',
      'import { createRequire } from "module";',
      'const require = createRequire(import.meta.url);',
    ].join("\n"),
  },
  sourcemap: true,
  logLevel: "info",
};

if (isWatch) {
  const ctx = await context(options);
  await ctx.watch();
  console.error("[agent] watching for changes...");
} else {
  await build(options);

  // Upload source maps to Sentry (only in CI/release with auth token present)
  if (process.env.SENTRY_AUTH_TOKEN) {
    const { execFileSync } = await import("child_process");
    try {
      execFileSync(
        "sentry-cli",
        [
          "sourcemaps",
          "upload",
          "--org",
          "openorchestra",
          "--project",
          "openorchestra-agent",
          "dist/",
        ],
        { stdio: "inherit", env: process.env },
      );
    } catch (e) {
      console.error(
        "[agent] source map upload failed (non-fatal):",
        e.message,
      );
    }
  }
}
