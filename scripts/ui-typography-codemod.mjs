/**
 * UI typography codemod.
 *
 * Replaces every hard-coded `text-[<n>px]` utility with a step from the design
 * scale defined in apps/web/src/app/globals.css. Client-facing surfaces (portal,
 * public invoice page) and the print / PDF documents keep their own scale and
 * are skipped on purpose.
 *
 *   node scripts/ui-typography-codemod.mjs [--write]
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = "apps/web/src";
const WRITE = process.argv.includes("--write");

/* Surfaces that intentionally keep an independent type scale. */
const SKIP = [
  "app/portal-client/",
  "app/portal-login/",
  "app/p/",
  "app/(app)/portal/",
  "capital/_components/invoice-print-view.tsx",
  "components/portal-charts.tsx",
];
const SKIP_LIB = /lib[\\/].*-pdf\.ts$/;

/* px → scale step. Collapses 17 ad-hoc sizes into the 11 documented steps. */
const MAP = {
  8.5: "micro",
  9: "micro",
  9.5: "micro",
  10: "micro",
  10.5: "micro",
  11: "meta",
  11.5: "meta",
  12: "body",
  12.5: "body",
  13: "body-lg",
  13.5: "body-lg",
  14: "body-lg",
  14.5: "body-lg",
  15: "section",
  16: "section",
  17: "title",
  18: "title",
  19: "title",
  20: "stat",
  21: "stat",
  22: "stat",
  24: "page",
  26: "page",
  28: "stat-lg",
  30: "hero",
  42: "display",
};

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(e.name)) out.push(p);
  }
  return out;
}

const norm = (p) => p.split(path.sep).join("/");

const changed = [];
const unknown = new Map();
let replacements = 0;

for (const file of walk(ROOT)) {
  const rel = norm(file);
  if (SKIP.some((s) => rel.includes(s))) continue;
  if (SKIP_LIB.test(rel)) continue;

  const src = fs.readFileSync(file, "utf8");
  let hits = 0;

  const next = src.replace(/text-\[(\d+(?:\.\d+)?)px\]/g, (match, raw) => {
    const px = Number(raw);
    const step = MAP[px];
    if (!step) {
      unknown.set(match, (unknown.get(match) || 0) + 1);
      return match;
    }
    hits++;
    return `text-${step}`;
  });

  if (hits) {
    replacements += hits;
    changed.push({ file: rel, hits });
    if (WRITE) fs.writeFileSync(file, next);
  }
}

changed.sort((a, b) => b.hits - a.hits);
console.log(`${WRITE ? "APPLIED" : "DRY RUN"} — ${replacements} replacements across ${changed.length} files\n`);
for (const c of changed) console.log(`  ${String(c.hits).padStart(4)}  ${c.file}`);
if (unknown.size) {
  console.log("\nUnmapped sizes (left untouched):");
  for (const [k, v] of unknown) console.log(`  ${k} ×${v}`);
}
