#!/usr/bin/env node
// Vendor brand-icon SVGs into src/assets/brand-icons/ for the connection catalogue.
// Reads iconSlug values from the bundled catalogue and downloads each matching
// SVG from the Simple Icons jsDelivr mirror. One-off; safe to re-run.

import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT_DIR = join(ROOT, "src/assets/brand-icons");
const CDN = "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons";

const CATALOGUE_FILES = [
  "agent/src/connections/service-catalogue/dev-and-infra.ts",
  "agent/src/connections/service-catalogue/productivity-and-comms.ts",
];

function loadSlugs() {
  const slugs = new Set();
  for (const rel of CATALOGUE_FILES) {
    const text = readFileSync(join(ROOT, rel), "utf-8");
    for (const line of text.split("\n")) {
      const idMatch = line.match(/\bid:\s*"([^"]+)"/);
      if (!idMatch) continue;
      const slugMatch = line.match(/\biconSlug:\s*"([^"]+)"/);
      slugs.add(slugMatch ? slugMatch[1] : idMatch[1]);
    }
  }
  return [...slugs].sort();
}

async function fetchOne(slug) {
  const url = `${CDN}/${slug}.svg`;
  const resp = await fetch(url);
  if (!resp.ok) return null;
  return await resp.text();
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const slugs = loadSlugs();
  const missing = [];
  let fetched = 0;
  let skipped = 0;
  for (const slug of slugs) {
    const out = join(OUT_DIR, `${slug}.svg`);
    if (existsSync(out)) { skipped++; continue; }
    const svg = await fetchOne(slug);
    if (!svg) { missing.push(slug); continue; }
    writeFileSync(out, svg);
    fetched++;
    await new Promise((r) => setTimeout(r, 50));
  }
  console.log(`[brand-icons] fetched=${fetched} skipped=${skipped} missing=${missing.length}`);
  if (missing.length) console.warn(`[brand-icons] missing: ${missing.join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
